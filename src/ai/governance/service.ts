import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isUserAdmin } from "@/lib/auth";
import type { AiRequest, ResolvedAiProviderConfig } from "../contracts";
import { AiError } from "../errors";
import { alertDeduplicationKey, applyMetadataPrivacyPolicy, budgetPeriod, DEFAULT_METADATA_ALLOWLIST, estimateRequestCost, evaluateCostLimit, evaluateRetryCost, strictestPrivacyMode, trimContext, validatePromptLimits, wouldExceedBudget, type AiPrivacyMode } from "./policy";
import { AI_GLOBAL_REQUEST_LIMIT_MODES, AI_REQUEST_LIMIT_MODES, evaluateRequestLimit, requestLimitAuditDetails, requestLimitResetAt, validateRequestLimitConfiguration } from "./requestLimits";
import { AI_COST_LIMIT_MODES, costLimitAuditDetails, resolveCostLimit, validateCostLimitConfiguration } from "./costLimits";
import { classifyProviderAndModel, resolvePaidProviderPermission, type AiClassificationResult } from "./classification";
import { unexpectedAiError } from "./logging";
import { resolveModelCapabilities } from "../registry/modelCapabilities";
import { MAX_AI_TIMEOUT_MS, MAX_CANCELLATION_GRACE_MS, MIN_CANCELLATION_GRACE_MS } from "../config/timeout";

const warningThresholds = [0.5, 0.75, 0.9, 1];
const deprecatedTokenFields = ["maximumInputTokens", "maximumOutputTokens", "maximumCombinedTokens", "maximumCompletionTokens", "maximumPromptTokens", "maximumReasoningTokens", "maximumRequestTokens", "tokenLimit", "dailyTokenLimit", "monthlyTokenLimit", "providerTokenLimit", "userTokenLimit", "featureTokenLimit", "defaultOutputTokens", "recommendedOutputTokens"] as const;
export const FULL_METADATA_POLICY_VERSION = "v2.4.1-1";
const FULL_METADATA_WARNING = "Full Metadata can disclose administrator-approved music metadata to external AI providers. Secrets, file paths, credentials, and infrastructure identifiers remain prohibited.";

const governanceSchema = z.object({
  privacyMode: z.enum(["LOCAL_ONLY", "METADATA_LIMITED", "ANONYMOUS_METADATA", "FULL_METADATA"]).optional(), reviewed: z.boolean().optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), monthlyBudget: z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d{1,6})?$/), z.null()]).optional(), budgetResetDay: z.number().int().min(1).max(28).optional(), budgetWarningThresholds: z.array(z.number().min(0).max(1)).min(1).max(10).optional(), hardShutdownEnabled: z.boolean().optional(), countLocalCost: z.boolean().optional(), allowUnpricedExternalModels: z.boolean().optional(), adminExemptionEnabled: z.boolean().optional(), allowPaidProviderFallback: z.boolean().optional(), paidProvidersAllowed: z.boolean().optional(), allowUserPaidProviderOverrides: z.boolean().optional(), automaticCheaperModelFallback: z.boolean().optional(), backgroundAiEnabled: z.boolean().optional(), externalBackgroundAiEnabled: z.boolean().optional(), maximumBackgroundRequestsPerDay: z.number().int().positive().nullable().optional(), maximumBackgroundCostPerDay: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), maximumBackgroundConcurrency: z.number().int().min(1).max(100).optional(), requireExternalBackgroundApproval: z.boolean().optional(), maximumPromptCharacters: z.number().int().min(100).max(20_000_000).optional(), maximumPromptBytes: z.number().int().min(100).max(50_000_000).optional(), maximumMetadataRecords: z.number().int().min(0).max(100_000).optional(), maximumContextMessages: z.number().int().min(1).max(10_000).optional(), maximumResponseBytes: z.number().int().min(1024).max(20_000_000).optional(), maximumStructuredItems: z.number().int().min(1).max(100_000).optional(), dailyRequestLimitMode: z.enum(AI_GLOBAL_REQUEST_LIMIT_MODES).optional(), dailyRequestLimit: z.number().int().positive("Enter 1 or more daily requests, or choose Unlimited. Zero is not a valid limit.").max(1_000_000).nullable().optional(), monthlyRequestLimit: z.number().int().positive("Enter 1 or more monthly requests, or leave the field blank for no monthly request limit.").max(10_000_000).nullable().optional(), metadataAllowlist: z.array(z.string().min(1).max(80)).max(100).optional(), anonymousGranularity: z.enum(["STRICT", "BALANCED", "MINIMAL"]).optional(), anonymousYearBandSize: z.number().int().min(5).max(50).optional(), anonymousBpmBandSize: z.number().int().min(5).max(50).optional(), allowUnknownLocalMetadata: z.boolean().optional(), secureDebugEnabled: z.boolean().optional(), secureDebugRetentionHours: z.number().int().min(1).max(168).optional(), defaultContextTrimmingStrategy: z.enum(["REJECT", "REMOVE_OLDEST", "REMOVE_LOWEST_PRIORITY", "REMOVE_DUPLICATES"]).optional(), connectionTimeoutMs: z.number().int().positive().max(MAX_AI_TIMEOUT_MS).nullable().optional(), firstTokenTimeoutMs: z.number().int().positive().max(MAX_AI_TIMEOUT_MS).nullable().optional(), totalRequestTimeoutMs: z.number().int().positive().max(MAX_AI_TIMEOUT_MS).nullable().optional(), streamingIdleTimeoutMs: z.number().int().positive().max(MAX_AI_TIMEOUT_MS).nullable().optional(), cancellationGraceMs: z.number().int().min(MIN_CANCELLATION_GRACE_MS).max(MAX_CANCELLATION_GRACE_MS).optional(), maximumRetryAttempts: z.number().int().min(0).max(10).optional(), maximumRetryCost: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), perRequestCostLimitMode: z.enum(AI_COST_LIMIT_MODES).optional(), maximumEstimatedRequestCost: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), cumulativeRequestCostLimitMode: z.enum(AI_COST_LIMIT_MODES).optional(), maximumCumulativeRequestCost: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), retryAfterPossibleBilling: z.boolean().optional(), auditRetentionDays: z.number().int().min(1).max(3650).optional(), usageSummaryRetentionDays: z.number().int().min(30).max(3650).optional(), errorRetentionDays: z.number().int().min(1).max(3650).optional(), externalProvidersAllowed: z.boolean().optional(), requireExternalConfirmation: z.boolean().optional(), allowedExternalFeaturesJson: z.array(z.string().max(120)).max(100).optional(), allowedExternalDataJson: z.array(z.string().max(120)).max(100).optional(), requestMetadataRetentionDays: z.number().int().min(0).max(3650).optional(), requestBodyRetentionDays: z.number().int().min(0).max(3650).optional(), responseMetadataRetentionDays: z.number().int().min(0).max(3650).optional(), responseBodyRetentionDays: z.number().int().min(0).max(3650).optional(), quarantineRetentionDays: z.number().int().min(1).max(3650).optional(), approvalRetentionDays: z.number().int().min(1).max(3650).optional(), costRetentionDays: z.number().int().min(1).max(3650).optional(), diagnosticRetentionDays: z.number().int().min(0).max(3650).optional(), redactEmailAddresses: z.boolean().optional(), redactLocalPaths: z.boolean().optional(), redactInternalHostnames: z.boolean().optional(), redactIpAddresses: z.boolean().optional(), redactUsernames: z.boolean().optional(), globalConcurrencyLimit: z.number().int().min(1).max(1000).optional(), perProviderConcurrencyLimit: z.number().int().min(1).max(1000).optional(), perModelConcurrencyLimit: z.number().int().min(1).max(1000).optional(), perUserConcurrencyLimit: z.number().int().min(1).max(1000).optional(), perFeatureConcurrencyLimit: z.number().int().min(1).max(1000).optional(), diagnosticConcurrencyLimit: z.number().int().min(1).max(1000).optional(), healthCheckConcurrencyLimit: z.number().int().min(1).max(1000).optional(), maximumQueueSize: z.number().int().min(1).max(100000).optional(), jobLeaseSeconds: z.number().int().min(30).max(3600).optional(), jsonLocalRepairAttempts: z.number().int().min(0).max(1).optional(), jsonProviderRepairAttempts: z.number().int().min(0).max(1).optional(), reason: z.string().max(1000).optional()
});

function defaultGovernanceData() {
  return { id: "global", budgetWarningThresholds: warningThresholds, metadataAllowlistJson: [...DEFAULT_METADATA_ALLOWLIST] };
}

function publicGovernanceSettings<T extends Record<string, any>>(row: T) {
  const result = { ...row };
  for (const field of deprecatedTokenFields) delete result[field];
  return result;
}

