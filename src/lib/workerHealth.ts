import os from "os";
import type { Prisma } from "@prisma/client";
import { APP_VERSION } from "./appVersion";
import prisma from "./prisma";

export const DEFAULT_WORKER_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_WORKER_STALE_THRESHOLD_MS = 5 * 60_000;
export const DEFAULT_JOB_LEASE_MS = 10 * 60_000;

type WorkerRuntime = {
  workerId: string;
  hostname: string;
  processId: number;
  startedAt: Date;
  heartbeatTimer: NodeJS.Timeout | null;
  initialized: boolean;
  shuttingDown: boolean;
  currentJobId: string | null;
  currentJobType: string | null;
  lastError: string | null;
  lastRecovery: WorkerRecoveryResult | null;
};

declare global {
  var mixarrWorkerRuntime: WorkerRuntime | undefined;
}

function configuredMs(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function workerHeartbeatIntervalMs() {
  return configuredMs(process.env.WORKER_HEARTBEAT_INTERVAL_MS, DEFAULT_WORKER_HEARTBEAT_INTERVAL_MS);
}

export function workerStaleThresholdMs() {
  return configuredMs(process.env.WORKER_STALE_THRESHOLD_MS, DEFAULT_WORKER_STALE_THRESHOLD_MS);
}

export function jobLeaseMs() {
  return configuredMs(process.env.WORKER_JOB_LEASE_MS, DEFAULT_JOB_LEASE_MS);
}

function newWorkerId() {
  const host = os.hostname() || "unknown-host";
  return `${host}:${process.pid}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

const runtime: WorkerRuntime = globalThis.mixarrWorkerRuntime ?? {
  workerId: newWorkerId(),
  hostname: os.hostname() || "unknown-host",
  processId: process.pid,
  startedAt: new Date(),
  heartbeatTimer: null,
  initialized: false,
  shuttingDown: false,
  currentJobId: null,
  currentJobType: null,
  lastError: null,
  lastRecovery: null,
};

globalThis.mixarrWorkerRuntime = runtime;

function capText(value: unknown, maxLength: number) {
  if (value == null) return null;
  const text = value instanceof Error ? value.message : String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function jsonObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function getWorkerIdentity() {
  return {
    workerId: runtime.workerId,
    hostname: runtime.hostname,
    processId: runtime.processId,
    startedAt: runtime.startedAt,
    appVersion: APP_VERSION,
  };
}

export function leaseExpiresAt(now = new Date()) {
  return new Date(now.getTime() + jobLeaseMs());
}

export function isHeartbeatStale(lastHeartbeatAt: Date | string | null | undefined, now = Date.now(), thresholdMs = workerStaleThresholdMs()) {
  if (!lastHeartbeatAt) return true;
  const timestamp = new Date(lastHeartbeatAt).getTime();
  return !Number.isFinite(timestamp) || now - timestamp > thresholdMs;
}

export function isSafeToAutoRequeueJobType(type: string, name = "") {
  const normalized = type.toLowerCase();
  const label = name.toLowerCase();
  if (normalized.includes("playlist") || label.includes("playlist")) return false;
  return [
    "plex_sync",
    "library_health",
    "bpm",
    "audio_features",
    "local_audio_features",
    "popularity",
    "tags",
    "genres",
    "initial",
    "cleanup",
  ].includes(normalized);
}

export function recoveryHintForJob(type: string, name = "") {
  if (isSafeToAutoRequeueJobType(type, name)) {
    return "Safe to retry. Mixarr can restart this enrichment, analysis, or sync job without destructive playlist changes.";
  }
  return "Manual review required. Mixarr will not automatically re-run playlist or destructive jobs.";
}

export async function heartbeatWorker({
  status = runtime.currentJobId ? "processing" : "idle",
  currentJobId = runtime.currentJobId,
  currentJobType = runtime.currentJobType,
  error,
}: {
  status?: string;
  currentJobId?: string | null;
  currentJobType?: string | null;
  error?: unknown;
} = {}) {
  const now = new Date();
  runtime.currentJobId = currentJobId ?? null;
  runtime.currentJobType = currentJobType ?? null;
  if (error !== undefined) runtime.lastError = capText(error, 1_000);

  try {
    await prisma.workerHeartbeat.upsert({
      where: { workerId: runtime.workerId },
      create: {
        workerId: runtime.workerId,
        hostname: runtime.hostname,
        processId: runtime.processId,
        appVersion: APP_VERSION,
        status,
        startedAt: runtime.startedAt,
        lastHeartbeatAt: now,
        currentJobId,
        currentJobType,
        lastError: runtime.lastError,
      },
      update: {
        hostname: runtime.hostname,
        processId: runtime.processId,
        appVersion: APP_VERSION,
        status,
        lastHeartbeatAt: now,
        currentJobId,
        currentJobType,
        lastError: runtime.lastError,
      },
    });
  } catch (heartbeatError) {
    runtime.lastError = capText(heartbeatError, 1_000);
    console.error("[Worker] Failed to record heartbeat", heartbeatError);
  }
}

export async function markJobLeaseHeartbeat({
  jobId,
  jobType,
  lockKey,
  progress,
  currentItemLabel,
}: {
  jobId?: string | null;
  jobType?: string | null;
  lockKey?: string | null;
  progress?: Prisma.InputJsonValue;
  currentItemLabel?: string | null;
}) {
  if (!jobId) {
    await heartbeatWorker({
      status: jobType ? "processing" : "idle",
      currentJobId: null,
      currentJobType: jobType ?? null,
    });
    return;
  }

  const now = new Date();
  await heartbeatWorker({ status: "processing", currentJobId: jobId, currentJobType: jobType ?? null });

  try {
    await prisma.jobHistory.update({
      where: { id: jobId },
      data: {
        workerId: runtime.workerId,
        lockKey: lockKey || undefined,
        lastHeartbeatAt: now,
        lastProgressAt: progress || currentItemLabel ? now : undefined,
        leaseExpiresAt: leaseExpiresAt(now),
        progress: progress ?? undefined,
        currentItemLabel: currentItemLabel === undefined ? undefined : currentItemLabel,
      },
    });
  } catch (error) {
    console.error(`[Worker] Failed to update job lease heartbeat jobId=${jobId}`, error);
  }
}

export async function markWorkerStopped(reason = "shutdown") {
  runtime.shuttingDown = true;
  if (runtime.heartbeatTimer) {
    clearInterval(runtime.heartbeatTimer);
    runtime.heartbeatTimer = null;
  }

  try {
    await prisma.workerHeartbeat.update({
      where: { workerId: runtime.workerId },
      data: {
        status: "stopped",
        lastHeartbeatAt: new Date(),
        currentJobId: null,
        currentJobType: null,
        lastError: reason,
      },
    });
  } catch (error) {
    console.error("[Worker] Failed to mark worker stopped", error);
  }
}

async function startupSelfCheck() {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - workerStaleThresholdMs());
  const [pending, stale, schedulerState] = await Promise.all([
    prisma.jobHistory.count({ where: { status: { in: ["queued", "retrying"] } } }),
    prisma.jobHistory.count({
      where: {
        status: { in: ["queued", "running", "processing", "stale"] },
        OR: [
          { lastHeartbeatAt: { lt: staleBefore } },
          { leaseExpiresAt: { lt: now } },
          { lastHeartbeatAt: null, startedAt: { lt: staleBefore } },
        ],
      },
    }),
    prisma.systemState.findUnique({ where: { key: "scheduler.settings" } }).catch(() => null),
  ]);

  const scheduler = schedulerState ? "configured" : "default";
  console.log(`[Worker] Startup self-check OK pending=${pending} stale=${stale} scheduler=${scheduler}`);
  return { pending, stale, scheduler };
}

export type WorkerRecoveryResult = {
  inspected: number;
  requeued: number;
  interrupted: number;
  needsReview: number;
  blocked: number;
  details: Array<{
    id: string;
    name: string;
    type: string;
    action: "requeued" | "interrupted" | "needs_review" | "blocked";
    reason: string;
  }>;
};

type StaleJobRow = Awaited<ReturnType<typeof findStaleJobRows>>[number];

async function findStaleJobRows() {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - workerStaleThresholdMs());
  return prisma.jobHistory.findMany({
    where: {
      status: { in: ["queued", "running", "processing", "retrying", "stale"] },
      OR: [
        { lastHeartbeatAt: { lt: staleBefore } },
        { leaseExpiresAt: { lt: now } },
        { lastHeartbeatAt: null, startedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { startedAt: "asc" },
    take: 50,
  });
}

function engineForJob(job: StaleJobRow) {
  const metadata = jsonObject(job.metadata);
  const explicitEngine = typeof metadata.engine === "string" ? metadata.engine : null;
  if (explicitEngine) return explicitEngine;
  if (job.type === "bpm") return "bpm";
  if (job.type === "audio_features" || job.type === "local_audio_features") return "audio";
  if (job.type === "popularity") return "popularity";
  if (job.type === "tags" || job.type === "genres") return "tags";
  if (job.type === "plex_sync") return "plex";
  if (job.type === "initial") return "initial";
  return null;
}

async function requeueSafeJob(job: StaleJobRow) {
  if (!job.userId) return { started: false as const, reason: "Missing user id." };
  const engine = engineForJob(job);
  if (!engine) return { started: false as const, reason: "No retry engine could be inferred." };
  const metadata = jsonObject(job.metadata);
  const libraryId = typeof metadata.libraryId === "string" ? metadata.libraryId : undefined;
  if (engine === "plex" && !libraryId) return { started: false as const, reason: "Missing library id for Plex sync retry." };

  const { startSyncJobInBackground } = await import("./syncJobRunner");
  const { getUserSyncSettings } = await import("./syncSettings");
  const syncSettings = await getUserSyncSettings(job.userId);

  if (engine === "plex") {
    const { runSyncEngine } = await import("./syncEngine");
    return startSyncJobInBackground({
      engine,
      libraryId,
      userId: job.userId,
      source: "startup",
      task: () => runSyncEngine(libraryId!, syncSettings),
    });
  }

  if (engine === "popularity") {
    return startSyncJobInBackground({
      engine,
      userId: job.userId,
      source: "startup",
      trackedEngine: "popularity",
      task: () => import("./popularityEngine").then((m) => m.runPopularityEngine(syncSettings)),
    });
  }

  if (engine === "tags") {
    return startSyncJobInBackground({
      engine,
      userId: job.userId,
      source: "startup",
      trackedEngine: "tags",
      task: () => import("./trackTagEngine").then((m) => m.runTrackTagEngine(syncSettings)),
    });
  }

  if (engine === "bpm") {
    return startSyncJobInBackground({
      engine,
      userId: job.userId,
      source: "startup",
      trackedEngine: "bpm",
      task: () => import("./localBpmEngine").then((m) => m.runLocalBpmEngine(syncSettings)),
    });
  }

  if (engine === "audio") {
    return startSyncJobInBackground({
      engine,
      userId: job.userId,
      source: "startup",
      trackedEngine: "audio",
      task: async () => {
        const { runAudioFeatures } = await import("./audioFeatureOrchestrator");
        const result = await runAudioFeatures({ source: "startup", userId: job.userId! });
        return { ...result, metadata: { ...result.metadata, recoveredFromJobId: job.id } };
      },
    });
  }

  return { started: false as const, reason: "This job type requires manual retry." };
}

export async function recoverStaleJobs({ requeueSafe = true, trigger = "manual" }: { requeueSafe?: boolean; trigger?: string } = {}): Promise<WorkerRecoveryResult> {
  const staleJobs = await findStaleJobRows();
  const result: WorkerRecoveryResult = {
    inspected: staleJobs.length,
    requeued: 0,
    interrupted: 0,
    needsReview: 0,
    blocked: 0,
    details: [],
  };

  for (const job of staleJobs) {
    const safe = isSafeToAutoRequeueJobType(job.type, job.name);
    const hint = recoveryHintForJob(job.type, job.name);
    await prisma.jobHistory.update({
      where: { id: job.id },
      data: {
        status: safe ? "interrupted" : "stale",
        finishedAt: new Date(),
        durationMs: Math.max(0, Date.now() - job.startedAt.getTime()),
        summary: `${job.name} was interrupted after worker heartbeat/lease expiry.`,
        recoveryHint: hint,
        currentItemLabel: null,
      },
    });

    if (!safe) {
      result.needsReview += 1;
      result.details.push({ id: job.id, name: job.name, type: job.type, action: "needs_review", reason: hint });
      continue;
    }

    if (!requeueSafe) {
      result.interrupted += 1;
      result.details.push({ id: job.id, name: job.name, type: job.type, action: "interrupted", reason: hint });
      continue;
    }

    try {
      const restarted = await requeueSafeJob(job);
      if ("started" in restarted && restarted.started) {
        result.requeued += 1;
        result.details.push({ id: job.id, name: job.name, type: job.type, action: "requeued", reason: "Safe job was restarted." });
      } else if ("started" in restarted && !restarted.started && "activeJob" in restarted) {
        result.blocked += 1;
        result.details.push({ id: job.id, name: job.name, type: job.type, action: "blocked", reason: `${restarted.activeJob.name} is already running.` });
      } else {
        result.interrupted += 1;
        result.details.push({ id: job.id, name: job.name, type: job.type, action: "interrupted", reason: "Marked interrupted; retry requires missing parameters." });
      }
    } catch (error) {
      result.interrupted += 1;
      result.details.push({ id: job.id, name: job.name, type: job.type, action: "interrupted", reason: capText(error, 240) || "Recovery failed." });
      console.error(`[Worker] Failed to requeue stale job id=${job.id} type=${job.type}`, error);
    }
  }

  runtime.lastRecovery = result;
  if (staleJobs.length > 0) {
    console.log(`[Worker] Stale job recovery trigger=${trigger} found=${result.inspected} requeued=${result.requeued} interrupted=${result.interrupted} needsReview=${result.needsReview} blocked=${result.blocked}`);
  }
  return result;
}

export async function initializeWorkerReliability() {
  if (runtime.initialized) return getWorkerIdentity();
  runtime.initialized = true;

  console.log(`[Worker] Starting background worker version=${APP_VERSION} workerId=${runtime.workerId}`);
  await heartbeatWorker({ status: "starting" });

  try {
    await startupSelfCheck();
    const recovery = await recoverStaleJobs({ requeueSafe: true, trigger: "startup" });
    console.log(`[Worker] Startup recovery found running=${recovery.inspected} stale=${recovery.inspected} requeued=${recovery.requeued} interrupted=${recovery.interrupted}`);
  } catch (error) {
    runtime.lastError = capText(error, 1_000);
    console.error("[Worker] Startup self-check/recovery failed", error);
  }

  await heartbeatWorker({ status: "idle" });
  runtime.heartbeatTimer = setInterval(() => {
    void heartbeatWorker({ status: runtime.currentJobId ? "processing" : "idle" });
  }, workerHeartbeatIntervalMs());
  runtime.heartbeatTimer.unref?.();
  console.log(`[Worker] Heartbeat started interval=${Math.round(workerHeartbeatIntervalMs() / 1000)}s`);

  const shutdown = () => {
    console.log("[Worker] Graceful shutdown requested. Releasing idle locks.");
    void markWorkerStopped("Graceful shutdown requested.");
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  return getWorkerIdentity();
}

export async function getWorkerHealthSummary() {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - workerStaleThresholdMs());
  const [
    workers,
    runningJobs,
    staleJobs,
    queuedJobs,
    failedRecentJobs,
    lastCompletedJob,
    lastErrorJob,
    schedulerModule,
    schedulerSettingsModule,
  ] = await Promise.all([
    prisma.workerHeartbeat.findMany({ orderBy: { lastHeartbeatAt: "desc" }, take: 10 }),
    prisma.jobHistory.findMany({ where: { status: { in: ["running", "processing"] } }, orderBy: { startedAt: "desc" }, take: 10 }),
    prisma.jobHistory.findMany({
      where: {
        status: { in: ["queued", "running", "processing", "retrying", "stale"] },
        OR: [
          { lastHeartbeatAt: { lt: staleBefore } },
          { leaseExpiresAt: { lt: now } },
          { lastHeartbeatAt: null, startedAt: { lt: staleBefore } },
        ],
      },
      orderBy: { startedAt: "asc" },
      take: 10,
    }),
    prisma.jobHistory.count({ where: { status: { in: ["queued", "retrying"] } } }),
    prisma.jobHistory.count({
      where: {
        status: "failed",
        startedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.jobHistory.findFirst({
      where: { status: { in: ["success", "warning", "completed", "completed_with_warnings"] }, finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
    }),
    prisma.jobHistory.findFirst({
      where: { OR: [{ status: "failed" }, { error: { not: null } }] },
      orderBy: { startedAt: "desc" },
    }),
    import("./backgroundScheduler").catch(() => null),
    import("./schedulerSettings").catch(() => null),
  ]);

  const activeWorker = workers[0] || null;
  const activeWorkerStale = activeWorker ? isHeartbeatStale(activeWorker.lastHeartbeatAt, now.getTime()) : true;
  const activeInMemory = (await import("./jobLock")).getJobDebugSnapshot(now.getTime());
  const schedulerStatus = schedulerModule?.getBackgroundSchedulerRuntimeStatus?.() ?? null;
  const schedulerSettings = schedulerSettingsModule?.getResolvedSchedulerSettings
    ? await schedulerSettingsModule.getResolvedSchedulerSettings().catch(() => null)
    : null;

  let status = "Unknown";
  if (!activeWorker) status = "Stopped";
  else if (runtime.shuttingDown || activeWorker.status === "recovering") status = "Recovering";
  else if (activeWorkerStale || staleJobs.length > 0) status = "Stale";
  else if (runningJobs.length > 0 || activeInMemory.activeJobs.length > 0 || activeWorker.currentJobId) status = "Processing";
  else if (activeWorker.status === "idle") status = "Idle";
  else status = "Running";

  return {
    status,
    version: APP_VERSION,
    workerCount: workers.length,
    activeWorkerId: activeWorker?.workerId ?? null,
    lastHeartbeat: activeWorker?.lastHeartbeatAt?.toISOString() ?? null,
    heartbeatAgeSeconds: activeWorker ? Math.max(0, Math.round((now.getTime() - activeWorker.lastHeartbeatAt.getTime()) / 1000)) : null,
    staleThresholdSeconds: Math.round(workerStaleThresholdMs() / 1000),
    currentJob: runningJobs[0] ? {
      id: runningJobs[0].id,
      name: runningJobs[0].name,
      type: runningJobs[0].type,
      startedAt: runningJobs[0].startedAt.toISOString(),
      progress: runningJobs[0].progress,
      currentItemLabel: runningJobs[0].currentItemLabel,
      lastProgressAt: runningJobs[0].lastProgressAt?.toISOString() ?? null,
    } : activeInMemory.activeJob,
    queueDepth: queuedJobs,
    runningJobs: runningJobs.length,
    failedRecentJobs,
    staleJobs: staleJobs.length,
    activeLocks: activeInMemory.activeJobs,
    lastCompletedJob: lastCompletedJob ? {
      id: lastCompletedJob.id,
      name: lastCompletedJob.name,
      type: lastCompletedJob.type,
      status: lastCompletedJob.status,
      finishedAt: lastCompletedJob.finishedAt?.toISOString() ?? null,
      summary: lastCompletedJob.summary,
    } : null,
    lastError: lastErrorJob?.error || null,
    scheduler: {
      runtime: schedulerStatus,
      enabled: schedulerSettings?.schedulerEnabled ?? schedulerStatus?.schedulerEnabled ?? false,
      cron: schedulerSettings?.schedulerCron ?? schedulerStatus?.schedulerCron ?? null,
      lastRecovery: runtime.lastRecovery,
    },
    diagnostics: {
      heartbeat: activeWorker && !activeWorkerStale ? "OK" : "Stale",
      staleWorker: activeWorkerStale,
      staleJobs: staleJobs.map((job) => ({
        id: job.id,
        name: job.name,
        type: job.type,
        startedAt: job.startedAt.toISOString(),
        lastHeartbeatAt: job.lastHeartbeatAt?.toISOString() ?? null,
        recoveryHint: recoveryHintForJob(job.type, job.name),
      })),
    },
  };
}
