import type { ScheduledTask } from "node-cron";
import { getResolvedSchedulerSettings, isValidSchedulerCron, type ResolvedSchedulerSettings } from "./schedulerSettings";
import { logDebug } from "./logging";

type SchedulerRuntime = {
  task: ScheduledTask | null;
  settings: ResolvedSchedulerSettings | null;
  pipelineRunning: boolean;
};

declare global {
  var mixarrBackgroundSchedulerRuntime: SchedulerRuntime | undefined;
}

const runtime: SchedulerRuntime = globalThis.mixarrBackgroundSchedulerRuntime ?? {
  task: null,
  settings: null,
  pipelineRunning: false,
};

globalThis.mixarrBackgroundSchedulerRuntime = runtime;

export function getBackgroundSchedulerRuntimeStatus() {
  return {
    active: Boolean(runtime.task),
    schedulerEnabled: runtime.settings?.schedulerEnabled ?? false,
    schedulerCron: runtime.settings?.schedulerCron ?? null,
    schedulerMode: runtime.settings?.schedulerMode ?? null,
    pipelineRunning: runtime.pipelineRunning,
  };
}

export async function initializeBackgroundScheduler() {
  const settings = await getResolvedSchedulerSettings();
  await applyBackgroundSchedulerSettings(settings);
  return settings;
}

export async function rescheduleBackgroundScheduler(settings?: ResolvedSchedulerSettings) {
  const nextSettings = settings ?? await getResolvedSchedulerSettings();
  await applyBackgroundSchedulerSettings(nextSettings);
  return nextSettings;
}

async function applyBackgroundSchedulerSettings(settings: ResolvedSchedulerSettings) {
  if (runtime.task) {
    runtime.task.stop();
    runtime.task = null;
  }

  runtime.settings = settings;

  if (!settings.schedulerEnabled) {
    console.log("[Scheduler] Background scheduler is disabled by saved settings.");
    return;
  }

  if (!isValidSchedulerCron(settings.schedulerCron)) {
    console.error(`[Scheduler] Refusing to start invalid schedule: ${settings.schedulerCron}`);
    return;
  }

  const cron = await import("node-cron");
  runtime.task = cron.schedule(settings.schedulerCron, async () => {
    await runScheduledBackgroundSync(settings.schedulerCron);
  });

  console.log(`[Scheduler] Background scheduler active: ${settings.schedulerCron} (${settings.source})`);
}

