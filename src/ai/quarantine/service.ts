import crypto from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { redactAiContent } from "../security/redaction";
import { NON_OVERRIDABLE_QUARANTINE_REASONS } from "../security/responseSecurity";

const preview = (value: unknown) => String(typeof value === "string" ? value : JSON.stringify(value)).slice(0, 4000);

export async function storeAiResponse(input: { requestId: string; jobId?: string; providerConfigId?: string; model?: string; schemaVersion: string; body?: unknown; status?: string; repairAttempts?: number; repairMethod?: string; validationSummary?: unknown }) {
  const governance = await prisma.aiGovernanceSetting.findUnique({ where: { id: "global" }, select: { responseBodyRetentionDays: true } });
  const redacted = redactAiContent(input.body);
  const retainBody = (governance?.responseBodyRetentionDays || 0) > 0;
  const jsonBody = input.body && typeof input.body === "object" ? redacted.value as Prisma.InputJsonValue : undefined;
  const textBody = typeof input.body === "string" ? String(redacted.value).slice(0, 1_000_000) : undefined;
  return prisma.aiResponseRecord.upsert({
    where: { requestId: input.requestId },
    create: { requestId: input.requestId, jobId: input.jobId, providerConfigId: input.providerConfigId, model: input.model, schemaVersion: input.schemaVersion, status: input.status || "RECEIVED", bodyJson: retainBody ? jsonBody : undefined, bodyText: retainBody ? textBody : undefined, bodyPurgedAt: retainBody ? undefined : new Date(), repairAttempts: input.repairAttempts || 0, repairMethod: input.repairMethod, responseHash: crypto.createHash("sha256").update(JSON.stringify(redacted.value)).digest("hex"), validationSummaryJson: input.validationSummary == null ? undefined : redactAiContent(input.validationSummary).value as Prisma.InputJsonValue },
    update: { status: input.status || "RECEIVED", bodyJson: retainBody ? jsonBody : undefined, bodyText: retainBody ? textBody : undefined, bodyPurgedAt: retainBody ? undefined : new Date(), repairAttempts: input.repairAttempts || 0, repairMethod: input.repairMethod, validationSummaryJson: input.validationSummary == null ? undefined : redactAiContent(input.validationSummary).value as Prisma.InputJsonValue },
  });
}

export async function quarantineAiResponse(input: { requestId: string; responseRecordId?: string; jobId?: string; userId?: string; featureKey: string; providerConfigId?: string; model?: string; severity?: string; reasons: string[]; requestPreview?: unknown; responsePreview?: unknown; validationFailures?: unknown }) {
  const reasons = Array.from(new Set(input.reasons));
  const nonOverridable = reasons.some((reason) => NON_OVERRIDABLE_QUARANTINE_REASONS.has(reason));
  const safeRequest = redactAiContent(preview(input.requestPreview));
  const safeResponse = redactAiContent(preview(input.responsePreview));
  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.aiQuarantineRecord.create({ data: { requestId: input.requestId, responseRecordId: input.responseRecordId, jobId: input.jobId, userId: input.userId, featureKey: input.featureKey, providerConfigId: input.providerConfigId, model: input.model, severity: nonOverridable ? "BLOCKED" : input.severity || "HIGH", reasonCodesJson: reasons, nonOverridable, safeRequestPreview: String(safeRequest.value), safeResponsePreview: String(safeResponse.value), validationFailuresJson: input.validationFailures == null ? undefined : redactAiContent(input.validationFailures).value as Prisma.InputJsonValue, redactionResultJson: { request: safeRequest.result, response: safeResponse.result } as Prisma.InputJsonValue } });
    await tx.aiRequestAudit.updateMany({ where: { requestId: input.requestId }, data: { quarantineStatus: "QUARANTINED", safetyAnalysisResult: nonOverridable ? "BLOCKED" : "FAILED", status: "QUARANTINED", completedAt: new Date() } });
    await tx.aiJob.updateMany({ where: { requestId: input.requestId }, data: { status: "QUARANTINED", completedAt: new Date(), leaseExpiresAt: null } });
    await tx.aiSecurityEvent.create({ data: { requestId: input.requestId, actorId: input.userId, eventType: "AI_RESPONSE_QUARANTINED", severity: created.severity, reasonCodesJson: reasons, safeDetailsJson: { quarantineId: created.id, nonOverridable } } });
    return created;
  });
  return record;
}

export async function listAiQuarantine(input: { status?: string; severity?: string; featureKey?: string; cursor?: string; limit?: number }) {
  const limit = Math.max(1, Math.min(100, input.limit || 25));
  const rows = await prisma.aiQuarantineRecord.findMany({ where: { ...(input.status ? { status: input.status } : {}), ...(input.severity ? { severity: input.severity } : {}), ...(input.featureKey ? { featureKey: input.featureKey } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}), take: limit + 1 });
  return { records: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
}

export async function resolveAiQuarantine(input: { id: string; actorId: string; action: "REJECT" | "DISMISS_WARNING"; notes?: string }) {
  const row = await prisma.aiQuarantineRecord.findUnique({ where: { id: input.id } });
  if (!row) throw Object.assign(new Error("Quarantine record not found."), { code: "NOT_FOUND", status: 404 });
  if (row.status !== "OPEN") return row;
  if (input.action === "DISMISS_WARNING" && row.nonOverridable) throw Object.assign(new Error("This policy violation is non-overridable and can only be rejected."), { code: "NON_OVERRIDABLE_QUARANTINE", status: 409 });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.aiQuarantineRecord.update({ where: { id: row.id }, data: { status: input.action === "REJECT" ? "REJECTED" : "DISMISSED", resolvedBy: input.actorId, resolvedAt: new Date(), resolution: input.action, resolutionNotes: input.notes?.slice(0, 1000) } });
    await tx.aiSecurityEvent.create({ data: { requestId: row.requestId, actorId: input.actorId, eventType: input.action === "REJECT" ? "AI_QUARANTINE_REJECTED" : "AI_QUARANTINE_WARNING_DISMISSED", severity: row.severity, reasonCodesJson: row.reasonCodesJson as Prisma.InputJsonValue, safeDetailsJson: { quarantineId: row.id } } });
    return updated;
  });
}
