import { runMetadataScanJob } from "../../lib/aiAdvisory/service";
import { runAiRetentionCleanup } from "../retention/service";
import { registerAiJobHandler } from "./worker";

let registered = false;

export function registerDefaultAiJobHandlers() {
  if (registered) return;
  registered = true;

  registerAiJobHandler("METADATA_SUGGESTION_SCAN", async (job, context) => {
    const payload = job.payloadJson as { metadataJobId?: string; input?: unknown } | null;
    if (!job.userId || !payload?.metadataJobId) throw Object.assign(new Error("The metadata scan job payload is incomplete."), { code: "AI_JOB_PAYLOAD_INVALID" });
    if (!(await context.heartbeat({ stage: "STARTING_METADATA_SCAN", metadataJobId: payload.metadataJobId }))) throw Object.assign(new Error("The metadata scan was cancelled before execution."), { code: "REQUEST_CANCELLED" });
    const result = await runMetadataScanJob(job.userId, payload.metadataJobId, payload.input || {});
    await context.heartbeat({ stage: "METADATA_SCAN_COMPLETE", metadataJobId: payload.metadataJobId });
    return { metadataJobId: payload.metadataJobId, status: (result as any).status || ((result as any).cancelled ? "CANCELLED" : "COMPLETED") };
  });

  registerAiJobHandler("AI_RETENTION_CLEANUP", async (job, context) => {
    if (!job.userId) throw Object.assign(new Error("A retention actor is required."), { code: "AI_JOB_PAYLOAD_INVALID" });
    await context.heartbeat({ stage: "PURGING_EXPIRED_AI_DATA" });
    return runAiRetentionCleanup({ actorId: job.userId });
  });
}
