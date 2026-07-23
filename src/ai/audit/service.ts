import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { AiResponse } from "../contracts";
import type { AiErrorCategory } from "../errors";

export async function createAiAudit(input: { requestId: string; correlationId?: string; featureKey: string; providerConfigId?: string; providerType?: string; providerDisplayName?: string; model?: string; streaming: boolean; userId?: string; metadata?: Record<string, unknown>; promptHash?: string; requestSource?: string; locationClassification?: string; idempotencyKey?: string; contentFingerprint?: string; promptTemplateVersion?: string; requestBody?: unknown; redactionResult?: unknown; injectionResult?: unknown; externalDataCategories?: string[] }) {
  return prisma.aiRequestAudit.create({ data: { requestId: input.requestId, logicalRequestId: input.requestId, correlationId: input.correlationId, featureKey: input.featureKey, providerConfigId: input.providerConfigId, providerType: input.providerType, providerDisplayName: input.providerDisplayName, model: input.model, streamingUsed: input.streaming, userId: input.userId, safeMetadataJson: input.metadata as Prisma.InputJsonValue | undefined, promptHash: input.promptHash, requestSource: input.requestSource || "FOREGROUND", background: input.requestSource === "BACKGROUND", locationClassification: input.locationClassification, idempotencyKey: input.idempotencyKey, contentFingerprint: input.contentFingerprint, promptTemplateVersion: input.promptTemplateVersion, requestBodyJson: input.requestBody as Prisma.InputJsonValue | undefined, redactionResultJson: input.redactionResult as Prisma.InputJsonValue | undefined, injectionResultJson: input.injectionResult as Prisma.InputJsonValue | undefined, externalDataCategoriesJson: input.externalDataCategories as Prisma.InputJsonValue | undefined, policyValidationResult: "PASSED", status: "RUNNING" } });
}
export async function completeAiAudit(requestId: string, response: AiResponse, responseByteCount: number) { return prisma.aiRequestAudit.update({ where: { requestId }, data: { status: "COMPLETED", completedAt: new Date(), latencyMs: response.latencyMs, providerDurationMs: response.latencyMs, retryCount: response.retryCount, inputTokenCount: response.usage?.inputTokens, outputTokenCount: response.usage?.outputTokens, totalTokenCount: response.usage?.totalTokens, cachedTokenCount: response.usage?.cachedTokens, reasoningTokenCount: response.usage?.reasoningTokens, estimatedCost: response.estimatedCost, actualCost: response.actualCost, usageSource: response.usage?.providerReported ? "PROVIDER_REPORTED" : "ESTIMATED", providerRequestId: response.usage?.providerRequestId?.slice(0, 300), responseByteCount, budgetControlResult: "RECONCILED", limitControlResult: "ALLOWED", structuredOutputResult: response.data === undefined ? "NOT_REQUIRED" : "PASSED", schemaValidationResult: response.data === undefined ? "NOT_REQUIRED" : "PASSED", safetyAnalysisResult: "PASSED", quarantineStatus: "NONE" } }); }
export async function failAiAudit(requestId: string, input: { category: AiErrorCategory; retryCount: number; latencyMs: number; cancelled?: boolean; timedOut?: boolean }) { return prisma.aiRequestAudit.update({ where: { requestId }, data: { status: input.cancelled ? "CANCELLED" : input.timedOut ? "TIMED_OUT" : "FAILED", completedAt: new Date(), latencyMs: input.latencyMs, retryCount: input.retryCount, cancellationStatus: input.cancelled ? "USER_OR_SERVER_CANCELLED" : null, errorCategory: input.category, sanitizedErrorCode: input.category } }); }
export async function setAiAuditStatus(requestId: string, status: "STREAMING" | "RETRIED") { return prisma.aiRequestAudit.update({ where: { requestId }, data: { status } }); }

export async function cleanupAiAuditRecords(retentionDays: number, batchSize = 500) {
  const cutoff = new Date(Date.now() - Math.max(1, retentionDays) * 86_400_000); let deleted = 0;
  while (true) {
    const batch = await prisma.aiRequestAudit.findMany({ where: { createdAt: { lt: cutoff }, status: { notIn: ["QUEUED", "RUNNING", "STREAMING", "RETRIED"] } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: Math.min(1000, Math.max(1, batchSize)) });
    if (!batch.length) break;
    deleted += (await prisma.aiRequestAudit.deleteMany({ where: { id: { in: batch.map((row) => row.id) } } })).count;
    if (batch.length < batchSize) break;
  }
  console.info("[AI Audit] Retention cleanup completed", { deleted, retentionDays });
  return { deleted, retentionDays, cutoff: cutoff.toISOString() };
}