export async function getAiGovernanceSettings() {
  const row = await prisma.aiGovernanceSetting.upsert({ where: { id: "global" }, create: defaultGovernanceData(), update: {} });
  if (await prisma.aiAlertThreshold.count() === 0) await prisma.aiAlertThreshold.createMany({ data: [{ scopeType: "GLOBAL", condition: "BUDGET_PERCENT", thresholdsJson: warningThresholds }, { scopeType: "GLOBAL", condition: "HARD_SHUTDOWN", thresholdsJson: [1] }, { scopeType: "GLOBAL", condition: "STALE_PRICING", thresholdsJson: [90] }] });
  const now = new Date(); const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [acknowledgment, reservations, alerts, requestsToday] = await Promise.all([
    prisma.aiPrivacyAcknowledgment.findFirst({ where: { policyVersion: FULL_METADATA_POLICY_VERSION, revokedAt: null }, orderBy: { acceptedAt: "desc" } }),
    prisma.aiBudgetReservation.findMany({ where: { status: "ACTIVE", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, requestId: true, providerConfigId: true, userId: true, featureKey: true, requestSource: true, currency: true, reservedCost: true, expiresAt: true, createdAt: true } }),
    prisma.aiAlertEvent.findMany({ where: { acknowledgedAt: null }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.aiRequestAudit.count({ where: { createdAt: { gte: today }, status: { in: ["COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"] } } })
  ]);
  // Resolved so the administrative interface always shows the same effective state
  // the admission check will apply, including for legacy rows without a mode.
  const globalDailyRequests = evaluateRequestLimit({ period: "DAILY", now, scopes: [{ scope: "GLOBAL", mode: row.dailyRequestLimitMode, limit: row.dailyRequestLimit, usage: requestsToday }] });
  return { ...publicGovernanceSettings(row), budgetWarningThresholds: row.budgetWarningThresholds, metadataAllowlist: row.metadataAllowlistJson, fullMetadataPolicyVersion: FULL_METADATA_POLICY_VERSION, fullMetadataWarning: FULL_METADATA_WARNING, fullMetadataAcknowledged: !!acknowledgment, acknowledgment, reservations, alerts, dailyRequestUsage: { usage: requestsToday, effectiveMode: globalDailyRequests.effective?.effectiveMode || "UNLIMITED", limit: globalDailyRequests.limit, remaining: globalDailyRequests.remaining, resetAt: globalDailyRequests.resetAt || requestLimitResetAt("DAILY", now).toISOString(), exceeded: !globalDailyRequests.allowed }, requestLimitModes: AI_REQUEST_LIMIT_MODES, costLimitModes: AI_COST_LIMIT_MODES, costLimits: { perRequest: resolveCostLimit({ control: "PER_REQUEST", mode: row.perRequestCostLimitMode, limit: row.maximumEstimatedRequestCost?.toString() }), cumulativeRequest: resolveCostLimit({ control: "CUMULATIVE_REQUEST", mode: row.cumulativeRequestCostLimitMode, limit: row.maximumCumulativeRequestCost?.toString() }) } };
}

export async function updateAiGovernanceSettings(raw: unknown, actorId: string) {
  const deprecated = raw && typeof raw === "object" ? deprecatedTokenFields.filter((field) => Object.prototype.hasOwnProperty.call(raw, field)) : [];
  const input = governanceSchema.parse(raw);
  if (input.maximumRetryAttempts != null && input.maximumRetryAttempts > 1) throw new AiError("INVALID_REQUEST", "AI requests permit at most one transient retry.", 400);
  const previous = await prisma.aiGovernanceSetting.upsert({ where: { id: "global" }, create: defaultGovernanceData(), update: {} });
  if (input.privacyMode === "FULL_METADATA") { const ack = await prisma.aiPrivacyAcknowledgment.findFirst({ where: { policyVersion: FULL_METADATA_POLICY_VERSION, revokedAt: null } }); if (!ack) throw new AiError("AI_PRIVACY_POLICY_BLOCKED", undefined, 409, undefined, { reason: "FULL_METADATA_ACKNOWLEDGMENT_REQUIRED" }); }
  const { reason, budgetWarningThresholds, metadataAllowlist, ...values } = input;
  // Mode and limit are stored together, so validate the merged pair: patching one
  // must never leave "Limited" without a usable number of requests.
  if (values.dailyRequestLimitMode !== undefined || values.dailyRequestLimit !== undefined) {
    const decision = validateRequestLimitConfiguration({
      mode: values.dailyRequestLimitMode ?? previous.dailyRequestLimitMode,
      limit: values.dailyRequestLimit !== undefined ? values.dailyRequestLimit : previous.dailyRequestLimit,
      allowInherit: false,
    });
    if (!decision.ok) throw new AiError("INVALID_REQUEST", decision.error, 400, undefined, { field: `dailyRequestLimit${decision.field === "mode" ? "Mode" : ""}` });
    values.dailyRequestLimitMode = decision.mode as "UNLIMITED" | "LIMITED";
    values.dailyRequestLimit = decision.limit;
  }
  // The two monetary ceilings are separate controls with separate modes. Zero
  // stays expressible under Limited; it is only ever ambiguous without a mode.
  for (const control of [
    { control: "PER_REQUEST" as const, modeKey: "perRequestCostLimitMode" as const, limitKey: "maximumEstimatedRequestCost" as const },
    { control: "CUMULATIVE_REQUEST" as const, modeKey: "cumulativeRequestCostLimitMode" as const, limitKey: "maximumCumulativeRequestCost" as const },
  ]) {
    if (values[control.modeKey] === undefined && values[control.limitKey] === undefined) continue;
    const decision = validateCostLimitConfiguration({
      control: control.control,
      mode: values[control.modeKey] ?? previous[control.modeKey],
      limit: values[control.limitKey] !== undefined ? values[control.limitKey] : previous[control.limitKey],
    });
    if (!decision.ok) throw new AiError("INVALID_REQUEST", decision.error, 400, undefined, { field: decision.field === "mode" ? control.modeKey : control.limitKey });
    values[control.modeKey] = decision.mode;
    values[control.limitKey] = decision.limit;
  }
  const data = { ...values, monthlyBudget: values.monthlyBudget as any, maximumBackgroundCostPerDay: values.maximumBackgroundCostPerDay as any, maximumRetryCost: values.maximumRetryCost as any, maximumCumulativeRequestCost: values.maximumCumulativeRequestCost as any, ...(budgetWarningThresholds ? { budgetWarningThresholds } : {}), ...(metadataAllowlist ? { metadataAllowlistJson: metadataAllowlist } : {}), settingVersion: { increment: 1 }, updatedBy: actorId } as any;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.aiGovernanceSetting.update({ where: { id: "global" }, data });
    await tx.aiGovernanceAudit.create({ data: { actorId, action: "GLOBAL_GOVERNANCE_UPDATED", entityType: "AiGovernanceSetting", entityId: "global", previousValueJson: previous as any, newValueJson: updated as any, reason } });
    return { ...publicGovernanceSettings(updated), ...(deprecated.length ? { warnings: deprecated.map((field) => `${field} is deprecated and was ignored.`) } : {}) };
  });
}

export async function setFullMetadataAcknowledgment(accepted: boolean, actorId: string) {
  if (accepted) {
    const warningHash = Buffer.from(FULL_METADATA_WARNING).toString("base64url").slice(0, 64);
    return prisma.$transaction(async (tx) => { await tx.aiPrivacyAcknowledgment.updateMany({ where: { policyVersion: FULL_METADATA_POLICY_VERSION, revokedAt: null }, data: { revokedAt: new Date() } }); const row = await tx.aiPrivacyAcknowledgment.create({ data: { policyVersion: FULL_METADATA_POLICY_VERSION, actorId, warningHash } }); await tx.aiGovernanceAudit.create({ data: { actorId, action: "FULL_METADATA_ACKNOWLEDGED", entityType: "AiPrivacyAcknowledgment", entityId: row.id, newValueJson: { policyVersion: FULL_METADATA_POLICY_VERSION } } }); return row; });
  }
  await prisma.$transaction(async (tx) => { await tx.aiPrivacyAcknowledgment.updateMany({ where: { policyVersion: FULL_METADATA_POLICY_VERSION, revokedAt: null }, data: { revokedAt: new Date() } }); await tx.aiGovernanceAudit.create({ data: { actorId, action: "FULL_METADATA_REVOKED", entityType: "AiPrivacyAcknowledgment", entityId: FULL_METADATA_POLICY_VERSION } }); });
  return { revoked: true };
}

