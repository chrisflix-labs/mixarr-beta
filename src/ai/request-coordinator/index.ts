import prisma from "@/lib/prisma";
import type { AiCapability, AiCapabilityConfidence, AiProviderAdapter, AiRequest, AiResponse, AiStreamEvent, ResolvedAiProviderConfig } from "../contracts";
import { AiError, normalizeProviderError } from "../errors";
import { aiFeatureByKey } from "../features/registry";
import { aiProviderRegistry } from "../registry/providerRegistry";
import { resolveAiProvider } from "../services/providerService";
import { oneWayPromptHash } from "../security";
import { safeMetadataSchema, parseStructuredResponseDetailed, parseStructuredResponseWithProviderRepair } from "../validation";
import { abortableDelay, isRetryEligible, retryDelayMs } from "../utilities/retry";
import { sanitizePromptText } from "../utilities/prompt";
import { completeAiAudit, createAiAudit, failAiAudit, setAiAuditStatus } from "../audit/service";
import { recordAiExecutionHealth } from "../health/service";
import { createAiTimeoutRuntime } from "../utilities/cancellation";
import { prepareAiRetry, previewAiRequest, reconcileAiBudgetReservation, recordBlockedAiRequest, reserveAiBudget } from "../governance/service";
import { selectCheaperEligibleModel } from "../governance/policy";
import { unexpectedAiError } from "../governance/logging";
import { assertAiExecutionPolicy } from "../governance/executionPolicy";
import { requireAiFeaturePermission } from "../governance/permissions";
import { detectPromptInjection } from "../security/promptInjection";
import { redactAiContent } from "../security/redaction";
import { inspectAiResponse } from "../security/responseSecurity";
import { quarantineAiResponse, storeAiResponse } from "../quarantine/service";
import { resolveEffectiveTimeoutPolicy, type AiTimeoutPolicyOverride } from "../config/timeout";
import { executeEligibleFallback } from "../utilities/fallback";
import { SCORING_MODELS } from "@/lib/scoringModelCatalog";
import { safePlaylistSummaryLogDetails } from "../playlistSummaries/responseFormat";

const supportedCapability = new Set<AiCapabilityConfidence>(["CONFIRMED", "REPORTED", "ASSUMED", "MANUALLY_ENABLED"]);

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
    try {
      const fallbackConfig = await resolveAiProvider(fallbackId);
      const safeConfiguration = (feature.safeConfigurationJson || {}) as Record<string, unknown>;
      const remoteFallbackBlocked = config.locationClassification === "LOCAL" && fallbackConfig.locationClassification === "REMOTE" && safeConfiguration.allowRemoteFallback !== true;
      if (!remoteFallbackBlocked) fallback = await prepareCandidate(fallbackConfig, fallbackConfig.defaultModel, required, request, request.allowStreamingFallback);
    } catch (error) { console.info("[AI Fallback] configured fallback is not eligible", { feature: request.featureKey, reason: error instanceof AiError ? error.category : "INELIGIBLE" }); }
  }
  return { global, feature, primary, fallback, required };
}

type PreparedCandidate = Awaited<ReturnType<typeof prepareCandidate>>;
type GovernedReservation = Awaited<ReturnType<typeof reserveAiBudget>>;

