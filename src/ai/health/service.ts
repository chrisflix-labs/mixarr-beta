import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { aiProviderRegistry } from "../registry/providerRegistry";
import { resolveAiProvider } from "../services/providerService";
import { AiError, normalizeProviderError } from "../errors";
import { createAiRequestSignal } from "../utilities/cancellation";
import { beginAdministrativeAiOperation, finishAdministrativeAiOperation } from "../governance/service";
import { classifyOpenAiModel } from "../providers/openai";
import { resolveEffectiveTimeoutPolicy } from "../config/timeout";

const activeProviderTests = new Set<string>();

async function administrativeTimeoutPolicy(config: Awaited<ReturnType<typeof resolveAiProvider>>) {
  const governance = await prisma.aiGovernanceSetting.findUnique({ where: { id: "global" } });
  return resolveEffectiveTimeoutPolicy({
    providerOverrideEnabled: config.timeoutOverrideEnabled,
    providerPolicy: config.timeoutPolicy,
    globalPolicy: governance || undefined,
  });
}

function safeMessage(error: AiError) { return error.toSafePayload().message; }
function safeOrigin(value?: string) { if (!value) return undefined; try { return new URL(value).origin; } catch { return "invalid-url"; } }
function details(error: AiError) { return error.details || {}; }
function failureHealthState(category: string) {
  if (category === "PROVIDER_UNAUTHORIZED") return "UNAUTHORIZED";
  if (["PROVIDER_ENDPOINT_INVALID", "PROVIDER_SECRET_UNAVAILABLE"].includes(category)) return "MISCONFIGURED";
  if (category === "PROVIDER_CONNECTION_FAILED") return "UNREACHABLE";
  return "DEGRADED";
}

function normalizeAdministrativeError(error: unknown, timed: ReturnType<typeof createAiRequestSignal>, correlationId: string) {
  let normalized = error instanceof AiError ? error : new AiError("INTERNAL_AI_ERROR");
  if (timed.timedOut()) normalized = new AiError("PROVIDER_TIMEOUT");
  else if (timed.signal.aborted && normalized.category === "REQUEST_CANCELLED") normalized = new AiError("REQUEST_CANCELLED");
  normalized.details = { ...(normalized.details || {}), correlation_id: correlationId };
  return normalized;
}

function compatibility(row: { modelIdentifier: string; capabilityMetadata: unknown }) {
  const metadata = row.capabilityMetadata && typeof row.capabilityMetadata === "object" && !Array.isArray(row.capabilityMetadata) ? row.capabilityMetadata as Record<string, any> : {};
  return metadata.compatibility && typeof metadata.compatibility === "object" ? metadata.compatibility : classifyOpenAiModel(row.modelIdentifier);
}

async function selectOpenAiTestModel(providerId: string, defaultModel?: string, requestedModel?: string) {
  const rows = await prisma.aiProviderModel.findMany({ where: { providerConfigId: providerId, availabilityStatus: "AVAILABLE" }, orderBy: { modelIdentifier: "asc" } });
  if (requestedModel) {
    const row = rows.find((model) => model.modelIdentifier === requestedModel);
    if (!row) throw new AiError("MODEL_NOT_AVAILABLE", undefined, 404, undefined, { model: requestedModel, failure_stage: "MODEL_VALIDATION" });
    const modelCompatibility = compatibility(row);
    if (!modelCompatibility.suitableForConnectionTest || !modelCompatibility.supportsResponsesApi) throw new AiError("MODEL_NOT_COMPATIBLE", undefined, 400, undefined, { model: requestedModel, compatibility_reason: modelCompatibility.reason, failure_stage: "MODEL_VALIDATION" });
    return { id: row.modelIdentifier, compatibility: modelCompatibility, eligibleCount: rows.filter((model) => compatibility(model).suitableForConnectionTest).length };
  }
  const eligible = rows.filter((model) => { const value = compatibility(model); return value.suitableForConnectionTest && value.supportsResponsesApi; });
  if (!eligible.length) throw new AiError("MODEL_NOT_COMPATIBLE", "No compatible text-generation models were found.", 400, undefined, { compatibility_reason: "Model discovery succeeded, but Mixarr could not find a model suitable for a Responses API inference test.", failure_stage: "MODEL_VALIDATION" });
  const selected = eligible.find((model) => model.modelIdentifier === defaultModel) || eligible[0];
  return { id: selected.modelIdentifier, compatibility: compatibility(selected), eligibleCount: eligible.length };
}

