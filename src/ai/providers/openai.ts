import { sanitizeErrorText } from "../../lib/supportRedaction";
import type { AiCapabilityResult, AiConnectionTestResult, AiModel, AiModelCompatibility, AiProviderAdapter, AiProviderExecutionContext, AiRequest, AiResponse, ResolvedAiProviderConfig } from "../contracts";
import { AiError } from "../errors";
import { configuredHeaders } from "./http";
import { normalizeAIResponse } from "./normalizeResponse";

const DEFAULT_OPENAI_API_ROOT = "https://api.openai.com/v1";
const ADMIN_TEST_PROMPT = "Reply with exactly: MIXARR_OK";
const incompatibleName = /(embedding|embed-|moderation|omni-moderation|image|dall-e|sora|video|audio|realtime|transcrib|whisper|tts|speech|diariz|search-preview|computer-use|fine-tun|babbage|davinci)/i;
const generativeName = /^(gpt-|chatgpt-|o[1-9](?:-|$)|ft:gpt-|ft:o[1-9])/i;

type OpenAiHttpResult = { payload: any; httpStatus: number; providerRequestId?: string };

export function normalizeOpenAiBaseUrl(value?: string) {
  const source = (value || DEFAULT_OPENAI_API_ROOT).trim();
  let url: URL;
  try { url = new URL(source); } catch { throw new AiError("PROVIDER_ENDPOINT_INVALID"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new AiError("PROVIDER_ENDPOINT_INVALID");
  if (/platform\.openai\.com|chatgpt\.com|chat\.openai\.com/i.test(url.hostname)) throw new AiError("PROVIDER_ENDPOINT_INVALID");
  let path = url.pathname.replace(/\/+$/, "");
  if (!path || path === "/") path = "/v1";
  if (/\/(responses|models|chat\/completions|completions)$/i.test(path)) throw new AiError("PROVIDER_ENDPOINT_INVALID");
  path = path.replace(/(?:\/v1)+$/i, "/v1");
  url.pathname = path;
  return url.toString().replace(/\/$/, "");
}

function endpoint(config: ResolvedAiProviderConfig, resource: "models" | "responses") {
  return `${normalizeOpenAiBaseUrl(config.baseUrl)}/${resource}`;
}

function headers(config: ResolvedAiProviderConfig) {
  if (!config.apiKey || /^(\*+|configured|stored)$/i.test(config.apiKey.trim())) throw new AiError("PROVIDER_SECRET_UNAVAILABLE");
  const extra: Record<string, string> = {};
  if (typeof config.customConfiguration.organization === "string") extra["OpenAI-Organization"] = config.customConfiguration.organization;
  if (typeof config.customConfiguration.project === "string") extra["OpenAI-Project"] = config.customConfiguration.project;
  return configuredHeaders(config, extra);
}

function endpointList(item: any) {
  const raw = item?.endpoints ?? item?.supported_endpoints ?? item?.capabilities?.endpoints;
  return Array.isArray(raw) ? raw.map((value) => String(value).toLowerCase()) : null;
}

export function classifyOpenAiModel(id: string, item: any = {}): AiModelCompatibility {
  const endpoints = endpointList(item);
  const declaredTextInput = item?.capabilities?.text_input ?? item?.capabilities?.input_text;
  const declaredTextOutput = item?.capabilities?.text_output ?? item?.capabilities?.output_text;
  const blockedByName = incompatibleName.test(id);
  const knownGenerative = generativeName.test(id);
  const supportsResponsesApi = endpoints ? endpoints.some((value) => value.includes("responses")) : knownGenerative && !blockedByName;
  const supportsChatCompletions = endpoints ? endpoints.some((value) => value.includes("chat/completions")) : knownGenerative && !blockedByName;
  const supportsTextInput = typeof declaredTextInput === "boolean" ? declaredTextInput : knownGenerative && !blockedByName;
  const supportsTextOutput = typeof declaredTextOutput === "boolean" ? declaredTextOutput : knownGenerative && !blockedByName;
  const suitable = supportsResponsesApi && supportsTextInput && supportsTextOutput;
  let reason: string | undefined;
  if (blockedByName) reason = "This model belongs to a specialized endpoint category and is not eligible for a standard text response test.";
  else if (endpoints && !supportsResponsesApi) reason = "Provider capability metadata does not list the Responses API for this model.";
  else if (!knownGenerative && !endpoints) reason = "OpenAI did not return enough capability metadata to identify this model as a text-generation model; run an explicit compatibility probe before use.";
  return { ownedBy: typeof item?.owned_by === "string" ? item.owned_by : undefined, lifecycleState: /deprecated/i.test(String(item?.status || item?.lifecycle || "")) ? "DEPRECATED" : "UNKNOWN", supportsTextInput, supportsTextOutput, supportsResponsesApi, supportsChatCompletions, supportsStreaming: suitable, supportsUsageReporting: suitable, suitableForConnectionTest: suitable, selectableAsDefault: suitable, reason };
}

function providerErrorDetails(response: Response, body: any, providerRequestId?: string) {
  const error = body?.error && typeof body.error === "object" ? body.error : {};
  return {
    http_status: response.status,
    provider_error_type: typeof error.type === "string" ? error.type.slice(0, 120) : undefined,
    provider_error_code: typeof error.code === "string" ? error.code.slice(0, 120) : undefined,
    parameter: typeof error.param === "string" ? error.param.slice(0, 120) : undefined,
    sanitized_provider_message: sanitizeErrorText(error.message, 300) || undefined,
    provider_request_id: providerRequestId,
    endpoint_mode: "responses",
  };
}

export function classifyOpenAiHttpError(status: number, body: any, providerRequestId?: string) {
  const error = body?.error && typeof body.error === "object" ? body.error : {};
  const code = String(error.code || "").toLowerCase();
  const type = String(error.type || "").toLowerCase();
  const param = String(error.param || "").toLowerCase();
  const message = String(error.message || "").toLowerCase();
  const details = { http_status: status, provider_error_type: type || undefined, provider_error_code: code || undefined, parameter: param || undefined, sanitized_provider_message: sanitizeErrorText(error.message, 300) || undefined, provider_request_id: providerRequestId, endpoint_mode: "responses" };
  if (status === 401) return new AiError("PROVIDER_UNAUTHORIZED", undefined, 401, undefined, details);
  if (status === 403) return new AiError("PROVIDER_PERMISSION_DENIED", undefined, 403, undefined, details);
  if (status === 408) return new AiError("PROVIDER_TIMEOUT", undefined, 504, undefined, details);
  if (status === 429 && (/quota|billing|credit/.test(`${code} ${type} ${message}`) || code === "insufficient_quota")) return new AiError("PROVIDER_QUOTA_EXCEEDED", undefined, 429, undefined, details);
  if (status === 429) return new AiError("PROVIDER_RATE_LIMITED", undefined, 429, undefined, details);
  if (status === 404 && (/model/.test(`${code} ${type} ${param} ${message}`))) return new AiError("MODEL_NOT_AVAILABLE", undefined, 404, undefined, details);
  if (status === 404) return new AiError("PROVIDER_ENDPOINT_INVALID", undefined, 400, undefined, details);
  if (status === 400 && (/model/.test(`${param} ${code}`) && /not support|unsupported|incompatible|does not support|only supported/.test(message))) return new AiError("MODEL_NOT_COMPATIBLE", undefined, 400, undefined, details);
  if (status === 400) return new AiError("PROVIDER_REQUEST_INVALID", undefined, 400, undefined, details);
  if (status >= 500) return new AiError("PROVIDER_SERVICE_ERROR", undefined, 502, undefined, details);
  return new AiError("PROVIDER_SERVICE_ERROR", undefined, 502, undefined, details);
}

async function readResponseJson(response: Response, maxBytes: number) {
  if (!response.body) throw new AiError("PROVIDER_RESPONSE_INVALID", undefined, 502, undefined, { http_status: response.status });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new AiError("RESPONSE_TOO_LARGE"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new AiError("PROVIDER_RESPONSE_INVALID", undefined, 502, undefined, { http_status: response.status, provider_request_id: response.headers.get("x-request-id") || undefined }); }
}

async function openAiFetchJson(url: string, init: RequestInit, maxBytes: number): Promise<OpenAiHttpResult> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch (error) {
    if ((error as Error)?.name === "AbortError") throw new AiError("REQUEST_CANCELLED");
    throw new AiError("PROVIDER_CONNECTION_FAILED", undefined, 502, undefined, { exception_class: (error as Error)?.name || "Error", sanitized_exception_message: sanitizeErrorText(error, 200) });
  }
  const providerRequestId = response.headers.get("x-request-id") || response.headers.get("openai-request-id") || undefined;
  let payload: any;
  try { payload = await readResponseJson(response, maxBytes); }
  catch (error) { if (!response.ok && error instanceof AiError && error.category === "PROVIDER_RESPONSE_INVALID") payload = {}; else throw error; }
  if (!response.ok) {
    const classified = classifyOpenAiHttpError(response.status, payload, providerRequestId);
    classified.details = { ...providerErrorDetails(response, payload, providerRequestId), ...(classified.details || {}) };
    throw classified;
  }
  return { payload, httpStatus: response.status, providerRequestId };
}

export function extractOpenAiResponseText(payload: any) {
  try { return normalizeAIResponse(payload, { providerType: "openai", provider: "OpenAI", requestedModel: String(payload?.model || "unknown"), requestId: "response-extraction" }).text; }
  catch { return undefined; }
}

function usage(payload: any, providerRequestId?: string) {
  const inputTokens = Number(payload?.usage?.input_tokens);
  const outputTokens = Number(payload?.usage?.output_tokens);
  const totalTokens = Number(payload?.usage?.total_tokens);
  const cachedTokens = Number(payload?.usage?.input_tokens_details?.cached_tokens);
  const reasoningTokens = Number(payload?.usage?.output_tokens_details?.reasoning_tokens);
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : undefined,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : undefined,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : undefined,
    cachedTokens: Number.isFinite(cachedTokens) ? cachedTokens : undefined,
    reasoningTokens: Number.isFinite(reasoningTokens) ? reasoningTokens : undefined,
    providerReported: !!payload?.usage,
    providerRequestId,
  };
}

