import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AiError } from "../errors";
import { redactAiContent } from "../security/redaction";
import { currentEmergencyShutdown } from "../governance/executionPolicy";
import { aiJobFingerprint } from "./fingerprint";

export { aiJobFingerprint } from "./fingerprint";

export const AI_JOB_STATES = ["PENDING", "QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "WAITING_PROVIDER", "RETRYING", "COMPLETED", "FAILED", "CANCELLED", "QUARANTINED", "EXPIRED"] as const;
export type AiJobState = typeof AI_JOB_STATES[number];
const activeStates: AiJobState[] = ["PENDING", "QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "WAITING_PROVIDER", "RETRYING"];

export async function enqueueAiJob(input: { userId: string; featureKey: string; jobType: string; payload: unknown; providerConfigId?: string; model?: string; priority?: number; maximumAttempts?: number; idempotencyKey?: string; forceNew?: boolean; requestAuditId?: string }) {
  const governance = await prisma.aiGovernanceSetting.findUnique({ where: { id: "global" }, select: { maximumQueueSize: true } });
  const queued = await prisma.aiJob.count({ where: { status: { in: activeStates } } });
  if (queued >= (governance?.maximumQueueSize || 100)) throw new AiError("AI_QUEUE_FULL");
  const safe = redactAiContent(input.payload, { blockOnPrivateKey: true });
  if (safe.result.blockedEntirely) throw new AiError("AI_PROMPT_INJECTION_BLOCKED");
  const fingerprint = aiJobFingerprint(safe.value);
  const idempotencyKey = input.forceNew ? crypto.randomUUID() : input.idempotencyKey?.trim().slice(0, 200) || fingerprint;
  const existing = !input.forceNew ? await prisma.aiJob.findUnique({ where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey } } }) : null;
  if (existing) return { job: existing, duplicate: true };
  try {
    const requestId = crypto.randomUUID();
    const job = await prisma.aiJob.create({ data: { requestId, requestAuditId: input.requestAuditId, userId: input.userId, featureKey: input.featureKey, jobType: input.jobType, payloadJson: safe.value as Prisma.InputJsonValue, providerConfigId: input.providerConfigId, model: input.model, priority: Math.max(0, Math.min(1000, input.priority ?? 100)), maximumAttempts: Math.max(1, Math.min(10, input.maximumAttempts ?? 1)), idempotencyKey, contentFingerprint: fingerprint, status: "QUEUED" } });
    await prisma.aiSecurityEvent.create({ data: { requestId, actorId: input.userId, eventType: "AI_JOB_QUEUED", severity: "INFO", reasonCodesJson: ["queued"], safeDetailsJson: { jobId: job.id, featureKey: job.featureKey, redaction: safe.result } as Prisma.InputJsonValue, correlationId: requestId } });
    return { job, duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.aiJob.findUnique({ where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey } } });
      if (duplicate) return { job: duplicate, duplicate: true };
    }
    throw error;
  }
}

export async function claimNextAiJob(workerId: string) {
  const shutdown = await currentEmergencyShutdown();
  if (shutdown.active) return null;
  return prisma.$transaction(async (tx) => {
    // PostgreSQL returns `void` from pg_advisory_xact_lock. Prisma 5.14 cannot
    // deserialize that type, so cast the result while retaining the
    // transaction-scoped advisory lock.
    await tx.$queryRaw<Array<{ lockResult: string }>>`SELECT pg_advisory_xact_lock(hashtext('mixarr-ai-job-claim-v249'))::text AS "lockResult"`;
    const governance = await tx.aiGovernanceSetting.findUnique({ where: { id: "global" } });
    const limits = { global: governance?.globalConcurrencyLimit || 2, provider: governance?.perProviderConcurrencyLimit || 1, model: governance?.perModelConcurrencyLimit || 1, user: governance?.perUserConcurrencyLimit || 1, feature: governance?.perFeatureConcurrencyLimit || 1 };
    const running = await tx.aiJob.findMany({ where: { status: "RUNNING", leaseExpiresAt: { gt: new Date() } }, select: { providerConfigId: true, model: true, userId: true, featureKey: true } });
    if (running.length >= limits.global) return null;
    const candidates = await tx.aiJob.findMany({ where: { status: { in: ["PENDING", "QUEUED", "RETRYING", "WAITING_RATE_LIMIT", "WAITING_PROVIDER"] }, cancellationRequestedAt: null, OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }] }, orderBy: [{ priority: "asc" }, { queuedAt: "asc" }], take: 50 });
    const candidate = candidates.find((job) => running.filter((row) => job.providerConfigId && row.providerConfigId === job.providerConfigId).length < limits.provider && running.filter((row) => job.model && row.providerConfigId === job.providerConfigId && row.model === job.model).length < limits.model && running.filter((row) => row.userId === job.userId).length < limits.user && running.filter((row) => row.featureKey === job.featureKey).length < limits.feature);
    if (!candidate) return null;
    const leaseSeconds = Math.max(30, Math.min(900, governance?.jobLeaseSeconds || 120));
    const now = new Date();
    const claimed = await tx.aiJob.updateMany({ where: { id: candidate.id, status: candidate.status, cancellationRequestedAt: null }, data: { status: "RUNNING", workerId, startedAt: candidate.startedAt || now, heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000), waitingReason: null, attemptCount: { increment: 1 } } });
    return claimed.count ? tx.aiJob.findUnique({ where: { id: candidate.id } }) : null;
  });
}

