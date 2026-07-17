function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export const PLAYLIST_GENERATION_LIMITS = Object.freeze({
  maxRuntimeMs: boundedInteger(process.env.PLAYLIST_GENERATION_MAX_RUNTIME_MINUTES, 12, 1, 120) * 60_000,
  maxTracks: boundedInteger(process.env.PLAYLIST_GENERATION_MAX_TRACKS, Number(process.env.MAX_PLAYLIST_SIZE || 5000), 1, 20_000),
  queryBatchSize: boundedInteger(process.env.PLAYLIST_GENERATION_QUERY_BATCH_SIZE, 500, 50, 2_000),
  concurrency: boundedInteger(process.env.PLAYLIST_GENERATION_CONCURRENCY, 1, 1, 4),
  maxSelectionAttempts: boundedInteger(process.env.PLAYLIST_GENERATION_MAX_SELECTION_ATTEMPTS, 300, 25, 2_000),
  maxOptimizationPasses: boundedInteger(process.env.PLAYLIST_GENERATION_MAX_OPTIMIZATION_PASSES, 1, 0, 10),
  maxTuningPasses: boundedInteger(process.env.PLAYLIST_GENERATION_MAX_TUNING_PASSES, 1, 1, 10),
  maxMoodTransitionPasses: boundedInteger(process.env.PLAYLIST_GENERATION_MAX_MOOD_TRANSITION_PASSES, 1, 0, 10),
  maxCandidateRescoringPasses: boundedInteger(process.env.PLAYLIST_GENERATION_MAX_CANDIDATE_RESCORING_PASSES, 1, 1, 10),
  maxFallbackAttempts: boundedInteger(process.env.PLAYLIST_GENERATION_MAX_FALLBACK_ATTEMPTS, 2, 0, 20),
  maxReplacementAttempts: boundedInteger(process.env.PLAYLIST_GENERATION_MAX_REPLACEMENT_ATTEMPTS, 2, 0, 20),
  stageTimeoutMs: boundedInteger(process.env.PLAYLIST_GENERATION_STAGE_TIMEOUT_SECONDS, 180, 10, 3_600) * 1_000,
  progressIntervalMs: boundedInteger(process.env.PLAYLIST_GENERATION_PROGRESS_INTERVAL_MS, 750, 250, 10_000),
  heartbeatTimeoutMs: boundedInteger(process.env.PLAYLIST_GENERATION_HEARTBEAT_TIMEOUT_SECONDS, 90, 15, 3_600) * 1_000,
  yieldEvery: boundedInteger(process.env.PLAYLIST_GENERATION_YIELD_EVERY, 100, 10, 2_000),
  explanationRejectedSampleLimit: boundedInteger(process.env.PLAYLIST_GENERATION_EXPLANATION_SAMPLE_LIMIT, 100, 0, 500),
});

export type PlaylistGenerationLimits = typeof PLAYLIST_GENERATION_LIMITS;

export function playlistGenerationLimitsForDiagnostics() {
  return {
    maxRuntimeMinutes: PLAYLIST_GENERATION_LIMITS.maxRuntimeMs / 60_000,
    maxTracks: PLAYLIST_GENERATION_LIMITS.maxTracks,
    queryBatchSize: PLAYLIST_GENERATION_LIMITS.queryBatchSize,
    concurrency: PLAYLIST_GENERATION_LIMITS.concurrency,
    maxSelectionAttempts: PLAYLIST_GENERATION_LIMITS.maxSelectionAttempts,
    maxOptimizationPasses: PLAYLIST_GENERATION_LIMITS.maxOptimizationPasses,
    maxTuningPasses: PLAYLIST_GENERATION_LIMITS.maxTuningPasses,
    maxMoodTransitionPasses: PLAYLIST_GENERATION_LIMITS.maxMoodTransitionPasses,
    maxCandidateRescoringPasses: PLAYLIST_GENERATION_LIMITS.maxCandidateRescoringPasses,
    maxFallbackAttempts: PLAYLIST_GENERATION_LIMITS.maxFallbackAttempts,
    maxReplacementAttempts: PLAYLIST_GENERATION_LIMITS.maxReplacementAttempts,
    stageTimeoutSeconds: PLAYLIST_GENERATION_LIMITS.stageTimeoutMs / 1_000,
    progressIntervalMs: PLAYLIST_GENERATION_LIMITS.progressIntervalMs,
    heartbeatTimeoutSeconds: PLAYLIST_GENERATION_LIMITS.heartbeatTimeoutMs / 1_000,
  };
}