async function recordValidationFailure(provider: Awaited<ReturnType<typeof resolveAiProvider>>, model: string | undefined, userId: string | undefined, error: AiError) {
  const requestId = crypto.randomUUID();
  error.details = { ...(error.details || {}), correlation_id: requestId };
  await prisma.aiRequestAudit.create({ data: { requestId, correlationId: requestId, logicalRequestId: requestId, featureKey: "administrative_connection_test", userId, providerConfigId: provider.id, providerType: provider.providerType, providerDisplayName: provider.displayName, model: model || provider.defaultModel, requestSource: "CONNECTION_TEST", locationClassification: provider.locationClassification, status: "FAILED", completedAt: new Date(), testStage: "MODEL_VALIDATION", governanceResult: "NOT_EVALUATED", modelCompatibilityResult: error.category === "MODEL_NOT_AVAILABLE" ? "UNAVAILABLE" : "INCOMPATIBLE", endpointMode: provider.providerType === "openai" ? "RESPONSES_API" : "PROVIDER_DEFAULT", costState: "NOT_SENT", errorCategory: error.category, sanitizedErrorCode: error.category, blockReason: error.category, budgetControlResult: "NOT_SENT", limitControlResult: "NOT_SENT" } }).catch(() => null);
  return requestId;
}

async function resolveProviderForAdministrativeTest(providerId: string, userId?: string) {
  try { return await resolveAiProvider(providerId); }
  catch (error) {
    if (!(error instanceof AiError) || error.category !== "PROVIDER_SECRET_UNAVAILABLE") throw error;
    const requestId = crypto.randomUUID();
    error.details = { ...(error.details || {}), correlation_id: requestId, failure_stage: "SECRET_RESOLUTION" };
    const row = await prisma.aiProviderConfig.findUnique({ where: { id: providerId }, select: { providerType: true, displayName: true, defaultModel: true, locationClassification: true } }).catch(() => null);
    await prisma.aiRequestAudit.create({ data: { requestId, correlationId: requestId, logicalRequestId: requestId, featureKey: "administrative_connection_test", userId, providerConfigId: row ? providerId : undefined, providerType: row?.providerType, providerDisplayName: row?.displayName, model: row?.defaultModel, requestSource: "CONNECTION_TEST", locationClassification: row?.locationClassification, status: "FAILED", completedAt: new Date(), testStage: "SECRET_RESOLUTION", governanceResult: "NOT_EVALUATED", costState: "NOT_SENT", errorCategory: error.category, sanitizedErrorCode: error.category, blockReason: error.category, budgetControlResult: "NOT_SENT", limitControlResult: "NOT_SENT" } }).catch(() => null);
    throw error;
  }
}