const pricingSchema = z.object({ providerConfigId: z.string().uuid(), modelIdentifier: z.string().min(1).max(300), displayName: z.string().min(1).max(300), inputPricePerMillion: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), outputPricePerMillion: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), cachedInputPricePerMillion: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), reasoningPricePerMillion: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), fixedRequestCost: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(), currency: z.string().regex(/^[A-Z]{3}$/).default("USD"), effectiveAt: z.coerce.date().optional(), pricingSource: z.string().max(500).nullable().optional(), lastVerifiedAt: z.coerce.date().nullable().optional(), enabled: z.boolean().default(true), estimated: z.boolean().default(true), billingClassification: z.enum(["LOCAL", "EXTERNAL", "FREE"]).default("EXTERNAL"), status: z.enum(["PRICED", "FREE", "UNPRICED"]).default("PRICED") });
export async function listAiPricingProfiles() { const rows = await prisma.aiModelPricing.findMany({ include: { provider: { select: { displayName: true, locationClassification: true, deletedAt: true } } }, orderBy: [{ providerConfigId: "asc" }, { modelIdentifier: "asc" }, { effectiveAt: "desc" }] }); return rows.map((row) => ({ ...row, provider: { ...row.provider, displayName: `${row.provider.displayName}${row.provider.deletedAt ? " (Deleted)" : ""}` } })); }
export async function saveAiPricingProfile(raw: unknown, actorId: string, id?: string) { const input = pricingSchema.parse(raw); const previous = id ? await prisma.aiModelPricing.findUnique({ where: { id } }) : null; if (id && !previous) throw new AiError("MODEL_NOT_FOUND"); return prisma.$transaction(async (tx) => { if (previous) await tx.aiModelPricing.update({ where: { id: previous.id }, data: { enabled: false } }); const row = await tx.aiModelPricing.create({ data: { ...input, ...(previous ? { supersedesId: previous.id, effectiveAt: input.effectiveAt || new Date() } : {}) } as any }); await tx.aiGovernanceAudit.create({ data: { actorId, action: id ? "PRICING_VERSION_CREATED" : "PRICING_CREATED", entityType: "AiModelPricing", entityId: row.id, previousValueJson: previous as any, newValueJson: row as any } }); return row; }); }
export async function duplicateAiPricingProfile(id: string, actorId: string) { const source = await prisma.aiModelPricing.findUnique({ where: { id } }); if (!source) throw new AiError("MODEL_NOT_FOUND"); return saveAiPricingProfile({ ...source, id: undefined, displayName: `${source.displayName} copy`, effectiveAt: new Date(), lastVerifiedAt: null, enabled: false }, actorId); }
export async function importDiscoveredPricingProfiles(providerConfigId: string, actorId: string) { const [provider, models, existing] = await Promise.all([prisma.aiProviderConfig.findUnique({ where: { id: providerConfigId } }), prisma.aiProviderModel.findMany({ where: { providerConfigId }, orderBy: { displayName: "asc" } }), prisma.aiModelPricing.findMany({ where: { providerConfigId }, select: { modelIdentifier: true } })]); if (!provider) throw new AiError("PROVIDER_NOT_FOUND"); const known = new Set(existing.map((row) => row.modelIdentifier)); const missing = models.filter((model) => !known.has(model.modelIdentifier)); return prisma.$transaction(async (tx) => { const profiles = []; for (const model of missing) profiles.push(await tx.aiModelPricing.create({ data: { providerConfigId, modelIdentifier: model.modelIdentifier, displayName: model.displayName, currency: "USD", pricingSource: "Provider model discovery — pricing required", enabled: false, estimated: true, billingClassification: provider.locationClassification === "LOCAL" ? "LOCAL" : "EXTERNAL", status: "UNPRICED" } })); await tx.aiGovernanceAudit.create({ data: { actorId, action: "DISCOVERED_MODELS_IMPORTED_TO_PRICING", entityType: "AiProviderConfig", entityId: providerConfigId, newValueJson: { importedModelIdentifiers: profiles.map((row) => row.modelIdentifier) } } }); return { imported: profiles.length, profiles }; }); }

type PreviewContext = { request: AiRequest; provider: ResolvedAiProviderConfig; model: string; userId?: string; reserve?: boolean; requestId?: string; auditId?: string; enforceBudgets?: boolean; estimatedCostOverride?: number };

function logBudgetDecision(input: { request: AiRequest; requestId?: string; userId?: string; providerId?: string; model?: string; attemptNumber: number; retryNumber: number; estimatedInputTokens?: number; estimatedOutputTokens?: number; estimatedCost: number; currentUsage?: number; limit?: number | null; decision: "ALLOWED" | "BLOCKED"; reasonCode?: string | null; scope: string }) {
  console.info("[AI] Budget decision", {
    correlationId: input.request.correlationId || input.requestId,
    userId: input.userId,
    operation: input.request.featureKey,
    providerId: input.providerId,
    modelId: input.model,
    attemptNumber: input.attemptNumber,
    retryNumber: input.retryNumber,
    estimatedInputTokens: input.estimatedInputTokens,
    estimatedOutputTokens: input.estimatedOutputTokens,
    estimatedIncrementalCost: input.estimatedCost,
    currentUsage: input.currentUsage,
    applicableLimit: input.limit,
    scope: input.scope,
    decision: input.decision,
    reasonCode: input.reasonCode || null,
  });
}

