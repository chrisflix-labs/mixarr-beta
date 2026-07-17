import { monitorEventLoopDelay } from "node:perf_hooks";
import { PLAYLIST_GENERATION_LIMITS } from "./playlistGenerationLimits";

export type PlaylistGenerationStage = "queued" | "loading" | "filtering" | "scoring" | "selecting" | "optimizing" | "persisting" | "completed";

export type PlaylistGenerationProgress = {
  stage: PlaylistGenerationStage;
  stageLabel: string;
  requestedTracks: number;
  libraryTracks?: number;
  initialCandidates?: number;
  eligibleCandidates?: number;
  processedCandidates?: number;
  selectedTracks?: number;
  scoringPasses?: number;
  optimizationPasses?: number;
  databaseQueries?: number;
  elapsedMs: number;
  heapUsedMb: number;
  eventLoopDelayMs?: number;
};

export class PlaylistGenerationCancelledError extends Error {
  constructor(message = "Playlist generation was cancelled.") { super(message); this.name = "PlaylistGenerationCancelledError"; }
}

export class PlaylistGenerationTimeoutError extends Error {
  constructor(message: string) { super(message); this.name = "PlaylistGenerationTimeoutError"; }
}

export type PlaylistGenerationControl = ReturnType<typeof createPlaylistGenerationControl>;

export function createPlaylistGenerationControl({
  requestedTracks,
  signal,
  onProgress,
  maxRuntimeMs = PLAYLIST_GENERATION_LIMITS.maxRuntimeMs,
  stageTimeoutMs = PLAYLIST_GENERATION_LIMITS.stageTimeoutMs,
}: {
  requestedTracks: number;
  signal?: AbortSignal;
  onProgress?: (progress: PlaylistGenerationProgress) => void | Promise<void>;
  maxRuntimeMs?: number;
  stageTimeoutMs?: number;
}) {
  const startedAt = Date.now();
  let stageStartedAt = startedAt;
  let currentStage: PlaylistGenerationStage = "queued";
  let lastProgressAt = 0;
  let operationsSinceYield = 0;
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();

  const check = () => {
    if (signal?.aborted) throw new PlaylistGenerationCancelledError(typeof signal.reason === "string" ? signal.reason : undefined);
    const now = Date.now();
    if (now - startedAt > maxRuntimeMs) throw new PlaylistGenerationTimeoutError(`Generation stopped after ${Math.ceil(maxRuntimeMs / 60_000)} minutes because the configured job limit was reached.`);
    if (now - stageStartedAt > stageTimeoutMs) throw new PlaylistGenerationTimeoutError(`Generation stage "${currentStage}" exceeded the configured ${Math.ceil(stageTimeoutMs / 1_000)} second limit.`);
  };

  const snapshot = (stageLabel: string, values: Partial<PlaylistGenerationProgress> = {}): PlaylistGenerationProgress => ({
    stage: currentStage,
    stageLabel,
    requestedTracks,
    elapsedMs: Date.now() - startedAt,
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    eventLoopDelayMs: Math.round(delay.max / 1_000_000),
    ...values,
  });

  const progress = async (stageLabel: string, values: Partial<PlaylistGenerationProgress> = {}, force = false) => {
    check();
    const now = Date.now();
    if (!force && now - lastProgressAt < PLAYLIST_GENERATION_LIMITS.progressIntervalMs) return;
    lastProgressAt = now;
    await onProgress?.(snapshot(stageLabel, values));
  };

  return {
    startedAt,
    get stage() { return currentStage; },
    check,
    async setStage(stage: PlaylistGenerationStage, stageLabel: string, values: Partial<PlaylistGenerationProgress> = {}) {
      currentStage = stage;
      stageStartedAt = Date.now();
      await progress(stageLabel, values, true);
    },
    progress,
    async yield(stageLabel: string, values: Partial<PlaylistGenerationProgress> = {}, forceYield = false) {
      operationsSinceYield += 1;
      check();
      if (!forceYield && operationsSinceYield < PLAYLIST_GENERATION_LIMITS.yieldEvery) return;
      operationsSinceYield = 0;
      await new Promise<void>((resolve) => setImmediate(resolve));
      await progress(stageLabel, values, false);
    },
    finish() { delay.disable(); },
  };
}