export async function testAiProviderConnection(providerId: string, signal?: AbortSignal, userId?: string, background = false, requestedModel?: string) {
  const config = await resolveProviderForAdministrativeTest(providerId, userId);
  const adapter = aiProviderRegistry.get(config.providerType);
  if (!adapter.available) throw new AiError("PROVIDER_UNSUPPORTED");
  if (activeProviderTests.has(providerId)) throw new AiError("PROVIDER_UNAVAILABLE", "A connection test is already running for this provider.", 409);

  let selectedModel = requestedModel || config.defaultModel;
  let eligibleCount = 0;
  if (config.providerType === "openai") {
    try { const selected = await selectOpenAiTestModel(providerId, config.defaultModel, requestedModel); selectedModel = selected.id; eligibleCount = selected.eligibleCount; }
    catch (error) { if (error instanceof AiError) { await recordValidationFailure(config, requestedModel, userId, error); throw error; } throw error; }
  }

  const governanceOperation = await beginAdministrativeAiOperation({ provider: config, source: "CONNECTION_TEST", model: selectedModel, userId, signal, background });
  activeProviderTests.add(providerId);
  const timeoutPolicy = await administrativeTimeoutPolicy(config);
  const timed = createAiRequestSignal(signal, timeoutPolicy.totalRequestTimeoutMs);
  const started = Date.now();
  const initialProfile = { retryAttempt: 0, thinkingMode: "disabled" as const };
  try {
    const result = await adapter.testConnection(config, timed.signal, selectedModel, initialProfile);
    if (eligibleCount) result.availableModelCount = eligibleCount;
    const current = await prisma.aiProviderHealth.findUnique({ where: { providerConfigId: providerId } });
    const now = new Date();
    await prisma.$transaction([
      prisma.aiProviderConfig.update({ where: { id: providerId }, data: { lastConnectionTestAt: now, lastSuccessfulConnectionAt: now } }),
      prisma.aiProviderHealth.upsert({ where: { providerConfigId: providerId }, create: { providerConfigId: providerId, healthState: "HEALTHY", authenticationState: "HEALTHY", discoveryState: current?.discoveryState || "NOT_TESTED", inferenceState: "HEALTHY", lastCheckAt: now, lastSuccessfulCheckAt: now, lastAuthenticationAt: now, lastSuccessfulInferenceAt: now, latencyMs: result.latencyMs, discoveredModelCount: current?.discoveredModelCount || 0, endpointMode: result.endpointMode, providerRequestId: result.providerRequestId }, update: { healthState: "HEALTHY", authenticationState: "HEALTHY", inferenceState: "HEALTHY", lastCheckAt: now, lastSuccessfulCheckAt: now, lastAuthenticationAt: now, lastSuccessfulInferenceAt: now, latencyMs: result.latencyMs, consecutiveFailureCount: 0, errorCategory: null, sanitizedMessage: result.message, endpointMode: result.endpointMode, lastHttpStatus: 200, providerRequestId: result.providerRequestId, nextEligibleCheckAt: null } }),
    ]);
    await finishAdministrativeAiOperation(governanceOperation, { success: true, estimatedCost: governanceOperation.providerTest?.maximumEstimatedCost, modelReturned: result.modelReturned, endpointMode: result.endpointMode, providerRequestId: result.providerRequestId, usage: result.usage, retryAttempted: false, thinkingModeRequested: result.thinkingModeRequested, hasReasoningContent: result.hasReasoningContent, reasoningCharacterCount: result.reasoningCharacterCount, finalContentCharacterCount: result.finalContentCharacterCount });
    console.info("[AI Provider Test] Completed", { correlationId: governanceOperation.requestId, providerId, providerType: config.providerType, apiOrigin: safeOrigin(config.baseUrl), selectedModel, adapterName: adapter.constructor.name, endpointMode: result.endpointMode, governanceResult: "ALLOWED", httpStatus: 200, providerRequestId: result.providerRequestId, failureStage: null });
    return { ...result, success: true, provider: config.displayName, model: selectedModel || result.model || null, classification: governanceOperation.classification.classification, classificationReason: governanceOperation.classification.reason, effectivePolicy: governanceOperation.resolvedPolicy, latency_ms: result.latencyMs, correlation_id: governanceOperation.requestId, thinking_mode_requested: result.thinkingModeRequested, has_reasoning_content: result.hasReasoningContent, reasoning_character_count: result.reasoningCharacterCount, final_content_character_count: result.finalContentCharacterCount, retry_attempted: false };
  } catch (error) {
    const normalized = normalizeAdministrativeError(error, timed, governanceOperation.requestId);
    await finishAdministrativeAiOperation(governanceOperation, { success: false, error: normalized, estimatedCost: details(normalized).http_status ? governanceOperation.providerTest?.maximumEstimatedCost : undefined });
    if (normalized.category === "REQUEST_CANCELLED") throw normalized;
    const current = await prisma.aiProviderHealth.findUnique({ where: { providerConfigId: providerId } });
    const failures = (current?.consecutiveFailureCount || 0) + 1;
    const now = new Date();
    const next = new Date(Date.now() + Math.min(24 * 60, 2 ** failures) * 60_000);
    const info = details(normalized);
    const authState = normalized.category === "PROVIDER_UNAUTHORIZED" ? "FAILED" : current?.authenticationState || "NOT_TESTED";
    await prisma.$transaction([
      prisma.aiProviderConfig.update({ where: { id: providerId }, data: { lastConnectionTestAt: now } }),
      prisma.aiProviderHealth.upsert({ where: { providerConfigId: providerId }, create: { providerConfigId: providerId, healthState: failureHealthState(normalized.category), authenticationState: authState, inferenceState: "FAILED", lastCheckAt: now, lastFailedRequestAt: now, latencyMs: Date.now() - started, errorCategory: normalized.category, sanitizedMessage: safeMessage(normalized), consecutiveFailureCount: failures, endpointMode: (info.endpoint_mode as string | undefined) || (config.providerType === "openai" ? "RESPONSES_API" : undefined), lastHttpStatus: info.http_status as number | undefined, providerRequestId: info.provider_request_id as string | undefined, nextEligibleCheckAt: next }, update: { healthState: failureHealthState(normalized.category), authenticationState: authState, inferenceState: "FAILED", lastCheckAt: now, lastFailedRequestAt: now, latencyMs: Date.now() - started, errorCategory: normalized.category, sanitizedMessage: safeMessage(normalized), consecutiveFailureCount: failures, endpointMode: (info.endpoint_mode as string | undefined) || current?.endpointMode, lastHttpStatus: info.http_status as number | undefined, providerRequestId: info.provider_request_id as string | undefined, nextEligibleCheckAt: next } }),
    ]);
    console.error("[AI Provider Test] Failed", { correlationId: governanceOperation.requestId, providerId, providerType: config.providerType, apiOrigin: safeOrigin(config.baseUrl), selectedModel, adapterName: adapter.constructor.name, endpointMode: info.endpoint_mode || (config.providerType === "openai" ? "RESPONSES_API" : "PROVIDER_DEFAULT"), governanceResult: "ALLOWED", httpStatus: info.http_status, providerErrorType: info.provider_error_type, providerErrorCode: info.provider_error_code, providerRequestId: info.provider_request_id, failureStage: info.failure_stage || (info.http_status ? "PROVIDER_RESPONSE" : "NETWORK"), exceptionClass: normalized.name, sanitizedExceptionMessage: safeMessage(normalized) });
    throw normalized;
  } finally { timed.close(); activeProviderTests.delete(providerId); }
}

