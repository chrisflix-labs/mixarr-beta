import type { Prisma } from "@prisma/client";
import prisma from "./prisma";

export const JOB_HISTORY_RETENTION_LIMIT = 500;
export const JOB_HISTORY_PAGE_LIMIT = 100;

export type JobHistoryStatus = "running" | "success" | "warning" | "failed" | "cancelled";
export type JobHistoryTrigger = "manual" | "scheduled" | "retry" | "startup" | "system" | "unknown";

export type JobCounts = {
  attempted?: number | null;
  processed?: number | null;
  skipped?: number | null;
  failed?: number | null;
};

export type StartedJobHistory = {
  id: string;
  startedAt: Date;
};

const TYPE_GROUPS: Record<string, string[]> = {
  bpm: ["bpm", "local_bpm"],
  audio_features: ["audio_features", "local_audio_features"],
  plex_sync: ["plex_sync"],
  playlist: ["playlist"],
  library_health: ["library_health", "genres", "popularity"],
  cleanup: ["cleanup"],
  other: ["other", "initial", "tags"],
};

function capText(value: unknown, maxLength: number) {
  if (value == null) return undefined;
  const text = value instanceof Error ? value.message : String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function countsFromResult(result: unknown): JobCounts {
  if (!result || typeof result !== "object") return {};
  const source = result as Record<string, unknown>;
  return {
    attempted: finiteNumber(source.attempted),
    processed: finiteNumber(source.processed),
    skipped: finiteNumber(source.skipped),
    failed: finiteNumber(source.failed),
  };
}

function hasCounts(counts: JobCounts) {
  return ["attempted", "processed", "skipped", "failed"].some((key) => finiteNumber(counts[key as keyof JobCounts]) != null);
}

export function statusFromCounts(counts: JobCounts): JobHistoryStatus {
  return (counts.failed || 0) > 0 ? "warning" : "success";
}

export function summaryFromResult(name: string, result: unknown, counts: JobCounts = countsFromResult(result)) {
  if (hasCounts(counts)) {
    if ((counts.attempted ?? 0) === 0 && (counts.processed ?? 0) === 0 && (counts.failed ?? 0) === 0) {
      if (/bpm/i.test(name)) {
        return `BPM backfill completed with no eligible tracks. attempted=0, processed=0, skipped=${counts.skipped ?? 0}, failed=0. The selected retry queue was empty or all matching tracks were already complete.`;
      }
      if (/audio/i.test(name)) {
        return `Audio feature backfill completed with no eligible tracks. attempted=0, processed=0, skipped=${counts.skipped ?? 0}, failed=0. The selected retry queue was empty, all matching tracks were already complete, or no tracks matched the selected retry filter.`;
      }
    }
    return `${name} completed. attempted=${counts.attempted ?? 0}, processed=${counts.processed ?? 0}, skipped=${counts.skipped ?? 0}, failed=${counts.failed ?? 0}.`;
  }

  if (result && typeof result === "object" && "activeTracksSeen" in result) {
    const sync = result as Record<string, unknown>;
    return `${name} completed. activeTracksSeen=${sync.activeTracksSeen ?? 0}, markedMissing=${sync.markedMissing ?? 0}, restored=${sync.restored ?? 0}.`;
  }

  return `${name} completed.`;
}

function metadataOrUndefined(metadata: Prisma.InputJsonValue | undefined) {
  return metadata === undefined ? undefined : metadata;
}

async function pruneOldJobHistory() {
  const oldRows = await prisma.jobHistory.findMany({
    orderBy: { startedAt: "desc" },
    skip: JOB_HISTORY_RETENTION_LIMIT,
    select: { id: true },
  });
  if (oldRows.length === 0) return;
  await prisma.jobHistory.deleteMany({ where: { id: { in: oldRows.map((row) => row.id) } } });
}

export async function safeStartJobHistory({
  userId,
  type,
  name,
  trigger = "unknown",
  metadata,
}: {
  userId?: string | null;
  type: string;
  name: string;
  trigger?: JobHistoryTrigger | string;
  metadata?: Prisma.InputJsonValue;
}): Promise<StartedJobHistory | null> {
  try {
    const row = await prisma.jobHistory.create({
      data: {
        userId: userId || undefined,
        type,
        name,
        status: "running",
        trigger,
        metadata: metadataOrUndefined(metadata),
      },
      select: { id: true, startedAt: true },
    });
    await pruneOldJobHistory();
    return row;
  } catch (error) {
    console.error("[JobHistory] Failed to start job history record", error);
    return null;
  }
}

export async function safeFinishJobHistory({
  job,
  status,
  result,
  counts = countsFromResult(result),
  summary,
  error,
  metadata,
}: {
  job: StartedJobHistory | null;
  status?: JobHistoryStatus;
  result?: unknown;
  counts?: JobCounts;
  summary?: string;
  error?: unknown;
  metadata?: Prisma.InputJsonValue;
}) {
  if (!job) return;
  const finishedAt = new Date();
  const finalStatus = status || (error ? "failed" : statusFromCounts(counts));
  try {
    await prisma.jobHistory.update({
      where: { id: job.id },
      data: {
        status: finalStatus,
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - job.startedAt.getTime()),
        summary: capText(summary, 600),
        attempted: counts.attempted ?? undefined,
        processed: counts.processed ?? undefined,
        skipped: counts.skipped ?? undefined,
        failed: counts.failed ?? undefined,
        error: capText(error, 2_000),
        metadata: metadataOrUndefined(metadata),
      },
    });
    await pruneOldJobHistory();
  } catch (historyError) {
    console.error("[JobHistory] Failed to finish job history record", historyError);
  }
}

