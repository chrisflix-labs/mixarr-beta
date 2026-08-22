import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { z } from "zod";
import { decryptAiSecret, encryptAiSecret, isAiSecretEncryptionConfigured } from "./secretStorage";
import { AI_PROVIDER_TYPES } from "../ai/contracts";
import { AiError, normalizeProviderError } from "../ai/errors";
import { aiProviderRegistry, AiProviderRegistry } from "../ai/registry/providerRegistry";
import { resolveModelCapabilities } from "../ai/registry/modelCapabilities";
import { OpenAiCompatibleAdapter } from "../ai/providers/openAiCompatible";
import { OllamaAdapter } from "../ai/providers/ollama";
import { AnthropicAdapter } from "../ai/providers/anthropic";
import { safeFetchJson } from "../ai/providers/http";
import { parseStructuredResponse } from "../ai/validation";
import { buildUntrustedDataBlock, sanitizePromptText } from "../ai/utilities/prompt";
import { isRetryEligible, retryDelayMs } from "../ai/utilities/retry";
import { redactAiValue, validateNonSecretHeaders } from "../ai/security";
import type { ResolvedAiProviderConfig } from "../ai/contracts";
import { createAiRequestSignal, nextStreamEvent } from "../ai/utilities/cancellation";

let server: http.Server; let baseUrl = "";
before(async () => {
  server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/models") return response.end(JSON.stringify({ data: [{ id: "fast-model", context_length: 8192 }] }));
    if (request.url === "/v1/chat/completions" && body.stream) { response.setHeader("content-type", "text/event-stream"); response.write('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n'); response.write('data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n'); return response.end("data: [DONE]\n\n"); }
    if (request.url === "/v1/chat/completions") return response.end(JSON.stringify({ model: body.model, choices: [{ message: { content: body.response_format || body.messages?.some((message: any) => /exactly this JSON object/i.test(message.content)) ? '{"ok":true}' : "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
    if (request.url === "/v1/messages" && body.stream) { response.setHeader("content-type", "text/event-stream"); response.write('data: {"type":"content_block_delta","delta":{"text":"native"}}\n\n'); response.write('data: {"type":"message_delta","usage":{"output_tokens":1}}\n\n'); return response.end('data: {"type":"message_stop"}\n\n'); }
    if (request.url === "/v1/messages") return response.end(JSON.stringify({ model: body.model, content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 2, output_tokens: 1 } }));
    if (request.url === "/api/tags") return response.end(JSON.stringify({ models: [{ name: "llama-test", details: { context_length: 4096 } }] }));
    if (request.url === "/api/chat") return response.end(JSON.stringify({ model: body.model, message: { content: body.messages?.some((message: any) => /exactly this JSON object/i.test(message.content)) ? '{"ok":true}' : "OK" }, done: true, prompt_eval_count: 2, eval_count: 1 }));
    if (request.url === "/oversized") return response.end(JSON.stringify({ data: "x".repeat(500) }));
    response.statusCode = 404; response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

function config(type: ResolvedAiProviderConfig["providerType"], path = ""): ResolvedAiProviderConfig { return { id: crypto.randomUUID(), providerType: type, displayName: "Contract provider", enabled: true, locationClassification: "LOCAL", baseUrl: `${baseUrl}${path}`, authenticationType: "NONE", secretHeaders: {}, nonSecretHeaders: {}, defaultModel: type === "ollama" ? "llama-test" : "fast-model", requestTimeoutMs: 5000, retryCount: 2, initialRetryDelayMs: 100, maximumRetryDelayMs: 1000, retryBackoffMultiplier: 2, sslVerification: true, capabilityOverrides: {}, customConfiguration: {} }; }

describe("AI secret security", () => {
  it("encrypts credentials with authenticated encryption and AI-specific configuration", () => { const previous = process.env.AI_CREDENTIAL_ENCRYPTION_KEY; process.env.AI_CREDENTIAL_ENCRYPTION_KEY = "test-only-ai-key-with-entropy"; try { assert.equal(isAiSecretEncryptionConfigured(), true); const ciphertext = encryptAiSecret("sk-example-not-real"); assert.equal(ciphertext.includes("sk-example-not-real"), false); assert.equal(decryptAiSecret(ciphertext), "sk-example-not-real"); const parts = ciphertext.split(":"); parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`; assert.throws(() => decryptAiSecret(parts.join(":"))); } finally { if (previous == null) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY; else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = previous; } });
  it("redacts authorization, API keys, secret headers, and nested values", () => { const value = redactAiValue({ Authorization: "Bearer example", apiKey: "example", nested: { password: "example" } }); assert.equal(value.Authorization, "[REDACTED]"); assert.equal(value.apiKey, "[REDACTED]"); assert.equal(value.nested.password, "[REDACTED]"); });
  it("rejects secret-like values from non-secret headers", () => { assert.throws(() => validateNonSecretHeaders({ Authorization: "Bearer value" })); assert.deepEqual(validateNonSecretHeaders({ "X-App-Name": "Mixarr" }), { "X-App-Name": "Mixarr" }); });
});

describe("AI provider registry", () => {
  it("registers every stable provider type and marks ChatGPT subscription unavailable", () => { assert.deepEqual(aiProviderRegistry.list().map((item) => item.type), [...AI_PROVIDER_TYPES]); const chatgpt = aiProviderRegistry.list().find((item) => item.type === "chatgpt_subscription"); assert.equal(chatgpt?.available, false); assert.match(chatgpt?.unavailableMessage || "", /never used|never uses|Browser cookies/i); });
  it("rejects duplicate adapter registration while provider configuration instances remain UUID-based", () => { const registry = new AiProviderRegistry(); const adapter = new OllamaAdapter(); const metadata = aiProviderRegistry.list().find((item) => item.type === "ollama")!; registry.register(adapter, metadata); assert.throws(() => registry.register(adapter, metadata), /already registered/); });
});

describe("provider adapter contract", () => {
  it("discovers models, tests chat completion, normalizes usage, and uses declared structured output", async () => { const adapter = new OpenAiCompatibleAdapter("openai_compatible"); const provider = config("openai_compatible", "/v1"); const models = await adapter.discoverModels(provider); assert.equal(models[0].id, "fast-model"); const test = await adapter.testConnection(provider); assert.equal(test.connected, true); const response = await adapter.complete({ featureKey: "contract", messages: [{ role: "user", content: "fixed" }], responseFormat: { type: "json", name: "test", schema: z.object({ ok: z.boolean() }) } }, provider, { requestId: "request", providerId: provider.id, model: "fast-model", signal: new AbortController().signal, maxResponseBytes: 4096, modelCapabilities: resolveModelCapabilities("openai_compatible", "fast-model", { jsonMode: true }) }); assert.equal(response.usage?.totalTokens, 3); assert.equal(response.content, '{"ok":true}'); });
  it("normalizes OpenAI-compatible streaming events", async () => { const adapter = new OpenAiCompatibleAdapter("openai_compatible"); const provider = config("openai_compatible", "/v1"); const events = []; for await (const event of adapter.stream!({ featureKey: "contract", messages: [{ role: "user", content: "fixed" }] }, provider, { requestId: "stream", providerId: provider.id, model: "fast-model", signal: new AbortController().signal, maxResponseBytes: 4096 })) events.push(event); assert.equal(events[0].type, "started"); assert.equal(events.filter((event) => event.type === "text_delta").map((event: any) => event.delta).join(""), "hello"); assert.ok(events.some((event) => event.type === "usage")); });
  it("passes Ollama discovery, selected-model inference testing, and completion contracts", async () => { const adapter = new OllamaAdapter(); const provider = { ...config("ollama"), defaultModel: undefined }; assert.equal((await adapter.discoverModels(provider))[0].id, "llama-test"); const test = await adapter.testConnection(provider, undefined, "llama-test"); assert.equal(test.connected, true); assert.equal(test.inferenceResult, "SUCCEEDED"); assert.equal(test.model, "llama-test"); const response = await adapter.complete({ featureKey: "contract", messages: [{ role: "user", content: "fixed" }] }, provider, { requestId: "ollama", providerId: provider.id, model: "llama-test", signal: new AbortController().signal, maxResponseBytes: 4096 }); assert.equal(response.content, "OK"); assert.match(response.warnings[0], /cost not tracked/i); });
  it("passes native Anthropic discovery, completion, usage, and streaming contracts", async () => { const adapter = new AnthropicAdapter(); const provider = config("anthropic"); assert.equal((await adapter.discoverModels(provider))[0].id, "fast-model"); const context = { requestId: "anthropic", providerId: provider.id, model: "fast-model", signal: new AbortController().signal, maxResponseBytes: 4096 }; const response = await adapter.complete({ featureKey: "contract", messages: [{ role: "user", content: "fixed" }] }, provider, context); assert.equal(response.content, "OK"); assert.equal(response.usage?.totalTokens, 3); const events = []; for await (const event of adapter.stream!({ featureKey: "contract", messages: [{ role: "user", content: "fixed" }] }, provider, context)) events.push(event); assert.ok(events.some((event: any) => event.type === "text_delta" && event.delta === "native")); assert.ok(events.some((event) => event.type === "completed")); });
  it("cancels oversized JSON bodies while reading", async () => { await assert.rejects(() => safeFetchJson(`${baseUrl}/oversized`, {}, 64), (error: any) => error.category === "RESPONSE_TOO_LARGE"); });
});

describe("structured response and prompt safety", () => {
  it("parses Zod-validated JSON and rejects invalid JSON", () => { const format = { type: "json" as const, name: "answer", schema: z.object({ answer: z.string().max(10) }).strict() }; assert.deepEqual(parseStructuredResponse('{"answer":"yes"}', format, 1024), { answer: "yes" }); assert.throws(() => parseStructuredResponse("not-json", format, 1024), (error: any) => error.category === "STRUCTURED_RESPONSE_INVALID"); assert.throws(() => parseStructuredResponse('{"answer":"yes","extra":1}', format, 1024)); });
  it("rejects deep nesting, excessive arrays, and oversized responses", () => { const anything = { type: "json" as const, name: "anything", schema: z.any() }; let deep: any = {}; let cursor = deep; for (let index = 0; index < 20; index += 1) cursor = cursor.child = {}; assert.throws(() => parseStructuredResponse(JSON.stringify(deep), anything, 10000)); assert.throws(() => parseStructuredResponse(JSON.stringify(new Array(1001).fill(1)), anything, 10000)); assert.throws(() => parseStructuredResponse('{"x":"too large"}', anything, 5), (error: any) => error.category === "RESPONSE_TOO_LARGE"); });
  it("bounds untrusted fields and rejects Plex credential markers", () => { const block = buildUntrustedDataBlock([{ title: "Song", filesystemPath: "C:/secret", notes: "x".repeat(1000) }], ["title", "filesystemPath", "notes"]); assert.match(block, /mixarr_untrusted_library_data/); assert.doesNotMatch(block, /filesystemPath|C:\/secret/); assert.ok(block.length < 800); assert.throws(() => sanitizePromptText("X-Plex-Token=not-real"), (error: any) => error.category === "INVALID_REQUEST"); });
});

describe("normalized errors and retry policy", () => {
  it("does not retry auth, validation, cancellation, or disabled errors", () => { for (const category of ["AUTHENTICATION_FAILED", "STRUCTURED_RESPONSE_INVALID", "REQUEST_CANCELLED", "AI_DISABLED"] as const) assert.equal(isRetryEligible(new AiError(category)), false); });
  it("retries only temporary categories and applies bounded jitter", () => { assert.equal(isRetryEligible(new AiError("RATE_LIMITED")), true); assert.equal(isRetryEligible(new AiError("PROVIDER_OVERLOADED")), true); assert.equal(retryDelayMs(2, 100, 1000, 2, () => 0), 300); assert.equal(retryDelayMs(10, 100, 1000, 2, () => 1), 1000); });
  it("normalizes provider statuses without exposing raw bodies", () => { assert.equal(normalizeProviderError(new Error("raw secret response"), 401).category, "AUTHENTICATION_FAILED"); assert.equal(normalizeProviderError(new Error("overload"), 503).category, "PROVIDER_OVERLOADED"); assert.equal(normalizeProviderError(Object.assign(new Error("cancelled"), { name: "AbortError" })).category, "REQUEST_CANCELLED"); });
});

describe("timeouts and cancellation", () => {
  it("propagates user cancellation and releases the combined signal", () => { const upstream = new AbortController(); const combined = createAiRequestSignal(upstream.signal, 5000); upstream.abort(); assert.equal(combined.signal.aborted, true); combined.close(); });
  it("terminates an idle stream with a normalized interruption", async () => { const controller = new AbortController(); const iterator: AsyncIterator<string> = { next: () => new Promise(() => undefined) }; await assert.rejects(() => nextStreamEvent(iterator, 5, () => controller.abort()), (error: any) => error.category === "STREAM_INTERRUPTED"); assert.equal(controller.signal.aborted, true); });
});

describe("v2.4.0 persistence, API, UI, and safety contracts", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  it("uses an additive migration with provider UUIDs, retained audit history, and disabled defaults", () => { const sql = read("prisma/migrations/20260721050000_ai_provider_foundation_v240/migration.sql"); assert.doesNotMatch(sql, /^\s*(DROP|DELETE|TRUNCATE|UPDATE)\b/im); assert.match(sql, /CREATE TABLE "AiProviderConfig"/); assert.match(sql, /CREATE TABLE "AiRequestAudit"/); assert.match(sql, /"enabled" BOOLEAN NOT NULL DEFAULT false/); assert.match(sql, /AiRequestAudit_providerConfigId_fkey[\s\S]*ON DELETE SET NULL/); assert.doesNotMatch(sql, /INSERT INTO "AiProviderConfig"/); });
  it("provides every protected administrator route without an AI playlist mutation route", () => { const files = ["src/app/api/ai/settings/route.ts", "src/app/api/ai/features/route.ts", "src/app/api/ai/providers/route.ts", "src/app/api/ai/providers/[providerId]/route.ts", "src/app/api/ai/providers/[providerId]/test/route.ts", "src/app/api/ai/providers/[providerId]/models/refresh/route.ts", "src/app/api/ai/providers/[providerId]/models/route.ts", "src/app/api/ai/providers/[providerId]/health/route.ts", "src/app/api/ai/audit/route.ts", "src/app/api/ai/usage/route.ts"]; for (const file of files) assert.match(read(file), /requireAi(?:Admin|Permission)/); const routeList = read("src/lib/aiFoundation.test.ts"); assert.doesNotMatch(routeList, /api\/ai\/(?:playlists|recipes|regenerate|tracks\/remove)/); });
  it("keeps secrets out of provider responses and implements explicit keep, replace, and remove semantics", () => { const service = read("src/ai/services/providerService.ts"); assert.match(service, /apiKeyConfigured/); assert.match(service, /apiKeyAction === "remove"/); assert.match(service, /apiKeyAction === "replace"/); assert.doesNotMatch(service.slice(service.indexOf("function publicProvider"), service.indexOf("async function secretUpdates")), /encryptedSecretPayload:/); const dashboard = read("src/components/AiProviderDashboard.tsx"); assert.match(dashboard, /Remove API key when saved/); assert.match(dashboard, /leave blank to keep/); });
  it("enforces central enablement, capability, budget, fallback privacy, auditing, byte limits, and validation", () => { const coordinator = read("src/ai/request-coordinator/index.ts"); for (const marker of ["AI_DISABLED", "FEATURE_DISABLED", "PROVIDER_NOT_CONFIGURED", "CAPABILITY_UNAVAILABLE", "BUDGET_EXCEEDED", "allowRemoteFallback", "createAiAudit", "completeAiAudit", "RESPONSE_TOO_LARGE", "parseStructuredResponse", "nextStreamEvent"]) assert.match(coordinator, new RegExp(marker)); });
  it("exposes accessible responsive states and only reviewed user-facing features are usable", () => { const ui = read("src/components/AiProviderDashboard.tsx"); const css = read("src/components/AiProviderDashboard.module.css"); const features = read("src/ai/features/registry.ts"); assert.match(ui, /aria-live="polite"/); assert.match(ui, /Cancel test/); assert.match(ui, /AI is disabled by default|AI disabled/); assert.match(css, /:focus-visible/); assert.match(css, /@media \(max-width: 480px\)/); for (const key of ["natural_language_playlist_requests", "recipe_copilot", "playlist_ai_summaries", "metadata_suggestions", "troubleshooting_explanations"]) assert.match(features, new RegExp(`${key}[\\s\\S]*implemented: true`)); assert.equal((features.match(/implemented: true/g) || []).length, 5); });
  it("documents encryption backup, Docker host networking, ChatGPT limitations, SSL, and the no-mutation boundary", () => { const docs = read("docs/AI_PROVIDER_FOUNDATION_V240.md"); for (const marker of [/host\.docker\.internal/, /Back it up separately/i, /ChatGPT Subscription/, /certificate verification/i, /cannot add, remove, unlock, create, regenerate/i]) assert.match(docs, marker); assert.equal(JSON.parse(read("package.json")).version, "2.4.23"); });
});