export async function previewAiRequest(input: PreviewContext) {
  const [governance, providerRow, modelLimit, pricing, userLimit, feature, acknowledgment] = await Promise.all([
    prisma.aiGovernanceSetting.upsert({ where: { id: "global" }, create: defaultGovernanceData(), update: {} }),
    prisma.aiProviderConfig.findUnique({ where: { id: input.provider.id }, include: { governanceBudget: true } }),
    prisma.aiProviderModel.findUnique({ where: { providerConfigId_modelIdentifier: { providerConfigId: input.provider.id, modelIdentifier: input.model } }, select: { contextSize: true, modelCategory: true, structuredOutput: true, jsonMode: true, capabilityMetadata: true } }),
    prisma.aiModelPricing.findFirst({ where: { providerConfigId: input.provider.id, modelIdentifier: input.model, enabled: true }, orderBy: { effectiveAt: "desc" } }),
    input.userId ? prisma.aiUserLimit.findUnique({ where: { userId: input.userId } }) : null,
    prisma.aiFeatureSetting.findUnique({ where: { featureKey: input.request.featureKey } }),
    prisma.aiPrivacyAcknowledgment.findFirst({ where: { policyVersion: FULL_METADATA_POLICY_VERSION, revokedAt: null } })
  ]);
  if (!providerRow) throw new AiError("PROVIDER_NOT_FOUND");
  if (providerRow.deletedAt || !providerRow.enabled) throw new AiError("PROVIDER_DISABLED");
  const adminExempt = !!input.userId && governance.adminExemptionEnabled && await isUserAdmin(input.userId);
  const classification = classifyProviderAndModel({ ...input.provider, administratorConfirmedLocal: providerRow.administratorConfirmedLocal, trustedNetwork: providerRow.trustedNetwork, customConfigurationJson: providerRow.customConfigurationJson }, input.model, pricing);
  if (classification.classification === "UNKNOWN") throw new AiError("PROVIDER_CLASSIFICATION_UNKNOWN", undefined, 409, undefined, { classification_reason: classification.reason });
  const external = classification.locality === "EXTERNAL";
  const featureConfig = (feature?.safeConfigurationJson || {}) as Record<string, any>;
  const privacyMode = strictestPrivacyMode(governance.privacyMode as AiPrivacyMode, featureConfig.privacyMode, input.request.privacyMode);
  if (privacyMode === "LOCAL_ONLY" && external) throw new AiError("PRIVACY_MODE_INCOMPATIBLE");
  if (input.request.requestSource === "BACKGROUND") {
    if (!governance.backgroundAiEnabled || featureConfig.backgroundAiEnabled === false || (external && !governance.externalBackgroundAiEnabled) || (external && governance.requireExternalBackgroundApproval && !input.request.backgroundApproval) || userLimit?.backgroundRequestsAllowed === false) throw new AiError("BACKGROUND_REQUEST_NOT_PERMITTED");
    const now = new Date(); const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); const [active, count, cost] = await Promise.all([prisma.aiBudgetReservation.count({ where: { requestSource: "BACKGROUND", status: "ACTIVE", expiresAt: { gt: now } } }), prisma.aiRequestAudit.count({ where: { requestSource: "BACKGROUND", createdAt: { gte: today } } }), prisma.aiRequestAudit.aggregate({ where: { requestSource: "BACKGROUND", createdAt: { gte: today }, status: "COMPLETED" }, _sum: { actualCost: true, estimatedCost: true } })]);
    if (active >= governance.maximumBackgroundConcurrency || governance.maximumBackgroundRequestsPerDay && count >= governance.maximumBackgroundRequestsPerDay || governance.maximumBackgroundCostPerDay && Number(cost._sum.actualCost ?? cost._sum.estimatedCost ?? 0) >= Number(governance.maximumBackgroundCostPerDay)) throw new AiError("AI_BACKGROUND_REQUEST_BLOCKED");
    const hours = governance.backgroundAllowedHoursJson as { start?: number; end?: number } | null; if (hours?.start != null && hours?.end != null) { const hour = now.getUTCHours(); const allowed = hours.start <= hours.end ? hour >= hours.start && hour < hours.end : hour >= hours.start || hour < hours.end; if (!allowed) throw new AiError("AI_BACKGROUND_REQUEST_BLOCKED"); }
  }
  const metadata = applyMetadataPrivacyPolicy({ mode: privacyMode, providerLocation: external ? "REMOTE" : "LOCAL", records: input.request.metadataRecords || (input.request.metadata ? [input.request.metadata] : []), allowlist: governance.metadataAllowlistJson as string[], allowUnknownLocal: governance.allowUnknownLocalMetadata, fullMetadataAcknowledged: !!acknowledgment, granularity: governance.anonymousGranularity as any, yearBandSize: governance.anonymousYearBandSize, bpmBandSize: governance.anonymousBpmBandSize });
  let sections = input.request.contextSections || [{ id: "system", content: input.request.systemInstructions || "", priority: "REQUIRED" as const, kind: "SYSTEM" as const }, ...input.request.messages.map((message, index) => ({ id: `message-${index}`, content: message.content, priority: "NORMAL" as const, kind: "CONTEXT" as const }))];
  const administrativeInferenceTest = input.request.requestSource === "CONNECTION_TEST" && input.request.featureKey === "administrative_connection_test";
  const modelCapabilities = resolveModelCapabilities(input.provider.providerType, input.model, modelLimit || {});
  const nativeContextTokens = modelLimit?.contextSize ?? providerRow.maximumContextTokens;
  const textBeforeTrim = sections.map((section) => section.content).join("\n"); let trimmingReport: any = null;
  try { validatePromptLimits({ text: textBeforeTrim, messageCount: input.request.messages.length, metadataRecordCount: metadata.payload.length, nativeContextTokens, estimatedOutputTokens: input.request.estimatedOutputTokens, limits: { maximumPromptCharacters: governance.maximumPromptCharacters, maximumPromptBytes: governance.maximumPromptBytes, maximumContextMessages: governance.maximumContextMessages, maximumMetadataRecords: governance.maximumMetadataRecords } }); }
  catch (error) { if (!(error instanceof AiError) || !["AI_MODEL_CONTEXT_WINDOW_EXCEEDED", "AI_PROMPT_TOO_LARGE"].includes(error.category) || (input.request.contextTrimmingStrategy || governance.defaultContextTrimmingStrategy) === "REJECT") throw error; const trimmed = trimContext(sections, nativeContextTokens || Math.max(1, Math.floor(governance.maximumPromptCharacters / 4)), (input.request.contextTrimmingStrategy || governance.defaultContextTrimmingStrategy) as any); sections = trimmed.sections; trimmingReport = trimmed.report; }
  const finalText = sections.map((section) => section.content).join("\n");
  const limits = validatePromptLimits({ text: finalText, messageCount: sections.length, metadataRecordCount: metadata.payload.length, nativeContextTokens, estimatedOutputTokens: input.request.estimatedOutputTokens, limits: { maximumPromptCharacters: governance.maximumPromptCharacters, maximumPromptBytes: governance.maximumPromptBytes, maximumContextMessages: governance.maximumContextMessages, maximumMetadataRecords: governance.maximumMetadataRecords } });
  const localZeroCost = !external && !governance.countLocalCost;
  const usablePricing = pricing?.status === "UNPRICED" ? null : pricing;
  if (external && classification.pricingClassification === "UNPRICED" && !governance.allowUnpricedExternalModels && !administrativeInferenceTest) throw new AiError("MODEL_UNPRICED");
  // Admission prices exactly one provider attempt. Retry allowance is evaluated only
  // after a retryable provider failure, immediately before the next attempt.
  const cost = localZeroCost ? { minimumEstimatedCost: 0, expectedEstimatedCost: 0, maximumEstimatedCost: 0, confidence: "LOCAL_ZERO_COST", currency: governance.currency, pricingSource: "Local-provider policy", pricingAgeDays: null } : usablePricing ? estimateRequestCost({ inputTokens: limits.estimatedInputTokens, estimatedOutputTokens: limits.estimatedOutputTokens, expectedOutputTokens: limits.estimatedOutputTokens, retryAllowance: 0, pricing: { ...usablePricing, inputPricePerMillion: usablePricing.inputPricePerMillion?.toString(), outputPricePerMillion: usablePricing.outputPricePerMillion?.toString(), cachedInputPricePerMillion: usablePricing.cachedInputPricePerMillion?.toString(), reasoningPricePerMillion: usablePricing.reasoningPricePerMillion?.toString(), fixedRequestCost: usablePricing.fixedRequestCost?.toString() } }) : { minimumEstimatedCost: 0, expectedEstimatedCost: 0, maximumEstimatedCost: 0, confidence: "UNPRICED_ALLOWED", currency: governance.currency, pricingSource: "No pricing configured", pricingAgeDays: null };
  // Admission enforces the per-request ceiling only. The cumulative ceiling is a
  // separate control evaluated in prepareAiRetry, and an unset or Unlimited
  // ceiling must never be read as a limit of exactly zero.
  const perRequestCostLimit = resolveCostLimit({ control: "PER_REQUEST", mode: governance.perRequestCostLimitMode, limit: governance.maximumEstimatedRequestCost?.toString() });
  const requestCostDecision = evaluateCostLimit({ scope: "request", estimatedCost: cost.maximumEstimatedCost, limit: perRequestCostLimit.limit, reasonCode: "AI_REQUEST_COST_LIMIT_EXCEEDED" });
  if (!requestCostDecision.allowed) {
    logBudgetDecision({ request: input.request, requestId: input.requestId, userId: input.userId, providerId: providerRow.id, model: input.model, attemptNumber: 1, retryNumber: 0, estimatedInputTokens: limits.estimatedInputTokens, estimatedOutputTokens: limits.estimatedOutputTokens, estimatedCost: requestCostDecision.estimatedCost, currentUsage: 0, limit: requestCostDecision.limit, decision: "BLOCKED", reasonCode: requestCostDecision.reasonCode, scope: requestCostDecision.scope });
    throw new AiError("AI_REQUEST_COST_LIMIT_EXCEEDED", undefined, 409, undefined, costLimitAuditDetails({ control: "PER_REQUEST", resolution: perRequestCostLimit, estimatedCost: requestCostDecision.estimatedCost, currency: cost.currency }));
  }
  const effectiveUserLimit = adminExempt && userLimit ? { ...userLimit, dailyCostLimit: null, monthlyCostLimit: null, dailyRequestLimitMode: "UNLIMITED", dailyRequestLimit: null, monthlyRequestLimit: null, paidProvidersAllowed: true } : userLimit;
  let remaining;
  try {
    remaining = await remainingBudgets({ governance, provider: providerRow, userLimit: effectiveUserLimit, userId: input.userId, estimatedCost: input.estimatedCostOverride ?? cost.maximumEstimatedCost, enforce: input.enforceBudgets !== false, excludeReservationRequestId: input.requestId });
  } catch (error) {
    const normalized = error instanceof AiError ? error : new AiError("INTERNAL_AI_ERROR");
    logBudgetDecision({ request: input.request, requestId: input.requestId, userId: input.userId, providerId: providerRow.id, model: input.model, attemptNumber: 1, retryNumber: 0, estimatedInputTokens: limits.estimatedInputTokens, estimatedOutputTokens: limits.estimatedOutputTokens, estimatedCost: input.estimatedCostOverride ?? cost.maximumEstimatedCost, decision: "BLOCKED", reasonCode: normalized.category, scope: "budget" });
    throw error;
  }
  const allowedPrivacyModes = userLimit?.allowedPrivacyModesJson as string[] | null; if (allowedPrivacyModes?.length && !allowedPrivacyModes.includes(privacyMode)) throw new AiError("AI_PRIVACY_POLICY_BLOCKED");
  const allowedProviders = userLimit?.allowedProviderIdsJson as string[] | null; if (allowedProviders?.length && !allowedProviders.includes(providerRow.id)) throw new AiError("AI_NO_ELIGIBLE_PROVIDER");
  const paidPermission = resolvePaidProviderPermission({ globalAllowed: governance.paidProvidersAllowed, allowUserOverrides: governance.allowUserPaidProviderOverrides, userValue: effectiveUserLimit?.paidProvidersAllowed, adminExempt });
  if (classification.requiresPaidProviderPermission && !paidPermission.allowed) throw new AiError("PAID_PROVIDER_NOT_PERMITTED");
  const policyDecision = { allowed: true, denialCode: null, denialMessage: null, resolvedPolicySource: paidPermission.source, providerClassification: classification.classification, modelClassification: classification.classification, costPricingState: classification.pricingClassification, paidProviderAllowed: paidPermission.value, backgroundRequestAllowed: userLimit?.backgroundRequestsAllowed ?? governance.backgroundAiEnabled };
  logBudgetDecision({ request: input.request, requestId: input.requestId, userId: input.userId, providerId: providerRow.id, model: input.model, attemptNumber: 1, retryNumber: 0, estimatedInputTokens: limits.estimatedInputTokens, estimatedOutputTokens: limits.estimatedOutputTokens, estimatedCost: input.estimatedCostOverride ?? cost.maximumEstimatedCost, decision: "ALLOWED", scope: "request" });
  return { allowed: true, feature: input.request.featureKey, provider: { id: providerRow.id, displayName: providerRow.displayName, location: external ? "EXTERNAL" : "LOCAL", classification: classification.classification, classificationReason: classification.reason }, classification, policyDecision, model: input.model, modelCapabilities, privacyMode, sanitizedMetadata: metadata.payload, privacyReport: metadata.report, limits, responseLimits: { maximumResponseBytes: Math.min(governance.maximumResponseBytes, input.request.maxResponseBytes || governance.maximumResponseBytes), maximumStructuredItems: governance.maximumStructuredItems }, structuredOutputPolicy: { jsonLocalRepairAttempts: Math.min(1, Math.max(0, governance.jsonLocalRepairAttempts)), jsonProviderRepairAttempts: Math.min(1, Math.max(0, governance.jsonProviderRepairAttempts)) }, trimmingReport, contextPreview: { sectionsAfter: sections.map((section) => ({ id: section.id, priority: section.priority, kind: section.kind })), contentValuesExcluded: true }, cost, costDecision: requestCostDecision, remainingBudgets: remaining, budgetWarningTriggered: remaining.warningTriggered, budgetViolations: remaining.violations, pricingProfileId: pricing?.id || null, timeoutPolicy: { connectionTimeoutMs: governance.connectionTimeoutMs, firstTokenTimeoutMs: governance.firstTokenTimeoutMs, totalRequestTimeoutMs: governance.totalRequestTimeoutMs, streamingIdleTimeoutMs: governance.streamingIdleTimeoutMs, cancellationGraceMs: governance.cancellationGraceMs }, costLimitPolicy: { perRequest: { mode: perRequestCostLimit.effectiveMode, limit: perRequestCostLimit.limitNumber, currency: cost.currency, configurationIssue: perRequestCostLimit.configurationIssue } }, retryPolicy: { maximumRetryAttempts: governance.maximumRetryAttempts, maximumRetryCost: governance.maximumRetryCost == null ? null : Number(governance.maximumRetryCost), cumulativeRequestCostLimitMode: governance.cumulativeRequestCostLimitMode, maximumCumulativeRequestCost: resolveCostLimit({ control: "CUMULATIVE_REQUEST", mode: governance.cumulativeRequestCostLimitMode, limit: governance.maximumCumulativeRequestCost?.toString() }).limitNumber, retryAfterPossibleBilling: governance.retryAfterPossibleBilling }, secureDebugPolicy: { enabled: governance.secureDebugEnabled, retentionHours: governance.secureDebugRetentionHours }, allowPaidProviderFallback: governance.allowPaidProviderFallback, automaticCheaperModelFallback: governance.automaticCheaperModelFallback };
}

