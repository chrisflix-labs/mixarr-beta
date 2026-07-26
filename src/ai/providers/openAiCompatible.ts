import { z } from "zod";
import type { AiCapabilityResult, AiConnectionTestResult, AiModel, AiProviderAdapter, AiProviderExecutionContext, AiProviderTestProfile, AiProviderType, AiRequest, AiResponse, AiStreamEvent, AiThinkingMode, ResolvedAiProviderConfig } from "../contracts";
import { AiError, normalizeProviderError } from "../errors";
import { configuredHeaders, joinUrl, openAiMessages, parseTextLines, safeFetchJson, safeFetchJsonDetailed } from "./http";
import { normalizeAIResponse, normalizeAIUsage } from "./normalizeResponse";
import { resolveModelCapabilities } from "../registry/modelCapabilities";
import { normalizedPositiveTokenLimit } from "../governance/outputTokenLimits";

const defaults: Record<string, string> = {
  openai: "https://api.openai.com/v1", deepseek: "https://api.deepseek.com", openrouter: "https://openrouter.ai/api/v1", litellm: "http://localhost:4000/v1", lm_studio: "http://localhost:1234/v1"
};
const PROVIDER_TEST_SYSTEM_PROMPT = "You are performing an AI provider connectivity test. Return only valid JSON and no additional text.";
const PROVIDER_TEST_USER_PROMPT = 'Return exactly this JSON object: {"ok":true}';
const providerTestFormat = { type: "json" as const, name: "mixarr_provider_test", schema: z.object({ ok: z.literal(true) }).strict(), allowEmbeddedJson: false };
const successfulFinishReasons = new Set(["stop", "completed", "complete", "end_turn", "end"]);

function configuredThinkingMode(config: ResolvedAiProviderConfig): AiThinkingMode {
  const value = config.customConfiguration.thinkingMode;
  return value === "disabled" || value === "enabled" || value === "provider_default" ? value : "provider_default";
}

function thinkingModeFor(request: AiRequest, config: ResolvedAiProviderConfig, supportsThinkingMode: boolean): AiThinkingMode {
  if (config.providerType !== "deepseek" || !supportsThinkingMode) return "provider_default";
  if (request.requestSource === "CONNECTION_TEST") return "disabled";
  if (request.responseFormat) return request.thinkingMode === "enabled" ? "enabled" : "disabled";
  return request.thinkingMode || configuredThinkingMode(config);
}

function providerDiagnostics(input: { config: ResolvedAiProviderConfig; model: string; request: AiRequest; transport?: AiResponse["transport"]; finishReason?: string; thinkingMode: AiThinkingMode; hasReasoningContent?: boolean; reasoningCharacterCount?: number; finalContentCharacterCount?: number; usage?: AiResponse["usage"]; requestedMaxTokens: number; effectiveMaxTokens: number; limitingSource: string; retryAttempt: number; elapsedMs: number }) {
  return {
    provider: input.config.displayName,
    model: input.model,
    endpointMode: "CHAT_COMPLETIONS",
    httpStatus: input.transport?.httpStatus,
    finishReason: input.finishReason,
    thinkingModeRequested: input.thinkingMode,
    hasReasoningContent: input.hasReasoningContent === true,
    reasoningCharacterCount: input.reasoningCharacterCount || 0,
    finalContentCharacterCount: input.finalContentCharacterCount || 0,
    promptTokens: input.usage?.inputTokens,
    completionTokens: input.usage?.outputTokens,
    reasoningTokens: input.usage?.reasoningTokens,
    requestedMaxTokens: input.requestedMaxTokens,
    effectiveMaxTokens: input.effectiveMaxTokens,
    outputTokenLimitingSource: input.limitingSource,
    retryAttempt: input.retryAttempt,
    providerRequestId: input.transport?.providerRequestId || input.usage?.providerRequestId,
    elapsedMs: input.elapsedMs,
  };
}

