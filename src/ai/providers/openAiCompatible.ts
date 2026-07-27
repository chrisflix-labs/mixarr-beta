import { z } from "zod";
import type { AiCapabilityResult, AiConnectionTestResult, AiModel, AiModelCapabilities, AiProviderAdapter, AiProviderExecutionContext, AiProviderTestProfile, AiProviderType, AiRequest, AiResponse, AiStreamEvent, AiStructuredOutputMode, AiThinkingMode, ResolvedAiProviderConfig } from "../contracts";
import { AiError, normalizeProviderError } from "../errors";
import { configuredHeaders, joinUrl, openAiMessages, parseTextLines, providerFetch, safeFetchJson, safeFetchJsonDetailed } from "./http";
import { normalizeAIResponse, normalizeAIUsage } from "./normalizeResponse";
import { resolveModelCapabilities } from "../registry/modelCapabilities";
import { zodToJsonSchema } from "../validation/jsonSchema";

const defaults: Record<string, string> = {
  openai: "https://api.openai.com/v1", deepseek: "https://api.deepseek.com", openrouter: "https://openrouter.ai/api/v1", litellm: "http://localhost:4000/v1", lm_studio: "http://localhost:1234/v1"
};
const PROVIDER_TEST_SYSTEM_PROMPT = "You are performing an AI provider connectivity test. Return only valid JSON and no additional text.";
const PROVIDER_TEST_USER_PROMPT = 'Return exactly this JSON object: {"ok":true}';
const providerTestSchema = z.object({ ok: z.literal(true) }).strict();
const providerTestFormat = { type: "json" as const, name: "mixarr_provider_test", schema: providerTestSchema, jsonSchema: zodToJsonSchema(providerTestSchema), allowEmbeddedJson: false };
const successfulFinishReasons = new Set(["stop", "completed", "complete", "end_turn", "end"]);

function configuredThinkingMode(config: ResolvedAiProviderConfig): AiThinkingMode {
  const value = config.customConfiguration.thinkingMode;
  return value === "disabled" || value === "enabled" || value === "provider_default" ? value : "provider_default";
}

function thinkingModeFor(request: AiRequest, config: ResolvedAiProviderConfig, supportsThinkingMode: boolean): AiThinkingMode {
  if (config.providerType !== "deepseek") return "provider_default";
  if (request.requestSource === "CONNECTION_TEST") return "disabled";
  if (!supportsThinkingMode) return "provider_default";
  if (request.responseFormat) return "disabled";
  return request.thinkingMode || configuredThinkingMode(config);
}

function providerDiagnostics(input: { config: ResolvedAiProviderConfig; model: string; request: AiRequest; transport?: AiResponse["transport"]; finishReason?: string; thinkingMode: AiThinkingMode; structuredOutputMode?: AiStructuredOutputMode; hasReasoningContent?: boolean; finalContentCharacterCount?: number; usage?: AiResponse["usage"]; retryAttempt: number; elapsedMs: number }) {
  return {
    provider: input.config.displayName,
    model: input.model,
    endpointMode: "CHAT_COMPLETIONS",
    httpStatus: input.transport?.httpStatus,
    finishReason: input.finishReason,
    thinkingModeRequested: input.thinkingMode,
    hasReasoningContent: input.hasReasoningContent === true,
    finalContentCharacterCount: input.finalContentCharacterCount || 0,
    promptTokens: input.usage?.inputTokens,
    completionTokens: input.usage?.outputTokens,
    reasoningTokens: input.usage?.reasoningTokens,
    structuredOutputMode: input.structuredOutputMode,
    retryAttempt: input.retryAttempt,
    providerRequestId: input.transport?.providerRequestId || input.usage?.providerRequestId,
    elapsedMs: input.elapsedMs,
  };
}

function structuredOutputMode(request: AiRequest, capabilities: AiModelCapabilities): AiStructuredOutputMode | undefined {
  return request.responseFormat ? capabilities.structuredOutputMode : undefined;
}

function nativeResponseFormat(request: AiRequest, mode?: AiStructuredOutputMode) {
  if (!request.responseFormat || mode === "prompt_only_json") return undefined;
  if (mode === "json_object") return { type: "json_object" };
  return { type: "json_schema", json_schema: { name: request.responseFormat.name, strict: true, schema: request.responseFormat.jsonSchema || zodToJsonSchema(request.responseFormat.schema) } };
}

