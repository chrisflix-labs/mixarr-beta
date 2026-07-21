import type { AiCapabilityResult, AiConnectionTestResult, AiModel, AiProviderAdapter, AiProviderExecutionContext, AiRequest, AiResponse, AiStreamEvent, ResolvedAiProviderConfig } from "../contracts";
import { AiError, normalizeProviderError } from "../errors";
import { configuredHeaders, joinUrl, parseTextLines, safeFetchJson } from "./http";

export class OllamaAdapter implements AiProviderAdapter {
  readonly providerType = "ollama" as const;
  readonly available = true;
  private base(config: ResolvedAiProviderConfig) { return config.baseUrl || "http://localhost:11434"; }
  private capabilities(config?: ResolvedAiProviderConfig): AiCapabilityResult { return { text_generation: "CONFIRMED", chat_messages: "CONFIRMED", system_instructions: "CONFIRMED", structured_json: "REPORTED", json_schema: "UNKNOWN", streaming: "CONFIRMED", request_cancellation: "CONFIRMED", model_discovery: "CONFIRMED", token_usage: "REPORTED", cost_reporting: "UNSUPPORTED", reasoning_models: "UNKNOWN", large_context: "UNKNOWN", custom_headers: "CONFIRMED", local_operation: "ASSUMED", remote_operation: "CONFIRMED", health_testing: "CONFIRMED", ...(config?.capabilityOverrides || {}) }; }
  async discoverModels(config: ResolvedAiProviderConfig, signal?: AbortSignal): Promise<AiModel[]> {
    const payload = await safeFetchJson(joinUrl(this.base(config), "/api/tags"), { headers: configuredHeaders(config), signal }, 2_000_000);
    return (Array.isArray(payload?.models) ? payload.models : []).map((item: any) => ({ id: String(item.name || item.model), displayName: String(item.name || item.model), contextSize: Number(item.details?.context_length) || undefined, category: "LOCAL", capabilities: this.capabilities(config), available: true }));
  }
  async detectCapabilities(config: ResolvedAiProviderConfig) { return this.capabilities(config); }
  async testConnection(config: ResolvedAiProviderConfig, signal?: AbortSignal): Promise<AiConnectionTestResult> {
    const started = Date.now();
    if (config.defaultModel) {
      await this.complete({ featureKey: "connection_test", messages: [{ role: "user", content: "Reply only with OK." }], maxOutputTokens: 8 }, config, { requestId: crypto.randomUUID(), providerId: config.id, model: config.defaultModel, signal: signal || new AbortController().signal, maxResponseBytes: 16_384 });
      return { connected: true, message: "Ollama connection and chat completion succeeded.", latencyMs: Date.now() - started, detectedApiType: "ollama", capabilities: this.capabilities(config), availableModelCount: 0, defaultModelAvailable: true, testedAt: new Date().toISOString() };
    }
    const models = await this.discoverModels(config, signal);
    return { connected: true, message: "Ollama is reachable. Select a model to test chat completion.", latencyMs: Date.now() - started, detectedApiType: "ollama", capabilities: this.capabilities(config), availableModelCount: models.length, defaultModelAvailable: null, testedAt: new Date().toISOString() };
  }
  async complete<T>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): Promise<AiResponse<T>> {
    const started = Date.now();
    const messages = [...(request.systemInstructions ? [{ role: "system", content: request.systemInstructions }] : []), ...request.messages];
    const payload = await safeFetchJson(joinUrl(this.base(config), "/api/chat"), { method: "POST", headers: configuredHeaders(config), signal: context.signal, body: JSON.stringify({ model: context.model, messages, stream: false, format: request.responseFormat ? "json" : undefined, options: { temperature: request.temperature, num_predict: request.maxOutputTokens, num_ctx: config.maximumContextTokens } }) }, context.maxResponseBytes);
    const content = payload?.message?.content;
    if (typeof content !== "string") throw new AiError("INVALID_RESPONSE");
    const inputTokens = Number(payload.prompt_eval_count) || undefined, outputTokens = Number(payload.eval_count) || undefined;
    return { requestId: context.requestId, providerId: config.id, providerType: "ollama", model: String(payload.model || context.model), content, usage: { inputTokens, outputTokens, totalTokens: inputTokens != null && outputTokens != null ? inputTokens + outputTokens : undefined }, latencyMs: Date.now() - started, retryCount: 0, streaming: false, finishReason: payload.done_reason, warnings: ["Local provider — API cost not tracked"] };
  }
  async *stream<T>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): AsyncIterable<AiStreamEvent> {
    const messages = [...(request.systemInstructions ? [{ role: "system", content: request.systemInstructions }] : []), ...request.messages];
    let response: Response;
    try { response = await fetch(joinUrl(this.base(config), "/api/chat"), { method: "POST", headers: configuredHeaders(config), signal: context.signal, body: JSON.stringify({ model: context.model, messages, stream: true, format: request.responseFormat ? "json" : undefined, options: { temperature: request.temperature, num_predict: request.maxOutputTokens } }) }); }
    catch (error) { throw normalizeProviderError(error); }
    if (!response.ok) throw normalizeProviderError(new Error(`Provider returned HTTP ${response.status}.`), response.status);
    yield { type: "started", requestId: context.requestId };
    for await (const line of parseTextLines(response, context.maxResponseBytes, context.signal)) {
      if (!line.trim()) continue;
      let event: any; try { event = JSON.parse(line); } catch { throw new AiError("INVALID_RESPONSE"); }
      const delta = event?.message?.content;
      if (typeof delta === "string" && delta) yield request.responseFormat ? { type: "structured_delta", delta } : { type: "text_delta", delta };
      if (event.done) { yield { type: "usage", usage: { inputTokens: event.prompt_eval_count, outputTokens: event.eval_count, totalTokens: Number(event.prompt_eval_count || 0) + Number(event.eval_count || 0) } }; yield { type: "completed", finishReason: event.done_reason }; return; }
    }
  }
}
