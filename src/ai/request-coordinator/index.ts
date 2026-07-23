import prisma from "@/lib/prisma";
import type { AiCapability, AiCapabilityConfidence, AiProviderAdapter, AiRequest, AiResponse, AiStreamEvent, ResolvedAiProviderConfig } from "../contracts";
import { AiError, normalizeProviderError, type AiErrorCategory } from "../errors";
import { aiFeatureByKey } from "../features/registry";
import { aiProviderRegistry } from "../registry/providerRegistry";
import { resolveAiProvider } from "../services/providerService";
import { oneWayPromptHash } from "../security";
import { safeMetadataSchema, parseStructuredResponseDetailed } from "../validation";
import { abortableDelay, isRetryEligible, retryDelayMs } from "../utilities/retry";
import { sanitizePromptText } from "../utilities/prompt";
import { completeAiAudit, createAiAudit, failAiAudit, setAiAuditStatus } from "../audit/service";
import { recordAiExecutionHealth } from "../health/service";
import { createAiRequestSignal, nextStreamEvent } from "../utilities/cancellation";
import { previewAiRequest, reconcileAiBudgetReservation, recordBlockedAiRequest, reserveAiBudget } from "../governance/service";
import { selectCheaperEligibleModel } from "../governance/policy";
import { unexpectedAiError } from "../governance/logging";
import { assertAiExecutionPolicy } from "../governance/executionPolicy";
import { requireAiFeaturePermission } from "../governance/permissions";
import { detectPromptInjection } from "../security/promptInjection";
import { redactAiContent } from "../security/redaction";
import { inspectAiResponse } from "../security/responseSecurity";
import { quarantineAiResponse, storeAiResponse } from "../quarantine/service";

const supportedCapability = new Set<AiCapabilityConfidence>(["CONFIRMED", "REPORTED", "ASSUMED", "MANUALLY_ENABLED"]);
const fallbackCategories = new Set<AiErrorCategory>(["PROVIDER_UNAVAILABLE", "CONNECTION_FAILED", "RATE_LIMITED", "REQUEST_TIMEOUT", "TLS_ERROR", "PROVIDER_OVERLOADED"]);

export function missingCapabilities(required: AiCapability[], resolved: Record<string, AiCapabilityConfidence | undefined>) {
  return required.filter((capability) => !supportedCapability.has(resolved[capability] || "UNKNOWN"));
}

async function prepareCandidate(config: ResolvedAiProviderConfig, model: string | undefined, required: AiCapability[], request: AiRequest, allowStreamingFallback?: boolean) {
  if (!config.enabled) throw new AiError("PROVIDER_DISABLED");
  if (!model) throw new AiError("MODEL_NOT_CONFIGURED");
  const policy = await assertAiExecutionPolicy({ request, provider: config, model, requiredCapabilities: required });
  const adapter = aiProviderRegistry.get(config.providerType);
  if (!adapter.available) throw new AiError("PROVIDER_UNSUPPORTED");
  const capabilities = { ...(await adapter.detectCapabilities(config, model)), ...config.capabilityOverrides };
  const missing = missingCapabilities(Array.from(new Set(required)), capabilities);
  if (missing.length && !(missing.length === 1 && missing[0] === "streaming" && allowStreamingFallback)) throw new AiError("CAPABILITY_UNAVAILABLE", `Provider lacks required capability: ${missing.join(", ")}.`);
  return { config, model, adapter, capabilities, streamFallback: missing.includes("streaming"), policy };
}

async function selection<T>(request: AiRequest<T>, userId?: string) {
  await requireAiFeaturePermission(userId, request.featureKey);
  const global = await prisma.aiGlobalSetting.findUnique({ where: { id: "global" } });
  if (!global?.enabled) throw new AiError("AI_DISABLED");
  const definition = aiFeatureByKey.get(request.featureKey);
  if (!definition?.implemented) throw new AiError("FEATURE_DISABLED");
  const feature = await prisma.aiFeatureSetting.findUnique({ where: { featureKey: request.featureKey } });
  if (!feature?.enabled) throw new AiError("FEATURE_DISABLED");
  const providerId = request.providerId || feature.preferredProviderId || global.defaultProviderId;
  if (!providerId) throw new AiError("PROVIDER_NOT_CONFIGURED");
  const config = await resolveAiProvider(providerId);
  const required = [...definition.requiredCapabilities, ...(request.requiredCapabilities || []), ...(request.stream ? ["streaming" as const] : []), ...(request.responseFormat ? ["structured_json" as const] : [])];
  const primary = await prepareCandidate(config, request.model || feature.preferredModel || config.defaultModel, required, request, request.allowStreamingFallback);
  let fallback: Awaited<ReturnType<typeof prepareCandidate>> | null = null;
  const featureFallbackId = feature.fallbackBehavior === "EXPLICIT_PROVIDER" ? feature.fallbackProviderId : null;
  const fallbackId = request.allowFallback ? (featureFallbackId || config.fallbackProviderId) : null;
  if (fallbackId && fallbackId !== config.id) {
    const fallbackConfig = await resolveAiProvider(fallbackId);
    const safeConfiguration = (feature.safeConfigurationJson || {}) as Record<string, unknown>;
    const remoteFallbackBlocked = config.locationClassification === "LOCAL" && fallbackConfig.locationClassification === "REMOTE" && safeConfiguration.allowRemoteFallback !== true;
    if (!remoteFallbackBlocked) fallback = await prepareCandidate(fallbackConfig, fallbackConfig.defaultModel, required, request, request.allowStreamingFallback);
  }
  return { global, feature, primary, fallback, required };
}

