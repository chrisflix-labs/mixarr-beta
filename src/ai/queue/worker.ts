import type { AiJob } from "@prisma/client";
import { claimNextAiJob, completeAiJob, failAiJob, heartbeatAiJob, recoverStaleAiJobs } from "./service";

export type AiJobHandler = (job: AiJob, context: { heartbeat: (progress?: unknown) => Promise<boolean>; signal: AbortSignal }) => Promise<unknown>;
const handlers = new Map<string, AiJobHandler>();
const workerId = `mixarr-ai-${process.pid}-${crypto.randomUUID()}`;
let running = false;
let task: import("node-cron").ScheduledTask | null = null;
const activeControllers = new Set<AbortController>();
let shutdownAttached = false;

function attachShutdownCancellation() {
  if (shutdownAttached) return;
  shutdownAttached = true;
  const cancel = () => { for (const controller of Array.from(activeControllers)) controller.abort("AI worker shutdown."); };
  process.once("SIGTERM", cancel);
  process.once("SIGINT", cancel);
}

export function registerAiJobHandler(jobType: string, handler: AiJobHandler) { handlers.set(jobType, handler); }

export async function runAiQueueOnce() {
  if (running) return false;
  running = true;
  try {
    await recoverStaleAiJobs();
    const job = await claimNextAiJob(workerId);
    if (!job) return false;
    const handler = handlers.get(job.jobType);
    if (!handler) { await failAiJob(job.id, workerId, Object.assign(new Error("No safe handler is registered for this AI job type."), { code: "AI_JOB_HANDLER_UNAVAILABLE" })); return true; }
    const controller = new AbortController();
    activeControllers.add(controller);
    const intervalMs = 15_000;
    const heartbeatTimer = setInterval(() => {
      void heartbeatAiJob(job.id, workerId, { stage: "RUNNING", timeoutMode: "heartbeat_managed" }).then((healthy) => {
        if (!healthy) controller.abort("AI job cancellation or lease ownership change.");
      }).catch(() => controller.abort("AI job heartbeat failed."));
    }, intervalMs);
    heartbeatTimer.unref?.();
    try {
      const result = await handler(job, { heartbeat: async (progress) => {
        const healthy = await heartbeatAiJob(job.id, workerId, progress);
        if (!healthy) controller.abort("AI job cancellation or lease ownership change.");
        return healthy;
      }, signal: controller.signal });
      if (controller.signal.aborted) throw Object.assign(new Error("The AI job was cancelled."), { code: "AI_REQUEST_CANCELLED" });
      await completeAiJob(job.id, workerId, result);
    }
    catch (error) { await failAiJob(job.id, workerId, error); }
    finally { clearInterval(heartbeatTimer); activeControllers.delete(controller); }
    return true;
  } finally { running = false; }
}

export async function initializeAiQueueWorker() {
  if (task) return;
  attachShutdownCancellation();
  const cron = await import("node-cron");
  task = cron.schedule("*/5 * * * * *", () => void runAiQueueOnce());
  console.log("[AI Queue] Durable worker initialized.");
}
