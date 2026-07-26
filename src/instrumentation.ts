export async function register() {
  // Only run in the Node.js runtime (not Edge / browser builds).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Optional: start a dedicated /metrics HTTP server on its own port so
  // Prometheus can scrape Mixarr. METRICS_PORT=0 (the default) disables
  // it entirely and avoids opening a second listener.
  const metricsPort = Number(process.env.METRICS_PORT || "0");
  if (Number.isFinite(metricsPort) && metricsPort > 0) {
    const { startMetricsServer } = await import("./lib/metrics");
    startMetricsServer(metricsPort);
  } else {
    console.log("[Metrics] Prometheus endpoint disabled (METRICS_PORT is 0 or unset)");
  }

  const { sanitizeErrorText } = await import("./lib/supportRedaction");

  const databaseConfigured = Boolean(process.env.DATABASE_URL);

  if (!databaseConfigured) {
    console.warn("[Readiness] DATABASE_URL is missing. Worker and scheduler startup are disabled until the database is configured.");
  } else {
    try {
      const { initializeStorageSafety } = await import("./lib/storageStartup");
      await initializeStorageSafety();
    } catch (error) {
      console.error("[Storage] Startup initialization failed", sanitizeErrorText(error));
    }

    try {
      const { initializeWorkerReliability } = await import("./lib/workerHealth");
      await initializeWorkerReliability();
    } catch (error) {
      console.error("[Worker] Startup initialization failed", sanitizeErrorText(error));
    }

    try {
      const { diagnoseAndMigrateRecipeScoringModels } = await import("./lib/scoringModelMigration");
      await diagnoseAndMigrateRecipeScoringModels();
    } catch (error) {
      console.error("[Playlist Recipe] Scoring-model migration diagnostic failed", sanitizeErrorText(error));
    }

    try {
      const { initializeBackgroundScheduler } = await import("./lib/backgroundScheduler");
      await initializeBackgroundScheduler();
    } catch (error) {
      console.error("[Scheduler] Startup initialization failed", sanitizeErrorText(error));
    }

    try {
      const { initializeIntegrationScheduler } = await import("./lib/integrations/scheduler");
      await initializeIntegrationScheduler();
    } catch (error) {
      console.error("[Integrations] Scheduler startup failed", sanitizeErrorText(error));
    }

    try {
      const { initializeRecentlyAddedScheduler } = await import("./lib/recentlyAdded/scheduler");
      await initializeRecentlyAddedScheduler();
    } catch (error) {
      console.error("[RecentlyAdded] Scheduler startup failed", sanitizeErrorText(error));
    }

    try {
      const { initializePlaylistOrchestrationWorker } = await import("./lib/orchestration/worker");
      await initializePlaylistOrchestrationWorker();
    } catch (error) {
      console.error("[OrchestrationWorker] Startup initialization failed", sanitizeErrorText(error));
    }

    try {
      const { initializePlaylistGroupScheduler } = await import("./lib/playlistGroups/scheduler");
      await initializePlaylistGroupScheduler();
    } catch (error) {
      console.error("[PlaylistGroupScheduler] Startup initialization failed", sanitizeErrorText(error));
    }

    try {
      const { initializeExperimentScheduler } = await import("./lib/experiments/scheduler");
      await initializeExperimentScheduler();
    } catch (error) {
      console.error("[SmartExperiments] Scheduler startup failed", sanitizeErrorText(error));
    }

    try {
      const { initializeAiHealthScheduler } = await import("./ai/health/scheduler");
      await initializeAiHealthScheduler();
    } catch (error) {
      console.warn("[AI Health] Optional scheduler startup skipped", sanitizeErrorText(error));
    }

    try {
      const { registerDefaultAiJobHandlers } = await import("./ai/queue/handlers");
      const { initializeAiQueueWorker } = await import("./ai/queue/worker");
      registerDefaultAiJobHandlers();
      await initializeAiQueueWorker();
    } catch (error) {
      console.warn("[AI Queue] Optional worker startup skipped", sanitizeErrorText(error));
    }

    try {
      const { validateAiFeatureConfiguration } = await import("./ai/governance/featureValidation");
      await validateAiFeatureConfiguration();
    } catch (error) {
      console.warn("[AI Governance] Feature identifier validation skipped", sanitizeErrorText(error));
    }
  }

  try {
    const { runStartupReadinessCheck } = await import("./lib/readiness");
    await runStartupReadinessCheck();
  } catch (error) {
    console.error("[Readiness] Startup initialization failed", sanitizeErrorText(error));
  }
}
