import type { AiCapabilityResult, AiConnectionTestResult, AiModel, AiProviderAdapter, AiProviderExecutionContext, AiProviderTestProfile, AiRequest, AiResponse, AiStreamEvent, ResolvedAiProviderConfig } from "../contracts";
import { AiError, normalizeProviderError } from "../errors";
import { configuredHeaders, joinUrl, parseTextLines, providerFetch, safeFetchJsonDetailed } from "./http";
import { normalizeAIResponse } from "./normalizeResponse";

const OLLAMA_TEST_SYSTEM_PROMPT = "You are performing an Ollama provider inference test. Return only valid JSON.";
const OLLAMA_TEST_USER_PROMPT = 'Return exactly this JSON object: {"ok":true}';

function ollamaError(error: unknown, input: { stage: "DISCOVERY" | "INFERENCE"; model?: string }) {
  const normalized = error instanceof AiError ? error : normalizeProviderError(error);
  const details = normalized.details || {};
  const httpStatus = Number(details.http_status || 0);
  if (input.stage === "INFERENCE" && input.model && httpStatus === 404) {
    return new AiError("MODEL_NOT_AVAILABLE", undefined, 404, undefined, {
      ...details,
      model: input.model,
      failure_stage: "MODEL_VALIDATION",
      sanitized_provider_message: `Ollama is reachable, but model "${input.model}" is not installed.`,
    });
  }
  if (input.stage === "DISCOVERY" && (httpStatus === 404 || ["AI_PROVIDER_MALFORMED_JSON", "AI_PROVIDER_INVALID_RESPONSE"].includes(normalized.category))) {
    return new AiError("PROVIDER_ENDPOINT_INVALID", undefined, 400, undefined, {
      ...details,
      failure_stage: "OLLAMA_ENDPOINT_VALIDATION",
      sanitized_provider_message: "The server responded, but it is not a compatible Ollama API endpoint.",
    });
  }
  return normalized;
}