function promptFor(request: AiRequest) {
  const sections = [...(request.systemInstructions ? [`System: ${request.systemInstructions}`] : []), ...request.messages.map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)];
  return sections.join("\n\n");
}

export class OpenAIProviderAdapter implements AiProviderAdapter {
  readonly providerType = "openai" as const;
  readonly available = true;

  knownCapabilities(): AiCapabilityResult { return { text_generation: "CONFIRMED", chat_messages: "REPORTED", system_instructions: "REPORTED", structured_json: "REPORTED", json_schema: "REPORTED", streaming: "REPORTED", request_cancellation: "CONFIRMED", model_discovery: "CONFIRMED", token_usage: "CONFIRMED", cost_reporting: "UNKNOWN", reasoning_models: "REPORTED", large_context: "REPORTED", remote_operation: "CONFIRMED", health_testing: "CONFIRMED" }; }
  async detectCapabilities(config: ResolvedAiProviderConfig): Promise<AiCapabilityResult> { return { ...this.knownCapabilities(), ...config.capabilityOverrides }; }

  async discoverModels(config: ResolvedAiProviderConfig, signal?: AbortSignal): Promise<AiModel[]> {
    const { payload } = await openAiFetchJson(endpoint(config, "models"), { headers: headers(config), signal }, 2_000_000);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data.map((item: any) => {
      const id = String(item?.id || "");
      const compatibility = classifyOpenAiModel(id, item);
      return { id, displayName: id, category: /reason|^o[1-9]/i.test(id) ? "REASONING" : /mini|nano|luna/i.test(id) ? "FAST" : "REMOTE", capabilities: { text_generation: compatibility.supportsTextOutput ? "ASSUMED" : "UNSUPPORTED", model_discovery: "CONFIRMED", token_usage: compatibility.supportsUsageReporting ? "ASSUMED" : "UNKNOWN", remote_operation: "CONFIRMED" }, available: true, compatibility } as AiModel;
    }).filter((model: AiModel) => !!model.id).sort((left: AiModel, right: AiModel) => left.id.localeCompare(right.id));
  }