async function remainingBudgets(input: { governance: any; provider: any; userLimit: any; userId?: string; estimatedCost: number; enforce: boolean; excludeReservationRequestId?: string }) {
  const now = new Date(); const period = budgetPeriod(now, input.governance.budgetResetDay); const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const usageWhere = (extra: any, since: Date) => ({ ...extra, createdAt: { gte: since }, status: "COMPLETED" });
  const requestCountWhere = (extra: any, since: Date) => ({ ...extra, createdAt: { gte: since }, status: { in: ["COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"] } });
  const [globalUsage, providerMonth, providerDay, userMonth, userDay, globalReserved, providerReserved, userReserved, globalCountDay, globalCountMonth, providerCountDay, providerCountMonth, userCountDay, userCountMonth] = await Promise.all([
    prisma.aiRequestAudit.aggregate({ where: usageWhere({}, period.start), _sum: { actualCost: true, estimatedCost: true } }), prisma.aiRequestAudit.aggregate({ where: usageWhere({ providerConfigId: input.provider.id }, period.start), _sum: { actualCost: true, estimatedCost: true } }), prisma.aiRequestAudit.aggregate({ where: usageWhere({ providerConfigId: input.provider.id }, day), _sum: { actualCost: true, estimatedCost: true } }), input.userId ? prisma.aiRequestAudit.aggregate({ where: usageWhere({ userId: input.userId }, period.start), _sum: { actualCost: true, estimatedCost: true } }) : null, input.userId ? prisma.aiRequestAudit.aggregate({ where: usageWhere({ userId: input.userId }, day), _sum: { actualCost: true, estimatedCost: true } }) : null,
    prisma.aiBudgetReservation.aggregate({ where: { status: "ACTIVE", expiresAt: { gt: now }, ...(input.excludeReservationRequestId ? { requestId: { not: input.excludeReservationRequestId } } : {}) }, _sum: { reservedCost: true } }), prisma.aiBudgetReservation.aggregate({ where: { providerConfigId: input.provider.id, status: "ACTIVE", expiresAt: { gt: now }, ...(input.excludeReservationRequestId ? { requestId: { not: input.excludeReservationRequestId } } : {}) }, _sum: { reservedCost: true } }), input.userId ? prisma.aiBudgetReservation.aggregate({ where: { userId: input.userId, status: "ACTIVE", expiresAt: { gt: now }, ...(input.excludeReservationRequestId ? { requestId: { not: input.excludeReservationRequestId } } : {}) }, _sum: { reservedCost: true } }) : null,
    prisma.aiRequestAudit.count({ where: requestCountWhere({}, day) }), prisma.aiRequestAudit.count({ where: requestCountWhere({}, period.start) }), prisma.aiRequestAudit.count({ where: requestCountWhere({ providerConfigId: input.provider.id }, day) }), prisma.aiRequestAudit.count({ where: requestCountWhere({ providerConfigId: input.provider.id }, period.start) }), input.userId ? prisma.aiRequestAudit.count({ where: requestCountWhere({ userId: input.userId }, day) }) : 0, input.userId ? prisma.aiRequestAudit.count({ where: requestCountWhere({ userId: input.userId }, period.start) }) : 0
  ]);
  const cost = (aggregate: any) => Number(aggregate?._sum?.actualCost ?? aggregate?._sum?.estimatedCost ?? 0); const reserved = (aggregate: any) => Number(aggregate?._sum?.reservedCost ?? 0); const providerBudget = input.provider.governanceBudget; const providerMonthlyLimit = providerBudget?.monthlyLimit ?? input.provider.monthlyBudget;
  const violations: string[] = [];
  // Request-count limits are throttles rather than spending controls: an absent or
  // non-positive limit means "no limit at this scope", never "zero requests".
  const dailyRequests = evaluateRequestLimit({ period: "DAILY", now, scopes: [
    { scope: "GLOBAL", mode: input.governance.dailyRequestLimitMode, limit: input.governance.dailyRequestLimit, usage: globalCountDay },
    { scope: "PROVIDER", scopeId: input.provider.id, scopeLabel: input.provider.displayName, configured: !!providerBudget, mode: providerBudget?.dailyRequestLimitMode, limit: providerBudget?.dailyRequestLimit, usage: providerCountDay },
    { scope: "USER", scopeId: input.userId, configured: !!input.userLimit, mode: input.userLimit?.dailyRequestLimitMode, limit: input.userLimit?.dailyRequestLimit, usage: userCountDay },
  ] });
  const monthlyRequests = evaluateRequestLimit({ period: "MONTHLY", resetAt: period.end, scopes: [
    { scope: "GLOBAL", mode: input.governance.monthlyRequestLimit == null ? "UNLIMITED" : "LIMITED", limit: input.governance.monthlyRequestLimit, usage: globalCountMonth },
    { scope: "PROVIDER", scopeId: input.provider.id, scopeLabel: input.provider.displayName, configured: !!providerBudget, mode: providerBudget?.monthlyRequestLimit == null ? "UNLIMITED" : "LIMITED", limit: providerBudget?.monthlyRequestLimit, usage: providerCountMonth },
    { scope: "USER", scopeId: input.userId, configured: !!input.userLimit, mode: input.userLimit?.monthlyRequestLimit == null ? "UNLIMITED" : "LIMITED", limit: input.userLimit?.monthlyRequestLimit, usage: userCountMonth },
  ] });
  if (!dailyRequests.allowed) violations.push("DAILY_REQUEST_LIMIT_REACHED");
  if (!monthlyRequests.allowed) violations.push("MONTHLY_REQUEST_LIMIT_REACHED");
  if (providerBudget?.dailyLimit && wouldExceedBudget(providerBudget.dailyLimit.toString(), cost(providerDay), reserved(providerReserved), input.estimatedCost) || providerMonthlyLimit != null && wouldExceedBudget(providerMonthlyLimit.toString(), cost(providerMonth), reserved(providerReserved), input.estimatedCost)) violations.push("AI_PROVIDER_BUDGET_EXCEEDED");
  if (input.userLimit?.dailyCostLimit != null && wouldExceedBudget(input.userLimit.dailyCostLimit.toString(), cost(userDay), reserved(userReserved), input.estimatedCost)) violations.push("DAILY_COST_LIMIT_REACHED");
  if (input.userLimit?.monthlyCostLimit != null && wouldExceedBudget(input.userLimit.monthlyCostLimit.toString(), cost(userMonth), reserved(userReserved), input.estimatedCost)) violations.push("MONTHLY_COST_LIMIT_REACHED");
  if (input.governance.monthlyBudget && input.governance.hardShutdownEnabled && wouldExceedBudget(input.governance.monthlyBudget.toString(), cost(globalUsage), reserved(globalReserved), input.estimatedCost)) violations.push("AI_GLOBAL_BUDGET_EXCEEDED");
  if (input.enforce && violations.length) {
    const code = violations[0] as any;
    const details =
      code === "AI_GLOBAL_BUDGET_EXCEEDED" ? { monthly_limit: Number(input.governance.monthlyBudget), current_usage: cost(globalUsage), reserved_cost: reserved(globalReserved), estimated_request_cost: input.estimatedCost, reset_at: period.end.toISOString() }
      : code === "DAILY_REQUEST_LIMIT_REACHED" ? requestLimitAuditDetails(dailyRequests)
      : code === "MONTHLY_REQUEST_LIMIT_REACHED" ? requestLimitAuditDetails(monthlyRequests)
      : undefined;
    throw new AiError(code, undefined, 409, undefined, details);
  }
  const remaining = (limit: any, used: number, held: number) => limit == null ? null : Math.max(0, Number(limit) - used - held);
  const crosses = (limit: any, used: number, held: number, thresholds: unknown) => limit != null && Array.isArray(thresholds) && thresholds.length > 0 && (used + held + input.estimatedCost) / Number(limit) >= Math.min(...thresholds.map(Number));
  const warningTriggered = crosses(input.governance.monthlyBudget, cost(globalUsage), reserved(globalReserved), input.governance.budgetWarningThresholds) || crosses(providerMonthlyLimit, cost(providerMonth), reserved(providerReserved), providerBudget?.warningThresholdsJson);
  return { user: remaining(input.userLimit?.monthlyCostLimit, cost(userMonth), reserved(userReserved)), provider: remaining(providerMonthlyLimit, cost(providerMonth), reserved(providerReserved)), global: remaining(input.governance.monthlyBudget, cost(globalUsage), reserved(globalReserved)), resetAt: period.end.toISOString(), warningTriggered, violations, dailyRequests, monthlyRequests };
}