export class OllamaAdapter implements AiProviderAdapter {
  readonly providerType = "ollama" as const;
  readonly available = true;
  private base(config: ResolvedAiProviderConfig) { return config.baseUrl || "http://localhost:11434"; }
  private capabilities(config?: ResolvedAiProviderConfig): AiCapabilityResult { return { text_generation: "CONFIRMED", chat_messages: "CONFIRMED", system_instructions: "CONFIRMED", structured_json: "REPORTED", json_schema: "UNKNOWN", streaming: "CONFIRMED", request_cancellation: "CONFIRMED", model_discovery: "CONFIRMED", token_usage: "REPORTED", cost_reporting: "UNSUPPORTED", reasoning_models: "UNKNOWN", large_context: "UNKNOWN", custom_headers: "CONFIRMED", local_operation: "ASSUMED", remote_operation: "CONFIRMED", health_testing: "CONFIRMED", ...(config?.capabilityOverrides || {}) }; }
  async discoverModels(config: ResolvedAiProviderConfig, signal?: AbortSignal): Promise<AiModel[]> {
    try {
      const result = await safeFetchJsonDetailed(joinUrl(this.base(config), "/api/tags"), { headers: configuredHeaders(config), signal }, 2_000_000, { provider: config.displayName, stage: "MODEL_DISCOVERY", sslVerification: config.sslVerification });
      if (!result.payload || typeof result.payload !== "object" || !Array.isArray(result.payload.models)) throw new AiError("PROVIDER_RESPONSE_INVALID", undefined, 502, undefined, { failure_stage: "OLLAMA_MODEL_LIST", http_status: result.transport.httpStatus, sanitized_provider_message: "Ollama responded without a valid models list." });
      return result.payload.models.map((item: any) => ({ id: String(item.name || item.model), displayName: String(item.name || item.model), contextSize: Number(item.details?.context_length) || undefined, category: "LOCAL", capabilities: this.capabilities(config), available: true })).filter((item: AiModel) => item.id);
    } catch (error) { throw ollamaError(error, { stage: "DISCOVERY" }); }
  }
  async detectCapabilities(config: ResolvedAiProviderConfig) { return this.capabilities(config); }
  async testConnection(config: ResolvedAiProviderConfig, signal?: AbortSignal, model?: string, _profile?: AiProviderTestProfile): Promise<AiConnectionTestResult> {
    const started = Date.now();
    const models = await this.discoverModels(config, signal);
    const selected = model || config.defaultModel;
    if (!selected) return { connected: true, message: models.length ? "Ollama is reachable. Select a model to test chat completion." : "Ollama is reachable, but no models are installed.", latencyMs: Date.now() - started, detectedApiType: "ollama", capabilities: this.capabilities(config), availableModelCount: models.length, defaultModelAvailable: null, testedAt: new Date().toISOString(), authenticationResult: "SUCCEEDED", discoveryResult: "SUCCEEDED", inferenceResult: "NOT_TESTED" };
    if (!models.some((item) => item.id === selected)) throw ollamaError(new AiError("MODEL_NOT_AVAILABLE", undefined, 404, undefined, { model: selected, sanitized_provider_message: `Ollama is reachable, but model "${selected}" is not installed.` }), { stage: "INFERENCE", model: selected });
    const response = await this.complete({ featureKey: "administrative_connection_test", systemInstructions: OLLAMA_TEST_SYSTEM_PROMPT, messages: [{ role: "user", content: OLLAMA_TEST_USER_PROMPT }], requestSource: "CONNECTION_TEST" }, config, { requestId: crypto.randomUUID(), providerId: config.id, model: selected, signal: signal || new AbortController().signal, maxResponseBytes: 16_384 });
    let parsed: unknown;
    try { parsed = JSON.parse(String(response.content || "")); } catch { throw new AiError("AI_PROVIDER_INVALID_STRUCTURED_RESPONSE", undefined, 422, undefined, { failure_stage: "JSON_PARSE", model: selected }); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed as any).ok !== true) throw new AiError("AI_PROVIDER_INVALID_STRUCTURED_RESPONSE", undefined, 422, undefined, { failure_stage: "SCHEMA_VALIDATION", model: selected });
    return { connected: true, message: "Ollama connection, discovery, and chat completion succeeded.", latencyMs: Date.now() - started, detectedApiType: "ollama", capabilities: this.capabilities(config), availableModelCount: models.length, defaultModelAvailable: config.defaultModel ? models.some((item) => item.id === config.defaultModel) : null, testedAt: new Date().toISOString(), model: selected, modelReturned: response.model, endpointMode: "OLLAMA_CHAT", authenticationResult: "SUCCEEDED", discoveryResult: "SUCCEEDED", inferenceResult: "SUCCEEDED", usage: response.usage };
  }
  async complete<T>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): Promise<AiResponse<T>> {
    const started = Date.now();
    const messages = [...(request.systemInstructions ? [{ role: "system", content: request.systemInstructions }] : []), ...request.messages];
    let result;
    try { result = await safeFetchJsonDetailed(joinUrl(this.base(config), "/api/chat"), { method: "POST", headers: configuredHeaders(config), signal: context.signal, body: JSON.stringify({ model: context.model, messages, stream: false, format: request.responseFormat || request.requestSource === "CONNECTION_TEST" ? "json" : undefined, options: request.temperature == null ? undefined : { temperature: request.temperature } }) }, context.maxResponseBytes, { requestId: context.requestId, provider: config.displayName, model: context.model, stage: "CHAT_COMPLETION", lifecycle: context.lifecycle, sslVerification: config.sslVerification }); }
    catch (error) { throw ollamaError(error, { stage: "INFERENCE", model: context.model }); }
    const payload = { ...result.payload, usage: { input_tokens: result.payload?.prompt_eval_count, output_tokens: result.payload?.eval_count } };
    const normalized = normalizeAIResponse(payload, { providerType: "ollama", provider: config.displayName, requestedModel: context.model, requestId: context.requestId, transport: result.transport, allowDirectStructuredObject: !!request.responseFormat });
    context.lifecycle?.responseActivity({ meaningful: true, producedOutput: normalized.text.length > 0 });
    return { requestId: context.requestId, providerId: config.id, providerType: "ollama", model: normalized.model || context.model, content: normalized.text, usage: normalized.usage, latencyMs: Date.now() - started, retryCount: 0, streaming: false, finishReason: normalized.finishReason, warnings: ["Local provider - API cost not tracked"], transport: result.transport };
  }
  async *stream<T>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): AsyncIterable<AiStreamEvent> {
    const messages = [...(request.systemInstructions ? [{ role: "system", content: request.systemInstructions }] : []), ...request.messages];
    let response: Response;
    try { response = await providerFetch(joinUrl(this.base(config), "/api/chat"), { method: "POST", headers: configuredHeaders(config), signal: context.signal, body: JSON.stringify({ model: context.model, messages, stream: true, format: request.responseFormat ? "json" : undefined, options: request.temperature == null ? undefined : { temperature: request.temperature } }) }, context.lifecycle, config.sslVerification); }
    catch (error) { throw normalizeProviderError(error); }
    if (!response.ok) throw normalizeProviderError(new Error(`Provider returned HTTP ${response.status}.`), response.status);
    yield { type: "started", requestId: context.requestId };
    for await (const line of parseTextLines(response, context.maxResponseBytes, context.signal, context.lifecycle)) {
      if (!line.trim()) continue;
      let event: any; try { event = JSON.parse(line); } catch { throw new AiError("INVALID_RESPONSE"); }
      const delta = event?.message?.content;
      context.lifecycle?.responseActivity({ meaningful: !!delta || event.done === true, producedOutput: !!delta });
      if (typeof delta === "string" && delta) yield request.responseFormat ? { type: "structured_delta", delta } : { type: "text_delta", delta };
      if (event.done) { yield { type: "usage", usage: { inputTokens: event.prompt_eval_count, outputTokens: event.eval_count, totalTokens: Number(event.prompt_eval_count || 0) + Number(event.eval_count || 0) } }; yield { type: "completed", finishReason: event.done_reason }; return; }
    }
  }
}