async function findCheaperCandidate(input: { request: AiRequest; primary: PreparedCandidate; required: AiCapability[]; userId?: string; preferredPreview: Awaited<ReturnType<typeof previewAiRequest>> }) {
  if (input.required.includes("reasoning_models")) return null;
  const models = await prisma.aiProviderModel.findMany({ where: { availabilityStatus: "AVAILABLE", provider: { enabled: true, deletedAt: null } }, select: { providerConfigId: true, modelIdentifier: true, contextSize: true }, take: 200 });
  const evaluated: Array<{ prepared: PreparedCandidate; preview: Awaited<ReturnType<typeof previewAiRequest>>; policy: { providerId: string; model: string; estimatedCost: number; local: boolean; paid: boolean; capabilities: string[]; contextTokens: number } }> = [];
  for (const model of models) {
    if (model.providerConfigId === input.primary.config.id && model.modelIdentifier === input.primary.model) continue;
    try {
      const config = await resolveAiProvider(model.providerConfigId);
      const prepared = await prepareCandidate(config, model.modelIdentifier, input.required, input.request, input.request.allowStreamingFallback);
      if (input.request.stream && (!prepared.adapter.stream || prepared.streamFallback)) continue;
      const preview = await previewAiRequest({ request: input.request, provider: config, model: model.modelIdentifier, userId: input.userId });
      const capabilities = Object.entries(prepared.capabilities).filter(([, confidence]) => supportedCapability.has(confidence || "UNKNOWN")).map(([capability]) => capability);
      evaluated.push({ prepared, preview, policy: { providerId: config.id, model: model.modelIdentifier, estimatedCost: preview.cost.maximumEstimatedCost, local: preview.provider.location === "LOCAL", paid: preview.cost.maximumEstimatedCost > 0, capabilities, contextTokens: model.contextSize ?? config.maximumContextTokens ?? 0 } });
    } catch { /* Ineligible, unhealthy, unpriced, private, or over-budget candidates are excluded. */ }
  }
  const preferredCapabilities = Object.entries(input.primary.capabilities).filter(([, confidence]) => supportedCapability.has(confidence || "UNKNOWN")).map(([capability]) => capability);
  const decision = selectCheaperEligibleModel({ preferred: { providerId: input.primary.config.id, model: input.primary.model, estimatedCost: input.preferredPreview.cost.maximumEstimatedCost, local: input.preferredPreview.provider.location === "LOCAL", paid: input.preferredPreview.cost.maximumEstimatedCost > 0, capabilities: preferredCapabilities, contextTokens: input.primary.config.maximumContextTokens ?? input.preferredPreview.limits.nativeContextTokens ?? 0 }, candidates: evaluated.map((item) => item.policy), requiredCapabilities: input.required, minimumContextTokens: input.preferredPreview.limits.estimatedInputTokens, privacyMode: input.preferredPreview.privacyMode, allowPaidProviderFallback: input.preferredPreview.allowPaidProviderFallback });
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

function requestTimeoutOverride(request: AiRequest): AiTimeoutPolicyOverride | undefined {
  const override: AiTimeoutPolicyOverride = { ...(request.timeoutPolicy || {}) };
  if (Object.prototype.hasOwnProperty.call(request, "timeoutMs")) override.totalRequestTimeoutMs = request.timeoutMs!;
  return Object.keys(override).length ? override : undefined;
}

function effectiveTimeoutPolicy(request: AiRequest, provider: ResolvedAiProviderConfig, globalPolicy: AiTimeoutPolicyOverride) {
  return resolveEffectiveTimeoutPolicy({
    requestOverride: requestTimeoutOverride(request),
    providerOverrideEnabled: provider.timeoutOverrideEnabled,
    providerPolicy: provider.timeoutPolicy,
    globalPolicy,
  });
}

function timeoutLifecycleLogger(input: { requestId: string; provider: ResolvedAiProviderConfig; model: string; streaming: boolean; policy: ReturnType<typeof resolveEffectiveTimeoutPolicy> }) {
  return (event: Record<string, unknown>) => console.info("[AI Timeout]", {
    requestId: input.requestId,
    providerId: input.provider.id,
    providerType: input.provider.providerType,
    model: input.model,
    streaming: input.streaming,
    effectiveTimeoutPolicy: input.policy,
    ...event,
  });
}

async function executeWithRetries<T>(input: { request: AiRequest<T>; candidate: { config: ResolvedAiProviderConfig; model: string; adapter: AiProviderAdapter }; requestId: string; auditId?: string; timed: ReturnType<typeof createAiTimeoutRuntime>; maxBytes: number; started: number; startingRetries: number; maximumRetryAttempts: number; retryAfterPossibleBilling: boolean; estimatedAttemptCost: number; beforeRetry: (retryNumber: number, possiblePriorBilling: boolean) => Promise<unknown> }) {
  let retries = input.startingRetries;
  let possiblePriorBillingCost = 0;
  let priorUsage: AiResponse["usage"];
  while (true) {
    const attemptStarted = Date.now();
    const attemptNumber = retries + 1;
    const attempt = input.auditId ? await prisma.aiProviderAttempt.create({ data: { requestAuditId: input.auditId, attemptNumber, providerConfigId: input.candidate.config.id, model: input.candidate.model, status: "STARTED", estimatedCost: input.estimatedAttemptCost } }).catch((error) => { unexpectedAiError(error, { correlationId: input.requestId, featureName: input.request.featureKey, providerId: input.candidate.config.id, governanceDecisionStage: "audit_persistence" }); return null; }) : null;
    try {
      await enforceBudget(input.candidate.config); // Backward-compatible v2.4.0 provider limit.
      input.timed.beginAttempt();
      const response = await input.candidate.adapter.complete(input.request, input.candidate.config, { requestId: input.requestId, providerId: input.candidate.config.id, model: input.candidate.model, signal: input.timed.signal, maxResponseBytes: input.maxBytes, modelCapabilities: input.request.resolvedModelCapabilities, lifecycle: input.timed.lifecycle });
      if (String(response.finishReason || "").toLowerCase() === "length") {
        let completeStructuredResult = false;
        if (input.request.responseFormat && response.content) {
          try { parseStructuredResponseDetailed(response.content, input.request.responseFormat, input.maxBytes); completeStructuredResult = true; }
          catch { /* A length-limited response must remain a truncation, not malformed success. */ }
        }
        if (completeStructuredResult) response.warnings.push("The provider reported a length limit, but the complete response passed strict JSON parsing and schema validation.");
        else throw new AiError(input.request.featureKey === "recipe_copilot" ? "AI_FEATURE_TRUNCATED_STRUCTURED_OUTPUT" : response.content?.trim() ? "AI_PROVIDER_TRUNCATED_FINAL_RESPONSE" : response.hasReasoningContent ? "AI_PROVIDER_TRUNCATED_BEFORE_FINAL" : "AI_PROVIDER_TRUNCATED_RESPONSE", undefined, 422, undefined, { request_id: input.requestId, provider: input.candidate.config.displayName, model: input.candidate.model, stage: "STRUCTURED_RESPONSE", finish_reason: response.finishReason, thinking_mode_requested: response.thinkingModeRequested, has_reasoning_content: response.hasReasoningContent, reasoning_character_count: response.reasoningCharacterCount, final_content_character_count: response.finalContentCharacterCount, parent_category: "AI_PROVIDER_TRUNCATED_RESPONSE", usage_input_tokens: response.usage?.inputTokens, usage_output_tokens: response.usage?.outputTokens, usage_total_tokens: response.usage?.totalTokens, usage_reasoning_tokens: response.usage?.reasoningTokens, usage_final_answer_tokens: response.usage?.finalAnswerTokens, usage_provider_reported: response.usage?.providerReported === true, provider_request_id: response.transport?.providerRequestId || response.usage?.providerRequestId, actual_cost: response.actualCost, billing_possible: true, http_status: response.transport?.httpStatus, response_content_type: response.transport?.contentType, response_body_length: response.transport?.bodyLength });
      }
      response.retryCount = retries; response.latencyMs = Date.now() - input.started;
      if (priorUsage) {
        const sum = (left?: number, right?: number) => left == null && right == null ? undefined : Number(left || 0) + Number(right || 0);
        response.usage = { ...response.usage, inputTokens: sum(priorUsage.inputTokens, response.usage?.inputTokens), outputTokens: sum(priorUsage.outputTokens, response.usage?.outputTokens), finalAnswerTokens: sum(priorUsage.finalAnswerTokens, response.usage?.finalAnswerTokens), reasoningTokens: sum(priorUsage.reasoningTokens, response.usage?.reasoningTokens), totalTokens: sum(priorUsage.totalTokens, response.usage?.totalTokens), providerReported: priorUsage.providerReported === true && response.usage?.providerReported === true };
      }
      if (attempt) await prisma.aiProviderAttempt.update({ where: { id: attempt.id }, data: { status: "COMPLETED", completedAt: new Date(), providerAcknowledged: true, estimatedCost: response.estimatedCost, actualCost: response.actualCost, inputTokens: response.usage?.inputTokens, outputTokens: response.usage?.outputTokens, cachedTokens: response.usage?.cachedTokens, reasoningTokens: response.usage?.reasoningTokens, safeUsageJson: response.usage?.rawUsage ? sanitizeUsagePayload(response.usage.rawUsage) as any : undefined } }).catch((error) => { unexpectedAiError(error, { correlationId: input.requestId, featureName: input.request.featureKey, providerId: input.candidate.config.id, governanceDecisionStage: "audit_persistence" }); });
      await recordAiExecutionHealth(input.candidate.config.id, true, Date.now() - attemptStarted);
      if (possiblePriorBillingCost > 0) (response as any).possiblePriorBillingCost = possiblePriorBillingCost;
      return response;
    } catch (error) {
      let normalized = normalizeProviderError(error);
      if (input.timed.timedOut()) normalized = input.timed.error({ request_id: input.requestId, provider: input.candidate.config.displayName, provider_id: input.candidate.config.id, provider_type: input.candidate.config.providerType, model: input.candidate.model, streaming: false, stage: "PROVIDER_REQUEST", timeout_source: "effective_policy", retryable: true, usage_available: false });
      else if (input.timed.signal.aborted && ["CONNECTION_FAILED", "REQUEST_CANCELLED"].includes(normalized.category)) normalized = input.timed.error({ request_id: input.requestId, provider_id: input.candidate.config.id, provider_type: input.candidate.config.providerType, model: input.candidate.model, streaming: false });
      normalized.details = { estimated_cost: input.estimatedAttemptCost, ...normalized.details };
      const mayHaveBeenBilled = normalized.details?.billing_possible !== false && !["CONNECTION_FAILED", "TLS_ERROR"].includes(normalized.category);
      if (attempt) await prisma.aiProviderAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", completedAt: new Date(), providerAcknowledged: mayHaveBeenBilled, errorCategory: normalized.category, estimatedCost: typeof normalized.details?.estimated_cost === "number" ? normalized.details.estimated_cost : undefined, actualCost: typeof normalized.details?.actual_cost === "number" ? normalized.details.actual_cost : undefined, inputTokens: typeof normalized.details?.usage_input_tokens === "number" ? normalized.details.usage_input_tokens : undefined, outputTokens: typeof normalized.details?.usage_output_tokens === "number" ? normalized.details.usage_output_tokens : undefined, reasoningTokens: typeof normalized.details?.usage_reasoning_tokens === "number" ? normalized.details.usage_reasoning_tokens : undefined, safeUsageJson: normalized.details?.usage_provider_reported === true ? { prompt_tokens: normalized.details.usage_input_tokens, completion_tokens: normalized.details.usage_output_tokens, total_tokens: normalized.details.usage_total_tokens, completion_tokens_details: { reasoning_tokens: normalized.details.usage_reasoning_tokens, final_answer_tokens: normalized.details.usage_final_answer_tokens, accepted_prediction_tokens: normalized.details.usage_accepted_prediction_tokens, rejected_prediction_tokens: normalized.details.usage_rejected_prediction_tokens } } as any : undefined } }).catch((auditError) => logAuditFailure(auditError, { requestId: input.requestId, request: input.request, provider: input.candidate.config, model: input.candidate.model }));
      const retryLimit = Math.min(1, input.candidate.config.retryCount, input.maximumRetryAttempts);
      if (!isRetryEligible(normalized) || retries - input.startingRetries >= retryLimit || input.timed.signal.aborted || input.timed.producedContent() || (mayHaveBeenBilled && !input.retryAfterPossibleBilling)) {
        await recordAiExecutionHealth(input.candidate.config.id, false, Date.now() - attemptStarted, normalized);
        throw Object.assign(normalized, { retryCount: retries });
      }
      const nextRetryNumber = retries - input.startingRetries + 1;
      await input.beforeRetry(nextRetryNumber, mayHaveBeenBilled); // Retry-only cost and current policy are evaluated only after a transient failure.
      if (mayHaveBeenBilled) {
        possiblePriorBillingCost += typeof normalized.details?.actual_cost === "number" ? normalized.details.actual_cost : input.estimatedAttemptCost;
        const sum = (left?: number, right?: number) => left == null && right == null ? undefined : Number(left || 0) + Number(right || 0);
        priorUsage = { inputTokens: sum(priorUsage?.inputTokens, normalized.details?.usage_input_tokens as number | undefined), outputTokens: sum(priorUsage?.outputTokens, normalized.details?.usage_output_tokens as number | undefined), finalAnswerTokens: sum(priorUsage?.finalAnswerTokens, normalized.details?.usage_final_answer_tokens as number | undefined), reasoningTokens: sum(priorUsage?.reasoningTokens, normalized.details?.usage_reasoning_tokens as number | undefined), totalTokens: sum(priorUsage?.totalTokens, normalized.details?.usage_total_tokens as number | undefined), providerReported: priorUsage ? priorUsage.providerReported === true && normalized.details?.usage_provider_reported === true : normalized.details?.usage_provider_reported === true };
      }
      const delay = normalized.retryAfterMs ?? retryDelayMs(retries - input.startingRetries, input.candidate.config.initialRetryDelayMs, input.candidate.config.maximumRetryDelayMs, input.candidate.config.retryBackoffMultiplier);
      retries += 1; if (attempt) await prisma.aiProviderAttempt.update({ where: { id: attempt.id }, data: { retryReason: normalized.category } }).catch((auditError) => logAuditFailure(auditError, { requestId: input.requestId, request: input.request, provider: input.candidate.config, model: input.candidate.model })); if (input.auditId) await setAiAuditStatus(input.requestId, "RETRIED").catch((auditError) => logAuditFailure(auditError, { requestId: input.requestId, request: input.request, provider: input.candidate.config, model: input.candidate.model })); await abortableDelay(delay, input.timed.signal);
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
    const started = Date.now();
    const requestId = raw.correlationId || crypto.randomUUID();
    let secured: ReturnType<typeof normalizedRequest<T>>;
    try { secured = normalizedRequest(raw); }
    catch (error) { const normalized = error instanceof AiError ? error : new AiError("INVALID_REQUEST"); await recordBlockedAiRequest({ requestId, featureKey: raw.featureKey, userId, requestSource: raw.requestSource, error: normalized }); await prisma.aiSecurityEvent.create({ data: { requestId, actorId: userId, eventType: "AI_REQUEST_SECURITY_BLOCKED", severity: "BLOCKED", reasonCodesJson: (normalized.details?.reasons as string[]) || [normalized.category], correlationId: raw.correlationId || requestId } }).catch(() => null); throw normalized; }
    const request = secured.request; let selected: Awaited<ReturnType<typeof selection>>;
    try { selected = await selection(request, userId); } catch (error) { const normalized = error instanceof AiError ? error : (error as any)?.status === 403 ? new AiError("PERMISSION_DENIED", undefined, 403) : unexpectedAiError(error, { correlationId: request.correlationId || requestId, featureName: request.featureKey, userId, governanceDecisionStage: "provider_selection" }); await recordBlockedAiRequest({ requestId, featureKey: request.featureKey, userId, requestSource: request.requestSource, error: normalized }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId })); throw normalized; }
    if (userId && request.idempotencyKey) { const duplicate = await prisma.aiRequestAudit.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: request.idempotencyKey } } }); if (duplicate) throw new AiError("AI_DUPLICATE_REQUEST", undefined, 409, undefined, { request_id: duplicate.requestId, status: duplicate.status }); }
    let maxBytes = Math.min(request.maxResponseBytes || selected.global.maximumServerResponseBytes, selected.global.maximumServerResponseBytes);
    let retries = 0; let reservationId: string | undefined;
    let auditId: string | undefined;
    const contentFingerprint = oneWayPromptHash([request.systemInstructions || "", ...request.messages.map((message) => message.content)]);
    try { auditId = (await createAiAudit({ requestId, correlationId: request.correlationId || requestId, featureKey: request.featureKey, providerConfigId: selected.primary.config.id, providerType: selected.primary.config.providerType, providerDisplayName: selected.primary.config.displayName, model: selected.primary.model, streaming: false, userId, metadata: request.metadata, requestSource: request.requestSource, locationClassification: selected.primary.config.locationClassification, promptHash: contentFingerprint, contentFingerprint, idempotencyKey: request.idempotencyKey, promptTemplateVersion: request.promptTemplateVersion, redactionResult: secured.redaction, injectionResult: secured.injection, externalDataCategories: selected.primary.policy.externalDataCategories })).id; }
    catch (error) { throw unexpectedAiError(error, { correlationId: request.correlationId || requestId, featureName: request.featureKey, userId, providerId: selected.primary.config.id, providerType: selected.primary.config.providerType, model: selected.primary.model, governanceDecisionStage: "audit_persistence" }); }
    let governed: Awaited<ReturnType<typeof reserveAiBudget>>; let cheaperFallback: Awaited<ReturnType<typeof selectCheaperEligibleModel>> = null;
    try { const admission = await reserveWithOptionalCheaperFallback({ request, primary: selected.primary, required: selected.required, userId, requestId, auditId }); governed = admission.governed; selected.primary = admission.candidate; cheaperFallback = admission.fallback; reservationId = governed.reservation.id; }
    catch (error) { const normalized = error instanceof AiError ? error : unexpectedAiError(error, { correlationId: request.correlationId || requestId, featureName: request.featureKey, userId, providerId: selected.primary.config.id, providerType: selected.primary.config.providerType, model: selected.primary.model, governanceDecisionStage: "budget_and_policy_admission" }); if (auditId) await prisma.aiRequestAudit.update({ where: { id: auditId }, data: { status: "BLOCKED", completedAt: new Date(), errorCategory: normalized.category, sanitizedErrorCode: normalized.category, blockReason: normalized.category, budgetControlResult: normalized.category.includes("BUDGET") ? "BLOCKED" : null, limitControlResult: "BLOCKED" } }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model })); throw normalized; }
    request.metadataRecords = governed.preview.sanitizedMetadata; request.resolvedModelCapabilities = governed.preview.modelCapabilities; maxBytes = Math.min(maxBytes, governed.preview.responseLimits.maximumResponseBytes);
    let timeout: ReturnType<typeof resolveEffectiveTimeoutPolicy>;
    try {
      timeout = effectiveTimeoutPolicy(request, selected.primary.config, governed.preview.timeoutPolicy);
      if (auditId) await prisma.aiRequestAudit.update({ where: { id: auditId }, data: { effectiveTimeoutPolicyJson: timeout as any } });
    } catch (error) {
      const normalized = new AiError("INTERNAL_AI_ERROR", "AI request timeout configuration is invalid.", 500, undefined, { request_id: requestId, stage: "TIMEOUT_CONFIGURATION" });
      if (auditId) await failAiAudit(requestId, { category: normalized.category, retryCount: 0, latencyMs: Date.now() - started, details: normalized.details }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model }));
      await reconcileAiBudgetReservation(reservationId, undefined, "RELEASED");
      throw normalized;
    }
    let timed = createAiTimeoutRuntime({ upstream: request.signal, providerId: selected.primary.config.id, policy: timeout, streaming: false, deferConnectionUntilAttempt: true, requestStartedAt: started, onLifecycleLog: timeoutLifecycleLogger({ requestId, provider: selected.primary.config, model: selected.primary.model, streaming: false, policy: timeout }) });
    console.info("[AI] timeout policy resolved", { requestId, providerId: selected.primary.config.id, providerType: selected.primary.config.providerType, model: selected.primary.model, policy: timeout, streamed: false });
    let reservationAttemptCost: number | undefined;
    let finalCandidate = selected.primary;
    try {
      let response: AiResponse<T>;
      let fallbackOrigin: AiError | undefined;
      const explicitFallback = selected.fallback;
      const fallbackExecution = await executeEligibleFallback(
        () => executeWithRetries({ request, candidate: selected.primary, requestId, auditId, timed, maxBytes, started, startingRetries: 0, maximumRetryAttempts: governed.preview.retryPolicy.maximumRetryAttempts, retryAfterPossibleBilling: governed.preview.retryPolicy.retryAfterPossibleBilling, estimatedAttemptCost: governed.preview.cost.maximumEstimatedCost, beforeRetry: (retryNumber, possiblePriorBilling) => prepareAiRetry({ request, provider: selected.primary.config, model: selected.primary.model, userId, requestId, reservationId, retryNumber, possiblePriorBilling, initialAttemptCost: governed.preview.cost.maximumEstimatedCost }) }),
        explicitFallback ? async (normalized) => {
        retries = Number((normalized as any)?.retryCount || 0);
        if (timed.signal.aborted) throw normalized;
        request.resolvedModelCapabilities = undefined;
        if (auditId) await prisma.aiRequestAudit.update({ where: { id: auditId }, data: { originalProviderConfigId: selected.primary.config.id, originalModel: selected.primary.model, fallbackReason: normalized.category, status: "RETRIED" } }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model }));
        const fallbackPreview = await previewAiRequest({ request, provider: explicitFallback.config, model: explicitFallback.model, userId });
        const primaryPaid = governed.preview.cost.maximumEstimatedCost > 0; const fallbackPaid = fallbackPreview.cost.maximumEstimatedCost > 0;
        if ((!governed.preview.allowPaidProviderFallback && !primaryPaid && fallbackPaid) || governed.preview.privacyMode === "LOCAL_ONLY" && fallbackPreview.provider.location !== "LOCAL") throw new AiError("AI_PAID_FALLBACK_BLOCKED");
        const primaryAttemptCost = typeof normalized.details?.actual_cost === "number" ? normalized.details.actual_cost : typeof normalized.details?.estimated_cost === "number" ? normalized.details.estimated_cost : undefined;
        await reconcileAiBudgetReservation(reservationId, primaryAttemptCost, primaryAttemptCost == null ? "RELEASED" : "RECONCILED");
        const fallbackReservation = await reserveAiBudget({ request, provider: explicitFallback.config, model: explicitFallback.model, userId, requestId, auditId }); reservationId = fallbackReservation.reservation.id; governed = fallbackReservation; request.resolvedModelCapabilities = governed.preview.modelCapabilities;
        timed.close();
        timeout = effectiveTimeoutPolicy(request, explicitFallback.config, governed.preview.timeoutPolicy);
        timed = createAiTimeoutRuntime({ upstream: request.signal, providerId: explicitFallback.config.id, policy: timeout, streaming: false, deferConnectionUntilAttempt: true, requestStartedAt: started, onLifecycleLog: timeoutLifecycleLogger({ requestId, provider: explicitFallback.config, model: explicitFallback.model, streaming: false, policy: timeout }) });
        if (auditId) await prisma.aiRequestAudit.update({ where: { id: auditId }, data: { originalProviderConfigId: selected.primary.config.id, originalModel: selected.primary.model, fallbackReason: normalized.category, providerConfigId: explicitFallback.config.id, providerType: explicitFallback.config.providerType, providerDisplayName: explicitFallback.config.displayName, model: explicitFallback.model, status: "RETRIED", effectiveTimeoutPolicyJson: timeout as any } }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: explicitFallback.config, model: explicitFallback.model }));
        finalCandidate = explicitFallback;
        const fallbackResponse = await executeWithRetries({ request, candidate: explicitFallback, requestId, auditId, timed, maxBytes, started, startingRetries: retries + 1, maximumRetryAttempts: governed.preview.retryPolicy.maximumRetryAttempts, retryAfterPossibleBilling: governed.preview.retryPolicy.retryAfterPossibleBilling, estimatedAttemptCost: governed.preview.cost.maximumEstimatedCost, beforeRetry: (retryNumber, possiblePriorBilling) => prepareAiRetry({ request, provider: explicitFallback.config, model: explicitFallback.model, userId, requestId, reservationId, retryNumber, possiblePriorBilling, initialAttemptCost: governed.preview.cost.maximumEstimatedCost }) });
        reservationAttemptCost = fallbackResponse.actualCost ?? fallbackResponse.estimatedCost ?? governed.preview.cost.expectedEstimatedCost;
        fallbackResponse.warnings.push(`Explicit fallback used after ${selected.primary.config.displayName} was unavailable.`);
        return fallbackResponse;
      } : undefined);
      response = fallbackExecution.value;
      fallbackOrigin = fallbackExecution.originalError;
      if (fallbackOrigin) {
        const numberDetail = (key: string) => typeof fallbackOrigin?.details?.[key] === "number" ? fallbackOrigin.details[key] as number : undefined;
        const primaryInput = numberDetail("usage_input_tokens"); const primaryOutput = numberDetail("usage_output_tokens"); const primaryTotal = numberDetail("usage_total_tokens");
        const sum = (left: number | undefined, right: number | undefined) => left == null && right == null ? undefined : Number(left || 0) + Number(right || 0);
        response.usage = { ...response.usage, inputTokens: sum(primaryInput, response.usage?.inputTokens), outputTokens: sum(primaryOutput, response.usage?.outputTokens), totalTokens: sum(primaryTotal, response.usage?.totalTokens), providerReported: fallbackOrigin.details?.usage_provider_reported === true && response.usage?.providerReported === true };
        const primaryActual = numberDetail("actual_cost"); const primaryEstimated = numberDetail("estimated_cost"); const fallbackActual = response.actualCost; const fallbackEstimated = response.estimatedCost ?? governed.preview.cost.expectedEstimatedCost;
        response.estimatedCost = Number(primaryActual ?? primaryEstimated ?? 0) + Number(fallbackActual ?? fallbackEstimated ?? 0);
        response.actualCost = primaryActual != null && fallbackActual != null ? primaryActual + fallbackActual : undefined;
      }
      if (cheaperFallback) response.warnings.push(`A cheaper compatible model was selected, saving an estimated ${cheaperFallback.estimatedSavings.toFixed(6)} ${governed.preview.cost.currency}.`);
      retries = response.retryCount;
      const possiblePriorBillingCost = Number((response as any).possiblePriorBillingCost || 0);
      const responseInspection = inspectAiResponse(response.content || "");
      const stored = await storeAiResponse({ requestId, providerConfigId: response.providerId, model: response.model, schemaVersion: request.responseFormat?.name || "text-1", body: response.content || "", status: "RECEIVED", validationSummary: responseInspection });
      if (!responseInspection.safe) { await quarantineAiResponse({ requestId, responseRecordId: stored.id, userId, featureKey: request.featureKey, providerConfigId: response.providerId, model: response.model, severity: responseInspection.severity, reasons: responseInspection.reasons, requestPreview: { feature: request.featureKey }, responsePreview: response.content }); throw new AiError("AI_RESPONSE_QUARANTINED"); }
      if (request.responseFormat) {
        try {
          const parsed = await parseStructuredResponseWithProviderRepair({ content: response.content || "", format: request.responseFormat, maxBytes, maximumStructuredItems: governed.preview.responseLimits.maximumStructuredItems, providerRepairAttempts: governed.preview.structuredOutputPolicy.jsonProviderRepairAttempts, repair: async (malformedContent, validationDetails) => {
            await prepareAiRetry({ request, provider: finalCandidate.config, model: finalCandidate.model, userId, requestId, reservationId, retryNumber: 1, possiblePriorBilling: true, initialAttemptCost: governed.preview.cost.maximumEstimatedCost });
            const repairAttempt = auditId ? await prisma.aiProviderAttempt.create({ data: { requestAuditId: auditId, attemptNumber: response.retryCount + 2, providerConfigId: finalCandidate.config.id, model: finalCandidate.model, status: "STARTED", estimatedCost: governed.preview.cost.maximumEstimatedCost } }).catch(() => null) : null;
            const repairStarted = Date.now();
            let repairResponse: AiResponse<T>;
            const validationIssues = Array.isArray(validationDetails?.issues) ? validationDetails.issues : [];
            const repairIssues = validationIssues.map((issue: any) => ({ path: String(issue.path || ""), code: String(issue.code || "unknown"), expected: issue.expected, receivedType: String(issue.receivedType || "unknown") })).slice(0, 25);
            const repairDiagnostics = {
              failureStage: validationDetails?.failure_stage,
              rootValueType: validationDetails?.rootValueType,
              rootPropertyNames: validationDetails?.rootPropertyNames,
              nestedWrapperPropertyNames: validationDetails?.nestedWrapperPropertyNames,
              summaryCandidatePaths: validationDetails?.summaryCandidatePaths,
              invalidCollectionPaths: validationDetails?.invalidCollectionPaths,
              issues: repairIssues,
            };
            const scoringIssue = validationIssues.find((issue: any) => String(issue.path || "").endsWith("scoring.scoringModel"));
            if (request.featureKey === "recipe_copilot" && scoringIssue) {
              console.warn("[Recipe Copilot] Unsupported proposal enum", {
                proposalId: null,
                correlationId: requestId,
                path: "scoring.scoringModel",
                receivedValue: scoringIssue.receivedValue,
                supportedValues: SCORING_MODELS,
                normalizationAttempted: false,
                repairAttempted: true,
              });
            }
            const exactSchema = request.responseFormat?.jsonSchema ? JSON.stringify(request.responseFormat.jsonSchema) : "Use the response schema supplied through the native structured-output request.";
            try { repairResponse = await finalCandidate.adapter.complete({ ...request, systemInstructions: `This is the only schema repair attempt. Return only one corrected canonical JSON object matching this JSON Schema: ${exactSchema}. Do not return prose, Markdown, code fences, aliases, or wrapper objects.`, messages: [{ role: "user", content: `Exact validation errors: ${JSON.stringify(repairDiagnostics)}\nOriginal provider response:\n${malformedContent.slice(0, 100_000)}\nReturn only the corrected canonical JSON object.` }], stream: false, thinkingMode: finalCandidate.config.providerType === "deepseek" ? "disabled" : request.thinkingMode, reasoningEffort: undefined, temperature: undefined, metadata: { ...(request.metadata || {}), schema_repair: true, retryAttempt: 1 } }, finalCandidate.config, { requestId, providerId: finalCandidate.config.id, model: finalCandidate.model, signal: timed.signal, maxResponseBytes: maxBytes, modelCapabilities: request.resolvedModelCapabilities, lifecycle: timed.lifecycle }); }
            catch (repairError) { if (repairAttempt) await prisma.aiProviderAttempt.update({ where: { id: repairAttempt.id }, data: { status: "FAILED", completedAt: new Date(), providerAcknowledged: (repairError as AiError)?.details?.billing_possible !== false, errorCategory: repairError instanceof AiError ? repairError.category : "AI_PROVIDER_INVALID_RESPONSE" } }).catch(() => null); throw repairError; }
            if (repairAttempt) await prisma.aiProviderAttempt.update({ where: { id: repairAttempt.id }, data: { status: "COMPLETED", completedAt: new Date(), providerAcknowledged: true, inputTokens: repairResponse.usage?.inputTokens, outputTokens: repairResponse.usage?.outputTokens, actualCost: repairResponse.actualCost, estimatedCost: repairResponse.estimatedCost } }).catch(() => null);
            response.usage = { inputTokens: Number(response.usage?.inputTokens || 0) + Number(repairResponse.usage?.inputTokens || 0) || undefined, outputTokens: Number(response.usage?.outputTokens || 0) + Number(repairResponse.usage?.outputTokens || 0) || undefined, totalTokens: Number(response.usage?.totalTokens || 0) + Number(repairResponse.usage?.totalTokens || 0) || undefined, providerReported: response.usage?.providerReported === true && repairResponse.usage?.providerReported === true, providerRequestId: repairResponse.usage?.providerRequestId, rawUsage: repairResponse.usage?.rawUsage };
            response.actualCost = response.actualCost != null && repairResponse.actualCost != null ? response.actualCost + repairResponse.actualCost : undefined;
            response.estimatedCost = Number(response.estimatedCost || 0) + Number(repairResponse.estimatedCost || repairResponse.actualCost || 0) || undefined;
            response.content = repairResponse.content;
            response.transport = repairResponse.transport;
            response.warnings.push("The provider response required automatic format correction. Review the draft before applying it.");
            console.info("[AI] structured response repair completed", { requestId, provider: finalCandidate.config.displayName, model: finalCandidate.model, elapsedMs: Date.now() - repairStarted, stage: "SCHEMA_PROVIDER_REPAIR" });
            return repairResponse.content || "";
          } });
          response.content = parsed.content;
          response.data = parsed.data;
          if (request.featureKey === "playlist_ai_summaries" && process.env.NODE_ENV !== "production") console.info("[Playlist Summaries] Parsed response shape", { requestId, provider: finalCandidate.config.displayName, model: finalCandidate.model, ...safePlaylistSummaryLogDetails(parsed.normalization.featureDetails) });
          if (parsed.repaired || parsed.providerRepairUsed) await prisma.aiResponseRecord.update({ where: { id: stored.id }, data: { repairAttempts: 1, repairMethod: parsed.repairMethod, status: "SCHEMA_VALIDATED" } });
        } catch (error) {
          const structured = error instanceof AiError ? error : new AiError("AI_PROVIDER_INVALID_RESPONSE");
          const usageDetails = { usage_input_tokens: response.usage?.inputTokens, usage_output_tokens: response.usage?.outputTokens, usage_total_tokens: response.usage?.totalTokens, usage_provider_reported: response.usage?.providerReported === true, estimated_cost: response.estimatedCost ?? governed.preview.cost.expectedEstimatedCost, actual_cost: response.actualCost, billing_possible: response.transport?.httpStatus === 200, http_status: response.transport?.httpStatus, response_content_type: response.transport?.contentType, response_body_length: response.transport?.bodyLength, response_streamed: response.transport?.streamed, finish_reason: response.finishReason, final_content_character_count: response.finalContentCharacterCount ?? response.content?.length ?? 0 };
          await quarantineAiResponse({ requestId, responseRecordId: stored.id, userId, featureKey: request.featureKey, providerConfigId: response.providerId, model: response.model, reasons: [structured.details?.failure_stage === "SCHEMA_VALIDATION" ? "schema_validation_failed" : "json_parse_failed"], requestPreview: { feature: request.featureKey }, responsePreview: { contentType: "private_provider_output", characterCount: response.content?.length || 0, jsonParsed: structured.details?.json_parsed === true, propertyPaths: Array.isArray(structured.details?.issues) ? structured.details.issues.map((issue: any) => String(issue.path || "")).slice(0, 25) : [] }, validationFailures: structured.details });
          if (request.featureKey === "playlist_ai_summaries") {
            const details: Record<string, unknown> = { ...structured.details, ...usageDetails, request_id: requestId, provider: finalCandidate.config.displayName, model: finalCandidate.model };
            console.warn("[Playlist Summaries] Structured output validation failed", { requestId, provider: finalCandidate.config.displayName, model: finalCandidate.model, ...safePlaylistSummaryLogDetails(details) });
            const message = details.repair_attempted === true
              ? "The AI provider returned playlist summaries in an unsupported format. Mixarr attempted to repair the response, but it still did not match the required schema."
              : "The AI provider returned playlist summaries in an unsupported format and it did not match the required schema.";
            throw new AiError("AI_PROVIDER_INVALID_RESPONSE", message, 422, undefined, details);
          }
          console.warn("[Recipe Copilot] Structured output validation failed", { correlationId: requestId, provider: finalCandidate.config.displayName, model: finalCandidate.model, jsonParsed: structured.details?.json_parsed === true, normalized: structured.details?.normalized === true, issueCount: structured.details?.issue_count || 0, issues: structured.details?.issues || [], codeFenceRemoved: structured.details?.codeFenceRemoved === true, wrapperUnwrapped: structured.details?.wrapperUnwrapped === true, repairAttempted: structured.details?.repair_attempted === true });
          if (request.featureKey !== "recipe_copilot") { structured.details = { ...structured.details, ...usageDetails }; throw structured; }
          const scoringEnumIssue = Array.isArray(structured.details?.issues)
            && structured.details.issues.some((issue: any) => String(issue.path || "").endsWith("scoring.scoringModel"));
          const category = scoringEnumIssue
            ? "AI_RECIPE_PROPOSAL_UNSUPPORTED_ENUM"
            : structured.details?.repair_failed === true
              ? "AI_FEATURE_STRUCTURED_REPAIR_FAILED"
              : structured.details?.failure_stage === "JSON_PARSE"
                ? "AI_FEATURE_INVALID_JSON_OUTPUT"
                : "AI_FEATURE_INVALID_STRUCTURED_OUTPUT";
          throw new AiError(category, undefined, 422, undefined, { ...structured.details, ...usageDetails, request_id: requestId, provider: finalCandidate.config.displayName, model: finalCandidate.model, stage: structured.details?.failure_stage || "STRUCTURED_RESPONSE", elapsed_ms: Date.now() - started });
        }
      }
      const bytes = Buffer.byteLength(response.content || "", "utf8"); if (bytes > maxBytes) throw new AiError("RESPONSE_TOO_LARGE");
      if (possiblePriorBillingCost > 0) {
        // A prior attempt may have been billed but did not return exact usage.
        // Preserve the provider-reported final-attempt cost on its attempt row,
        // and account for the logical request conservatively as an estimate.
        response.estimatedCost = possiblePriorBillingCost + Number(response.actualCost ?? response.estimatedCost ?? governed.preview.cost.expectedEstimatedCost);
        response.actualCost = undefined;
      } else if (response.estimatedCost == null) response.estimatedCost = governed.preview.cost.expectedEstimatedCost;
      try { await completeAiAudit(requestId, response, bytes); await prisma.aiRequestAudit.update({ where: { requestId }, data: { finishReason: response.finishReason, finalContentStatus: "COMPLETE" } }); } catch (error) { await quarantineAiResponse({ requestId, responseRecordId: stored.id, userId, featureKey: request.featureKey, providerConfigId: response.providerId, model: response.model, reasons: ["audit_persistence_failed"], requestPreview: { feature: request.featureKey }, responsePreview: response.content }).catch(() => null); throw new AiError("INTERNAL_AI_ERROR"); } await reconcileAiBudgetReservation(reservationId, reservationAttemptCost ?? response.actualCost ?? response.estimatedCost, "RECONCILED"); await prisma.aiProviderModel.updateMany({ where: { providerConfigId: response.providerId, modelIdentifier: response.model }, data: { lastSuccessfulUseAt: new Date() } }); return response;
    } catch (error) {
      let normalized = normalizeProviderError(error); if (timed.timedOut()) normalized = timed.error({ request_id: requestId, provider: finalCandidate.config.displayName, provider_id: finalCandidate.config.id, provider_type: finalCandidate.config.providerType, model: finalCandidate.model, streaming: false, stage: "PROVIDER_REQUEST", timeout_source: timeout.sources[timed.timeoutPhase() === "connection" ? "connectionTimeoutMs" : timed.timeoutPhase() === "first_token" ? "firstTokenTimeoutMs" : "totalRequestTimeoutMs"], retryable: true, usage_available: false }); else if (timed.signal.aborted) normalized = timed.error({ request_id: requestId, provider_id: finalCandidate.config.id, provider_type: finalCandidate.config.providerType, model: finalCandidate.model, streaming: false }); else if (request.featureKey === "recipe_copilot" && normalized.category === "AI_PROVIDER_EMPTY_RESPONSE") normalized = new AiError("AI_FEATURE_EMPTY_OUTPUT", undefined, 422, undefined, normalized.details); retries = Number((error as any)?.retryCount || retries);
      if (normalized instanceof AiError) normalized.details = { request_id: requestId, provider: finalCandidate.config.displayName, model: finalCandidate.model, stage: normalized.details?.stage || normalized.details?.failure_stage || "AI_ORCHESTRATION", elapsed_ms: Date.now() - started, ...normalized.details };
      console.warn("[AI] request failed", { requestId, provider: finalCandidate.config.displayName, model: finalCandidate.model, endpointHostname: finalCandidate.config.baseUrl ? new URL(finalCandidate.config.baseUrl).hostname : undefined, elapsedMs: Date.now() - started, httpStatus: normalized.details?.http_status, contentType: normalized.details?.response_content_type, responseBodyLength: normalized.details?.response_body_length, streamed: normalized.details?.response_streamed === true, timeoutSource: normalized.details?.timeout_source, stage: normalized.details?.stage, code: normalized.category });
      if (auditId && normalized.category !== "AI_RESPONSE_QUARANTINED") await failAiAudit(requestId, { category: normalized.category, retryCount: retries, latencyMs: Date.now() - started, cancelled: ["REQUEST_CANCELLED", "AI_REQUEST_CANCELLED"].includes(normalized.category), timedOut: timed.timedOut(), details: normalized.details }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: finalCandidate.config, model: finalCandidate.model }));
      if (auditId && ["AI_PROVIDER_TRUNCATED_RESPONSE", "AI_PROVIDER_TRUNCATED_BEFORE_FINAL", "AI_PROVIDER_TRUNCATED_FINAL_RESPONSE", "AI_FEATURE_TRUNCATED_STRUCTURED_OUTPUT"].includes(normalized.category)) await prisma.aiRequestAudit.update({ where: { id: auditId }, data: { finishReason: "length", finalContentStatus: "INCOMPLETE", reasoningTokenCount: typeof normalized.details?.usage_reasoning_tokens === "number" ? normalized.details.usage_reasoning_tokens : undefined } }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: finalCandidate.config, model: finalCandidate.model }));
      const failureCost = reservationAttemptCost ?? (typeof normalized.details?.actual_cost === "number" ? normalized.details.actual_cost : typeof normalized.details?.estimated_cost === "number" ? normalized.details.estimated_cost : undefined);
      await reconcileAiBudgetReservation(reservationId, failureCost, failureCost == null ? "RELEASED" : "RECONCILED");
      throw normalized;
    } finally { timed.close(); }
  }

  async *stream<T = unknown>(raw: AiRequest<T>, userId?: string): AsyncIterable<AiStreamEvent> {
    // nextStreamEvent was replaced here by the lifecycle timer so stream-idle
    // timing begins only after first content instead of acting as a first-token cap.
    const requestId = raw.correlationId || crypto.randomUUID();
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
    request.metadataRecords = governed.preview.sanitizedMetadata; maxBytes = Math.min(maxBytes, governed.preview.responseLimits.maximumResponseBytes);
    const resolvedTimeout = effectiveTimeoutPolicy(request, selected.primary.config, governed.preview.timeoutPolicy);
    if (auditId) await prisma.aiRequestAudit.update({ where: { id: auditId }, data: { effectiveTimeoutPolicyJson: resolvedTimeout as any } }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model }));
    const timed = createAiTimeoutRuntime({ upstream: request.signal, providerId: selected.primary.config.id, policy: resolvedTimeout, streaming: true, deferConnectionUntilAttempt: true, requestStartedAt: started, onLifecycleLog: timeoutLifecycleLogger({ requestId, provider: selected.primary.config, model: selected.primary.model, streaming: true, policy: resolvedTimeout }) });
    const attempt = auditId ? await prisma.aiProviderAttempt.create({ data: { requestAuditId: auditId, attemptNumber: 1, providerConfigId: selected.primary.config.id, model: selected.primary.model } }).catch((error) => { unexpectedAiError(error, { correlationId: request.correlationId || requestId, featureName: request.featureKey, providerId: selected.primary.config.id, governanceDecisionStage: "audit_persistence" }); return null; }) : null; if (auditId) await setAiAuditStatus(requestId, "STREAMING").catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model })); if (cheaperFallback) yield { type: "warning", message: `A cheaper compatible model was selected, saving an estimated ${cheaperFallback.estimatedSavings.toFixed(6)} ${governed.preview.cost.currency}.` };
    let streamedContent = "";
    try {
      timed.beginAttempt();
      const iterator = selected.primary.adapter.stream!(request, selected.primary.config, { requestId, providerId: selected.primary.config.id, model: selected.primary.model, signal: timed.signal, maxResponseBytes: maxBytes, lifecycle: timed.lifecycle })[Symbol.asyncIterator]();
      while (true) {
        const next = await iterator.next(); if (next.done) break; const event = next.value;
        if (event.type === "text_delta" || event.type === "structured_delta") timed.lifecycle.responseActivity({ meaningful: event.delta.length > 0 });
        else if (event.type !== "started") timed.lifecycle.responseActivity({ meaningful: false });
        if (event.type === "text_delta" || event.type === "structured_delta") { bytes += Buffer.byteLength(event.delta, "utf8"); if (bytes > maxBytes) throw new AiError("RESPONSE_TOO_LARGE"); streamedContent += event.delta; }
        if (event.type === "usage") usage = event.usage; yield event;
      }
      const response: AiResponse = { requestId, providerId: selected.primary.config.id, providerType: selected.primary.config.providerType, model: selected.primary.model, content: streamedContent, usage, latencyMs: Date.now() - started, retryCount: 0, streaming: true, warnings: [] };
      const inspection = inspectAiResponse(streamedContent); const stored = await storeAiResponse({ requestId, providerConfigId: response.providerId, model: response.model, schemaVersion: request.responseFormat?.name || "text-stream-1", body: streamedContent, validationSummary: inspection });
      if (!inspection.safe) { await quarantineAiResponse({ requestId, responseRecordId: stored.id, userId, featureKey: request.featureKey, providerConfigId: response.providerId, model: response.model, severity: inspection.severity, reasons: inspection.reasons, responsePreview: streamedContent }); throw new AiError("AI_RESPONSE_QUARANTINED"); }
      response.estimatedCost = governed.preview.cost.expectedEstimatedCost; if (attempt) await prisma.aiProviderAttempt.update({ where: { id: attempt.id }, data: { status: "COMPLETED", completedAt: new Date(), providerAcknowledged: true, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens } }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model })); await recordAiExecutionHealth(selected.primary.config.id, true, response.latencyMs); await completeAiAudit(requestId, response, bytes); await reconcileAiBudgetReservation(reservationId, response.actualCost ?? response.estimatedCost, "RECONCILED");
    } catch (error) {
      let normalized = normalizeProviderError(error);
      if (timed.timedOut()) normalized = timed.error({ request_id: requestId, provider: selected.primary.config.displayName, provider_id: selected.primary.config.id, provider_type: selected.primary.config.providerType, model: selected.primary.model, streaming: true, stage: "PROVIDER_STREAM", timeout_source: "effective_policy", retryable: !timed.producedContent(), usage_available: false });
      else if (timed.signal.aborted) normalized = timed.error({ request_id: requestId, provider_id: selected.primary.config.id, provider_type: selected.primary.config.providerType, model: selected.primary.model, streaming: true });
      if (attempt) await prisma.aiProviderAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", completedAt: new Date(), providerAcknowledged: true, errorCategory: normalized.category } }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model })); await recordAiExecutionHealth(selected.primary.config.id, false, Date.now() - started, normalized); if (auditId && normalized.category !== "AI_RESPONSE_QUARANTINED") await failAiAudit(requestId, { category: normalized.category, retryCount: 0, latencyMs: Date.now() - started, cancelled: ["REQUEST_CANCELLED", "AI_REQUEST_CANCELLED"].includes(normalized.category), timedOut: timed.timedOut(), details: normalized.details }).catch((auditError) => logAuditFailure(auditError, { requestId, request, userId, provider: selected.primary.config, model: selected.primary.model })); await reconcileAiBudgetReservation(reservationId, undefined, "RELEASED");
      yield ["REQUEST_CANCELLED", "AI_REQUEST_CANCELLED"].includes(normalized.category) ? { type: "cancelled" } : { type: "failed", code: normalized.category, message: normalized.toSafePayload().message };
    } finally { timed.close(); }
  }
}

export const aiRequestCoordinator = new AiRequestCoordinator();
