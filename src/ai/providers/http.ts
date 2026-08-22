import http from "http";
import https from "https";
import { Readable } from "stream";
import type { AiMessage, AiProviderLifecycle, AiStreamEvent, ResolvedAiProviderConfig } from "../contracts";
import { AiError, normalizeProviderError } from "../errors";

export type ProviderHttpDiagnostics = {
  requestId?: string;
  provider?: string;
  model?: string;
  stage?: string;
  lifecycle?: AiProviderLifecycle;
  sslVerification?: boolean;
};

type ProviderTransport = {
  httpStatus: number;
  contentType: string;
  bodyLength: number;
  endpointHostname: string;
  streamed: boolean;
  providerRequestId?: string;
};

export function joinUrl(base: string | undefined, path: string) {
  const root = String(base || "").replace(/\/+$/, "");
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

export function configuredHeaders(config: ResolvedAiProviderConfig, providerHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...config.nonSecretHeaders, ...config.secretHeaders, ...providerHeaders };
  if (config.apiKey) {
    if (config.authenticationType === "API_KEY_HEADER") headers["x-api-key"] = config.apiKey;
    else if (config.authenticationType === "BASIC") headers.authorization = `Basic ${Buffer.from(config.apiKey).toString("base64")}`;
    else headers.authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

function normalizeProviderTransportError(error: unknown, diagnostics: ProviderHttpDiagnostics) {
  if (error instanceof AiError) return error;
  if ((error as Error)?.name === "AbortError") return new AiError("REQUEST_CANCELLED");
  const code = String((error as NodeJS.ErrnoException)?.code || "").toUpperCase();
  const message = String((error as Error)?.message || "");
  const details = {
    failure_stage: "NETWORK",
    provider: diagnostics.provider,
    model: diagnostics.model,
    stage: diagnostics.stage,
    network_reason: code === "ECONNREFUSED" ? "CONNECTION_REFUSED" : ["ENOTFOUND", "EAI_AGAIN"].includes(code) ? "DNS_FAILURE" : code === "ETIMEDOUT" ? "TIMEOUT" : "NETWORK_FAILURE",
  };
  if (code === "ETIMEDOUT" || /timed?\s*out/i.test(message)) return new AiError("PROVIDER_TIMEOUT", undefined, 504, undefined, details);
  if (["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(code) || /certificate|\btls\b|\bssl\b/i.test(message)) return new AiError("TLS_ERROR", undefined, 502, undefined, details);
  return new AiError("PROVIDER_CONNECTION_FAILED", undefined, 502, undefined, details);
}

export async function providerFetch(url: string, init: RequestInit = {}, lifecycle?: AiProviderLifecycle, sslVerification = true): Promise<Response> {
  const endpoint = new URL(url);
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new AiError("INVALID_REQUEST", "Provider URLs must use HTTP or HTTPS.");
  return new Promise<Response>((resolve, reject) => {
    const headers = new Headers(init.headers);
    const body = init.body;
    if (body != null && typeof body !== "string" && !(body instanceof Uint8Array)) {
      reject(new AiError("INVALID_REQUEST", "Unsupported provider request body."));
      return;
    }
    if (body != null && !headers.has("content-length")) headers.set("content-length", String(Buffer.byteLength(body)));
    let settled = false;
    let connectionReported = false;
    const reportConnection = () => {
      if (connectionReported) return;
      connectionReported = true;
      lifecycle?.connectionEstablished();
    };
    const transport = endpoint.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || undefined,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: init.method || "GET",
      headers: Object.fromEntries(headers.entries()),
      ...(endpoint.protocol === "https:" ? { rejectUnauthorized: sslVerification } : {}),
    }, (incoming) => {
      reportConnection();
      settled = true;
      const unregisterResponseCleanup = lifecycle?.registerForceCleanup(() => incoming.destroy(new Error("AI cancellation grace expired.")));
      incoming.once("close", () => unregisterResponseCleanup?.());
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
        else if (value != null) responseHeaders.set(name, String(value));
      }
      const responseBody = Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>;
      resolve(new Response(responseBody as any, { status: incoming.statusCode || 500, statusText: incoming.statusMessage, headers: responseHeaders }));
    });
    const unregisterCleanup = lifecycle?.registerForceCleanup(() => request.destroy(new Error("AI cancellation grace expired.")));
    const abort = () => request.destroy(new DOMException(String(init.signal?.reason || "AI request cancelled."), "AbortError"));
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    request.on("socket", (socket: any) => {
      if (!socket.connecting) reportConnection();
      else socket.once(endpoint.protocol === "https:" ? "secureConnect" : "connect", reportConnection);
    });
    request.on("error", (error) => {
      init.signal?.removeEventListener("abort", abort);
      unregisterCleanup?.();
      if (!settled) reject(error);
    });
    request.on("close", () => {
      init.signal?.removeEventListener("abort", abort);
      unregisterCleanup?.();
    });
    if (body != null) request.write(body);
    request.end();
  });
}

async function readBoundedBody(response: Response, maxBytes: number, lifecycle?: AiProviderLifecycle) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    lifecycle?.responseActivity({ meaningful: true, producedOutput: false });
    if (total > maxBytes) { await reader.cancel(); throw new AiError("RESPONSE_TOO_LARGE"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function safeProviderErrorCode(value: unknown) {
  const code = (value as any)?.error?.code ?? (value as any)?.code;
  return typeof code === "string" || typeof code === "number" ? String(code).replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 120) : undefined;
}

function providerHttpDetails(transport: ProviderTransport, diagnostics: ProviderHttpDiagnostics, extra: Record<string, unknown> = {}) {
  return {
    request_id: diagnostics.requestId,
    provider: diagnostics.provider,
    model: diagnostics.model,
    stage: diagnostics.stage || "PROVIDER_RESPONSE",
    endpoint_hostname: transport.endpointHostname,
    http_status: transport.httpStatus,
    response_content_type: transport.contentType,
    response_body_length: transport.bodyLength,
    response_streamed: transport.streamed,
    provider_request_id: transport.providerRequestId,
    ...extra,
  };
}

export async function safeFetchJsonDetailed(url: string, init: RequestInit, maxBytes: number, diagnostics: ProviderHttpDiagnostics = {}) {
  const started = Date.now();
  let response: Response;
  try { response = await providerFetch(url, init, diagnostics.lifecycle, diagnostics.sslVerification); } catch (error) { throw normalizeProviderTransportError(error, diagnostics); }
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const streamed = contentType.includes("text/event-stream");
  let bytes: Uint8Array;
  try { bytes = await readBoundedBody(response, maxBytes, diagnostics.lifecycle); }
  catch (error) {
    console.warn("[AI Provider] response read failed", { requestId: diagnostics.requestId, provider: diagnostics.provider, model: diagnostics.model, endpointHostname: new URL(url).hostname, elapsedMs: Date.now() - started, httpStatus: response.status, contentType, streamed, stage: "RESPONSE_READ" });
    throw error;
  }
  const transport: ProviderTransport = { httpStatus: response.status, contentType, bodyLength: bytes.byteLength, endpointHostname: new URL(url).hostname, streamed, providerRequestId: response.headers.get("x-request-id") || response.headers.get("openai-request-id") || undefined };
  console.info("[AI Provider] response received", { requestId: diagnostics.requestId, provider: diagnostics.provider, model: diagnostics.model, endpointHostname: transport.endpointHostname, elapsedMs: Date.now() - started, httpStatus: transport.httpStatus, contentType: transport.contentType, responseBodyLength: transport.bodyLength, streamed: transport.streamed, stage: diagnostics.stage || "PROVIDER_RESPONSE" });
  const retryAfter = response.headers.get("retry-after");
  const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new AiError("AI_PROVIDER_INVALID_RESPONSE", undefined, 502, undefined, providerHttpDetails(transport, diagnostics, { failure_stage: "UTF8_DECODE" })); }
  let parsed: any;
  if (text.trim()) {
    try { parsed = JSON.parse(text); }
    catch { parsed = undefined; }
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new AiError("AI_PROVIDER_HTTP_ERROR", undefined, response.status >= 400 && response.status < 600 ? response.status : 502, retryAfterMs, providerHttpDetails(transport, diagnostics, { failure_stage: "HTTP_STATUS", provider_error_code: safeProviderErrorCode(parsed), retryable, billing_possible: false }));
  }
  if (bytes.byteLength === 0 || !text.trim()) throw new AiError("AI_PROVIDER_EMPTY_RESPONSE", undefined, 502, undefined, providerHttpDetails(transport, diagnostics, { failure_stage: "EMPTY_BODY" }));
  if (streamed) throw new AiError("AI_PROVIDER_INVALID_RESPONSE", undefined, 502, undefined, providerHttpDetails(transport, diagnostics, { failure_stage: "UNEXPECTED_STREAM" }));
  if (parsed === undefined) throw new AiError("AI_PROVIDER_MALFORMED_JSON", undefined, 502, undefined, providerHttpDetails(transport, diagnostics, { failure_stage: contentType.includes("html") ? "HTML_RESPONSE" : "JSON_PARSE" }));
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.error) throw new AiError("AI_PROVIDER_HTTP_ERROR", undefined, 502, undefined, providerHttpDetails(transport, diagnostics, { failure_stage: "PROVIDER_ERROR_OBJECT", provider_error_code: safeProviderErrorCode(parsed), retryable: false, billing_possible: false }));
  return { payload: parsed, transport };
}