export async function runScheduledBackgroundSync(activeCron: string) {
  const { pipelineRunsTotal, pipelineDurationSeconds } = await import("./metrics");
  const { GLOBAL_SYNC_JOB_KEY, acquireJobLock, attachJobHistoryToLock, setJobPhase } = await import("./jobLock");
  const { safeFinishJobHistory, safeRecordJobHistory, safeStartJobHistory } = await import("./jobHistory");

  if (runtime.pipelineRunning) {
    console.warn("[Scheduler] Previous background pipeline is still running; skipping this tick.");
    await safeRecordJobHistory({
      type: "other",
      name: "nightly sync pipeline",
      status: "skipped",
      trigger: "scheduled",
      summary: `Scheduled background sync skipped because the previous run is still running. Cron: ${activeCron}.`,
      counts: { attempted: 1, processed: 0, skipped: 1, failed: 0 },
      metadata: { cron: activeCron },
    });
    pipelineRunsTotal.inc({ result: "skipped" });
    return;
  }

  const lock = acquireJobLock({
    name: "nightly sync pipeline",
    keys: [GLOBAL_SYNC_JOB_KEY, "scheduler"],
    source: "scheduler",
  });

  if (!lock.acquired) {
    console.warn(`[Scheduler] Skipping background pipeline; ${lock.activeJob.name} is already running.`);
    await safeRecordJobHistory({
      type: "other",
      name: "nightly sync pipeline",
      status: "blocked",
      trigger: "scheduled",
      summary: `Scheduled background sync skipped because ${lock.activeJob.name} is already running. Cron: ${activeCron}.`,
      counts: { attempted: 1, processed: 0, skipped: 1, failed: 0 },
      metadata: { activeJobName: lock.activeJob.name, activeJobStartedAt: lock.activeJob.startedAt, cron: activeCron },
    });
    pipelineRunsTotal.inc({ result: "skipped" });
    return;
  }

  runtime.pipelineRunning = true;
  const endTimer = pipelineDurationSeconds.startTimer();
  let pipelineResult: "success" | "partial" | "failed" | "timeout" = "success";
  const history = await safeStartJobHistory({
    type: "other",
    name: "nightly sync pipeline",
    trigger: "scheduled",
    metadata: { cron: activeCron, lockKey: lock.job.lockKey },
    lockKey: lock.job.lockKey,
    workerId: lock.job.workerId,
  });
  attachJobHistoryToLock(lock.job, history, "other");

  const pipelineStart = Date.now();
  const maxPipelineMs = Number(process.env.SYNC_MAX_PIPELINE_MS || 6 * 60 * 60 * 1000);
  const deadline = pipelineStart + maxPipelineMs;
  const remaining = () => deadline - Date.now() > 0;
  const stages: any[] = [];

  console.log(`[Scheduler] Nightly sync started cron=${JSON.stringify(activeCron)}`);

  try {
    const prisma = (await import("./prisma")).default;

    setJobPhase(lock.job, "Step 1/5: plex_sync");
    let stageStartedAt = Date.now();
    console.log("[Scheduler] Step 1/5 started name=plex_sync");
    const libraries = await prisma.library.findMany({ include: { server: { select: { userId: true } } } });
    const plexCounts = { scanned: 0, created: 0, missing: 0, failed: 0 };
    if (libraries.length > 0) {
      const { runSyncEngine } = await import("./syncEngine");
      for (const lib of libraries) {
        if (!remaining()) {
          console.warn(`[Scheduler] Pipeline deadline reached before syncing ${lib.name}; aborting.`);
          pipelineResult = "timeout";
          break;
        }
        logDebug(`[Scheduler] Syncing library name=${JSON.stringify(lib.name)} id=${lib.id}`);
        const result = await runSyncEngine(lib.id);
        plexCounts.scanned += result?.scanned || 0;
        plexCounts.created += result?.newTracks || 0;
        plexCounts.missing += result?.markedMissing || 0;
        plexCounts.failed += result?.failed || 0;
      }
    }
    let durationMs = Date.now() - stageStartedAt;
    stages.push({ name: "plex_sync", startedAt: new Date(stageStartedAt).toISOString(), completedAt: new Date().toISOString(), durationMs, ...plexCounts });
    console.log(`[Scheduler] Step 1/5 completed name=plex_sync duration=${Math.round(durationMs / 1000)}s scanned=${plexCounts.scanned} created=${plexCounts.created} missing=${plexCounts.missing} failed=${plexCounts.failed}`);

    setJobPhase(lock.job, "Step 2/5: popularity");
    stageStartedAt = Date.now();
    console.log("[Scheduler] Step 2/5 started name=popularity");
    const { runPopularityEngine } = await import("./popularityEngine");
    const popularity = await loopEngine("PopularityEngine", runPopularityEngine, remaining);
    if (!popularity.drained) pipelineResult = "timeout";
    durationMs = Date.now() - stageStartedAt;
    stages.push({ name: "popularity", startedAt: new Date(stageStartedAt).toISOString(), completedAt: new Date().toISOString(), durationMs, ...popularity });
    console.log(`[Scheduler] Step 2/5 completed name=popularity duration=${Math.round(durationMs / 1000)}s processed=${popularity.processed} skipped=${popularity.skipped} failed=${popularity.failed}`);

    setJobPhase(lock.job, "Step 3/5: track_tags");
    stageStartedAt = Date.now();
    console.log("[Scheduler] Step 3/5 started name=track_tags");
    const { runTrackTagEngine } = await import("./trackTagEngine");
    const tags = await loopEngine("TrackTagEngine", runTrackTagEngine, remaining);
    if (!tags.drained) pipelineResult = "timeout";
    durationMs = Date.now() - stageStartedAt;
    stages.push({ name: "track_tags", startedAt: new Date(stageStartedAt).toISOString(), completedAt: new Date().toISOString(), durationMs, ...tags });
    console.log(`[Scheduler] Step 3/5 completed name=track_tags duration=${Math.round(durationMs / 1000)}s processed=${tags.processed} skipped=${tags.skipped} failed=${tags.failed}`);

    if (remaining()) {
      setJobPhase(lock.job, "Step 4/5: saved_playlist_refresh");
      stageStartedAt = Date.now();
      console.log("[Scheduler] Step 4/5 started name=saved_playlist_refresh");
      const { refreshAutoPlaylists } = await import("./playlistService");
      const refreshedCount = await refreshAutoPlaylists();
      durationMs = Date.now() - stageStartedAt;
      stages.push({ name: "saved_playlist_refresh", startedAt: new Date(stageStartedAt).toISOString(), completedAt: new Date().toISOString(), durationMs, refreshed: refreshedCount });
      console.log(`[Scheduler] Step 4/5 completed name=saved_playlist_refresh duration=${Math.round(durationMs / 1000)}s refreshed=${refreshedCount}`);
    } else {
      console.warn("[Scheduler] Pipeline deadline reached before Step 4/5; skipping playlist refresh and Audio Features.");
      pipelineResult = "timeout";
    }

    if (remaining()) {
      setJobPhase(lock.job, "Step 5/5: audio_features");
      stageStartedAt = Date.now();
      console.log("[Scheduler] Step 5/5 started name=audio_features");
      const { runAudioFeatures } = await import("./audioFeatureOrchestrator");
      const userIds = Array.from(new Set(libraries.map((library) => library.server.userId)));
      const audioTotals = { attempted: 0, processed: 0, skipped: 0, failed: 0, eligible: 0 };
      const audioResults = [];
      for (const userId of userIds) {
        const audio = await runAudioFeatures({ source: "nightly", userId, shouldContinue: remaining });
        audioResults.push({ userId, ...audio });
        audioTotals.attempted += audio.attempted;
        audioTotals.processed += audio.processed;
        audioTotals.skipped += audio.skipped;
        audioTotals.failed += audio.failed;
        audioTotals.eligible += audio.tracksDiscovered;
        if (audio.status === "failed") pipelineResult = "failed";
        else if (audio.status === "warning" && pipelineResult === "success") pipelineResult = "partial";
      }
      durationMs = Date.now() - stageStartedAt;
      stages.push({ name: "audio_features", startedAt: new Date(stageStartedAt).toISOString(), completedAt: new Date().toISOString(), durationMs, ...audioTotals, results: audioResults });
      console.log(`[Scheduler] Step 5/5 completed name=audio_features duration=${Math.round(durationMs / 1000)}s eligible=${audioTotals.eligible} processed=${audioTotals.processed} skipped=${audioTotals.skipped} failed=${audioTotals.failed}`);
    }

    const durationSeconds = Math.round((Date.now() - pipelineStart) / 1000);
    const log = pipelineResult === "success" ? console.log : console.warn;
    log(`[Scheduler] Nightly sync completed status=${pipelineResult} duration=${durationSeconds}s`);
  } catch (error) {
    console.error("[Scheduler] Scheduled background sync failed:", error);
    pipelineResult = "failed";
  } finally {
    endTimer();
    await safeFinishJobHistory({
      job: history,
      status: pipelineResult === "success" ? "completed" : pipelineResult === "failed" ? "failed" : "completed_with_warnings",
      summary: `Scheduled background sync started using cron ${activeCron} and finished with status=${pipelineResult}.`,
      metadata: { cron: activeCron, stages },
    });
    pipelineRunsTotal.inc({ result: pipelineResult });
    runtime.pipelineRunning = false;
    lock.release();
  }
}