export async function verifyAiProviderCredentials(providerId: string, signal?: AbortSignal, userId?: string) {
  const config = await resolveAiProvider(providerId);
  if (!config.enabled) throw new AiError("PROVIDER_DISABLED");
  const operation = await beginAdministrativeAiOperation({ provider: config, source: "MODEL_DISCOVERY", userId, signal });
  const adapter = aiProviderRegistry.get(config.providerType);
  const timeoutPolicy = await administrativeTimeoutPolicy(config);
  const timed = createAiRequestSignal(signal, timeoutPolicy.totalRequestTimeoutMs);
  const started = Date.now();
  try {
    const models = await adapter.discoverModels(config, timed.signal);
    const now = new Date();
    const current = await prisma.aiProviderHealth.findUnique({ where: { providerConfigId: providerId } });
    await prisma.aiProviderHealth.upsert({ where: { providerConfigId: providerId }, create: { providerConfigId: providerId, healthState: current?.inferenceState === "HEALTHY" ? "HEALTHY" : "AUTHENTICATED", authenticationState: "HEALTHY", lastAuthenticationAt: now, lastCheckAt: now, latencyMs: Date.now() - started, discoveredModelCount: current?.discoveredModelCount || 0 }, update: { healthState: current?.inferenceState === "HEALTHY" ? "HEALTHY" : "AUTHENTICATED", authenticationState: "HEALTHY", lastAuthenticationAt: now, lastCheckAt: now, latencyMs: Date.now() - started, errorCategory: null, sanitizedMessage: "Credentials accepted by the provider models endpoint." } });
    await finishAdministrativeAiOperation(operation, { success: true, endpointMode: "MODELS_API" });
    return { success: true, stage: "authentication", code: "AUTHENTICATED", provider: config.displayName, authenticationResult: "SUCCEEDED", discoveredModelCount: models.length, inferenceResult: current?.inferenceState || "NOT_TESTED", correlation_id: operation.requestId };
  } catch (error) { const normalized = normalizeAdministrativeError(error, timed, operation.requestId); await finishAdministrativeAiOperation(operation, { success: false, error: normalized }); throw normalized; }
  finally { timed.close(); }
}