type PreparedCandidate = Awaited<ReturnType<typeof prepareCandidate>>;
type GovernedReservation = Awaited<ReturnType<typeof reserveAiBudget>>;

async function findCheaperCandidate(input: { request: AiRequest; primary: PreparedCandidate; required: AiCapability[]; userId?: string; preferredPreview: Awaited<ReturnType<typeof previewAiRequest>> }) {
  if (input.required.includes("reasoning_models")) return null;
  const models = await prisma.aiProviderModel.findMany({ where: { availabilityStatus: "AVAILABLE", provider: { enabled: true, deletedAt: null } }, select: { providerConfigId: true, modelIdentifier: true, contextSize: true, maximumCombinedTokens: true }, take: 200 });
  const evaluated: Array<{ prepared: PreparedCandidate; preview: Awaited<ReturnType<typeof previewAiRequest>>; policy: { providerId: string; model: string; estimatedCost: number; local: boolean; paid: boolean; capabilities: string[]; contextTokens: number } }> = [];
  for (const model of models) {
    if (model.providerConfigId === input.primary.config.id && model.modelIdentifier === input.primary.model) continue;
    try {
      const config = await resolveAiProvider(model.providerConfigId);
      const prepared = await prepareCandidate(config, model.modelIdentifier, input.required, input.request, input.request.allowStreamingFallback);
      if (input.request.stream && (!prepared.adapter.stream || prepared.streamFallback)) continue;
      const preview = await previewAiRequest({ request: input.request, provider: config, model: model.modelIdentifier, userId: input.userId });
      const capabilities = Object.entries(prepared.capabilities).filter(([, confidence]) => supportedCapability.has(confidence || "UNKNOWN")).map(([capability]) => capability);
      evaluated.push({ prepared, preview, policy: { providerId: config.id, model: model.modelIdentifier, estimatedCost: preview.cost.maximumEstimatedCost, local: preview.provider.location === "LOCAL", paid: preview.cost.maximumEstimatedCost > 0, capabilities, contextTokens: model.maximumCombinedTokens ?? model.contextSize ?? config.maximumContextTokens ?? 0 } });
    } catch { /* Ineligible, unhealthy, unpriced, private, or over-budget candidates are excluded. */ }
  }
  const preferredCapabilities = Object.entries(input.primary.capabilities).filter(([, confidence]) => supportedCapability.has(confidence || "UNKNOWN")).map(([capability]) => capability);
  const decision = selectCheaperEligibleModel({ preferred: { providerId: input.primary.config.id, model: input.primary.model, estimatedCost: input.preferredPreview.cost.maximumEstimatedCost, local: input.preferredPreview.provider.location === "LOCAL", paid: input.preferredPreview.cost.maximumEstimatedCost > 0, capabilities: preferredCapabilities, contextTokens: input.primary.config.maximumContextTokens ?? input.preferredPreview.limits.effectiveLimits.maximumCombinedTokens }, candidates: evaluated.map((item) => item.policy), requiredCapabilities: input.required, minimumContextTokens: input.preferredPreview.limits.estimatedInputTokens + input.preferredPreview.limits.maxOutputTokens, privacyMode: input.preferredPreview.privacyMode, allowPaidProviderFallback: input.preferredPreview.allowPaidProviderFallback });
  if (!decision) return null;
  const chosen = evaluated.find((item) => item.policy.providerId === decision.selected.providerId && item.policy.model === decision.selected.model);
  return chosen ? { ...chosen, decision } : null;
}