export async function safeRecordJobHistory({
  userId,
  type,
  name,
  status,
  trigger = "unknown",
  startedAt = new Date(),
  finishedAt = new Date(),
  summary,
  counts = {},
  error,
  metadata,
}: {
  userId?: string | null;
  type: string;
  name: string;
  status: JobHistoryStatus;
  trigger?: JobHistoryTrigger | string;
  startedAt?: Date;
  finishedAt?: Date;
  summary?: string;
  counts?: JobCounts;
  error?: unknown;
  metadata?: Prisma.InputJsonValue;
}) {
  try {
    const row = await prisma.jobHistory.create({
      data: {
        userId: userId || undefined,
        type,
        name,
        status,
        trigger,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        summary: capText(summary, 600),
        attempted: counts.attempted ?? undefined,
        processed: counts.processed ?? undefined,
        skipped: counts.skipped ?? undefined,
        failed: counts.failed ?? undefined,
        error: capText(error, 2_000),
        metadata: metadataOrUndefined(metadata),
      },
      select: { id: true },
    });
    await pruneOldJobHistory();
    return row.id;
  } catch (historyError) {
    console.error("[JobHistory] Failed to record job history", historyError);
    return null;
  }
}

export async function getJobHistory({
  userId,
  status,
  type,
  limit = JOB_HISTORY_PAGE_LIMIT,
}: {
  userId: string;
  status?: string;
  type?: string;
  limit?: number;
}) {
  const typeGroup = type && type !== "all" ? TYPE_GROUPS[type] : undefined;
  return prisma.jobHistory.findMany({
    where: {
      OR: [{ userId }, { userId: null }],
      ...(status && status !== "all" ? { status } : {}),
      ...(typeGroup ? { type: { in: typeGroup } } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}

export async function getRecentJobSummary(userId: string) {
  const [lastJob, recentFailures] = await Promise.all([
    prisma.jobHistory.findFirst({
      where: { OR: [{ userId }, { userId: null }] },
      orderBy: { startedAt: "desc" },
    }),
    prisma.jobHistory.count({
      where: {
        OR: [{ userId }, { userId: null }],
        status: "failed",
        startedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  return { lastJob, recentFailures };
}
