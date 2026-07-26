import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { z } from "zod";
import type { ResolvedAiProviderConfig } from "../ai/contracts";
import { OpenAiCompatibleAdapter } from "../ai/providers/openAiCompatible";
import { normalizeAIResponse } from "../ai/providers/normalizeResponse";
import { resolveModelCapabilities } from "../ai/registry/modelCapabilities";

let server: http.Server;
let baseUrl = "";
const requests: any[] = [];

before(async () => {
  server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    requests.push(body); response.setHeader("content-type", "application/json"); response.setHeader("x-request-id", `request-${requests.length}`);
    if (request.url?.endsWith("/models")) return response.end(JSON.stringify({ data: [{ id: "deepseek-v4-pro" }] }));
    response.end(JSON.stringify({ model: body.model, choices: [{ message: { role: "assistant", content: '{"ok":true}', reasoning_content: "private reasoning fixture" }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 4 } } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

function provider(providerType: "deepseek" | "openai_compatible" = "deepseek"): ResolvedAiProviderConfig { return { id: "provider", providerType, displayName: providerType, enabled: true, approved: true, locationClassification: "REMOTE", baseUrl, authenticationType: "BEARER", apiKey: "fixture-secret", secretHeaders: {}, nonSecretHeaders: {}, defaultModel: "deepseek-v4-pro", requestTimeoutMs: 30_000, retryCount: 0, initialRetryDelayMs: 1, maximumRetryDelayMs: 1, retryBackoffMultiplier: 1, sslVerification: true, capabilityOverrides: {}, customConfiguration: {} }; }
const format = { type: "json" as const, name: "test", schema: z.object({ ok: z.literal(true) }).strict(), jsonSchema: { type: "object", properties: { ok: { const: true } }, required: ["ok"], additionalProperties: false } };
const context = (providerType: "deepseek" | "openai_compatible" = "deepseek") => ({ requestId: "correlation", providerId: "provider", model: "deepseek-v4-pro", signal: new AbortController().signal, maxResponseBytes: 64_000, modelCapabilities: resolveModelCapabilities(providerType, "deepseek-v4-pro") });

describe("v2.4.17 provider payloads", () => {
  it("omits every application output-token parameter for DeepSeek structured requests", async () => { requests.length = 0; await new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "recipe_copilot", messages: [{ role: "user", content: "Return JSON" }], responseFormat: format, estimatedOutputTokens: 5500, thinkingMode: "enabled", reasoningEffort: "medium", temperature: .7 }, provider(), context()); const sent = requests[0]; for (const key of ["max_tokens", "max_completion_tokens", "max_output_tokens", "temperature", "top_p", "presence_penalty", "frequency_penalty", "reasoning_effort"]) assert.equal(key in sent, false); assert.deepEqual(sent.thinking, { type: "disabled" }); assert.equal(sent.stream, false); assert.deepEqual(sent.response_format, { type: "json_object" }); });
  it("provider tests use a tiny deterministic JSON request without token caps", async () => { requests.length = 0; const result = await new OpenAiCompatibleAdapter("deepseek").testConnection(provider(), undefined, "deepseek-v4-pro", { retryAttempt: 0, thinkingMode: "disabled" }); const sent = requests.find((body) => Array.isArray(body.messages)); assert.equal(result.connected, true); assert.deepEqual(sent.thinking, { type: "disabled" }); assert.equal(sent.messages[1].content, 'Return exactly this JSON object: {"ok":true}'); for (const key of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) assert.equal(key in sent, false); });
  it("never sends DeepSeek thinking fields to other compatible providers", async () => { requests.length = 0; await new OpenAiCompatibleAdapter("openai_compatible").complete({ featureKey: "structured", messages: [{ role: "user", content: "JSON" }], responseFormat: format }, provider("openai_compatible"), context("openai_compatible")); assert.equal("thinking" in requests[0], false); });
  it("uses only final content and keeps reasoning private", () => { const raw = { choices: [{ message: { content: '{"ok":true}', reasoning_content: "never expose this" }, finish_reason: "stop" }] }; const response = normalizeAIResponse(raw, { providerType: "deepseek", provider: "DeepSeek", requestedModel: "deepseek-v4-pro", requestId: "fixture" }); assert.equal(response.text, '{"ok":true}'); assert.doesNotMatch(JSON.stringify(response), /never expose this/); });
  it("contains no runtime provider token parameter builders", () => { for (const path of ["src/ai/providers/openAiCompatible.ts", "src/ai/providers/openai.ts", "src/ai/providers/anthropic.ts", "src/ai/providers/ollama.ts"]) { const source = readFileSync(path, "utf8"); assert.doesNotMatch(source, /\b(max_tokens|max_completion_tokens|max_output_tokens|num_predict)\s*:/); } });
});