async function reserveWithOptionalCheaperFallback(input: { request: AiRequest; primary: PreparedCandidate; required: AiCapability[]; userId?: string; requestId: string; auditId?: string }) {
  let governed: GovernedReservation | undefined;
  let primaryError: AiError | undefined;
  try { governed = await reserveAiBudget({ request: input.request, provider: input.primary.config, model: input.primary.model, userId: input.userId, requestId: input.requestId, auditId: input.auditId }); }
  catch (error) {
    const normalized = error instanceof AiError ? error : unexpectedAiError(error, { correlationId: input.request.correlationId || input.requestId, featureName: input.request.featureKey, userId: input.userId, providerId: input.primary.config.id, providerType: input.primary.config.providerType, model: input.primary.model, governanceDecisionStage: "budget_and_policy_admission" });
    if (!["AI_PROVIDER_BUDGET_EXCEEDED", "AI_USER_BUDGET_EXCEEDED", "AI_GLOBAL_BUDGET_EXCEEDED"].includes(normalized.category)) throw normalized;
    primaryError = normalized;
  }
  const safeConfiguration = await prisma.aiFeatureSetting.findUnique({ where: { featureKey: input.request.featureKey }, select: { safeConfigurationJson: true } });
  const featurePolicy = (safeConfiguration?.safeConfigurationJson || {}) as Record<string, unknown>;
  const preview = governed?.preview || await previewAiRequest({ request: input.request, provider: input.primary.config, model: input.primary.model, userId: input.userId, enforceBudgets: false });
  const automatic = input.request.allowFallback === true && preview.automaticCheaperModelFallback && featurePolicy.automaticCheaperModelFallback !== false;
  const shouldFallback = automatic && (primaryError || preview.budgetWarningTriggered);
  if (!shouldFallback) { if (primaryError) throw primaryError; return { candidate: input.primary, governed: governed!, fallback: null }; }
  if (primaryError?.category === "AI_PROVIDER_BUDGET_EXCEEDED") { const policy = await prisma.aiProviderBudget.findUnique({ where: { providerConfigId: input.primary.config.id }, select: { allowFallbackWhenExhausted: true } }); if (!policy?.allowFallbackWhenExhausted) throw primaryError; }
  const cheaper = await findCheaperCandidate({ request: input.request, primary: input.primary, required: input.required, userId: input.userId, preferredPreview: preview });
  if (!cheaper) { if (primaryError) throw primaryError; return { candidate: input.primary, governed: governed!, fallback: null }; }
  let cheaperGoverned: GovernedReservation;
  try { cheaperGoverned = await reserveAiBudget({ request: input.request, provider: cheaper.prepared.config, model: cheaper.prepared.model, userId: input.userId, requestId: input.requestId, auditId: input.auditId }); }
  catch (error) { if (primaryError) throw error; return { candidate: input.primary, governed: governed!, fallback: null }; }
  if (governed) await reconcileAiBudgetReservation(governed.reservation.id, undefined, "RELEASED");
  if (input.auditId) await prisma.aiRequestAudit.update({ where: { id: input.auditId }, data: { originalProviderConfigId: input.primary.config.id, originalModel: input.primary.model, providerConfigId: cheaper.prepared.config.id, providerType: cheaper.prepared.config.providerType, providerDisplayName: cheaper.prepared.config.displayName, model: cheaper.prepared.model, locationClassification: cheaper.preview.provider.location, fallbackReason: primaryError?.category || "BUDGET_WARNING_CHEAPER_MODEL", estimatedFallbackSavings: cheaper.decision.estimatedSavings, crossedProviderBoundary: cheaper.decision.crossedProviderBoundary, crossedLocationBoundary: cheaper.decision.crossedLocalExternalBoundary } }).catch((error) => { unexpectedAiError(error, { correlationId: input.requestId, featureName: input.request.featureKey, providerId: cheaper.prepared.config.id, governanceDecisionStage: "audit_persistence" }); });
  return { candidate: cheaper.prepared, governed: cheaperGoverned, fallback: cheaper.decision };
}

async function enforceBudget(config: ResolvedAiProviderConfig) {
  const row = await prisma.aiProviderConfig.findUnique({ where: { id: config.id }, select: { monthlyBudget: true } });
  if (row?.monthlyBudget == null) return;
  const now = new Date(); const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const usage = await prisma.aiRequestAudit.aggregate({ where: { providerConfigId: config.id, createdAt: { gte: month }, status: "COMPLETED" }, _sum: { estimatedCost: true } });
  if ((usage._sum.estimatedCost || 0) >= row.monthlyBudget) throw new AiError("BUDGET_EXCEEDED");
}

function normalizedRequest<T>(request: AiRequest<T>) {
  const injection = detectPromptInjection({ systemInstructions: request.systemInstructions, messages: request.messages, metadataRecords: request.metadataRecords });
  if (injection.blocked) throw new AiError("AI_PROMPT_INJECTION_BLOCKED", undefined, 409, undefined, { severity: injection.severity, reasons: injection.reasons });
  const configuredSecrets = Object.entries(process.env).filter(([key, value]) => !!value && value!.length >= 4 && /SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL/i.test(key)).map(([, value]) => value!);
  const redacted = redactAiContent({ systemInstructions: request.systemInstructions, messages: request.messages, metadataRecords: request.metadataRecords }, { configuredSecrets, blockOnPrivateKey: true });
  if (redacted.result.blockedEntirely) throw new AiError("AI_PROMPT_INJECTION_BLOCKED", undefined, 409, undefined, { reasons: ["private_key_detected"] });
  const safe = redacted.value;
  return { request: { ...request, systemInstructions: safe.systemInstructions ? sanitizePromptText(safe.systemInstructions, 20_000) : undefined, messages: safe.messages.slice(0, 100).map((message) => ({ role: message.role, content: sanitizePromptText(message.content, 20_000) })), metadataRecords: safe.metadataRecords, metadata: safeMetadataSchema.parse(request.metadata || {}), temperature: request.temperature == null ? undefined : Math.max(0, Math.min(2, request.temperature)) }, injection, redaction: redacted.result };
}