export async function recordAiExecutionHealth(providerId: string, success: boolean, latencyMs: number, error?: unknown) {
  const activeProvider = await prisma.aiProviderConfig.findFirst({ where: { id: providerId, deletedAt: null }, select: { id: true } }).catch(() => null);
  if (!activeProvider) return;
  const current = await prisma.aiProviderHealth.findUnique({ where: { providerConfigId: providerId } }).catch(() => null);
  const failures = success ? 0 : (current?.consecutiveFailureCount || 0) + 1;
  const normalized = success ? null : error instanceof AiError ? error : normalizeProviderError(error);
  const now = new Date();
  await prisma.aiProviderHealth.upsert({ where: { providerConfigId: providerId }, create: { providerConfigId: providerId, healthState: success ? "HEALTHY" : failureHealthState(normalized!.category), authenticationState: success ? "HEALTHY" : "NOT_TESTED", inferenceState: success ? "HEALTHY" : "FAILED", lastCheckAt: now, lastSuccessfulCheckAt: success ? now : undefined, lastSuccessfulInferenceAt: success ? now : undefined, lastFailedRequestAt: success ? undefined : now, latencyMs, consecutiveFailureCount: failures, errorCategory: normalized?.category, sanitizedMessage: success ? "Request completed successfully." : safeMessage(normalized!) }, update: { healthState: success ? "HEALTHY" : failureHealthState(normalized!.category), authenticationState: success ? "HEALTHY" : current?.authenticationState, inferenceState: success ? "HEALTHY" : "FAILED", lastCheckAt: now, lastSuccessfulCheckAt: success ? now : undefined, lastSuccessfulInferenceAt: success ? now : undefined, lastFailedRequestAt: success ? undefined : now, latencyMs, consecutiveFailureCount: failures, errorCategory: normalized?.category || null, sanitizedMessage: success ? "Request completed successfully." : safeMessage(normalized!) } }).catch(() => null);
  if (success) await prisma.aiProviderConfig.updateMany({ where: { id: providerId, deletedAt: null }, data: { lastSuccessfulConnectionAt: now } }).catch(() => null);
}

