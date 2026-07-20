import prisma from "@/lib/prisma";
import type { AiCapability, AiCapabilityConfidence, AiProviderAdapter, AiRequest, AiResponse, AiStreamEvent, ResolvedAiProviderConfig } from "../contracts";
import { AiError, normalizeProviderError, type AiErrorCategory } from "../errors";
import { aiFeatureByKey } from "../features/registry";
import { aiProviderRegistry } from "../registry/providerRegistry";
import { resolveAiProvider } from "../services/providerService";
import { oneWayPromptHash } from "../security";
import { safeMetadataSchema, parseStructuredResponse } from "../validation";
import { abortableDelay, isRetryEligible, retryDelayMs } from "../utilities/retry";
import { sanitizePromptText } from "../utilities/prompt";
import { completeAiAudit, createAiAudit, failAiAudit, setAiAuditStatus } from "../audit/service";
import { recordAiExecutionHealth } from "../health/service";
import { createAiRequestSignal, nextStreamEvent } from "../utilities/cancellation";

const supportedCapability = new Set<AiCapabilityConfidence>(["CONFIRMED", "REPORTED", "ASSUMED", "MANUALLY_ENABLED"]);
const fallbackCategories = new Set<AiErrorCategory>(["PROVIDER_UNAVAILABLE", "CONNECTION_FAILED", "RATE_LIMITED", "REQUEST_TIMEOUT", "TLS_ERROR", "PROVIDER_OVERLOADED"]);

export function missingCapabilities(required: AiCapability[], resolved: Record<string, AiCapabilityConfidence | undefined>) {
  return required.filter((capability) => !supportedCapability.has(resolved[capability] || "UNKNOWN"));
}

async function prepareCandidate(config: ResolvedAiProviderConfig, model: string | undefined, required: AiCapability[], allowStreamingFallback?: boolean) {
  if (!config.enabled) throw new AiError("PROVIDER_DISABLED");
  if (!model) throw new AiError("MODEL_NOT_CONFIGURED");
  const adapter = aiProviderRegistry.get(config.providerType);
  if (!adapter.available) throw new AiError("PROVIDER_UNSUPPORTED");
  const capabilities = { ...(await adapter.detectCapabilities(config, model)), ...config.capabilityOverrides };
  const missing = missingCapabilities(Array.from(new Set(required)), capabilities);
  if (missing.length && !(missing.length === 1 && missing[0] === "streaming" && allowStreamingFallback)) throw new AiError("CAPABILITY_UNAVAILABLE", `Provider lacks required capability: ${missing.join(", ")}.`);
  return { config, model, adapter, streamFallback: missing.includes("streaming") };
}

async function selection<T>(request: AiRequest<T>) {
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
  const primary = await prepareCandidate(config, request.model || feature.preferredModel || config.defaultModel, required, request.allowStreamingFallback);
  let fallback: Awaited<ReturnType<typeof prepareCandidate>> | null = null;
  const featureFallbackId = feature.fallbackBehavior === "EXPLICIT_PROVIDER" ? feature.fallbackProviderId : null;
  const fallbackId = request.allowFallback ? (featureFallbackId || config.fallbackProviderId) : null;
  if (fallbackId && fallbackId !== config.id) {
    const fallbackConfig = await resolveAiProvider(fallbackId);
    const safeConfiguration = (feature.safeConfigurationJson || {}) as Record<string, unknown>;
    const remoteFallbackBlocked = config.locationClassification === "LOCAL" && fallbackConfig.locationClassification === "REMOTE" && safeConfiguration.allowRemoteFallback !== true;
    if (!remoteFallbackBlocked) fallback = await prepareCandidate(fallbackConfig, fallbackConfig.defaultModel, required, request.allowStreamingFallback);
  }
  return { global, feature, primary, fallback };
}

async function enforceBudget(config: ResolvedAiProviderConfig) {
  const row = await prisma.aiProviderConfig.findUnique({ where: { id: config.id }, select: { monthlyBudget: true } });
  if (row?.monthlyBudget == null) return;
  const now = new Date(); const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const usage = await prisma.aiRequestAudit.aggregate({ where: { providerConfigId: config.id, createdAt: { gte: month }, status: "COMPLETED" }, _sum: { estimatedCost: true } });
  if ((usage._sum.estimatedCost || 0) >= row.monthlyBudget) throw new AiError("BUDGET_EXCEEDED");
}

