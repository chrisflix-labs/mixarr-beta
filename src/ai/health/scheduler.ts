import type { ScheduledTask } from "node-cron";

type AiHealthSchedulerRuntime = { task: ScheduledTask | null; running: boolean; lastCleanupAt: number };
declare global { var mixarrAiHealthSchedulerRuntime: AiHealthSchedulerRuntime | undefined; }
const runtime = globalThis.mixarrAiHealthSchedulerRuntime ?? { task: null, running: false, lastCleanupAt: 0 };
globalThis.mixarrAiHealthSchedulerRuntime = runtime;

export async function initializeAiHealthScheduler() {
  if (runtime.task) return;
  const cron = await import("node-cron");
  runtime.task = cron.schedule("*/1 * * * *", async () => {
    if (runtime.running) return;
    runtime.running = true;
    try {
      const { runDueAiHealthChecks } = await import("./service");
      await runDueAiHealthChecks(Number(process.env.AI_HEALTH_CHECK_CONCURRENCY || 2));
      if (Date.now() - runtime.lastCleanupAt >= 24 * 60 * 60 * 1000) {
        const prisma = (await import("@/lib/prisma")).default;
        const settings = await prisma.aiGlobalSetting.findUnique({ where: { id: "global" }, select: { auditRetentionDays: true } });
        if (settings) { const { cleanupAiAuditRecords } = await import("../audit/service"); await cleanupAiAuditRecords(settings.auditRetentionDays); }
        runtime.lastCleanupAt = Date.now();
      }
    } catch (error) {
      // AI is optional and missing migrations/provider outages must never affect
      // application health or other schedulers.
      console.warn("[AI Health] Optional scheduler tick skipped", { code: "AI_HEALTH_CHECK_SKIPPED" });
    } finally { runtime.running = false; }
  });
  console.log("[AI Health] Optional provider-health scheduler initialized; external checks remain gated by global and provider settings.");
}
