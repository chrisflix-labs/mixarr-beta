import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { safeFinishJobHistory, safeStartJobHistory } from "./jobHistory";
import { createPlaylistGenerationControl, PlaylistGenerationCancelledError, type PlaylistGenerationProgress } from "./playlistGenerationControl";
import { PLAYLIST_GENERATION_LIMITS, playlistGenerationLimitsForDiagnostics } from "./playlistGenerationLimits";
import { previewPlaylistTracks, type PlaylistConfigInput } from "./playlistService";
import { sanitizeErrorText } from "./supportRedaction";
import { withPlaylistGenerationQueryCount } from "./playlistGenerationQueryMetrics";

type QueuedGeneration = { jobId: string; userId: string; config: PlaylistConfigInput; controller: AbortController };
type RuntimeState = { queue: QueuedGeneration[]; active: Map<string, QueuedGeneration>; pumping: boolean; shutdownHandlersAttached?: boolean };

const globalRuntime = globalThis as typeof globalThis & { mixarrPlaylistGenerationRuntime?: RuntimeState };
const runtime: RuntimeState = globalRuntime.mixarrPlaylistGenerationRuntime ?? { queue: [], active: new Map<string, QueuedGeneration>(), pumping: false };
globalRuntime.mixarrPlaylistGenerationRuntime = runtime;
if (!runtime.shutdownHandlersAttached) {
  runtime.shutdownHandlersAttached = true;
  const abortForShutdown = () => {
    for (const item of Array.from(runtime.active.values())) item.controller.abort("Application shutdown interrupted playlist generation.");
    for (const item of runtime.queue) item.controller.abort("Application shutdown interrupted playlist generation.");
  };
  process.once("SIGTERM", abortForShutdown);
  process.once("SIGINT", abortForShutdown);
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return { heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024), rssMb: Math.round(memory.rss / 1024 / 1024) };
}

function logGeneration(jobId: string, progress: PlaylistGenerationProgress, extra: Record<string, unknown> = {}) {
  console.info("[PlaylistGeneration]", { jobId, ...progress, ...extra });
}

async function updateProgress(jobId: string, progress: PlaylistGenerationProgress) {
  const now = new Date();
  await prisma.jobHistory.updateMany({
    where: { id: jobId, status: { in: ["queued", "running", "processing"] } },
    data: {
      status: progress.stage === "queued" ? "queued" : "processing",
      currentItemLabel: progress.stageLabel,
      processed: progress.selectedTracks,
      lastHeartbeatAt: now,
      lastProgressAt: now,
      leaseExpiresAt: new Date(now.getTime() + PLAYLIST_GENERATION_LIMITS.heartbeatTimeoutMs),
      progress: progress as unknown as Prisma.InputJsonValue,
    },
  });
  logGeneration(jobId, progress);
}