export async function refreshAiProviderModels(providerId: string, signal?: AbortSignal, userId?: string) {
  const config = await resolveAiProvider(providerId);
  if (!config.enabled) throw new AiError("PROVIDER_DISABLED");
  const operation = await beginAdministrativeAiOperation({ provider: config, source: "MODEL_DISCOVERY", userId, signal });
  const adapter = aiProviderRegistry.get(config.providerType);
  const timeoutPolicy = await administrativeTimeoutPolicy(config);
  const timed = createAiRequestSignal(signal, timeoutPolicy.totalRequestTimeoutMs);
  try {
    const models = await adapter.discoverModels(config, timed.signal);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.aiProviderModel.updateMany({ where: { providerConfigId: providerId }, data: { availabilityStatus: "UNAVAILABLE" } });
      for (const model of models) {
        const metadata = { ...model.capabilities, ...(model.compatibility ? { compatibility: model.compatibility } : {}) } as Prisma.InputJsonValue;
        await tx.aiProviderModel.upsert({ where: { providerConfigId_modelIdentifier: { providerConfigId: providerId, modelIdentifier: model.id } }, create: { providerConfigId: providerId, modelIdentifier: model.id, displayName: model.displayName, contextSize: model.contextSize, modelCategory: model.category, capabilityMetadata: metadata, discoveredAt: now, lastSeenAt: now, availabilityStatus: "AVAILABLE" }, update: { displayName: model.displayName, contextSize: model.contextSize, modelCategory: model.category, capabilityMetadata: metadata, lastSeenAt: now, availabilityStatus: "AVAILABLE" } });
      }
      if (config.providerType === "openai" && config.defaultModel) {
        const discoveredDefault = models.find((model) => model.id === config.defaultModel);
        if (!discoveredDefault?.compatibility?.selectableAsDefault) await tx.aiProviderConfig.update({ where: { id: providerId }, data: { defaultModel: null } });
      }
      const current = await tx.aiProviderHealth.findUnique({ where: { providerConfigId: providerId } });
      await tx.aiProviderHealth.upsert({ where: { providerConfigId: providerId }, create: { providerConfigId: providerId, healthState: "AUTHENTICATED", authenticationState: "HEALTHY", discoveryState: "HEALTHY", lastAuthenticationAt: now, lastDiscoveryAt: now, lastCheckAt: now, discoveredModelCount: models.length, sanitizedMessage: "Credentials accepted and model discovery succeeded." }, update: { healthState: current?.inferenceState === "HEALTHY" ? "HEALTHY" : "AUTHENTICATED", authenticationState: "HEALTHY", discoveryState: "HEALTHY", lastAuthenticationAt: now, lastDiscoveryAt: now, lastCheckAt: now, discoveredModelCount: models.length, errorCategory: current?.inferenceState === "FAILED" ? current.errorCategory : null, sanitizedMessage: current?.inferenceState === "FAILED" ? "Authentication and model discovery succeeded, but the most recent inference test failed." : "Credentials accepted and model discovery succeeded." } });
    });
    await finishAdministrativeAiOperation(operation, { success: true, endpointMode: "MODELS_API" });
    return { models, discoveredAt: now.toISOString(), authenticationResult: "SUCCEEDED", discoveryResult: "SUCCEEDED", inferenceResult: (await prisma.aiProviderHealth.findUnique({ where: { providerConfigId: providerId } }))?.inferenceState || "NOT_TESTED", correlation_id: operation.requestId };
  } catch (error) {
    const normalized = normalizeAdministrativeError(error, timed, operation.requestId);
    await finishAdministrativeAiOperation(operation, { success: false, error: normalized });
    const current = await prisma.aiProviderHealth.findUnique({ where: { providerConfigId: providerId } });
    await prisma.aiProviderHealth.upsert({ where: { providerConfigId: providerId }, create: { providerConfigId: providerId, healthState: failureHealthState(normalized.category), authenticationState: normalized.category === "PROVIDER_UNAUTHORIZED" ? "FAILED" : "NOT_TESTED", discoveryState: "FAILED", lastCheckAt: new Date(), lastFailedRequestAt: new Date(), errorCategory: normalized.category, sanitizedMessage: safeMessage(normalized) }, update: { healthState: failureHealthState(normalized.category), authenticationState: normalized.category === "PROVIDER_UNAUTHORIZED" ? "FAILED" : current?.authenticationState, discoveryState: "FAILED", lastCheckAt: new Date(), lastFailedRequestAt: new Date(), errorCategory: normalized.category, sanitizedMessage: safeMessage(normalized) } });
    throw normalized;
  } finally { timed.close(); }
}

export async function runDueAiHealthChecks(concurrency = 2) {
  const global = await prisma.aiGlobalSetting.findUnique({ where: { id: "global" } });
  if (!global?.enabled) return { tested: 0, skipped: true };
  const now = new Date();
  const providers = await prisma.aiProviderConfig.findMany({ where: { enabled: true, deletedAt: null, healthCheckEnabled: true, OR: [{ health: null }, { health: { nextEligibleCheckAt: { lte: now } } }, { health: { nextEligibleCheckAt: null, lastCheckAt: { lte: new Date(now.getTime() - 60_000) } } }] }, select: { id: true, healthCheckIntervalMinutes: true, health: true } });
  const due = providers.filter((provider) => !provider.health?.lastCheckAt || now.getTime() - provider.health.lastCheckAt.getTime() >= provider.healthCheckIntervalMinutes * 60_000);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, async () => { while (cursor < due.length) { const item = due[cursor++]; await testAiProviderConnection(item.id, undefined, undefined, true).catch(() => null); } }));
  return { tested: due.length, skipped: false };
}
