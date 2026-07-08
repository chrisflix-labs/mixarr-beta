import type { ScheduledTask } from "node-cron";
import { getResolvedSchedulerSettings, isValidSchedulerCron, type ResolvedSchedulerSettings } from "./schedulerSettings";

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
  let pipelineResult: "success" | "failed" | "timeout" = "success";
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

  console.log(`[Scheduler] Scheduled background sync started using cron ${activeCron}.`);

  try {
    const prisma = (await import("./prisma")).default;

    setJobPhase(lock.job, "Step 1/5: Pulling latest tracks from Plex");
    console.log("[Scheduler] Step 1/5: Pulling latest tracks from Plex...");
    const libraries = await prisma.library.findMany();
    if (libraries.length > 0) {
      const { runSyncEngine } = await import("./syncEngine");
      for (const lib of libraries) {
        if (!remaining()) {
          console.warn(`[Scheduler] Pipeline deadline reached before syncing ${lib.name}; aborting.`);
          pipelineResult = "timeout";
          return;
        }
        console.log(`[Scheduler] Syncing library: ${lib.name} (${lib.id})`);
        await runSyncEngine(lib.id);
      }
    } else {
      console.log("[Scheduler] No libraries found. Skipping Plex sync.");
    }

    setJobPhase(lock.job, "Step 2/5: Enriching audio features");
    console.log("[Scheduler] Step 2/5: Enriching Audio Features...");
    const { runAudioFeatureEngine } = await import("./audioFeatureEngine");
    const audioDrained = await loopEngine("AudioFeatureEngine", runAudioFeatureEngine, remaining);
    if (!audioDrained) pipelineResult = "timeout";

    setJobPhase(lock.job, "Step 3/5: Fetching popularity scores");
    console.log("[Scheduler] Step 3/5: Fetching Popularity Scores...");
    const { runPopularityEngine } = await import("./popularityEngine");
    const popDrained = await loopEngine("PopularityEngine", runPopularityEngine, remaining);
    if (!popDrained) pipelineResult = "timeout";

    setJobPhase(lock.job, "Step 4/5: Fetching track-level genres");
    console.log("[Scheduler] Step 4/5: Fetching Track-Level Genres...");
    const { runTrackTagEngine } = await import("./trackTagEngine");
    const tagsDrained = await loopEngine("TrackTagEngine", runTrackTagEngine, remaining);
    if (!tagsDrained) pipelineResult = "timeout";

    if (remaining()) {
      setJobPhase(lock.job, "Step 5/5: Refreshing saved smart playlists");
      console.log("[Scheduler] Step 5/5: Refreshing saved smart playlists...");
      const { refreshAutoPlaylists } = await import("./playlistService");
      const refreshedCount = await refreshAutoPlaylists();
      console.log(`[Scheduler] Refreshed ${refreshedCount} saved smart playlists.`);
    } else {
      console.warn("[Scheduler] Pipeline deadline reached before Step 5/5; skipping playlist refresh.");
      pipelineResult = "timeout";
    }

    const minutes = Math.round((Date.now() - pipelineStart) / 60000);
    if (pipelineResult === "success") {
      console.log(`[Scheduler] Scheduled background sync completed successfully. (${minutes} min)`);
    } else {
      console.warn(`[Scheduler] Pipeline exited with status=${pipelineResult} after ${minutes} min`);
    }
  } catch (error) {
    console.error("[Scheduler] Scheduled background sync failed:", error);
    pipelineResult = "failed";
  } finally {
    endTimer();
    await safeFinishJobHistory({
      job: history,
      status: pipelineResult === "success" ? "completed" : pipelineResult === "timeout" ? "completed_with_warnings" : "failed",
      summary: `Scheduled background sync started using cron ${activeCron} and finished with status=${pipelineResult}.`,
      metadata: { cron: activeCron },
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
): Promise<boolean> {
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
      console.log(`[Scheduler] ${label} drained after ${batchNum} batch(es); attempted=${totalAttempted}, processed=${totalProcessed}, skipped=${totalSkipped}, failed=${totalFailed}.`);
      return true;
    }
  }

  console.warn(`[Scheduler] ${label} hit pipeline deadline after ${batchNum} batch(es); attempted=${totalAttempted}, processed=${totalProcessed}, skipped=${totalSkipped}, failed=${totalFailed}; more remain.`);
  return false;
}