async function loopEngine(
  label: string,
  run: () => Promise<number | { attempted: number; processed: number; skipped: number; failed: number }>,
  remaining: () => boolean,
): Promise<{ drained: boolean; attempted: number; processed: number; skipped: number; failed: number; batches: number }> {
  let totalAttempted = 0;
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let batchNum = 0;

  while (remaining()) {
    batchNum += 1;
    const result = await run();
    const attempted = typeof result === "number" ? result : result.attempted;
    totalAttempted += attempted;
    if (typeof result !== "number") {
      totalProcessed += result.processed;
      totalSkipped += result.skipped;
      totalFailed += result.failed;
    }
    if (attempted === 0) {
      logDebug(`[Scheduler] ${label} drained after ${batchNum} batch(es); attempted=${totalAttempted}, processed=${totalProcessed}, skipped=${totalSkipped}, failed=${totalFailed}.`);
      return { drained: true, attempted: totalAttempted, processed: totalProcessed, skipped: totalSkipped, failed: totalFailed, batches: batchNum };
    }
  }

  console.warn(`[Scheduler] ${label} hit pipeline deadline after ${batchNum} batch(es); attempted=${totalAttempted}, processed=${totalProcessed}, skipped=${totalSkipped}, failed=${totalFailed}; more remain.`);
  return { drained: false, attempted: totalAttempted, processed: totalProcessed, skipped: totalSkipped, failed: totalFailed, batches: batchNum };
}
