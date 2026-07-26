import type { AiCapabilityResult, AiConnectionTestResult, AiModel, AiProviderAdapter, AiProviderExecutionContext, AiProviderType, AiRequest, AiResponse, AiStreamEvent, ResolvedAiProviderConfig } from "../contracts";
import { AiError, normalizeProviderError } from "../errors";
import { configuredHeaders, joinUrl, openAiMessages, parseTextLines, safeFetchJson, safeFetchJsonDetailed } from "./http";
import { normalizeAIResponse, normalizeAIUsage } from "./normalizeResponse";
import { resolveModelCapabilities } from "../registry/modelCapabilities";

const defaults: Record<string, string> = {
  openai: "https://api.openai.com/v1", deepseek: "https://api.deepseek.com", openrouter: "https://openrouter.ai/api/v1", litellm: "http://localhost:4000/v1", lm_studio: "http://localhost:1234/v1"
};

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
      return { id, displayName: String(item.name || id), contextSize: Number(item.context_length || item.context_window || item.max_model_len) || undefined, category: classify(id, config), capabilities: this.knownCapabilities(), available: true };
    }).filter((item: AiModel) => item.id);
  }
  knownCapabilities(): AiCapabilityResult {
    const base: AiCapabilityResult = { text_generation: "ASSUMED", chat_messages: "ASSUMED", system_instructions: "ASSUMED", streaming: "ASSUMED", request_cancellation: "CONFIRMED", model_discovery: "ASSUMED", token_usage: "ASSUMED", remote_operation: "ASSUMED", health_testing: "CONFIRMED" };
    if (["openai", "deepseek", "openrouter", "litellm"].includes(this.providerType)) base.structured_json = "REPORTED";
    if (this.providerType === "openai") base.json_schema = "REPORTED";
    if (this.providerType === "openrouter") base.cost_reporting = "REPORTED";
    if (this.providerType === "lm_studio") { base.local_operation = "ASSUMED"; base.remote_operation = "UNKNOWN"; }
    return base;
  }
  async detectCapabilities(config: ResolvedAiProviderConfig): Promise<AiCapabilityResult> { return { ...this.knownCapabilities(), ...config.capabilityOverrides }; }
  async testConnection(config: ResolvedAiProviderConfig, signal?: AbortSignal): Promise<AiConnectionTestResult> {
    const started = Date.now();
    const models = await this.discoverModels(config, signal);
    if (config.defaultModel) await this.complete({ featureKey: "connection_test", messages: [{ role: "user", content: "Reply with OK." }], maxOutputTokens: 8 }, config, { requestId: crypto.randomUUID(), providerId: config.id, model: config.defaultModel, signal: signal || new AbortController().signal, maxResponseBytes: 16_384 });
    return { connected: true, message: config.defaultModel ? "Connection and chat completion succeeded." : "Connection succeeded. Select a model to test chat completion.", latencyMs: Date.now() - started, detectedApiType: "openai-compatible", capabilities: await this.detectCapabilities(config), availableModelCount: models.length, defaultModelAvailable: config.defaultModel ? models.some((model) => model.id === config.defaultModel) : null, testedAt: new Date().toISOString() };
  }
  async complete<T>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): Promise<AiResponse<T>> {
    const started = Date.now();
    const endpoint = typeof config.customConfiguration.chatCompletionEndpoint === "string" ? config.customConfiguration.chatCompletionEndpoint : "/chat/completions";
    const modelCapabilities = context.modelCapabilities || request.resolvedModelCapabilities || resolveModelCapabilities(this.providerType, context.model);
    const outputLimit = request.maxOutputTokens;
    const result = await safeFetchJsonDetailed(joinUrl(this.base(config), endpoint), { method: "POST", headers: this.headers(config), signal: context.signal, body: JSON.stringify({ model: context.model, messages: openAiMessages(request.messages, request.systemInstructions), temperature: request.temperature, ...(modelCapabilities.outputTokenParameter === "max_completion_tokens" ? { max_completion_tokens: outputLimit } : { max_tokens: outputLimit }), response_format: request.responseFormat && modelCapabilities.supportsJsonMode ? { type: "json_object" } : undefined, stream: false }) }, context.maxResponseBytes, { requestId: context.requestId, provider: config.displayName, model: context.model, stage: "CHAT_COMPLETION" });
    const payload = result.payload;
    const normalized = normalizeAIResponse(payload, {
      providerType: this.providerType,
      provider: config.displayName,
      requestedModel: context.model,
      requestId: context.requestId,
      transport: result.transport,
      allowDirectStructuredObject: !!request.responseFormat,
    });
    const cost = Number(payload?.usage?.cost ?? payload?.cost);
    return { requestId: context.requestId, providerId: config.id, providerType: this.providerType, model: normalized.model || context.model, content: normalized.text, usage: normalized.usage, actualCost: Number.isFinite(cost) && cost >= 0 ? cost : undefined, finishReason: normalized.finishReason, latencyMs: Date.now() - started, retryCount: 0, streaming: false, warnings: [], transport: result.transport };
  }
  async *stream<T>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): AsyncIterable<AiStreamEvent> {
    const endpoint = typeof config.customConfiguration.chatCompletionEndpoint === "string" ? config.customConfiguration.chatCompletionEndpoint : "/chat/completions";
    let response: Response;
    const modelCapabilities = context.modelCapabilities || request.resolvedModelCapabilities || resolveModelCapabilities(this.providerType, context.model);
    try { response = await fetch(joinUrl(this.base(config), endpoint), { method: "POST", headers: this.headers(config), signal: context.signal, body: JSON.stringify({ model: context.model, messages: openAiMessages(request.messages, request.systemInstructions), temperature: request.temperature, ...(modelCapabilities.outputTokenParameter === "max_completion_tokens" ? { max_completion_tokens: request.maxOutputTokens } : { max_tokens: request.maxOutputTokens }), response_format: request.responseFormat && modelCapabilities.supportsJsonMode ? { type: "json_object" } : undefined, stream: true, stream_options: { include_usage: true } }) }); }
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