export async function reserveAiBudget(input: PreviewContext & { requestId: string; auditId?: string }) {
  const preview = await previewAiRequest(input); const reservedCost = preview.cost.maximumEstimatedCost;
  try {
    return await prisma.$transaction(async (tx) => {
      // PostgreSQL returns `void` from pg_advisory_xact_lock. Cast it to text so
      // Prisma never attempts to deserialize its unsupported void wire type.
      await tx.$queryRaw<Array<{ lockResult: string }>>`SELECT pg_advisory_xact_lock(hashtext('mixarr-ai-budget-reservation'))::text AS "lockResult"`;
      await tx.aiBudgetReservation.updateMany({ where: { status: "ACTIVE", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED", releasedAt: new Date() } });
      // Re-run the serializable read/check immediately before creating the reservation.
      await previewAiRequest(input);
      const reservation = await tx.aiBudgetReservation.create({ data: { requestId: input.requestId, auditId: input.auditId, userId: input.userId, providerConfigId: input.provider.id, featureKey: input.request.featureKey, requestSource: input.request.requestSource || "FOREGROUND", currency: preview.cost.currency, reservedCost, expiresAt: new Date(Date.now() + 10 * 60_000) } });
      if (input.auditId) await tx.aiRequestAudit.update({ where: { id: input.auditId }, data: { budgetControlResult: "RESERVED", limitControlResult: "ALLOWED", privacyMode: preview.privacyMode, includedMetadataFields: preview.privacyReport.included_fields, transformedMetadataFields: preview.privacyReport.transformed_fields, blockedMetadataFields: preview.privacyReport.blocked_fields, locationClassification: preview.provider.location, providerModelClassification: preview.classification.classification, pricingProfileId: preview.pricingProfileId, estimatedCost: preview.cost.expectedEstimatedCost } });
      if (preview.trimmingReport) await tx.aiContextTrimmingRecord.create({ data: { requestId: input.requestId, strategy: preview.trimmingReport.strategy, originalTokenEstimate: preview.trimmingReport.originalTokenEstimate, finalTokenEstimate: preview.trimmingReport.finalTokenEstimate, savedTokenEstimate: preview.trimmingReport.savedTokenEstimate, removedSectionsJson: preview.trimmingReport.removedSections } });
      await tx.aiSecureDebugPayload.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      if (preview.secureDebugPolicy.enabled) await tx.aiSecureDebugPayload.create({ data: { requestId: input.requestId, privacyMode: preview.privacyMode, sanitizedPayload: preview.sanitizedMetadata as any, privacyReportJson: preview.privacyReport as any, expiresAt: new Date(Date.now() + preview.secureDebugPolicy.retentionHours * 60 * 60_000) } });
      return { reservation, preview };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw unexpectedAiError(error, {
      correlationId: input.request.correlationId || input.requestId,
      featureName: input.request.featureKey,
      userId: input.userId,
      providerId: input.provider.id,
      providerType: input.provider.providerType,
      model: input.model,
      privacyMode: preview.privacyMode,
      paidProviderPermission: preview.policyDecision.paidProviderAllowed,
      backgroundRequestPermission: preview.policyDecision.backgroundRequestAllowed,
      governanceDecisionStage: "budget_and_policy_admission"
    });
  }
}

export async function prepareAiRetry(input: PreviewContext & {
  requestId: string;
  reservationId?: string;
  retryNumber: number;
  possiblePriorBilling: boolean;
  initialAttemptCost: number;
}) {
  const retryNumber = Math.max(1, Math.floor(input.retryNumber));
  const governance = await prisma.aiGovernanceSetting.upsert({ where: { id: "global" }, create: defaultGovernanceData(), update: {} });
  const cumulativeCostLimit = resolveCostLimit({ control: "CUMULATIVE_REQUEST", mode: governance.cumulativeRequestCostLimitMode, limit: governance.maximumCumulativeRequestCost?.toString() });
  const incrementalPreview = await previewAiRequest({ ...input, requestId: input.requestId, enforceBudgets: false });
  const incrementalCost = incrementalPreview.cost.maximumEstimatedCost;
  const decision = evaluateRetryCost({
    incrementalCost,
    retryNumber,
    retryLimit: governance.maximumRetryCost?.toString(),
    initialAttemptCost: input.initialAttemptCost,
    cumulativeRequestLimit: cumulativeCostLimit.limit,
  });
  logBudgetDecision({
    request: input.request,
    requestId: input.requestId,
    userId: input.userId,
    providerId: input.provider.id,
    model: input.model,
    attemptNumber: retryNumber + 1,
    retryNumber,
    estimatedCost: decision.estimatedCost,
    currentUsage: decision.currentUsage,
    limit: decision.limit,
    decision: decision.allowed ? "ALLOWED" : "BLOCKED",
    reasonCode: decision.reasonCode,
    scope: "retry",
  });
  if (!decision.allowed) throw new AiError("AI_RETRY_COST_LIMIT_EXCEEDED", undefined, 409, undefined, {
    retry_number: retryNumber,
    estimated_incremental_cost: decision.estimatedCost,
    cumulative_retry_cost: decision.currentUsage + decision.estimatedCost,
    retry_limit: governance.maximumRetryCost == null ? null : Number(governance.maximumRetryCost),
    cumulative_request_limit: cumulativeCostLimit.limitNumber,
  });

  // A connection failure known to occur before dispatch can reuse the first
  // attempt's reservation. Ambiguous failures are retried only when the
  // administrator opted in, and reserve the cumulative possible charge.
  const possibleRequestCost = input.possiblePriorBilling ? input.initialAttemptCost + incrementalCost * retryNumber : incrementalCost;
  const preview = await previewAiRequest({ ...input, requestId: input.requestId, estimatedCostOverride: possibleRequestCost });
  if (input.possiblePriorBilling && input.reservationId) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ lockResult: string }>>`SELECT pg_advisory_xact_lock(hashtext('mixarr-ai-budget-reservation'))::text AS "lockResult"`;
      await previewAiRequest({ ...input, requestId: input.requestId, estimatedCostOverride: possibleRequestCost });
      const updated = await tx.aiBudgetReservation.updateMany({ where: { id: input.reservationId, requestId: input.requestId, status: "ACTIVE" }, data: { reservedCost: possibleRequestCost } });
      if (updated.count !== 1) throw new AiError("INTERNAL_AI_ERROR");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  return { decision, preview, possibleRequestCost };
}

export async function reconcileAiBudgetReservation(reservationId: string | undefined, actualCost: number | undefined, status: "RECONCILED" | "RELEASED") {
  if (!reservationId) return null;
  const result = await prisma.aiBudgetReservation.updateMany({ where: { id: reservationId, status: status === "RELEASED" ? "ACTIVE" : { in: ["ACTIVE", "RELEASED"] } }, data: { status, actualCost: actualCost ?? null, releasedAt: new Date(), resolutionReason: status === "RELEASED" ? "request_released" : "request_completed" } }).catch(() => null);
  if (status === "RECONCILED" && result?.count) await evaluateAiAlerts().catch(() => null);
  return result;
}

export async function releaseAiBudgetReservationsForProvider(tx: Prisma.TransactionClient, providerId: string, excludedAuditIds: string[], releasedAt: Date) {
  const auditFilter = excludedAuditIds.length ? { OR: [{ auditId: null }, { auditId: { notIn: excludedAuditIds } }] } : {};
  return tx.aiBudgetReservation.updateMany({ where: { providerConfigId: providerId, status: "ACTIVE", ...auditFilter }, data: { status: "RELEASED", releasedAt, resolutionReason: "provider_deleted" } });
}

export async function recordBlockedAiRequest(input: { requestId: string; featureKey: string; userId?: string; requestSource?: string; error: AiError; provider?: ResolvedAiProviderConfig; model?: string; classification?: AiClassificationResult }) {
  const row = await prisma.aiRequestAudit.create({ data: { requestId: input.requestId, correlationId: input.requestId, logicalRequestId: input.requestId, featureKey: input.featureKey, userId: input.userId, providerConfigId: input.provider?.id, providerType: input.provider?.providerType, providerDisplayName: input.provider?.displayName, model: input.model, requestSource: input.requestSource || "FOREGROUND", background: input.requestSource === "BACKGROUND", locationClassification: input.classification?.locality || input.provider?.locationClassification, providerModelClassification: input.classification?.classification, status: "BLOCKED", completedAt: new Date(), testStage: "GOVERNANCE", governanceResult: "BLOCKED", costState: "NOT_SENT", errorCategory: input.error.category, sanitizedErrorCode: input.error.category, blockReason: input.error.category, budgetControlResult: input.error.category.includes("BUDGET") || input.error.category.includes("COST_LIMIT") ? "BLOCKED" : null, limitControlResult: input.error.category.includes("TOKEN") || input.error.category.includes("PROMPT") || input.error.category.includes("REQUEST_LIMIT") ? "BLOCKED" : null } });
  if (["AI_GLOBAL_BUDGET_EXCEEDED", "AI_EXTERNAL_PROVIDER_BLOCKED", "AI_PAID_FALLBACK_BLOCKED"].includes(input.error.category)) await createDeduplicatedAlert({ condition: input.error.category, severity: input.error.category.includes("BUDGET") ? "CRITICAL" : "WARNING", scopeType: "GLOBAL", scopeId: null, threshold: 1, periodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())), details: { requestId: input.requestId, featureKey: input.featureKey } }).catch(() => null);
  return row;
}

async function createDeduplicatedAlert(input: { condition: string; severity: string; scopeType: string; scopeId?: string | null; threshold: number; periodStart: Date; details?: Record<string, unknown>; cooldownMinutes?: number }) {
  const key = alertDeduplicationKey(input.condition, input.scopeType, input.scopeId, input.threshold, input.periodStart); const cutoff = new Date(Date.now() - (input.cooldownMinutes || 1440) * 60_000); const existing = await prisma.aiAlertEvent.findFirst({ where: { deduplicationKey: key, createdAt: { gte: cutoff } } }); if (existing) return existing; return prisma.aiAlertEvent.create({ data: { deduplicationKey: key, severity: input.severity, condition: input.condition, scopeType: input.scopeType, scopeId: input.scopeId, safeDetailsJson: input.details as any } });
}

export async function evaluateAiAlerts() {
  const governance = await prisma.aiGovernanceSetting.findUnique({ where: { id: "global" } }); if (!governance?.monthlyBudget) return [];
  const period = budgetPeriod(new Date(), governance.budgetResetDay); const [usage, reservations, policies] = await Promise.all([prisma.aiRequestAudit.aggregate({ where: { createdAt: { gte: period.start }, status: "COMPLETED" }, _sum: { actualCost: true, estimatedCost: true } }), prisma.aiBudgetReservation.aggregate({ where: { status: "ACTIVE", expiresAt: { gt: new Date() } }, _sum: { reservedCost: true } }), prisma.aiAlertThreshold.findMany({ where: { scopeType: "GLOBAL", condition: "BUDGET_PERCENT", enabled: true } })]); const spent = Number(usage._sum.actualCost ?? usage._sum.estimatedCost ?? 0) + Number(reservations._sum.reservedCost ?? 0); const ratio = spent / Number(governance.monthlyBudget); const created = [];
  for (const policy of policies) for (const threshold of policy.thresholdsJson as number[]) if (ratio >= threshold) created.push(await createDeduplicatedAlert({ condition: threshold >= 1 ? "HARD_SHUTDOWN" : "BUDGET_PERCENT", severity: threshold >= 1 ? "CRITICAL" : threshold >= .9 ? "HIGH" : "WARNING", scopeType: "GLOBAL", threshold, periodStart: period.start, cooldownMinutes: policy.cooldownMinutes, details: { threshold, ratio, usedAndReserved: spent, monthlyLimit: Number(governance.monthlyBudget), resetAt: period.end.toISOString() } }));
  return created;
}

export async function listProviderComparison(inputTokens = 1000, outputTokens = 500, privacyMode: AiPrivacyMode = "METADATA_LIMITED") {
  const providers = await prisma.aiProviderConfig.findMany({ where: { enabled: true, deletedAt: null }, include: { models: { where: { availabilityStatus: "AVAILABLE" } }, pricingProfiles: { where: { enabled: true }, orderBy: { effectiveAt: "desc" } }, health: true, governanceBudget: true }, orderBy: [{ priority: "asc" }, { displayName: "asc" }] });
  return providers.flatMap((provider) => provider.models.map((model) => { const pricing = provider.pricingProfiles.find((row) => row.modelIdentifier === model.modelIdentifier); const eligible = privacyMode !== "LOCAL_ONLY" || provider.locationClassification === "LOCAL" && provider.administratorConfirmedLocal; const cost = pricing ? estimateRequestCost({ inputTokens, estimatedOutputTokens: outputTokens, pricing: { ...pricing, inputPricePerMillion: pricing.inputPricePerMillion?.toString(), outputPricePerMillion: pricing.outputPricePerMillion?.toString(), cachedInputPricePerMillion: pricing.cachedInputPricePerMillion?.toString(), reasoningPricePerMillion: pricing.reasoningPricePerMillion?.toString(), fixedRequestCost: pricing.fixedRequestCost?.toString() } }) : null; return { providerId: provider.id, provider: provider.displayName, model: model.modelIdentifier, local: provider.locationClassification === "LOCAL" && provider.administratorConfirmedLocal, contextWindow: model.contextSize, capabilities: model.capabilityMetadata, healthStatus: provider.health?.healthState || "NOT_TESTED", privacyEligible: eligible, budgetStatus: provider.governanceBudget ? "CONFIGURED" : provider.monthlyBudget != null ? "LEGACY_LIMIT" : "NO_LIMIT", cost, expectedFallbackOrder: provider.priority, qualityNotAssessed: true }; }));
}

export async function beginAdministrativeAiOperation(input: { provider: ResolvedAiProviderConfig; source: "CONNECTION_TEST" | "MODEL_DISCOVERY"; model?: string; userId?: string; signal?: AbortSignal; background?: boolean }) {
  const requestId = crypto.randomUUID();
  const featureKey = input.source === "CONNECTION_TEST" ? "administrative_connection_test" : "administrative_model_discovery";
  const specialModel = input.source === "MODEL_DISCOVERY" ? "__model_discovery__" : input.model || input.provider.defaultModel || "__connection_test__";
  const [global, governance, providerRow, pricing] = await Promise.all([
    prisma.aiGlobalSetting.findUnique({ where: { id: "global" } }),
    prisma.aiGovernanceSetting.upsert({ where: { id: "global" }, create: defaultGovernanceData(), update: {} }),
    prisma.aiProviderConfig.findUnique({ where: { id: input.provider.id } }),
    prisma.aiModelPricing.findFirst({ where: { providerConfigId: input.provider.id, modelIdentifier: specialModel, enabled: true }, orderBy: { effectiveAt: "desc" } })
  ]);
  if (!providerRow) throw new AiError("PROVIDER_NOT_FOUND");
  if (/^(0|false|off|disabled)$/i.test(String(process.env.MIXARR_AI_ENABLED || "true")) || !global?.enabled) throw new AiError("AI_DISABLED");
  if (global.emergencyShutdown) throw new AiError("AI_EMERGENCY_SHUTDOWN");
  if (!providerRow.enabled) throw new AiError("PROVIDER_DISABLED");
  if (!providerRow.approved) throw new AiError("AI_PROVIDER_NOT_APPROVED");
  const classification = classifyProviderAndModel({ ...input.provider, administratorConfirmedLocal: providerRow.administratorConfirmedLocal, trustedNetwork: providerRow.trustedNetwork, customConfigurationJson: providerRow.customConfigurationJson }, specialModel, pricing);
  let auditId: string | undefined;
  try {
    if (classification.classification === "UNKNOWN") throw new AiError("PROVIDER_CLASSIFICATION_UNKNOWN", undefined, 409, undefined, { classification_reason: classification.reason, correlation_id: requestId });
    if (governance.privacyMode === "LOCAL_ONLY" && classification.locality !== "LOCAL") throw new AiError("PRIVACY_MODE_INCOMPATIBLE", undefined, 409, undefined, { correlation_id: requestId });
    if (input.background && (!governance.backgroundAiEnabled || classification.locality === "EXTERNAL" && !governance.externalBackgroundAiEnabled)) throw new AiError("BACKGROUND_REQUEST_NOT_PERMITTED", undefined, 409, undefined, { correlation_id: requestId });
  } catch (error) {
    const normalized = error instanceof AiError ? error : unexpectedAiError(error, { correlationId: requestId, featureName: featureKey, userId: input.userId, providerId: input.provider.id, providerType: input.provider.providerType, model: specialModel, privacyMode: governance.privacyMode, backgroundRequestPermission: governance.backgroundAiEnabled, governanceDecisionStage: "provider_classification" });
    await recordBlockedAiRequest({ requestId, featureKey, userId: input.userId, requestSource: input.source, error: normalized, provider: input.provider, model: specialModel, classification }).catch((auditError) => { unexpectedAiError(auditError, { correlationId: requestId, featureName: featureKey, userId: input.userId, providerId: input.provider.id, providerType: input.provider.providerType, model: specialModel, privacyMode: governance.privacyMode, governanceDecisionStage: "audit_persistence" }); });
    throw normalized;
  }
  try {
    const audit = await prisma.aiRequestAudit.create({ data: { requestId, correlationId: requestId, logicalRequestId: requestId, featureKey, userId: input.userId, providerConfigId: input.provider.id, providerType: input.provider.providerType, providerDisplayName: input.provider.displayName, model: specialModel, requestSource: input.source, background: !!input.background, locationClassification: classification.locality, providerModelClassification: classification.classification, privacyMode: governance.privacyMode, status: "RUNNING", testStage: input.source === "CONNECTION_TEST" ? "GOVERNANCE" : "DISCOVERY", governanceResult: "ALLOWED", modelCompatibilityResult: input.source === "CONNECTION_TEST" ? "ELIGIBLE" : "NOT_APPLICABLE", endpointMode: input.provider.providerType === "openai" ? "RESPONSES_API" : "PROVIDER_DEFAULT", costState: "NOT_YET_REPORTED", budgetControlResult: "EVALUATING", limitControlResult: "ALLOWED" } });
    auditId = audit.id;
  } catch (auditError) { throw unexpectedAiError(auditError, { correlationId: requestId, featureName: featureKey, userId: input.userId, providerId: input.provider.id, providerType: input.provider.providerType, model: specialModel, privacyMode: governance.privacyMode, governanceDecisionStage: "audit_persistence" }); }
  let reservationId: string | undefined; let resolvedPolicy: any = null;
  if (input.source === "CONNECTION_TEST" || pricing) {
    try {
      const governed = await reserveAiBudget({ request: { featureKey, systemInstructions: input.source === "CONNECTION_TEST" ? "You are performing an AI provider connectivity test. Return only valid JSON and no additional text." : undefined, messages: [{ role: "user", content: input.source === "CONNECTION_TEST" ? 'Return exactly this JSON object: {"ok":true}' : "Mixarr model discovery." }], estimatedOutputTokens: input.source === "CONNECTION_TEST" ? 32 : 1, thinkingMode: input.source === "CONNECTION_TEST" ? "disabled" : undefined, requestSource: input.source, signal: input.signal }, provider: input.provider, model: specialModel, userId: input.userId, requestId, auditId });
      reservationId = governed.reservation.id; resolvedPolicy = governed.preview.policyDecision;
      if (input.source === "CONNECTION_TEST") (resolvedPolicy as any).__providerTest = { maximumEstimatedCost: governed.preview.cost.maximumEstimatedCost };
      if (input.source === "CONNECTION_TEST" && auditId) await prisma.aiRequestAudit.update({ where: { id: auditId }, data: { thinkingModeRequested: "disabled" } });
    } catch (error) {
      const normalized = error instanceof AiError ? error : unexpectedAiError(error, { correlationId: requestId, featureName: featureKey, userId: input.userId, providerId: input.provider.id, providerType: input.provider.providerType, model: specialModel, privacyMode: governance.privacyMode, governanceDecisionStage: "budget_and_policy_admission" });
      normalized.details = { ...(normalized.details || {}), correlation_id: requestId, provider_classification: classification.classification, classification_reason: classification.reason };
      if (auditId) await prisma.aiRequestAudit.update({ where: { id: auditId }, data: { status: "BLOCKED", completedAt: new Date(), errorCategory: normalized.category, sanitizedErrorCode: normalized.category, blockReason: normalized.category, budgetControlResult: "BLOCKED" } }).catch((auditError) => { unexpectedAiError(auditError, { correlationId: requestId, featureName: featureKey, providerId: input.provider.id, providerType: input.provider.providerType, model: specialModel, governanceDecisionStage: "audit_persistence" }); });
      throw normalized;
    }
  }
  const providerTest = resolvedPolicy?.__providerTest; if (resolvedPolicy?.__providerTest) delete resolvedPolicy.__providerTest;
  return { requestId, auditId, reservationId, startedAt: Date.now(), classification, resolvedPolicy, providerTest };
}

export async function finishAdministrativeAiOperation(operation: { requestId: string; auditId?: string; reservationId?: string; startedAt: number; classification?: AiClassificationResult }, result: { success: boolean; error?: unknown; estimatedCost?: number; modelReturned?: string; endpointMode?: string; providerRequestId?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedTokens?: number; reasoningTokens?: number; providerReported?: boolean }; retryAttempted?: boolean; thinkingModeRequested?: string; hasReasoningContent?: boolean; reasoningCharacterCount?: number; finalContentCharacterCount?: number }) {
  const normalized = result.success ? null : result.error instanceof AiError ? result.error : new AiError("INTERNAL_AI_ERROR");
  const details = normalized?.details || {};
  const providerResponded = typeof details.http_status === "number";
  const costState = result.success ? result.estimatedCost != null ? "CALCULATED" : result.usage?.providerReported ? "USAGE_RECORDED_PRICING_NOT_CONFIGURED" : "PRICING_NOT_CONFIGURED" : providerResponded ? "NO_BILLABLE_USAGE_REPORTED" : "USAGE_UNAVAILABLE";
  if (operation.auditId) await prisma.aiRequestAudit.update({ where: { id: operation.auditId }, data: { status: result.success ? "COMPLETED" : normalized?.category === "REQUEST_CANCELLED" ? "CANCELLED" : ["REQUEST_TIMEOUT", "PROVIDER_TIMEOUT"].includes(normalized?.category || "") ? "TIMED_OUT" : "FAILED", completedAt: new Date(), latencyMs: Date.now() - operation.startedAt, estimatedCost: result.estimatedCost, inputTokenCount: result.usage?.inputTokens ?? details.usage_input_tokens as number | undefined, outputTokenCount: result.usage?.outputTokens ?? details.usage_output_tokens as number | undefined, totalTokenCount: result.usage?.totalTokens ?? details.usage_total_tokens as number | undefined, cachedTokenCount: result.usage?.cachedTokens, reasoningTokenCount: result.usage?.reasoningTokens ?? details.usage_reasoning_tokens as number | undefined, usageSource: result.usage?.providerReported || details.usage_provider_reported === true ? "PROVIDER_REPORTED" : "UNAVAILABLE", modelReturned: result.modelReturned, endpointMode: result.endpointMode || (details.endpoint_mode as string | undefined), testStage: result.success ? "COMPLETE" : (details.failure_stage as string | undefined) || (providerResponded ? "PROVIDER_RESPONSE" : "NETWORK"), httpStatus: details.http_status as number | undefined, providerErrorCode: (details.provider_error_code as string | undefined)?.slice(0, 120), providerRequestId: (result.providerRequestId || details.provider_request_id as string | undefined)?.slice(0, 300), costState, errorCategory: normalized?.category, sanitizedErrorCode: normalized?.category, providerModelClassification: operation.classification?.classification, budgetControlResult: operation.reservationId ? result.success ? "RECONCILED" : "RELEASED" : "NOT_BILLABLE", finishReason: details.finish_reason as string | undefined, finalContentStatus: result.success ? "COMPLETE" : ["AI_PROVIDER_TRUNCATED_RESPONSE", "AI_PROVIDER_TRUNCATED_BEFORE_FINAL", "AI_PROVIDER_TRUNCATED_FINAL_RESPONSE"].includes(normalized?.category || "") ? "INCOMPLETE" : undefined, truncationRecoveryAttempted: result.retryAttempted === true || details.retry_attempted === true, thinkingModeRequested: result.thinkingModeRequested || details.thinking_mode_requested as string | undefined, reasoningContentDetected: result.hasReasoningContent ?? details.has_reasoning_content as boolean | undefined, reasoningCharacterCount: result.reasoningCharacterCount ?? details.reasoning_character_count as number | undefined, finalContentCharacterCount: result.finalContentCharacterCount ?? details.final_content_character_count as number | undefined } }).catch((auditError) => { unexpectedAiError(auditError, { correlationId: operation.requestId, governanceDecisionStage: "audit_persistence" }); });
  await reconcileAiBudgetReservation(operation.reservationId, result.estimatedCost, result.success || providerResponded ? "RECONCILED" : "RELEASED");
}