export async function safeFetchJson(url: string, init: RequestInit, maxBytes: number) {
  return (await safeFetchJsonDetailed(url, init, maxBytes)).payload;
}

export async function *parseTextLines(response: Response, maxBytes: number, signal: AbortSignal, lifecycle?: AiProviderLifecycle) {
  if (!response.body) throw new AiError("STREAM_INTERRUPTED");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new AiError("REQUEST_CANCELLED");
      const { done, value } = await reader.read();
      if (done) break;
      lifecycle?.responseActivity({ meaningful: false });
      total += value.byteLength;
      if (total > maxBytes) throw new AiError("RESPONSE_TOO_LARGE");
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) yield line;
    }
    pending += decoder.decode();
    if (pending) yield pending;
  } catch (error) {
    try { await reader.cancel(); } catch {}
    throw normalizeProviderError(error);
  }
}

export function openAiMessages(messages: AiMessage[], systemInstructions?: string) {
  return [...(systemInstructions ? [{ role: "system", content: systemInstructions }] : []), ...messages];
}

export function streamFailureEvent(error: unknown): AiStreamEvent {
  const normalized = normalizeProviderError(error);
  return { type: normalized.category === "REQUEST_CANCELLED" ? "cancelled" : "failed", ...(normalized.category === "REQUEST_CANCELLED" ? {} : { code: normalized.category, message: normalized.toSafePayload().message }) } as AiStreamEvent;
}