function normalizedRequest<T>(request: AiRequest<T>) {
  return { ...request, systemInstructions: request.systemInstructions ? sanitizePromptText(request.systemInstructions, 20_000) : undefined, messages: request.messages.slice(0, 100).map((message) => ({ role: message.role, content: sanitizePromptText(message.content, 20_000) })), metadata: safeMetadataSchema.parse(request.metadata || {}), temperature: request.temperature == null ? undefined : Math.max(0, Math.min(2, request.temperature)) };
}

async function executeWithRetries<T>(input: { request: AiRequest<T>; candidate: { config: ResolvedAiProviderConfig; model: string; adapter: AiProviderAdapter }; requestId: string; signal: AbortSignal; maxBytes: number; started: number; startingRetries: number; timedOut: () => boolean }) {
  let retries = input.startingRetries;
  while (true) {
    const attemptStarted = Date.now();
    try {
      await enforceBudget(input.candidate.config);
      const response = await input.candidate.adapter.complete(input.request, input.candidate.config, { requestId: input.requestId, providerId: input.candidate.config.id, model: input.candidate.model, signal: input.signal, maxResponseBytes: input.maxBytes });
      response.retryCount = retries; response.latencyMs = Date.now() - input.started;
      await recordAiExecutionHealth(input.candidate.config.id, true, Date.now() - attemptStarted);
      return response;
    } catch (error) {
      let normalized = normalizeProviderError(error);
      if (input.timedOut()) normalized = new AiError("REQUEST_TIMEOUT");
      else if (input.signal.aborted && ["CONNECTION_FAILED", "REQUEST_CANCELLED"].includes(normalized.category)) normalized = new AiError("REQUEST_CANCELLED");
      if (!isRetryEligible(normalized) || retries - input.startingRetries >= input.candidate.config.retryCount || input.signal.aborted) {
        await recordAiExecutionHealth(input.candidate.config.id, false, Date.now() - attemptStarted, normalized);
        throw Object.assign(normalized, { retryCount: retries });
      }
      const delay = normalized.retryAfterMs ?? retryDelayMs(retries - input.startingRetries, input.candidate.config.initialRetryDelayMs, input.candidate.config.maximumRetryDelayMs, input.candidate.config.retryBackoffMultiplier);
      retries += 1; await setAiAuditStatus(input.requestId, "RETRIED"); await abortableDelay(delay, input.signal);
    }
  }
}

export class AiRequestCoordinator {
  async complete<T = unknown>(raw: AiRequest<T>, userId?: string): Promise<AiResponse<T>> {
    const request = normalizedRequest(raw); const selected = await selection(request);
    const requestId = crypto.randomUUID(); const maxBytes = Math.min(request.maxResponseBytes || selected.global.maximumServerResponseBytes, selected.global.maximumServerResponseBytes);
    const maximumTimeout = Number(process.env.AI_MAX_REQUEST_TIMEOUT_MS || 120_000); const timeoutMs = Math.min(request.timeoutMs || selected.primary.config.requestTimeoutMs || selected.global.defaultTimeoutMs, maximumTimeout);
    const timed = createAiRequestSignal(request.signal, timeoutMs); const started = Date.now(); let retries = 0;
    await createAiAudit({ requestId, correlationId: request.correlationId, featureKey: request.featureKey, providerConfigId: selected.primary.config.id, providerType: selected.primary.config.providerType, providerDisplayName: selected.primary.config.displayName, model: selected.primary.model, streaming: false, userId, metadata: request.metadata, promptHash: oneWayPromptHash([request.systemInstructions || "", ...request.messages.map((message) => message.content)]) });
    try {
      let response: AiResponse<T>;
      try {
        response = await executeWithRetries({ request, candidate: selected.primary, requestId, signal: timed.signal, maxBytes, started, startingRetries: 0, timedOut: timed.timedOut });
      } catch (error) {
        const normalized = normalizeProviderError(error); retries = Number((error as any)?.retryCount || 0);
        if (!selected.fallback || !fallbackCategories.has(normalized.category) || timed.signal.aborted) throw error;
        await prisma.aiRequestAudit.update({ where: { requestId }, data: { providerConfigId: selected.fallback.config.id, providerType: selected.fallback.config.providerType, providerDisplayName: selected.fallback.config.displayName, model: selected.fallback.model, status: "RETRIED" } });
        response = await executeWithRetries({ request, candidate: selected.fallback, requestId, signal: timed.signal, maxBytes, started, startingRetries: retries + 1, timedOut: timed.timedOut });
        response.warnings.push(`Explicit fallback used after ${selected.primary.config.displayName} was unavailable.`);
      }
      retries = response.retryCount;
      if (request.responseFormat) response.data = parseStructuredResponse(response.content || "", request.responseFormat, maxBytes);
      const bytes = Buffer.byteLength(response.content || "", "utf8"); if (bytes > maxBytes) throw new AiError("RESPONSE_TOO_LARGE");
      await completeAiAudit(requestId, response, bytes); return response;
    } catch (error) {
      let normalized = normalizeProviderError(error); if (timed.timedOut()) normalized = new AiError("REQUEST_TIMEOUT"); retries = Number((error as any)?.retryCount || retries);
      await failAiAudit(requestId, { category: normalized.category, retryCount: retries, latencyMs: Date.now() - started, cancelled: normalized.category === "REQUEST_CANCELLED", timedOut: normalized.category === "REQUEST_TIMEOUT" }).catch(() => null);
      throw normalized;
    } finally { timed.close(); }
  }