function classify(id: string, config: ResolvedAiProviderConfig): AiModel["category"] {
  if (/reason|o1|o3|r1/i.test(id)) return "REASONING";
  if (/mini|nano|flash|haiku|fast/i.test(id)) return "FAST";
  return config.locationClassification === "LOCAL" ? "LOCAL" : config.locationClassification === "REMOTE" ? "REMOTE" : "GENERAL";
}

export class OpenAiCompatibleAdapter implements AiProviderAdapter {
  readonly available = true;
  constructor(public readonly providerType: AiProviderType) {}
  private base(config: ResolvedAiProviderConfig) { return config.baseUrl || defaults[this.providerType] || ""; }
  private headers(config: ResolvedAiProviderConfig) {
    const extra: Record<string, string> = {};
    if (this.providerType === "openrouter") {
      const site = config.customConfiguration.applicationUrl;
      const title = config.customConfiguration.applicationName;
      if (typeof site === "string") extra["HTTP-Referer"] = site;
      if (typeof title === "string") extra["X-Title"] = title;
    }
    if (typeof config.customConfiguration.organization === "string") extra["OpenAI-Organization"] = config.customConfiguration.organization;
    return configuredHeaders(config, extra);
  }
  async discoverModels(config: ResolvedAiProviderConfig, signal?: AbortSignal): Promise<AiModel[]> {
    const endpoint = typeof config.customConfiguration.modelDiscoveryEndpoint === "string" ? config.customConfiguration.modelDiscoveryEndpoint : "/models";
    const payload = await safeFetchJson(joinUrl(this.base(config), endpoint), { headers: this.headers(config), signal }, 2_000_000);
    const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
    return data.map((item: any) => {
      const id = String(item.id || item.name || "");
      const resolved = resolveModelCapabilities(this.providerType, id);
      return { id, displayName: String(item.name || id), contextSize: Number(item.context_length || item.context_window || item.max_model_len) || undefined, category: classify(id, config), capabilities: { ...this.knownCapabilities(), ...(resolved.supportsReasoning ? { reasoning_models: "REPORTED" as const } : {}), ...(resolved.supportsThinkingMode ? { thinking_mode: "CONFIRMED" as const } : {}) }, available: true };
    }).filter((item: AiModel) => item.id);
  }
  knownCapabilities(): AiCapabilityResult {
    const base: AiCapabilityResult = { text_generation: "ASSUMED", chat_messages: "ASSUMED", system_instructions: "ASSUMED", streaming: "ASSUMED", request_cancellation: "CONFIRMED", model_discovery: "ASSUMED", token_usage: "ASSUMED", remote_operation: "ASSUMED", health_testing: "CONFIRMED" };
    if (["openai", "deepseek", "openrouter", "litellm"].includes(this.providerType)) base.structured_json = "REPORTED";
    if (this.providerType === "deepseek") { base.reasoning_models = "REPORTED"; base.thinking_mode = "CONFIRMED"; }
    if (this.providerType === "openai") base.json_schema = "REPORTED";
    if (this.providerType === "openrouter") base.cost_reporting = "REPORTED";
    if (this.providerType === "lm_studio") { base.local_operation = "ASSUMED"; base.remote_operation = "UNKNOWN"; }
    return base;
  }
  async detectCapabilities(config: ResolvedAiProviderConfig): Promise<AiCapabilityResult> { return { ...this.knownCapabilities(), ...config.capabilityOverrides }; }
  async testConnection(config: ResolvedAiProviderConfig, signal?: AbortSignal, model?: string, profile?: AiProviderTestProfile): Promise<AiConnectionTestResult> {
    const started = Date.now();
    const models = await this.discoverModels(config, signal);
    const selected = model || config.defaultModel;
    if (!selected) throw new AiError("MODEL_NOT_CONFIGURED");
    const testProfile = profile || { maxOutputTokens: 128, requestedMaxTokens: 128, effectiveMaxTokens: 128, outputTokenLimitingSource: "request", retryAttempt: 0, thinkingMode: "disabled" };
    const response = await this.complete({ featureKey: "administrative_connection_test", systemInstructions: PROVIDER_TEST_SYSTEM_PROMPT, messages: [{ role: "user", content: PROVIDER_TEST_USER_PROMPT }], responseFormat: providerTestFormat, maxOutputTokens: testProfile.maxOutputTokens, thinkingMode: "disabled", requestSource: "CONNECTION_TEST", outputTokenLimit: { requestedOutputTokens: testProfile.requestedMaxTokens, configuredGlobalLimit: null, configuredProviderLimit: null, configuredFeatureLimit: null, configuredUserLimit: null, modelOutputLimit: null, effectiveOutputTokens: testProfile.effectiveMaxTokens, limitingSource: testProfile.outputTokenLimitingSource, unlimited: false }, metadata: { retryAttempt: testProfile.retryAttempt } }, config, { requestId: crypto.randomUUID(), providerId: config.id, model: selected, signal: signal || new AbortController().signal, maxResponseBytes: 64_000 });
    const finish = String(response.finishReason || "").toLowerCase();
    if (!successfulFinishReasons.has(finish)) throw new AiError("AI_PROVIDER_INVALID_RESPONSE", undefined, 422, undefined, { http_status: response.transport?.httpStatus, finish_reason: response.finishReason, provider_request_id: response.transport?.providerRequestId || response.usage?.providerRequestId, failure_stage: "FINISH_REASON", requested_max_tokens: testProfile.requestedMaxTokens, effective_max_tokens: testProfile.effectiveMaxTokens, output_token_limiting_source: testProfile.outputTokenLimitingSource, retry_attempted: testProfile.retryAttempt > 0 });
    let parsed: unknown;
    try { parsed = JSON.parse(response.content || ""); }
    catch { throw new AiError("AI_PROVIDER_INVALID_STRUCTURED_RESPONSE", undefined, 422, undefined, { http_status: response.transport?.httpStatus, finish_reason: response.finishReason, provider_request_id: response.transport?.providerRequestId || response.usage?.providerRequestId, failure_stage: "JSON_PARSE", requested_max_tokens: testProfile.requestedMaxTokens, effective_max_tokens: testProfile.effectiveMaxTokens, output_token_limiting_source: testProfile.outputTokenLimitingSource, retry_attempted: testProfile.retryAttempt > 0 }); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed as any).ok !== true || Object.keys(parsed as object).length !== 1) throw new AiError("AI_PROVIDER_INVALID_STRUCTURED_RESPONSE", undefined, 422, undefined, { http_status: response.transport?.httpStatus, finish_reason: response.finishReason, provider_request_id: response.transport?.providerRequestId || response.usage?.providerRequestId, failure_stage: "SCHEMA_VALIDATION", requested_max_tokens: testProfile.requestedMaxTokens, effective_max_tokens: testProfile.effectiveMaxTokens, output_token_limiting_source: testProfile.outputTokenLimitingSource, retry_attempted: testProfile.retryAttempt > 0 });
    return { connected: true, message: "Connection and structured chat completion succeeded.", latencyMs: Date.now() - started, detectedApiType: "openai-compatible", capabilities: await this.detectCapabilities(config), availableModelCount: models.length, defaultModelAvailable: config.defaultModel ? models.some((item) => item.id === config.defaultModel) : null, testedAt: new Date().toISOString(), model: selected, modelReturned: response.model, endpointMode: "CHAT_COMPLETIONS", authenticationResult: "SUCCEEDED", discoveryResult: "SUCCEEDED", inferenceResult: "SUCCEEDED", providerRequestId: response.transport?.providerRequestId || response.usage?.providerRequestId, usage: response.usage, requestedMaxTokens: testProfile.requestedMaxTokens, effectiveMaxTokens: testProfile.effectiveMaxTokens, outputTokenLimitingSource: testProfile.outputTokenLimitingSource, thinkingModeRequested: response.thinkingModeRequested, hasReasoningContent: response.hasReasoningContent, reasoningCharacterCount: response.reasoningCharacterCount, finalContentCharacterCount: response.finalContentCharacterCount };
  }
  async complete<T>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): Promise<AiResponse<T>> {
    const started = Date.now();
    const endpoint = typeof config.customConfiguration.chatCompletionEndpoint === "string" ? config.customConfiguration.chatCompletionEndpoint : "/chat/completions";
    const modelCapabilities = context.modelCapabilities || request.resolvedModelCapabilities || resolveModelCapabilities(this.providerType, context.model);
    const outputLimit = normalizedPositiveTokenLimit(request.maxOutputTokens) ?? normalizedPositiveTokenLimit(modelCapabilities.defaultOutputTokens) ?? 256;
    const thinkingMode = thinkingModeFor(request, config, modelCapabilities.supportsThinkingMode);
    const jsonInstruction = request.responseFormat && !/\bjson\b/i.test(request.systemInstructions || "") ? "Return only valid JSON with no markdown or additional text." : undefined;
    const systemInstructions = [request.systemInstructions, jsonInstruction].filter(Boolean).join("\n");
    const retryAttempt = Number(request.metadata?.retryAttempt || 0);
    const body = { model: context.model, messages: openAiMessages(request.messages, systemInstructions || undefined), ...(thinkingMode === "enabled" ? {} : { temperature: request.temperature }), ...(modelCapabilities.outputTokenParameter === "max_completion_tokens" ? { max_completion_tokens: outputLimit } : { max_tokens: outputLimit }), response_format: request.responseFormat && modelCapabilities.supportsJsonMode ? { type: "json_object" } : undefined, ...(config.providerType === "deepseek" && modelCapabilities.supportsThinkingMode && thinkingMode !== "provider_default" ? { thinking: { type: thinkingMode } } : {}), ...(thinkingMode === "enabled" && request.reasoningEffort && modelCapabilities.supportsReasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}), stream: false };
    const result = await safeFetchJsonDetailed(joinUrl(this.base(config), endpoint), { method: "POST", headers: this.headers(config), signal: context.signal, body: JSON.stringify(body) }, context.maxResponseBytes, { requestId: context.requestId, provider: config.displayName, model: context.model, stage: "CHAT_COMPLETION" });
    const payload = result.payload;
    let normalized;
    try { normalized = normalizeAIResponse(payload, {
      providerType: this.providerType,
      provider: config.displayName,
      requestedModel: context.model,
      requestId: context.requestId,
      transport: result.transport,
      allowDirectStructuredObject: !!request.responseFormat,
    }); }
    catch (error) {
      const normalizedError = error instanceof AiError ? error : new AiError("AI_PROVIDER_INVALID_RESPONSE");
      normalizedError.details = { ...normalizedError.details, requested_max_tokens: request.outputTokenLimit?.requestedOutputTokens ?? outputLimit, effective_max_tokens: outputLimit, output_token_limiting_source: request.outputTokenLimit?.limitingSource || "request", thinking_mode_requested: thinkingMode, retry_attempt: retryAttempt, elapsed_ms: Date.now() - started, endpoint_mode: "CHAT_COMPLETIONS", provider_request_id: result.transport.providerRequestId || normalizedError.details?.provider_request_id };
      console.warn("[AI Provider Response]", providerDiagnostics({ config, model: context.model, request, transport: result.transport, finishReason: String(normalizedError.details.finish_reason || "") || undefined, thinkingMode, hasReasoningContent: normalizedError.details.has_reasoning_content === true, reasoningCharacterCount: Number(normalizedError.details.reasoning_character_count || 0), finalContentCharacterCount: Number(normalizedError.details.final_content_character_count || 0), usage: { inputTokens: normalizedError.details.usage_input_tokens as number | undefined, outputTokens: normalizedError.details.usage_output_tokens as number | undefined, reasoningTokens: normalizedError.details.usage_reasoning_tokens as number | undefined, providerRequestId: result.transport.providerRequestId }, requestedMaxTokens: Number(request.outputTokenLimit?.requestedOutputTokens || outputLimit), effectiveMaxTokens: outputLimit, limitingSource: request.outputTokenLimit?.limitingSource || "request", retryAttempt, elapsedMs: Date.now() - started }));
      throw normalizedError;
    }
    const cost = Number(payload?.usage?.cost ?? payload?.cost);
    if (normalized.usage && result.transport.providerRequestId) normalized.usage.providerRequestId = result.transport.providerRequestId;
    console.info("[AI Provider Response]", providerDiagnostics({ config, model: context.model, request, transport: result.transport, finishReason: normalized.finishReason, thinkingMode, hasReasoningContent: normalized.hasReasoningContent, reasoningCharacterCount: normalized.reasoningCharacterCount, finalContentCharacterCount: normalized.finalContentCharacterCount, usage: normalized.usage, requestedMaxTokens: Number(request.outputTokenLimit?.requestedOutputTokens || outputLimit), effectiveMaxTokens: outputLimit, limitingSource: request.outputTokenLimit?.limitingSource || "request", retryAttempt, elapsedMs: Date.now() - started }));
    return { requestId: context.requestId, providerId: config.id, providerType: this.providerType, model: normalized.model || context.model, content: normalized.text, usage: normalized.usage, actualCost: Number.isFinite(cost) && cost >= 0 ? cost : undefined, finishReason: normalized.finishReason, latencyMs: Date.now() - started, retryCount: 0, streaming: false, warnings: [], transport: result.transport, thinkingModeRequested: thinkingMode, hasReasoningContent: normalized.hasReasoningContent, reasoningCharacterCount: normalized.reasoningCharacterCount, finalContentCharacterCount: normalized.finalContentCharacterCount };
  }
  async *stream<T>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): AsyncIterable<AiStreamEvent> {
    const endpoint = typeof config.customConfiguration.chatCompletionEndpoint === "string" ? config.customConfiguration.chatCompletionEndpoint : "/chat/completions";
    let response: Response;
    const modelCapabilities = context.modelCapabilities || request.resolvedModelCapabilities || resolveModelCapabilities(this.providerType, context.model);
    const outputLimit = normalizedPositiveTokenLimit(request.maxOutputTokens) ?? normalizedPositiveTokenLimit(modelCapabilities.defaultOutputTokens) ?? 256;
    const thinkingMode = thinkingModeFor(request, config, modelCapabilities.supportsThinkingMode);
    const systemInstructions = [request.systemInstructions, request.responseFormat && !/\bjson\b/i.test(request.systemInstructions || "") ? "Return only valid JSON with no markdown or additional text." : undefined].filter(Boolean).join("\n");
    try { response = await fetch(joinUrl(this.base(config), endpoint), { method: "POST", headers: this.headers(config), signal: context.signal, body: JSON.stringify({ model: context.model, messages: openAiMessages(request.messages, systemInstructions || undefined), ...(thinkingMode === "enabled" ? {} : { temperature: request.temperature }), ...(modelCapabilities.outputTokenParameter === "max_completion_tokens" ? { max_completion_tokens: outputLimit } : { max_tokens: outputLimit }), response_format: request.responseFormat && modelCapabilities.supportsJsonMode ? { type: "json_object" } : undefined, ...(config.providerType === "deepseek" && modelCapabilities.supportsThinkingMode && thinkingMode !== "provider_default" ? { thinking: { type: thinkingMode } } : {}), ...(thinkingMode === "enabled" && request.reasoningEffort && modelCapabilities.supportsReasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}), stream: true, stream_options: { include_usage: true } }) }); }
    catch (error) { throw normalizeProviderError(error); }
    if (!response.ok) throw normalizeProviderError(new Error(`Provider returned HTTP ${response.status}.`), response.status);
    yield { type: "started", requestId: context.requestId };
    for await (const line of parseTextLines(response, context.maxResponseBytes, context.signal)) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") { yield { type: "completed" }; return; }
      let event: any; try { event = JSON.parse(raw); } catch { throw new AiError("INVALID_RESPONSE"); }
      const delta = event?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) yield request.responseFormat ? { type: "structured_delta", delta } : { type: "text_delta", delta };
      if (event?.usage) yield { type: "usage", usage: normalizeAIUsage(event) || {} };
      const finish = event?.choices?.[0]?.finish_reason;
      if (finish) yield { type: "completed", finishReason: finish };
    }
  }
}
