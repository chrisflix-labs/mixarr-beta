import { rotateDueAlternatingExperiments } from "./generation";
import { evaluateDueExperimentCompletions } from "./metrics";
import { cleanupExpiredExperimentHistory } from "./service";

const globalState = globalThis as typeof globalThis & { __mixarrExperimentScheduler?: ReturnType<typeof setInterval> };

export async function initializeExperimentScheduler() {
  if (globalState.__mixarrExperimentScheduler) return;
  const run = async () => {
    try {
      const result = await rotateDueAlternatingExperiments();
      if (result.processed || result.failed) console.info("[SmartExperiments] alternating rotation scan", result);
      const completion = await evaluateDueExperimentCompletions();
      if (completion.completed || completion.inconclusive) console.info("[SmartExperiments] completion scan", completion);
      const cleanup = await cleanupExpiredExperimentHistory();
      if (cleanup.deleted) console.info("[SmartExperiments] retention cleanup", cleanup);
    } catch (error) {
      console.error("[SmartExperiments] alternating rotation scan failed", error instanceof Error ? error.message : error);
    }
  };
  globalState.__mixarrExperimentScheduler = setInterval(run, 5 * 60 * 1000);
  globalState.__mixarrExperimentScheduler.unref?.();
  console.info("[SmartExperiments] alternating rotation scheduler initialized (5 minute scan)");
}