  async *stream<T = unknown>(raw: AiRequest<T>, userId?: string): AsyncIterable<AiStreamEvent> {
    const request = normalizedRequest({ ...raw, stream: true }); const selected = await selection(request);
    if (!selected.primary.adapter.stream || selected.primary.streamFallback) {
      if (!request.allowStreamingFallback) throw new AiError("CAPABILITY_UNAVAILABLE");
      const response = await this.complete({ ...request, stream: false }, userId); yield { type: "started", requestId: response.requestId };
      if (response.content) yield request.responseFormat ? { type: "structured_delta", delta: response.content } : { type: "text_delta", delta: response.content };
      yield { type: "completed", finishReason: response.finishReason }; return;
    }
    await enforceBudget(selected.primary.config); const requestId = crypto.randomUUID(); const maxBytes = Math.min(request.maxResponseBytes || selected.global.maximumServerResponseBytes, selected.global.maximumServerResponseBytes);
    const duration = Math.min(Number(process.env.AI_MAX_STREAM_DURATION_MS || 300_000), Number(process.env.AI_MAX_REQUEST_TIMEOUT_MS || 300_000)); const timed = createAiRequestSignal(request.signal, duration); const started = Date.now(); let bytes = 0; let usage: any;
    await createAiAudit({ requestId, correlationId: request.correlationId, featureKey: request.featureKey, providerConfigId: selected.primary.config.id, providerType: selected.primary.config.providerType, providerDisplayName: selected.primary.config.displayName, model: selected.primary.model, streaming: true, userId, metadata: request.metadata, promptHash: oneWayPromptHash([request.systemInstructions || "", ...request.messages.map((message) => message.content)]) }); await setAiAuditStatus(requestId, "STREAMING");
    try {
      const iterator = selected.primary.adapter.stream(request, selected.primary.config, { requestId, providerId: selected.primary.config.id, model: selected.primary.model, signal: timed.signal, maxResponseBytes: maxBytes })[Symbol.asyncIterator]();
      const idleTimeoutMs = Math.min(Number(process.env.AI_STREAM_IDLE_TIMEOUT_MS || 30_000), selected.primary.config.requestTimeoutMs);
      while (true) {
        const next = await nextStreamEvent(iterator, idleTimeoutMs, timed.abort); if (next.done) break; const event = next.value;
        if (event.type === "text_delta" || event.type === "structured_delta") { bytes += Buffer.byteLength(event.delta, "utf8"); if (bytes > maxBytes) throw new AiError("RESPONSE_TOO_LARGE"); }
        if (event.type === "usage") usage = event.usage; yield event;
      }
      const response: AiResponse = { requestId, providerId: selected.primary.config.id, providerType: selected.primary.config.providerType, model: selected.primary.model, usage, latencyMs: Date.now() - started, retryCount: 0, streaming: true, warnings: [] };
      await recordAiExecutionHealth(selected.primary.config.id, true, response.latencyMs); await completeAiAudit(requestId, response, bytes);
    } catch (error) {
      let normalized = normalizeProviderError(error);
      if (timed.timedOut()) normalized = new AiError("REQUEST_TIMEOUT");
      else if (timed.signal.aborted && ["CONNECTION_FAILED", "REQUEST_CANCELLED"].includes(normalized.category)) normalized = new AiError("REQUEST_CANCELLED");
      await recordAiExecutionHealth(selected.primary.config.id, false, Date.now() - started, normalized); await failAiAudit(requestId, { category: normalized.category, retryCount: 0, latencyMs: Date.now() - started, cancelled: normalized.category === "REQUEST_CANCELLED", timedOut: normalized.category === "REQUEST_TIMEOUT" }).catch(() => null);
      yield normalized.category === "REQUEST_CANCELLED" ? { type: "cancelled" } : { type: "failed", code: normalized.category, message: normalized.toSafePayload().message };
    } finally { timed.close(); }
  }
}

export const aiRequestCoordinator = new AiRequestCoordinator();
