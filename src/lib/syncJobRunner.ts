import { GLOBAL_SYNC_JOB_KEY, acquireJobLock, type ActiveJob } from "./jobLock";
import { markEnrichmentJobFinished, markEnrichmentJobStarted } from "./enrichmentJobStatus";
import {
  countsFromResult,
  safeFinishJobHistory,
  safeRecordJobHistory,
  safeStartJobHistory,
  statusFromCounts,
  summaryFromResult,
} from "./jobHistory";

export const engineLabels: Record<string, string> = {
  initial: "initial enrichment",
  plex: "Plex metadata",
  popularity: "popularity",
  audio: "audio features",
  bpm: "BPM",
  tags: "track genres",
};

export function syncJobKeys(engine: string, libraryId?: string) {
  const keys = [GLOBAL_SYNC_JOB_KEY, engine];
  if (engine === "plex" && libraryId) keys.push(`plex:${libraryId}`);
  if (engine === "initial") keys.push("popularity", "tags", "audio", "bpm");
  return keys;
}

function jobHistoryTypeForEngine(engine: string) {
  if (engine === "bpm") return "bpm";
  if (engine === "audio") return "audio_features";
  if (engine === "plex") return "plex_sync";
  if (engine === "popularity") return "popularity";
  if (engine === "tags") return "tags";
  if (engine === "initial") return "initial";
  return "other";
}

export function alreadyRunningPayload(engine: string, activeJob: ActiveJob) {
  return {
    status: "already_running",
    message: `${engineLabels[engine] || engine} sync is already in progress (${activeJob.name}).`,
    activeJob: {
      name: activeJob.name,
      startedAt: activeJob.startedAt,
      phase: activeJob.phase || null,
    },
  };
}

export function startSyncJobInBackground({
  engine,
  libraryId,
  userId,
  source = "manual",
  trackedEngine,
  task,
}: {
  engine: string;
  libraryId?: string;
  userId?: string | null;
  source?: string;
  trackedEngine?: string;
  task: () => Promise<unknown>;
}) {
  const name = `${engineLabels[engine] || engine} sync`;
  const lock = acquireJobLock({
    name,
    keys: syncJobKeys(engine, libraryId),
    source,
  });

  if (!lock.acquired) {
    void safeRecordJobHistory({
      userId,
      type: jobHistoryTypeForEngine(engine),
      name,
      status: "warning",
      trigger: source,
      summary: `${name} skipped because ${lock.activeJob.name} is already running.`,
      counts: { attempted: 1, processed: 0, skipped: 1, failed: 0 },
      metadata: { activeJobName: lock.activeJob.name, activeJobStartedAt: lock.activeJob.startedAt },
    });
    return { started: false as const, activeJob: lock.activeJob };
  }

  if (trackedEngine) markEnrichmentJobStarted(trackedEngine);
  (async () => {
    const history = await safeStartJobHistory({
      userId,
      type: jobHistoryTypeForEngine(engine),
      name,
      trigger: source,
      metadata: libraryId ? { libraryId } : undefined,
    });

    try {
      const result = await task();
      if (trackedEngine) markEnrichmentJobFinished(trackedEngine, result);
      if (engine === "plex" && !result) {
        await safeFinishJobHistory({
          job: history,
          status: "failed",
          error: "Plex sync did not complete successfully. Check the latest Plex sync log for details.",
          summary: `${name} failed. Check the latest Plex sync log for details.`,
        });
        return;
      }
      const counts = countsFromResult(result);
      await safeFinishJobHistory({
        job: history,
        result,
        counts,
        status: statusFromCounts(counts),
        summary: summaryFromResult(name, result, counts),
      });
    } catch (error) {
      if (trackedEngine) markEnrichmentJobFinished(trackedEngine, undefined, error);
      await safeFinishJobHistory({
        job: history,
        status: "failed",
        error,
        summary: `${name} failed.`,
      });
      console.error(error);
    } finally {
      lock.release();
    }
  })();

  return { started: true as const, job: lock.job };
}