export async function heartbeatAiJob(jobId: string, workerId: string, progress?: unknown) {
  const governance = await prisma.aiGovernanceSetting.findUnique({ where: { id: "global" }, select: { jobLeaseSeconds: true } });
  const now = new Date();
  const updated = await prisma.aiJob.updateMany({ where: { id: jobId, workerId, status: "RUNNING", cancellationRequestedAt: null }, data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + Math.max(30, governance?.jobLeaseSeconds || 120) * 1000), progressJson: progress == null ? undefined : redactAiContent(progress).value as Prisma.InputJsonValue } });
  return updated.count === 1;
}

export async function completeAiJob(jobId: string, workerId: string, resultReference?: unknown) {
  const now = new Date();
  const updated = await prisma.aiJob.updateMany({ where: { id: jobId, workerId, status: "RUNNING", cancellationRequestedAt: null }, data: { status: "COMPLETED", completedAt: now, leaseExpiresAt: null, heartbeatAt: now, resultReferenceJson: resultReference == null ? undefined : redactAiContent(resultReference).value as Prisma.InputJsonValue } });
  if (!updated.count) throw new AiError("AI_JOB_NOT_CANCELLABLE");
}

export async function failAiJob(jobId: string, workerId: string, error: unknown, retryAfterMs?: number) {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
  if (!job || job.workerId !== workerId || job.status !== "RUNNING") throw new AiError("AI_JOB_NOT_FOUND");
  const safe = redactAiContent(error instanceof Error ? error.message : String(error)).value.slice(0, 1000);
  const retry = !job.cancellationRequestedAt && job.attemptCount < job.maximumAttempts;
  await prisma.aiJob.update({ where: { id: jobId }, data: retry ? { status: "RETRYING", nextRetryAt: new Date(Date.now() + Math.max(1000, retryAfterMs || 5000)), leaseExpiresAt: null, workerId: null, redactedErrorMessage: safe } : { status: job.cancellationRequestedAt ? "CANCELLED" : "FAILED", cancelledAt: job.cancellationRequestedAt ? new Date() : undefined, completedAt: new Date(), leaseExpiresAt: null, redactedErrorMessage: safe, errorCode: (error as any)?.code || (error as any)?.category || "AI_JOB_FAILED" } });
}

export async function cancelAiJob(jobId: string, actorId: string, admin = false) {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
  if (!job) throw new AiError("AI_JOB_NOT_FOUND");
  if (job.userId !== actorId && !admin) throw Object.assign(new Error("Permission denied."), { code: "PERMISSION_DENIED", status: 403 });
  if (!["PENDING", "QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "WAITING_PROVIDER", "RETRYING"].includes(job.status)) throw new AiError("AI_JOB_NOT_CANCELLABLE");
  const now = new Date();
  const immediate = job.status !== "RUNNING";
  const updated = await prisma.aiJob.update({ where: { id: jobId }, data: { cancellationRequestedAt: now, ...(immediate ? { status: "CANCELLED", cancelledAt: now, completedAt: now } : {}) } });
  await prisma.aiSecurityEvent.create({ data: { requestId: job.requestId, actorId, eventType: "AI_JOB_CANCELLATION_REQUESTED", severity: "INFO", reasonCodesJson: ["user_cancellation"], safeDetailsJson: { jobId } } });
  return updated;
}

export async function recoverStaleAiJobs(batchSize = 100) {
  const now = new Date();
  const stale = await prisma.aiJob.findMany({ where: { status: "RUNNING", leaseExpiresAt: { lt: now } }, orderBy: { leaseExpiresAt: "asc" }, take: Math.max(1, Math.min(500, batchSize)) });
  let recovered = 0;
  for (const job of stale) {
    const terminal = job.cancellationRequestedAt || job.attemptCount >= job.maximumAttempts;
    const updated = await prisma.aiJob.updateMany({ where: { id: job.id, status: "RUNNING", leaseExpiresAt: job.leaseExpiresAt }, data: terminal ? { status: job.cancellationRequestedAt ? "CANCELLED" : "FAILED", cancelledAt: job.cancellationRequestedAt ? now : undefined, completedAt: now, workerId: null, leaseExpiresAt: null, errorCode: "STALE_LEASE_EXPIRED" } : { status: "QUEUED", workerId: null, leaseExpiresAt: null, heartbeatAt: null, waitingReason: "STALE_LEASE_RECOVERED" } });
    recovered += updated.count;
  }
  return recovered;
}

export async function getVisibleAiJob(jobId: string, userId: string, admin = false) {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
  if (!job) throw new AiError("AI_JOB_NOT_FOUND");
  if (job.userId !== userId && !admin) throw Object.assign(new Error("Permission denied."), { code: "PERMISSION_DENIED", status: 403 });
  return { ...job, payloadJson: undefined };
}
