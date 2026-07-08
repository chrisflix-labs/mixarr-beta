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

  const { initializeWorkerReliability } = await import("./lib/workerHealth");
  await initializeWorkerReliability();

  const { initializeBackgroundScheduler } = await import("./lib/backgroundScheduler");
  await initializeBackgroundScheduler();
}