async function executeWithRetries<T>(input: { request: AiRequest<T>; candidate: { config: ResolvedAiProviderConfig; model: string; adapter: AiProviderAdapter }; requestId: string; auditId?: string; signal: AbortSignal; maxBytes: number; started: number; startingRetries: number; timedOut: () => boolean; maximumRetryAttempts: number; retryAfterPossibleBilling: boolean; revalidate: () => Promise<unknown> }) {
  let retries = input.startingRetries;
  while (true) {
    const attemptStarted = Date.now();
    const attemptNumber = retries + 1;
    const attempt = input.auditId ? await prisma.aiProviderAttempt.create({ data: { requestAuditId: input.auditId, attemptNumber, providerConfigId: input.candidate.config.id, model: input.candidate.model, status: "STARTED" } }).catch((error) => { unexpectedAiError(error, { correlationId: input.requestId, featureName: input.request.featureKey, providerId: input.candidate.config.id, governanceDecisionStage: "audit_persistence" }); return null; }) : null;
    try {
      await enforceBudget(input.candidate.config); // Backward-compatible v2.4.0 provider limit.
      const response = await input.candidate.adapter.complete(input.request, input.candidate.config, { requestId: input.requestId, providerId: input.candidate.config.id, model: input.candidate.model, signal: input.signal, maxResponseBytes: input.maxBytes });
      response.retryCount = retries; response.latencyMs = Date.now() - input.started;
      if (attempt) await prisma.aiProviderAttempt.update({ where: { id: attempt.id }, data: { status: "COMPLETED", completedAt: new Date(), providerAcknowledged: true, estimatedCost: response.estimatedCost, actualCost: response.actualCost, inputTokens: response.usage?.inputTokens, outputTokens: response.usage?.outputTokens, cachedTokens: response.usage?.cachedTokens, reasoningTokens: response.usage?.reasoningTokens, safeUsageJson: response.usage?.rawUsage ? sanitizeUsagePayload(response.usage.rawUsage) as any : undefined } }).catch((error) => { unexpectedAiError(error, { correlationId: input.requestId, featureName: input.request.featureKey, providerId: input.candidate.config.id, governanceDecisionStage: "audit_persistence" }); });
      await recordAiExecutionHealth(input.candidate.config.id, true, Date.now() - attemptStarted);
      return response;
    } catch (error) {
      let normalized = normalizeProviderError(error);
      if (input.timedOut()) normalized = new AiError("REQUEST_TIMEOUT");
      else if (input.signal.aborted && ["CONNECTION_FAILED", "REQUEST_CANCELLED"].includes(normalized.category)) normalized = new AiError("REQUEST_CANCELLED");
      const mayHaveBeenBilled = !["CONNECTION_FAILED", "TLS_ERROR"].includes(normalized.category);
      if (attempt) await prisma.aiProviderAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", completedAt: new Date(), providerAcknowledged: mayHaveBeenBilled, errorCategory: normalized.category } }).catch((auditError) => logAuditFailure(auditError, { requestId: input.requestId, request: input.request, provider: input.candidate.config, model: input.candidate.model }));
      const retryLimit = Math.min(input.candidate.config.retryCount, input.maximumRetryAttempts);
      if (!isRetryEligible(normalized) || retries - input.startingRetries >= retryLimit || input.signal.aborted || (mayHaveBeenBilled && !input.retryAfterPossibleBilling)) {
        await recordAiExecutionHealth(input.candidate.config.id, false, Date.now() - attemptStarted, normalized);
        throw Object.assign(normalized, { retryCount: retries });
      }
      await input.revalidate(); // Re-evaluate privacy, request counts, retry cost and all budgets before every attempt.
      const delay = normalized.retryAfterMs ?? retryDelayMs(retries - input.startingRetries, input.candidate.config.initialRetryDelayMs, input.candidate.config.maximumRetryDelayMs, input.candidate.config.retryBackoffMultiplier);
      retries += 1; if (attempt) await prisma.aiProviderAttempt.update({ where: { id: attempt.id }, data: { retryReason: normalized.category } }).catch((auditError) => logAuditFailure(auditError, { requestId: input.requestId, request: input.request, provider: input.candidate.config, model: input.candidate.model })); if (input.auditId) await setAiAuditStatus(input.requestId, "RETRIED").catch((auditError) => logAuditFailure(auditError, { requestId: input.requestId, request: input.request, provider: input.candidate.config, model: input.candidate.model })); await abortableDelay(delay, input.signal);
    }
  }
}

function sanitizeUsagePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitizeUsagePayload);
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 500) : value;
  const safe: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value as Record<string, unknown>)) { if (/prompt|response|content|secret|credential|authorization|api[_-]?key|access[_-]?token|auth[_-]?token|bearer/i.test(key)) continue; safe[key.slice(0, 100)] = sanitizeUsagePayload(item); } return safe;
}

function logAuditFailure(error: unknown, input: { requestId: string; request: AiRequest; userId?: string; provider?: ResolvedAiProviderConfig; model?: string }) {
  unexpectedAiError(error, {
    correlationId: input.request.correlationId || input.requestId,
    featureName: input.request.featureKey,
    userId: input.userId,
    providerId: input.provider?.id,
    providerType: input.provider?.providerType,
    model: input.model,
    governanceDecisionStage: "audit_persistence"
  });
}