function structuredInstruction(request: AiRequest, mode?: AiStructuredOutputMode) {
  if (!request.responseFormat || mode === "strict_json_schema") return undefined;
  const schema = request.responseFormat.jsonSchema || zodToJsonSchema(request.responseFormat.schema);
  return `Return one JSON object named ${request.responseFormat.name} matching this schema: ${JSON.stringify(schema)}. Do not return Markdown, code fences, commentary, analysis, or alternative versions.`;
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
    const testProfile = profile || { retryAttempt: 0, thinkingMode: "disabled" };
    const response = await this.complete({ featureKey: "administrative_connection_test", systemInstructions: PROVIDER_TEST_SYSTEM_PROMPT, messages: [{ role: "user", content: PROVIDER_TEST_USER_PROMPT }], responseFormat: providerTestFormat, thinkingMode: "disabled", requestSource: "CONNECTION_TEST", metadata: { retryAttempt: testProfile.retryAttempt } }, config, { requestId: crypto.randomUUID(), providerId: config.id, model: selected, signal: signal || new AbortController().signal, maxResponseBytes: 64_000 });
    const finish = String(response.finishReason || "").toLowerCase();
    if (!successfulFinishReasons.has(finish)) throw new AiError("AI_PROVIDER_INVALID_RESPONSE", undefined, 422, undefined, { http_status: response.transport?.httpStatus, finish_reason: response.finishReason, provider_request_id: response.transport?.providerRequestId || response.usage?.providerRequestId, failure_stage: "FINISH_REASON", retry_attempted: testProfile.retryAttempt > 0 });
    let parsed: unknown;
    try { parsed = JSON.parse(response.content || ""); }
    catch { throw new AiError("AI_PROVIDER_INVALID_STRUCTURED_RESPONSE", undefined, 422, undefined, { http_status: response.transport?.httpStatus, finish_reason: response.finishReason, provider_request_id: response.transport?.providerRequestId || response.usage?.providerRequestId, failure_stage: "JSON_PARSE", retry_attempted: testProfile.retryAttempt > 0 }); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed as any).ok !== true || Object.keys(parsed as object).length !== 1) throw new AiError("AI_PROVIDER_INVALID_STRUCTURED_RESPONSE", undefined, 422, undefined, { http_status: response.transport?.httpStatus, finish_reason: response.finishReason, provider_request_id: response.transport?.providerRequestId || response.usage?.providerRequestId, failure_stage: "SCHEMA_VALIDATION", retry_attempted: testProfile.retryAttempt > 0 });
    return { connected: true, message: "Connection and structured chat completion succeeded.", latencyMs: Date.now() - started, detectedApiType: "openai-compatible", capabilities: await this.detectCapabilities(config), availableModelCount: models.length, defaultModelAvailable: config.defaultModel ? models.some((item) => item.id === config.defaultModel) : null, testedAt: new Date().toISOString(), model: selected, modelReturned: response.model, endpointMode: "CHAT_COMPLETIONS", authenticationResult: "SUCCEEDED", discoveryResult: "SUCCEEDED", inferenceResult: "SUCCEEDED", providerRequestId: response.transport?.providerRequestId || response.usage?.providerRequestId, usage: response.usage, thinkingModeRequested: response.thinkingModeRequested, hasReasoningContent: response.hasReasoningContent, reasoningCharacterCount: response.reasoningCharacterCount, finalContentCharacterCount: response.finalContentCharacterCount, structuredOutputMode: response.structuredOutputMode };
  }
  async complete<T>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): Promise<AiResponse<T>> {
    const started = Date.now();
    const endpoint = typeof config.customConfiguration.chatCompletionEndpoint === "string" ? config.customConfiguration.chatCompletionEndpoint : "/chat/completions";
    const modelCapabilities = context.modelCapabilities || request.resolvedModelCapabilities || resolveModelCapabilities(this.providerType, context.model);
    const thinkingMode = thinkingModeFor(request, config, modelCapabilities.supportsThinkingMode);
    const outputMode = structuredOutputMode(request, modelCapabilities);
    const systemInstructions = [request.systemInstructions, structuredInstruction(request, outputMode)].filter(Boolean).join("\n");
    const retryAttempt = Number(request.metadata?.retryAttempt || 0);
    const body = { model: context.model, messages: openAiMessages(request.messages, systemInstructions || undefined), ...(config.providerType === "deepseek" && request.responseFormat ? {} : request.temperature == null ? {} : { temperature: request.temperature }), response_format: nativeResponseFormat(request, outputMode), ...(config.providerType === "deepseek" && (modelCapabilities.supportsThinkingMode || request.requestSource === "CONNECTION_TEST") && thinkingMode !== "provider_default" ? { thinking: { type: thinkingMode } } : {}), ...(!request.responseFormat && thinkingMode === "enabled" && request.reasoningEffort && modelCapabilities.supportsReasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}), stream: false };
    const result = await safeFetchJsonDetailed(joinUrl(this.base(config), endpoint), { method: "POST", headers: this.headers(config), signal: context.signal, body: JSON.stringify(body) }, context.maxResponseBytes, { requestId: context.requestId, provider: config.displayName, model: context.model, stage: "CHAT_COMPLETION", lifecycle: context.lifecycle, sslVerification: config.sslVerification });
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
      normalizedError.details = { ...normalizedError.details, thinking_mode_requested: thinkingMode, structured_output_mode: outputMode, retry_attempt: retryAttempt, elapsed_ms: Date.now() - started, endpoint_mode: "CHAT_COMPLETIONS", provider_request_id: result.transport.providerRequestId || normalizedError.details?.provider_request_id };
      console.warn("[AI Provider Response]", providerDiagnostics({ config, model: context.model, request, transport: result.transport, finishReason: String(normalizedError.details.finish_reason || "") || undefined, thinkingMode, structuredOutputMode: outputMode, hasReasoningContent: normalizedError.details.has_reasoning_content === true, finalContentCharacterCount: Number(normalizedError.details.final_content_character_count || 0), usage: { inputTokens: normalizedError.details.usage_input_tokens as number | undefined, outputTokens: normalizedError.details.usage_output_tokens as number | undefined, reasoningTokens: normalizedError.details.usage_reasoning_tokens as number | undefined, providerRequestId: result.transport.providerRequestId }, retryAttempt, elapsedMs: Date.now() - started }));
      throw normalizedError;
    }
    const cost = Number(payload?.usage?.cost ?? payload?.cost);
    context.lifecycle?.responseActivity({ meaningful: true, producedOutput: normalized.text.length > 0 });
    if (normalized.usage && result.transport.providerRequestId) normalized.usage.providerRequestId = result.transport.providerRequestId;
    console.info("[AI Provider Response]", providerDiagnostics({ config, model: context.model, request, transport: result.transport, finishReason: normalized.finishReason, thinkingMode, structuredOutputMode: outputMode, hasReasoningContent: normalized.hasReasoningContent, finalContentCharacterCount: normalized.finalContentCharacterCount, usage: normalized.usage, retryAttempt, elapsedMs: Date.now() - started }));
    return { requestId: context.requestId, providerId: config.id, providerType: this.providerType, model: normalized.model || context.model, content: normalized.text, usage: normalized.usage, actualCost: Number.isFinite(cost) && cost >= 0 ? cost : undefined, finishReason: normalized.finishReason, latencyMs: Date.now() - started, retryCount: 0, streaming: false, warnings: [], transport: result.transport, thinkingModeRequested: thinkingMode, hasReasoningContent: normalized.hasReasoningContent, reasoningCharacterCount: normalized.reasoningCharacterCount, finalContentCharacterCount: normalized.finalContentCharacterCount, structuredOutputMode: outputMode };
  }
  async *stream<T>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): AsyncIterable<AiStreamEvent> {
    const endpoint = typeof config.customConfiguration.chatCompletionEndpoint === "string" ? config.customConfiguration.chatCompletionEndpoint : "/chat/completions";
    let response: Response;
    const modelCapabilities = context.modelCapabilities || request.resolvedModelCapabilities || resolveModelCapabilities(this.providerType, context.model);
    const thinkingMode = thinkingModeFor(request, config, modelCapabilities.supportsThinkingMode);
    const outputMode = structuredOutputMode(request, modelCapabilities);
    const systemInstructions = [request.systemInstructions, structuredInstruction(request, outputMode)].filter(Boolean).join("\n");
    try { response = await providerFetch(joinUrl(this.base(config), endpoint), { method: "POST", headers: this.headers(config), signal: context.signal, body: JSON.stringify({ model: context.model, messages: openAiMessages(request.messages, systemInstructions || undefined), ...(config.providerType === "deepseek" && request.responseFormat ? {} : request.temperature == null ? {} : { temperature: request.temperature }), response_format: nativeResponseFormat(request, outputMode), ...(config.providerType === "deepseek" && modelCapabilities.supportsThinkingMode && thinkingMode !== "provider_default" ? { thinking: { type: thinkingMode } } : {}), ...(!request.responseFormat && thinkingMode === "enabled" && request.reasoningEffort && modelCapabilities.supportsReasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}), stream: true, stream_options: { include_usage: true } }) }, context.lifecycle, config.sslVerification); }
    catch (error) { throw normalizeProviderError(error); }
    if (!response.ok) throw normalizeProviderError(new Error(`Provider returned HTTP ${response.status}.`), response.status);
    yield { type: "started", requestId: context.requestId };
    for await (const line of parseTextLines(response, context.maxResponseBytes, context.signal, context.lifecycle)) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") { yield { type: "completed" }; return; }
      let event: any; try { event = JSON.parse(raw); } catch { throw new AiError("INVALID_RESPONSE"); }
      const delta = event?.choices?.[0]?.delta?.content;
      context.lifecycle?.responseActivity({ meaningful: typeof delta === "string" && delta.length > 0, producedOutput: typeof delta === "string" && delta.length > 0 });
      if (typeof delta === "string" && delta) yield request.responseFormat ? { type: "structured_delta", delta } : { type: "text_delta", delta };
      if (event?.usage) yield { type: "usage", usage: normalizeAIUsage(event) || {} };
      const finish = event?.choices?.[0]?.finish_reason;
      if (finish) yield { type: "completed", finishReason: finish };
    }
  }
}