async function executeGeneration(item: QueuedGeneration) {
  const started = await prisma.jobHistory.findUnique({ where: { id: item.jobId }, select: { startedAt: true, status: true, metadata: true } });
  if (!started || started.status === "cancelled") return;
  let measuredDatabaseQueries = 0;
  const activeQueryCounter: { current: { count: number } | null } = { current: null };
  const control = createPlaylistGenerationControl({
    requestedTracks: item.config.limit,
    signal: item.controller.signal,
    onProgress: (progress) => updateProgress(item.jobId, { ...progress, databaseQueries: activeQueryCounter.current?.count ?? measuredDatabaseQueries }),
  });
  const runtimeTimer = setTimeout(() => item.controller.abort(`Generation stopped after ${Math.ceil(PLAYLIST_GENERATION_LIMITS.maxRuntimeMs / 60_000)} minutes because the configured job limit was reached.`), PLAYLIST_GENERATION_LIMITS.maxRuntimeMs);
  runtimeTimer.unref?.();
  try {
    await prisma.jobHistory.update({ where: { id: item.jobId }, data: { status: "running", lastHeartbeatAt: new Date(), lastProgressAt: new Date() } });
    const result = await withPlaylistGenerationQueryCount(async (counter) => {
      activeQueryCounter.current = counter;
      const preview = await previewPlaylistTracks({ userId: item.userId, config: item.config, control });
      measuredDatabaseQueries = counter.count;
      activeQueryCounter.current = null;
      return preview;
    });
    const selected = result.trackIds.length;
    const warnings = result.warnings || [];
    const partial = selected < item.config.limit;
    const summary = partial
      ? `Only ${selected} of ${item.config.limit} requested tracks matched the selected rules. A ${selected}-track preview was generated with warnings.`
      : `Playlist preview generation completed with ${selected} tracks.`;
    await safeFinishJobHistory({
      job: { id: item.jobId, startedAt: started.startedAt },
      status: partial || warnings.length ? "completed_with_warnings" : "completed",
      summary,
      counts: { attempted: item.config.limit, processed: selected, skipped: Math.max(0, item.config.limit - selected), failed: 0 },
      metadata: {
        request: item.config,
        result,
        warnings,
        limits: playlistGenerationLimitsForDiagnostics(),
        finalStage: "completed",
        memory: memorySnapshot(),
        databaseQueries: measuredDatabaseQueries,
      } as unknown as Prisma.InputJsonValue,
    });
    console.info("[PlaylistGeneration]", { jobId: item.jobId, finalStatus: partial || warnings.length ? "completed_with_warnings" : "completed", requestedTracks: item.config.limit, selectedTracks: selected, databaseQueries: measuredDatabaseQueries, durationMs: Date.now() - started.startedAt.getTime(), ...memorySnapshot() });
  } catch (error) {
    measuredDatabaseQueries = activeQueryCounter.current?.count ?? measuredDatabaseQueries;
    activeQueryCounter.current = null;
    const cancelled = error instanceof PlaylistGenerationCancelledError || item.controller.signal.aborted;
    const message = sanitizeErrorText(error);
    const current = await prisma.jobHistory.findUnique({ where: { id: item.jobId }, select: { progress: true } }).catch(() => null);
    const progress = (current?.progress || {}) as Record<string, any>;
    await safeFinishJobHistory({
      job: { id: item.jobId, startedAt: started.startedAt },
      status: cancelled ? "cancelled" : "failed",
      summary: cancelled
        ? `Playlist generation was cancelled after selecting ${progress.selectedTracks || 0} of ${item.config.limit} requested tracks.`
        : `${message} Requested tracks: ${item.config.limit}. Selected tracks: ${progress.selectedTracks || 0}. Last completed stage: ${progress.stageLabel || progress.stage || "loading"}.`,
      error: message,
      counts: { attempted: item.config.limit, processed: progress.selectedTracks || 0, skipped: Math.max(0, item.config.limit - (progress.selectedTracks || 0)), failed: cancelled ? 0 : 1 },
      metadata: { request: item.config, limits: playlistGenerationLimitsForDiagnostics(), finalStage: progress.stage || "loading", failureReason: message, memory: memorySnapshot(), databaseQueries: measuredDatabaseQueries } as unknown as Prisma.InputJsonValue,
    });
    console.warn("[PlaylistGeneration]", { jobId: item.jobId, finalStatus: cancelled ? "cancelled" : "failed", reason: message, requestedTracks: item.config.limit, selectedTracks: progress.selectedTracks || 0, databaseQueries: measuredDatabaseQueries, ...memorySnapshot() });
  } finally {
    clearTimeout(runtimeTimer);
    control.finish();
  }
}

