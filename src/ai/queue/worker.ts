import type { AiJob } from "@prisma/client";
import { claimNextAiJob, completeAiJob, failAiJob, heartbeatAiJob, recoverStaleAiJobs } from "./service";

export type AiJobHandler = (job: AiJob, context: { heartbeat: (progress?: unknown) => Promise<boolean> }) => Promise<unknown>;
const handlers = new Map<string, AiJobHandler>();
const workerId = `mixarr-ai-${process.pid}-${crypto.randomUUID()}`;
let running = false;
let task: import("node-cron").ScheduledTask | null = null;

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
    try { const result = await handler(job, { heartbeat: (progress) => heartbeatAiJob(job.id, workerId, progress) }); await completeAiJob(job.id, workerId, result); }
    catch (error) { await failAiJob(job.id, workerId, error); }
    return true;
  } finally { running = false; }
}

export async function initializeAiQueueWorker() {
  if (task) return;
  const cron = await import("node-cron");
  task = cron.schedule("*/5 * * * * *", () => void runAiQueueOnce());
  console.log("[AI Queue] Durable worker initialized.");
}