  private async response(config: ResolvedAiProviderConfig, model: string, input: string, signal: AbortSignal, maxBytes: number) {
    const body = { model, input };
    return openAiFetchJson(endpoint(config, "responses"), { method: "POST", headers: headers(config), signal, body: JSON.stringify(body) }, maxBytes);
  }

  async testConnection(config: ResolvedAiProviderConfig, signal?: AbortSignal, model?: string): Promise<AiConnectionTestResult> {
    const selected = model || config.defaultModel;
    if (!selected) throw new AiError("MODEL_NOT_CONFIGURED");
    const started = Date.now();
    const result = await this.response(config, selected, ADMIN_TEST_PROMPT, signal || new AbortController().signal, 64_000);
    const content = extractOpenAiResponseText(result.payload);
    if (!content) throw new AiError("PROVIDER_RESPONSE_INVALID", undefined, 502, undefined, { http_status: result.httpStatus, provider_request_id: result.providerRequestId, response_id: typeof result.payload?.id === "string" ? result.payload.id : undefined });
    if (!/mixarr[\s_-]*ok/i.test(content)) throw new AiError("PROVIDER_RESPONSE_INVALID", undefined, 502, undefined, { http_status: result.httpStatus, provider_request_id: result.providerRequestId, response_id: typeof result.payload?.id === "string" ? result.payload.id : undefined, reason: "test_marker_missing" });
    const normalizedUsage = usage(result.payload, result.providerRequestId);
    return { connected: true, message: "OpenAI authentication and Responses API inference succeeded.", latencyMs: Date.now() - started, detectedApiType: "openai-responses", capabilities: await this.detectCapabilities(config), availableModelCount: 0, defaultModelAvailable: config.defaultModel ? config.defaultModel === selected : null, testedAt: new Date().toISOString(), model: selected, modelReturned: String(result.payload?.model || selected), endpointMode: "RESPONSES_API", authenticationResult: "SUCCEEDED", discoveryResult: "NOT_RUN", inferenceResult: "SUCCEEDED", responseId: typeof result.payload?.id === "string" ? result.payload.id : undefined, providerRequestId: result.providerRequestId, usage: normalizedUsage };
  }

  async complete<T>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): Promise<AiResponse<T>> {
    const started = Date.now();
    const result = await this.response(config, context.model, promptFor(request), context.signal, context.maxResponseBytes);
    const content = extractOpenAiResponseText(result.payload);
    if (!content) throw new AiError("PROVIDER_RESPONSE_INVALID", undefined, 502, undefined, { http_status: result.httpStatus, provider_request_id: result.providerRequestId });
    return { requestId: context.requestId, providerId: config.id, providerType: "openai", model: String(result.payload?.model || context.model), content, usage: usage(result.payload, result.providerRequestId), finishReason: String(result.payload?.status || "completed"), latencyMs: Date.now() - started, retryCount: 0, streaming: false, warnings: [] };
  }
}