function schedulePump() {
  if (runtime.pumping) return;
  runtime.pumping = true;
  setImmediate(async () => {
    try {
      while (runtime.active.size < PLAYLIST_GENERATION_LIMITS.concurrency && runtime.queue.length > 0) {
        const item = runtime.queue.shift()!;
        runtime.active.set(item.jobId, item);
        void executeGeneration(item).finally(() => { runtime.active.delete(item.jobId); schedulePump(); });
      }
    } finally {
      runtime.pumping = false;
      if (runtime.queue.length > 0 && runtime.active.size < PLAYLIST_GENERATION_LIMITS.concurrency) schedulePump();
    }
  });
}

export async function queuePlaylistGenerationJob({ userId, config }: { userId: string; config: PlaylistConfigInput }) {
  const history = await safeStartJobHistory({
    userId,
    type: "playlist",
    name: "Playlist Builder V2 generation",
    trigger: "manual",
    lockKey: `playlist-generation:${userId}`,
    metadata: { request: config, limits: playlistGenerationLimitsForDiagnostics() } as unknown as Prisma.InputJsonValue,
  });
  if (!history) throw new Error("Unable to create playlist generation job.");
  const progress: PlaylistGenerationProgress = { stage: "queued", stageLabel: "Waiting to start", requestedTracks: config.limit, selectedTracks: 0, elapsedMs: 0, heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) };
  await prisma.jobHistory.update({ where: { id: history.id }, data: { status: "queued", progress: progress as unknown as Prisma.InputJsonValue, currentItemLabel: progress.stageLabel } });
  runtime.queue.push({ jobId: history.id, userId, config, controller: new AbortController() });
  schedulePump();
  return { jobId: history.id, status: "queued" as const, progress, limits: playlistGenerationLimitsForDiagnostics(), largeRequest: config.limit >= 500 };
}

export async function getPlaylistGenerationJob(userId: string, jobId: string) {
  const row = await prisma.jobHistory.findFirst({ where: { id: jobId, userId, type: "playlist", name: "Playlist Builder V2 generation" } });
  if (!row) return null;
  const metadata = (row.metadata || {}) as Record<string, any>;
  return {
    id: row.id, status: row.status, startedAt: row.startedAt, finishedAt: row.finishedAt, durationMs: row.durationMs,
    summary: row.summary, error: row.error, progress: row.progress, result: metadata.result || null,
    warnings: metadata.warnings || [], limits: metadata.limits || playlistGenerationLimitsForDiagnostics(), recoveryHint: row.recoveryHint,
  };
}

export async function cancelPlaylistGenerationJob(userId: string, jobId: string) {
  const row = await prisma.jobHistory.findFirst({ where: { id: jobId, userId, type: "playlist", name: "Playlist Builder V2 generation" }, select: { id: true, status: true, metadata: true, startedAt: true } });
  if (!row) return null;
  if (["completed", "completed_with_warnings", "failed", "cancelled", "interrupted", "stale"].includes(row.status)) return { id: row.id, status: row.status, cancelled: false };
  const queued = runtime.queue.find((item) => item.jobId === jobId);
  const active = runtime.active.get(jobId);
  queued?.controller.abort("Cancelled by user");
  active?.controller.abort("Cancelled by user");
  runtime.queue = runtime.queue.filter((item) => item.jobId !== jobId);
  if (!active) {
    await safeFinishJobHistory({ job: { id: row.id, startedAt: row.startedAt }, status: "cancelled", summary: "Playlist generation was cancelled before it started.", counts: { attempted: 0, processed: 0, skipped: 0, failed: 0 }, metadata: { ...((row.metadata || {}) as object), cancelRequested: true } as Prisma.InputJsonValue });
  } else {
    await prisma.jobHistory.update({ where: { id: jobId }, data: { metadata: { ...((row.metadata || {}) as object), cancelRequested: true } as Prisma.InputJsonValue, currentItemLabel: "Cancelling" } });
  }
  return { id: row.id, status: active ? "processing" : "cancelled", cancelled: true };
}

export function playlistGenerationRuntimeSnapshot() {
  return { queued: runtime.queue.length, active: runtime.active.size, concurrency: PLAYLIST_GENERATION_LIMITS.concurrency };
}