export class AiRequestCoordinator {
  async complete<T = unknown>(raw: AiRequest<T>, userId?: string): Promise<AiResponse<T>> {
    const requestId = crypto.randomUUID();
    let secured: ReturnType<typeof normalizedRequest<T>>;
    try { secured = normalizedRequest(raw); }
    catch (error) { const normalized = error instanceof AiError ? error : new AiError("INVALID_REQUEST"); await recordBlockedAiRequest({ requestId, featureKey: raw.featureKey, userId, requestSource: raw.requestSource, error: normalized }); await prisma.aiSecurityEvent.create({ data: { requestId, actorId: userId, eventType: "AI_REQUEST_SECURITY_BLOCKED", severity: "BLOCKED", reasonCodesJson: (normalized.details?.reasons as string[]) || [normalized.category], correlationId: raw.correlationId || requestId } }).catch(() => null); throw normalized; }
    const request = secured.request; let selected: Awaited<ReturnType<typeof selection>>;
    try { selected = await selection(request, userId); } catch (error) { const normalized = error instanceof AiError ? error : (error as any)?.status === 403 ? new AiError("PERMISSION_DENIED", undefined, 403) : unexpectedAiError(error, { correlationId: request.correlationId || requestId, featureName: request.featureKey, userId, governanceDecisionStage: "provider_selection" }); await recordBlockedAiRequest({ requestId, featureKey: request.featureKey, userId, requestSource: request.requestSource, error: normalized }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId })); throw normalized; }
    if (userId && request.idempotencyKey) { const duplicate = await prisma.aiRequestAudit.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: request.idempotencyKey } } }); if (duplicate) throw new AiError("AI_DUPLICATE_REQUEST", undefined, 409, undefined, { request_id: duplicate.requestId, status: duplicate.status }); }
    let maxBytes = Math.min(request.maxResponseBytes || selected.global.maximumServerResponseBytes, selected.global.maximumServerResponseBytes);
    const started = Date.now(); let retries = 0; let reservationId: string | undefined;
    let auditId: string | undefined;
    const contentFingerprint = oneWayPromptHash([request.systemInstructions || "", ...request.messages.map((message) => message.content)]);
    try { auditId = (await createAiAudit({ requestId, correlationId: request.correlationId || requestId, featureKey: request.featureKey, providerConfigId: selected.primary.config.id, providerType: selected.primary.config.providerType, providerDisplayName: selected.primary.config.displayName, model: selected.primary.model, streaming: false, userId, metadata: request.metadata, requestSource: request.requestSource, locationClassification: selected.primary.config.locationClassification, promptHash: contentFingerprint, contentFingerprint, idempotencyKey: request.idempotencyKey, promptTemplateVersion: request.promptTemplateVersion, redactionResult: secured.redaction, injectionResult: secured.injection, externalDataCategories: selected.primary.policy.externalDataCategories })).id; }
    catch (error) { throw unexpectedAiError(error, { correlationId: request.correlationId || requestId, featureName: request.featureKey, userId, providerId: selected.primary.config.id, providerType: selected.primary.config.providerType, model: selected.primary.model, governanceDecisionStage: "audit_persistence" }); }
    let governed: Awaited<ReturnType<typeof reserveAiBudget>>; let cheaperFallback: Awaited<ReturnType<typeof selectCheaperEligibleModel>> = null;
    try { const admission = await reserveWithOptionalCheaperFallback({ request, primary: selected.primary, required: selected.required, userId, requestId, auditId }); governed = admission.governed; selected.primary = admission.candidate; cheaperFallback = admission.fallback; reservationId = governed.reservation.id; }
    catch (error) { const normalized = error instanceof AiError ? error : unexpectedAiError(error, { correlationId: request.correlationId || requestId, featureName: request.featureKey, userId, providerId: selected.primary.config.id, providerType: selected.primary.config.providerType, model: selected.primary.model, governanceDecisionStage: "budget_and_policy_admission" }); if (auditId) await prisma.aiRequestAudit.update({ where: { id: auditId }, data: { status: "BLOCKED", completedAt: new Date(), errorCategory: normalized.category, sanitizedErrorCode: normalized.category, blockReason: normalized.category, budgetControlResult: normalized.category.includes("BUDGET") ? "BLOCKED" : null, limitControlResult: "BLOCKED" } }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model })); throw normalized; }
    request.metadataRecords = governed.preview.sanitizedMetadata; request.maxOutputTokens = governed.preview.limits.maxOutputTokens; maxBytes = Math.min(maxBytes, governed.preview.responseLimits.maximumResponseBytes);
    const maximumTimeout = Number(process.env.AI_MAX_REQUEST_TIMEOUT_MS || 120_000); const timeoutMs = Math.min(request.timeoutMs || selected.primary.config.requestTimeoutMs || selected.global.defaultTimeoutMs, governed.preview.timeoutPolicy.totalRequestTimeoutMs, maximumTimeout);
    const timed = createAiRequestSignal(request.signal, timeoutMs);
    try {
      let response: AiResponse<T>;
      try {
        response = await executeWithRetries({ request, candidate: selected.primary, requestId, auditId, signal: timed.signal, maxBytes, started, startingRetries: 0, timedOut: timed.timedOut, maximumRetryAttempts: governed.preview.retryPolicy.maximumRetryAttempts, retryAfterPossibleBilling: governed.preview.retryPolicy.retryAfterPossibleBilling, revalidate: () => previewAiRequest({ request, provider: selected.primary.config, model: selected.primary.model, userId }) });
      } catch (error) {
        const normalized = normalizeProviderError(error); retries = Number((error as any)?.retryCount || 0);
        if (!selected.fallback || !fallbackCategories.has(normalized.category) || timed.signal.aborted) throw error;
        const fallbackPreview = await previewAiRequest({ request, provider: selected.fallback.config, model: selected.fallback.model, userId });
        const primaryPaid = governed.preview.cost.maximumEstimatedCost > 0; const fallbackPaid = fallbackPreview.cost.maximumEstimatedCost > 0;
        if ((!governed.preview.allowPaidProviderFallback && !primaryPaid && fallbackPaid) || governed.preview.privacyMode === "LOCAL_ONLY" && fallbackPreview.provider.location !== "LOCAL") throw new AiError("AI_PAID_FALLBACK_BLOCKED");
        await reconcileAiBudgetReservation(reservationId, undefined, "RELEASED");
        const fallbackReservation = await reserveAiBudget({ request, provider: selected.fallback.config, model: selected.fallback.model, userId, requestId, auditId }); reservationId = fallbackReservation.reservation.id; governed = fallbackReservation;
        if (auditId) await prisma.aiRequestAudit.update({ where: { id: auditId }, data: { providerConfigId: selected.fallback.config.id, providerType: selected.fallback.config.providerType, providerDisplayName: selected.fallback.config.displayName, model: selected.fallback.model, status: "RETRIED" } }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.fallback!.config, model: selected.fallback!.model }));
        response = await executeWithRetries({ request, candidate: selected.fallback, requestId, auditId, signal: timed.signal, maxBytes, started, startingRetries: retries + 1, timedOut: timed.timedOut, maximumRetryAttempts: governed.preview.retryPolicy.maximumRetryAttempts, retryAfterPossibleBilling: governed.preview.retryPolicy.retryAfterPossibleBilling, revalidate: () => previewAiRequest({ request, provider: selected.fallback!.config, model: selected.fallback!.model, userId }) });
        response.warnings.push(`Explicit fallback used after ${selected.primary.config.displayName} was unavailable.`);
      }
      if (cheaperFallback) response.warnings.push(`A cheaper compatible model was selected, saving an estimated ${cheaperFallback.estimatedSavings.toFixed(6)} ${governed.preview.cost.currency}.`);
      retries = response.retryCount;
      const responseInspection = inspectAiResponse(response.content || "");
      const stored = await storeAiResponse({ requestId, providerConfigId: response.providerId, model: response.model, schemaVersion: request.responseFormat?.name || "text-1", body: response.content || "", status: "RECEIVED", validationSummary: responseInspection });
      if (!responseInspection.safe) { await quarantineAiResponse({ requestId, responseRecordId: stored.id, userId, featureKey: request.featureKey, providerConfigId: response.providerId, model: response.model, severity: responseInspection.severity, reasons: responseInspection.reasons, requestPreview: { feature: request.featureKey }, responsePreview: response.content }); throw new AiError("AI_RESPONSE_QUARANTINED"); }
      if (request.responseFormat) {
        try { const parsed = parseStructuredResponseDetailed(response.content || "", request.responseFormat, maxBytes, governed.preview.responseLimits.maximumStructuredItems); response.data = parsed.data; if (parsed.repaired) await prisma.aiResponseRecord.update({ where: { id: stored.id }, data: { repairAttempts: 1, repairMethod: parsed.repairMethod, status: "SCHEMA_VALIDATED" } }); }
        catch (error) { await quarantineAiResponse({ requestId, responseRecordId: stored.id, userId, featureKey: request.featureKey, providerConfigId: response.providerId, model: response.model, reasons: ["schema_validation_failed"], requestPreview: { feature: request.featureKey }, responsePreview: response.content, validationFailures: (error as AiError).details }); throw new AiError("AI_RESPONSE_QUARANTINED"); }
      }
      const bytes = Buffer.byteLength(response.content || "", "utf8"); if (bytes > maxBytes) throw new AiError("RESPONSE_TOO_LARGE");
      if (response.estimatedCost == null) response.estimatedCost = governed.preview.cost.expectedEstimatedCost;
      try { await completeAiAudit(requestId, response, bytes); } catch (error) { await quarantineAiResponse({ requestId, responseRecordId: stored.id, userId, featureKey: request.featureKey, providerConfigId: response.providerId, model: response.model, reasons: ["audit_persistence_failed"], requestPreview: { feature: request.featureKey }, responsePreview: response.content }).catch(() => null); throw new AiError("INTERNAL_AI_ERROR"); } await reconcileAiBudgetReservation(reservationId, response.actualCost ?? response.estimatedCost, "RECONCILED"); await prisma.aiProviderModel.updateMany({ where: { providerConfigId: response.providerId, modelIdentifier: response.model }, data: { lastSuccessfulUseAt: new Date() } }); return response;
    } catch (error) {
      let normalized = normalizeProviderError(error); if (timed.timedOut()) normalized = new AiError("REQUEST_TIMEOUT"); retries = Number((error as any)?.retryCount || retries);
      if (auditId && normalized.category !== "AI_RESPONSE_QUARANTINED") await failAiAudit(requestId, { category: normalized.category, retryCount: retries, latencyMs: Date.now() - started, cancelled: normalized.category === "REQUEST_CANCELLED", timedOut: normalized.category === "REQUEST_TIMEOUT" }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model }));
      await reconcileAiBudgetReservation(reservationId, undefined, "RELEASED");
      throw normalized;
    } finally { timed.close(); }
  }

  async *stream<T = unknown>(raw: AiRequest<T>, userId?: string): AsyncIterable<AiStreamEvent> {
    const requestId = crypto.randomUUID();
    let secured: ReturnType<typeof normalizedRequest<T>>;
    try { secured = normalizedRequest({ ...raw, stream: true }); }
    catch (error) { const normalized = error instanceof AiError ? error : new AiError("INVALID_REQUEST"); await recordBlockedAiRequest({ requestId, featureKey: raw.featureKey, userId, requestSource: raw.requestSource, error: normalized }); throw normalized; }
    const request = secured.request; let selected: Awaited<ReturnType<typeof selection>>;
    try { selected = await selection(request, userId); } catch (error) { const normalized = error instanceof AiError ? error : (error as any)?.status === 403 ? new AiError("PERMISSION_DENIED", undefined, 403) : unexpectedAiError(error, { correlationId: request.correlationId || requestId, featureName: request.featureKey, userId, governanceDecisionStage: "provider_selection" }); await recordBlockedAiRequest({ requestId, featureKey: request.featureKey, userId, requestSource: request.requestSource, error: normalized }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId })); throw normalized; }
    if (!selected.primary.adapter.stream || selected.primary.streamFallback) {
      if (!request.allowStreamingFallback) throw new AiError("CAPABILITY_UNAVAILABLE");
      const response = await this.complete({ ...request, stream: false }, userId); yield { type: "started", requestId: response.requestId };
      if (response.content) yield request.responseFormat ? { type: "structured_delta", delta: response.content } : { type: "text_delta", delta: response.content };
      yield { type: "completed", finishReason: response.finishReason }; return;
    }
    let maxBytes = Math.min(request.maxResponseBytes || selected.global.maximumServerResponseBytes, selected.global.maximumServerResponseBytes); const started = Date.now(); let bytes = 0; let usage: any; let reservationId: string | undefined;
    let auditId: string | undefined;
    const contentFingerprint = oneWayPromptHash([request.systemInstructions || "", ...request.messages.map((message) => message.content)]);
    try { auditId = (await createAiAudit({ requestId, correlationId: request.correlationId || requestId, featureKey: request.featureKey, providerConfigId: selected.primary.config.id, providerType: selected.primary.config.providerType, providerDisplayName: selected.primary.config.displayName, model: selected.primary.model, streaming: true, userId, metadata: request.metadata, requestSource: request.requestSource, locationClassification: selected.primary.config.locationClassification, promptHash: contentFingerprint, contentFingerprint, idempotencyKey: request.idempotencyKey, promptTemplateVersion: request.promptTemplateVersion, redactionResult: secured.redaction, injectionResult: secured.injection, externalDataCategories: selected.primary.policy.externalDataCategories })).id; }
    catch (error) { throw unexpectedAiError(error, { correlationId: request.correlationId || requestId, featureName: request.featureKey, userId, providerId: selected.primary.config.id, providerType: selected.primary.config.providerType, model: selected.primary.model, governanceDecisionStage: "audit_persistence" }); }
    let governed: Awaited<ReturnType<typeof reserveAiBudget>>; let cheaperFallback: Awaited<ReturnType<typeof selectCheaperEligibleModel>> = null; try { const admission = await reserveWithOptionalCheaperFallback({ request, primary: selected.primary, required: selected.required, userId, requestId, auditId }); governed = admission.governed; selected.primary = admission.candidate; cheaperFallback = admission.fallback; reservationId = governed.reservation.id; } catch (error) { const normalized = error instanceof AiError ? error : unexpectedAiError(error, { correlationId: request.correlationId || requestId, featureName: request.featureKey, userId, providerId: selected.primary.config.id, providerType: selected.primary.config.providerType, model: selected.primary.model, governanceDecisionStage: "budget_and_policy_admission" }); if (auditId) await prisma.aiRequestAudit.update({ where: { id: auditId }, data: { status: "BLOCKED", completedAt: new Date(), blockReason: normalized.category, errorCategory: normalized.category, sanitizedErrorCode: normalized.category } }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model })); yield { type: "failed", code: normalized.category, message: normalized.toSafePayload().message }; return; }
    request.metadataRecords = governed.preview.sanitizedMetadata; request.maxOutputTokens = governed.preview.limits.maxOutputTokens; maxBytes = Math.min(maxBytes, governed.preview.responseLimits.maximumResponseBytes);
    const duration = Math.min(governed.preview.timeoutPolicy.totalRequestTimeoutMs, Number(process.env.AI_MAX_STREAM_DURATION_MS || 300_000), Number(process.env.AI_MAX_REQUEST_TIMEOUT_MS || 300_000)); const timed = createAiRequestSignal(request.signal, duration);
    const attempt = auditId ? await prisma.aiProviderAttempt.create({ data: { requestAuditId: auditId, attemptNumber: 1, providerConfigId: selected.primary.config.id, model: selected.primary.model } }).catch((error) => { unexpectedAiError(error, { correlationId: request.correlationId || requestId, featureName: request.featureKey, providerId: selected.primary.config.id, governanceDecisionStage: "audit_persistence" }); return null; }) : null; if (auditId) await setAiAuditStatus(requestId, "STREAMING").catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model })); if (cheaperFallback) yield { type: "warning", message: `A cheaper compatible model was selected, saving an estimated ${cheaperFallback.estimatedSavings.toFixed(6)} ${governed.preview.cost.currency}.` };
    let streamedContent = "";
    try {
      const iterator = selected.primary.adapter.stream!(request, selected.primary.config, { requestId, providerId: selected.primary.config.id, model: selected.primary.model, signal: timed.signal, maxResponseBytes: maxBytes })[Symbol.asyncIterator]();
      const idleTimeoutMs = Math.min(governed.preview.timeoutPolicy.streamingIdleTimeoutMs, Number(process.env.AI_STREAM_IDLE_TIMEOUT_MS || 30_000), selected.primary.config.requestTimeoutMs);
      while (true) {
        const next = await nextStreamEvent(iterator, idleTimeoutMs, timed.abort); if (next.done) break; const event = next.value;
        if (event.type === "text_delta" || event.type === "structured_delta") { bytes += Buffer.byteLength(event.delta, "utf8"); if (bytes > maxBytes) throw new AiError("RESPONSE_TOO_LARGE"); streamedContent += event.delta; }
        if (event.type === "usage") usage = event.usage; yield event;
      }
      const response: AiResponse = { requestId, providerId: selected.primary.config.id, providerType: selected.primary.config.providerType, model: selected.primary.model, content: streamedContent, usage, latencyMs: Date.now() - started, retryCount: 0, streaming: true, warnings: [] };
      const inspection = inspectAiResponse(streamedContent); const stored = await storeAiResponse({ requestId, providerConfigId: response.providerId, model: response.model, schemaVersion: request.responseFormat?.name || "text-stream-1", body: streamedContent, validationSummary: inspection });
      if (!inspection.safe) { await quarantineAiResponse({ requestId, responseRecordId: stored.id, userId, featureKey: request.featureKey, providerConfigId: response.providerId, model: response.model, severity: inspection.severity, reasons: inspection.reasons, responsePreview: streamedContent }); throw new AiError("AI_RESPONSE_QUARANTINED"); }
      response.estimatedCost = governed.preview.cost.expectedEstimatedCost; if (attempt) await prisma.aiProviderAttempt.update({ where: { id: attempt.id }, data: { status: "COMPLETED", completedAt: new Date(), providerAcknowledged: true, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens } }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model })); await recordAiExecutionHealth(selected.primary.config.id, true, response.latencyMs); await completeAiAudit(requestId, response, bytes); await reconcileAiBudgetReservation(reservationId, response.actualCost ?? response.estimatedCost, "RECONCILED");
    } catch (error) {
      let normalized = normalizeProviderError(error);
      if (timed.timedOut()) normalized = new AiError("REQUEST_TIMEOUT");
      else if (timed.signal.aborted && ["CONNECTION_FAILED", "REQUEST_CANCELLED"].includes(normalized.category)) normalized = new AiError("REQUEST_CANCELLED");
      if (attempt) await prisma.aiProviderAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", completedAt: new Date(), providerAcknowledged: true, errorCategory: normalized.category } }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model })); await recordAiExecutionHealth(selected.primary.config.id, false, Date.now() - started, normalized); if (auditId && normalized.category !== "AI_RESPONSE_QUARANTINED") await failAiAudit(requestId, { category: normalized.category, retryCount: 0, latencyMs: Date.now() - started, cancelled: normalized.category === "REQUEST_CANCELLED", timedOut: normalized.category === "REQUEST_TIMEOUT" }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model })); await reconcileAiBudgetReservation(reservationId, undefined, "RELEASED");
      yield normalized.category === "REQUEST_CANCELLED" ? { type: "cancelled" } : { type: "failed", code: normalized.category, message: normalized.toSafePayload().message };
    } finally { timed.close(); }
  }
}

export const aiRequestCoordinator = new AiRequestCoordinator();
