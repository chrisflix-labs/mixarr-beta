import type { AiMessage, AiStreamEvent, ResolvedAiProviderConfig } from "../contracts";
import { AiError, normalizeProviderError } from "../errors";

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

export async function safeFetchJson(url: string, init: RequestInit, maxBytes: number) {
  let response: Response;
  try { response = await fetch(url, init); } catch (error) { throw normalizeProviderError(error); }
  const retryAfter = response.headers.get("retry-after");
  const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
  if (!response.ok) throw normalizeProviderError(new Error(`Provider returned HTTP ${response.status}.`), response.status, retryAfterMs);
  if (!response.body) throw new AiError("INVALID_RESPONSE");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new AiError("RESPONSE_TOO_LARGE"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new AiError("INVALID_RESPONSE"); }
}

export async function *parseTextLines(response: Response, maxBytes: number, signal: AbortSignal) {
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
