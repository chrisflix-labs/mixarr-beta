import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { z } from "zod";
import type { ResolvedAiProviderConfig } from "../ai/contracts";
import { AiError } from "../ai/errors";
import { aiFailureStatus } from "../ai/audit/status";
import { configuredAiRequestTimeoutMs, resolveAiRequestTimeout } from "../ai/config/timeout";
import { OpenAiCompatibleAdapter } from "../ai/providers/openAiCompatible";
import { safeFetchJsonDetailed } from "../ai/providers/http";
import { normalizeAIResponse } from "../ai/providers/normalizeResponse";
import { executeEligibleFallback, isFallbackEligible } from "../ai/utilities/fallback";
import { createAiRequestSignal } from "../ai/utilities/cancellation";
import { parseStructuredResponse, parseStructuredResponseWithProviderRepair } from "../ai/validation";
import { recipeCopilotResponseSchema } from "./recipeCopilot/contracts";
import { buildPrivacyAwareRecipeContext } from "./recipeCopilot/core";
import { readRecipeCopilotResponse, RecipeCopilotHttpError } from "./recipeCopilot/http";

let server: http.Server; let baseUrl = "";
const fixture = (name: string) => readFileSync(join(process.cwd(), "src/lib/fixtures", name), "utf8");

const validRecipeProposal = {
  schemaVersion: "1.0", action: "create", proposedPatch: { metadata: { name: "Popular music mix" }, automationPolicy: { enabled: false } },
  intent: { summary: "Familiar popular music", primaryGoals: ["Prefer popular tracks"], secondaryGoals: [], conflicts: [] },
  analysis: { confidence: 0.9, assumptions: [], warnings: [], unsupportedRequests: [], expectedBehavioralChanges: [], compatibilityNotes: [] },
  recommendations: { parentRecipes: [], inheritance: [], missingRules: [], saferSettings: [] }, changeRationales: [], explanation: null, diagnoses: [], behaviorComparison: null, nameSuggestions: [], onboarding: [],
};

before(async () => {
  server = http.createServer(async (request, response) => {
    if (request.url === "/slow") { await new Promise((resolve) => setTimeout(resolve, 40)); response.setHeader("content-type", "application/json"); return response.end('{"ok":true}'); }
    if (request.url === "/timeout") { await new Promise((resolve) => setTimeout(resolve, 100)); response.setHeader("content-type", "application/json"); return response.end('{"ok":true}'); }
    if (request.url === "/empty") { response.statusCode = 200; response.setHeader("content-type", "application/json"); return response.end(); }
    if (request.url === "/html-error") { response.statusCode = 502; response.setHeader("content-type", "text/html"); return response.end("<html><body>upstream unavailable</body></html>"); }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    response.setHeader("content-type", "application/json");
    if (request.url === "/fixture-standard/chat/completions") return response.end(fixture("deepseek-standard-response.json"));
    if (request.url === "/fixture-blocks/chat/completions") return response.end(fixture("deepseek-content-block-response.json"));
    if (request.url === "/fixture-fenced/chat/completions") return response.end(fixture("deepseek-fenced-response.json"));
    if (request.url === "/fixture-e2e/chat/completions") return response.end(fixture("deepseek-recipe-copilot-response.json"));
    if (request.url === "/fixture-empty/chat/completions") return response.end(JSON.stringify({ id: "empty-id", model: body.model, choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 1707, completion_tokens: 1900, total_tokens: 3607, cost: 0.0018 } }));
    if (request.url === "/fixture-tool/chat/completions") return response.end(JSON.stringify({ id: "tool-id", model: body.model, choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "save_recipe", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }));
    if (request.url === "/fixture-reasoning/chat/completions") return response.end(fixture("deepseek-null-content-reasoning-response.json"));
    if (request.url === "/fixture-malformed/chat/completions") return response.end("{broken-json");
    if (request.url === "/fixture-unknown/chat/completions") return response.end(JSON.stringify({ metadata: 42 }));
    if (request.url === "/deepseek/chat/completions") return response.end(JSON.stringify({ id: "provider-request", model: body.model, choices: [{ message: { content: JSON.stringify(validRecipeProposal) }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } }));
    if (request.url === "/direct/chat/completions") return response.end(JSON.stringify(validRecipeProposal));
    if (request.url === "/responses/chat/completions") return response.end(JSON.stringify({ model: body.model, output: [{ content: [{ type: "output_text", text: JSON.stringify(validRecipeProposal) }] }], usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } }));
    response.statusCode = 404; return response.end('{"error":{"code":"not_found"}}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

function deepSeek(path = "/deepseek"): ResolvedAiProviderConfig {
  return { id: "deepseek-provider", providerType: "deepseek", displayName: "DeepSeek", enabled: true, approved: true, locationClassification: "REMOTE", baseUrl: `${baseUrl}${path}`, authenticationType: "BEARER", apiKey: "test-only-not-real", secretHeaders: {}, nonSecretHeaders: {}, defaultModel: "deepseek-v4-pro", requestTimeoutMs: 120_000, retryCount: 1, initialRetryDelayMs: 50, maximumRetryDelayMs: 100, retryBackoffMultiplier: 2, sslVerification: true, capabilityOverrides: {}, customConfiguration: {} };
}

const context = { requestId: "recipe-request-id", providerId: "deepseek-provider", model: "deepseek-v4-pro", signal: new AbortController().signal, maxResponseBytes: 512_000 };
const format = { type: "json" as const, name: "mixarr_recipe_copilot", schema: recipeCopilotResponseSchema, allowEmbeddedJson: false };

describe("v2.4.16 Recipe Copilot provider reliability", () => {
  it("accepts an immediate DeepSeek OpenAI-compatible completion and validates the recipe proposal", async () => {
    const response = await new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "recipe_copilot", messages: [{ role: "user", content: "Create a popular mix" }], responseFormat: format }, deepSeek(), context);
    assert.equal(response.requestId, "recipe-request-id"); assert.equal(response.usage?.providerReported, true); assert.equal(response.usage?.totalTokens, 50);
    const parsed = parseStructuredResponse(response.content!, format, 512_000); assert.equal(parsed.schemaVersion, "1.0"); assert.equal(parsed.proposedPatch?.automationPolicy?.enabled, false);
  });

  it("extracts the supplied DeepSeek chat-completion fixture and preserves provider usage", async () => {
    const small = { type: "json" as const, name: "fixture", schema: z.object({ name: z.string() }).strict(), allowEmbeddedJson: false };
    const response = await new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "recipe_copilot", messages: [{ role: "user", content: "fixture" }], responseFormat: small }, deepSeek("/fixture-standard"), context);
    assert.equal(response.content, '{"name":"Test recipe"}');
    assert.deepEqual(parseStructuredResponse(response.content!, small, 512_000), { name: "Test recipe" });
    assert.deepEqual(response.usage && { input: response.usage.inputTokens, output: response.usage.outputTokens, total: response.usage.totalTokens }, { input: 1707, output: 1900, total: 3607 });
  });

  it("joins DeepSeek textual content blocks, including nested text.value", async () => {
    const small = { type: "json" as const, name: "fixture", schema: z.object({ name: z.string() }).strict(), allowEmbeddedJson: false };
    const response = await new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "recipe_copilot", messages: [{ role: "user", content: "fixture" }], responseFormat: small }, deepSeek("/fixture-blocks"), context);
    assert.equal(response.content, '{"name":"Test recipe"}');
    assert.equal(response.usage, undefined);
  });

  it("normalizes every supported final-answer path without depending on finish reason, usage, or returned model alias", () => {
    const options = { providerType: "openai_compatible" as const, provider: "Compatible", requestedModel: "requested-alias", requestId: "paths" };
    const samples: Array<[unknown, string]> = [
      [{ choices: [{ message: { content: "  message content  " }, finish_reason: "unexpected_vendor_reason" }], model: "returned-alias" }, "message content"],
      [{ choices: [{ text: "choice text" }] }, "choice text"],
      [{ message: { content: "direct message" } }, "direct message"],
      [{ output_text: "shortcut" }, "shortcut"],
      [{ output: [{ content: [{ type: "output_text", text: "first" }, { type: "ignored", text: "secret" }, { type: "text", text: "second" }] }] }, "firstsecond"],
      [{ content: [{ type: "text", text: "anthropic" }] }, "anthropic"],
    ];
    for (const [payload, expected] of samples) assert.equal(normalizeAIResponse(payload, options).text, expected);
    const sdkObject = { toJSON: () => ({ output_text: "sdk object" }) };
    assert.equal(normalizeAIResponse(sdkObject, options).text, "sdk object");
    assert.equal(normalizeAIResponse(samples[0][0], options).model, "returned-alias");
  });

  it("passes a realistic fenced DeepSeek response from HTTP parsing through Recipe Copilot schema validation", async () => {
    const response = await new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "recipe_copilot", messages: [{ role: "user", content: "fixture" }], responseFormat: format }, deepSeek("/fixture-e2e"), context);
    const parsed = parseStructuredResponse(response.content!, format, 512_000);
    assert.equal(parsed.schemaVersion, "1.0"); assert.equal(parsed.proposedPatch?.metadata?.name, "Test recipe");
    assert.equal(response.usage?.outputTokens, 1900); assert.equal(response.actualCost, 0.0018);
  });

  it("accepts an outer Markdown fence and harmless prose around one complete object", async () => {
    const small = { type: "json" as const, name: "fixture", schema: z.object({ name: z.string() }).strict(), allowEmbeddedJson: false };
    const response = await new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "recipe_copilot", messages: [{ role: "user", content: "fixture" }], responseFormat: small }, deepSeek("/fixture-fenced"), context);
    assert.deepEqual(parseStructuredResponse(response.content!, small, 512_000), { name: "Test recipe" });
    assert.deepEqual(parseStructuredResponse('Explanation {"name":"Test recipe"}', small, 512_000), { name: "Test recipe" });
  });

  it("preserves usage and transport diagnostics when HTTP 200 extraction fails", async () => {
    await assert.rejects(() => new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "recipe_copilot", messages: [{ role: "user", content: "fixture" }], responseFormat: format }, deepSeek("/fixture-empty"), context), (error: any) => error.category === "AI_PROVIDER_EMPTY_RESPONSE" && error.details.http_status === 200 && error.details.response_body_length > 0 && error.details.response_streamed === false && error.details.stage === "CONTENT_EXTRACTION" && error.details.usage_output_tokens === 1900 && error.details.actual_cost === 0.0018);
  });

  it("distinguishes tool-only, unknown-shape, malformed JSON, and never uses DeepSeek reasoning as final content", async () => {
    const adapter = new OpenAiCompatibleAdapter("deepseek");
    await assert.rejects(() => adapter.complete({ featureKey: "recipe_copilot", messages: [{ role: "user", content: "fixture" }], responseFormat: format }, deepSeek("/fixture-tool"), context), (error: any) => error.category === "AI_PROVIDER_TOOL_CALL_ONLY");
    await assert.rejects(() => adapter.complete({ featureKey: "connection_test", messages: [{ role: "user", content: "fixture" }] }, deepSeek("/fixture-unknown"), context), (error: any) => error.category === "AI_PROVIDER_UNSUPPORTED_RESPONSE_SHAPE");
    await assert.rejects(() => adapter.complete({ featureKey: "recipe_copilot", messages: [{ role: "user", content: "fixture" }], responseFormat: format }, deepSeek("/fixture-malformed"), context), (error: any) => error.category === "AI_PROVIDER_MALFORMED_JSON");
    const savedFailure = JSON.parse(fixture("deepseek-null-content-reasoning-response.json"));
    assert.equal(savedFailure.choices[0].message.content, null);
    await assert.rejects(() => adapter.complete({ featureKey: "recipe_copilot", messages: [{ role: "user", content: "fixture" }], responseFormat: format }, deepSeek("/fixture-reasoning"), context), (error: any) => error.category === "AI_PROVIDER_EMPTY_RESPONSE" && error.details.has_reasoning_content === true && !JSON.stringify(error.details).includes("Compatibility answer"));
  });

  it("does not expose free-form chain-of-thought from reasoning_content", () => {
    assert.throws(() => normalizeAIResponse({ choices: [{ message: { content: null, reasoning_content: "I considered several private reasoning steps." }, finish_reason: "stop" }] }, { providerType: "deepseek", provider: "DeepSeek", requestedModel: "deepseek-v4-pro", requestId: "safe-reasoning" }), (error: any) => error.category === "AI_PROVIDER_EMPTY_RESPONSE" && error.details.has_reasoning_content === true);
  });

  it("classifies refusal and truncation separately from empty content", () => {
    const options = { providerType: "openai_compatible" as const, provider: "Compatible", requestedModel: "model", requestId: "classification" };
    assert.throws(() => normalizeAIResponse({ choices: [{ message: { content: null, refusal: "Cannot comply" }, finish_reason: "stop" }] }, options), (error: any) => error.category === "AI_PROVIDER_REFUSAL");
    assert.throws(() => normalizeAIResponse({ choices: [{ message: { content: "" }, finish_reason: "length" }] }, options), (error: any) => error.category === "AI_PROVIDER_TRUNCATED_RESPONSE");
    assert.throws(() => normalizeAIResponse({ choices: [{ message: { content: '{"ok":' }, finish_reason: "length" }] }, options), (error: any) => error.category === "AI_PROVIDER_TRUNCATED_FINAL_RESPONSE");
  });

  it("keeps deterministic normalization failures off same-provider retries but eligible for an approved fallback", () => {
    for (const category of ["AI_PROVIDER_EMPTY_RESPONSE", "AI_PROVIDER_UNSUPPORTED_RESPONSE_SHAPE", "AI_PROVIDER_MALFORMED_JSON"] as const) assert.equal(isFallbackEligible(new AiError(category)), true);
    assert.equal(isFallbackEligible(new AiError("AI_PROVIDER_HTTP_ERROR", undefined, 502, undefined, { retryable: true })), true);
    assert.equal(isFallbackEligible(new AiError("AI_PRIVACY_POLICY_BLOCKED")), false);
  });

  it("runs one approved fallback and retains the original normalization failure", async () => {
    let primaryCalls = 0; let fallbackCalls = 0;
    const result = await executeEligibleFallback(async () => { primaryCalls += 1; throw new AiError("AI_PROVIDER_EMPTY_RESPONSE", undefined, 422, undefined, { usage_output_tokens: 1900, actual_cost: 0.0018 }); }, async () => { fallbackCalls += 1; return { content: "fallback succeeded", usage: { outputTokens: 20 }, actualCost: 0.0002 }; });
    assert.equal(primaryCalls, 1); assert.equal(fallbackCalls, 1); assert.equal(result.value.content, "fallback succeeded");
    assert.equal(result.originalError?.category, "AI_PROVIDER_EMPTY_RESPONSE"); assert.equal(result.originalError?.details?.usage_output_tokens, 1900);
  });

  it("keeps the operation alive beyond the legacy 30-second boundary", async () => {
    const timeout = resolveAiRequestTimeout({ providerTimeoutMs: 120_000, globalTimeoutMs: 120_000, governanceTimeoutMs: 120_000, environment: { NODE_ENV: "test", AI_REQUEST_TIMEOUT_SECONDS: "120" } });
    assert.equal(timeout.timeoutMs, 120_000); assert.ok(timeout.timeoutMs > 30_000);
    const signal = createAiRequestSignal(undefined, timeout.timeoutMs);
    try { assert.deepEqual((await safeFetchJsonDetailed(`${baseUrl}/slow`, { signal: signal.signal }, 1024)).payload, { ok: true }); }
    finally { signal.close(); }
  });

  it("classifies a genuine timeout and lets the UI consume its structured JSON envelope", async () => {
    const signal = createAiRequestSignal(undefined, 5);
    try { await assert.rejects(() => safeFetchJsonDetailed(`${baseUrl}/timeout`, { signal: signal.signal }, 1024)); assert.equal(signal.timedOut(), true); }
    finally { signal.close(); }
    assert.equal(aiFailureStatus("AI_PROVIDER_TIMEOUT"), "TIMED_OUT");
    const envelope = { code: "AI_PROVIDER_TIMEOUT", message: "DeepSeek did not respond before the 120-second timeout.", requestId: "request-123", retryable: true, provider: "DeepSeek", model: "deepseek-v4-pro", stage: "PROVIDER_REQUEST", elapsedMs: 120_001 };
    const apiResponse = new Response(JSON.stringify({ error: envelope, ...envelope }), { status: 504, headers: { "content-type": "application/json" } });
    const body = await readRecipeCopilotResponse(apiResponse, "Recipe Copilot failed.").catch((error) => error);
    assert.ok(body instanceof RecipeCopilotHttpError); assert.equal(body.code, "AI_PROVIDER_TIMEOUT"); assert.equal(body.requestId, "request-123"); assert.doesNotMatch(body.message, /JSON\.parse|unexpected character/i);
  });

  it("classifies an empty successful body without blind JSON parsing", async () => {
    await assert.rejects(() => safeFetchJsonDetailed(`${baseUrl}/empty`, {}, 1024, { requestId: "empty", provider: "DeepSeek", model: "deepseek-v4-pro" }), (error: any) => error.category === "AI_PROVIDER_EMPTY_RESPONSE" && error.details.response_body_length === 0);
  });

  it("classifies plain-text or HTML non-2xx responses as provider HTTP errors", async () => {
    await assert.rejects(() => safeFetchJsonDetailed(`${baseUrl}/html-error`, {}, 1024, { requestId: "http", provider: "DeepSeek", model: "deepseek-v4-pro" }), (error: any) => error.category === "AI_PROVIDER_HTTP_ERROR" && error.details.http_status === 502 && error.details.response_content_type.includes("html"));
  });

  it("accepts fenced JSON, a JSON string, explanatory text with one unambiguous object, direct objects, and Responses-style output", async () => {
    const small = { type: "json" as const, name: "small", schema: z.object({ nested: z.object({ ok: z.boolean() }) }).strict() };
    assert.deepEqual(parseStructuredResponse('```json\n{"nested":{"ok":true}}\n```', small, 1024), { nested: { ok: true } });
    assert.deepEqual(parseStructuredResponse(JSON.stringify('{"nested":{"ok":true}}'), small, 1024), { nested: { ok: true } });
    assert.deepEqual(parseStructuredResponse('Here is the result: {"nested":{"ok":true}} End.', small, 1024), { nested: { ok: true } });
    const adapter = new OpenAiCompatibleAdapter("deepseek");
    const direct = await adapter.complete({ featureKey: "recipe_copilot", messages: [{ role: "user", content: "fixed" }], responseFormat: format }, deepSeek("/direct"), context);
    const responses = await adapter.complete({ featureKey: "recipe_copilot", messages: [{ role: "user", content: "fixed" }], responseFormat: format }, deepSeek("/responses"), context);
    assert.equal(parseStructuredResponse(direct.content!, format, 512_000).action, "create"); assert.equal(parseStructuredResponse(responses.content!, format, 512_000).action, "create");
  });

  it("allows exactly one provider JSON repair and returns invalid response when repair fails", async () => {
    const small = { type: "json" as const, name: "small", schema: z.object({ ok: z.boolean() }).strict() };
    let repairs = 0;
    const repaired = await parseStructuredResponseWithProviderRepair({ content: "{bad", format: small, maxBytes: 1024, providerRepairAttempts: 1, repair: async () => { repairs += 1; return '{"ok":true}'; } });
    assert.equal(repairs, 1); assert.equal(repaired.data.ok, true); assert.equal(repaired.providerRepairUsed, true);
    repairs = 0;
    await assert.rejects(() => parseStructuredResponseWithProviderRepair({ content: "{bad", format: small, maxBytes: 1024, providerRepairAttempts: 1, repair: async () => { repairs += 1; return "still bad"; } }), (error: any) => error.category === "AI_PROVIDER_INVALID_RESPONSE");
    assert.equal(repairs, 1);
  });

  it("offers one controlled repair for syntactically valid schema violations", async () => {
    const small = { type: "json" as const, name: "small", schema: z.object({ required: z.string() }).strict() };
    let repairs = 0;
    const repaired = await parseStructuredResponseWithProviderRepair({ content: '{"different":true}', format: small, maxBytes: 1024, providerRepairAttempts: 1, repair: async () => { repairs += 1; return '{"required":"fixed"}'; } });
    assert.equal(repairs, 1); assert.equal(repaired.data.required, "fixed");
    assert.equal(aiFailureStatus("AI_FEATURE_INVALID_STRUCTURED_OUTPUT"), "INVALID_RESPONSE");
  });

  it("handles a non-JSON backend error in the frontend without throwing JSON.parse", async () => {
    const error = await readRecipeCopilotResponse(new Response("Gateway Timeout", { status: 504, headers: { "content-type": "text/plain" } }), "Recipe Copilot failed.").catch((caught) => caught);
    assert.ok(error instanceof RecipeCopilotHttpError); assert.equal(error.code, "AI_RECIPE_REQUEST_FAILED"); assert.match(error.message, /Gateway Timeout/); assert.doesNotMatch(error.message, /JSON\.parse|unexpected character/i);
  });

  it("validates timeout configuration bounds and defaults to 120 seconds", () => {
    assert.equal(configuredAiRequestTimeoutMs({ NODE_ENV: "test" }), 120_000);
    assert.throws(() => configuredAiRequestTimeoutMs({ NODE_ENV: "test", AI_REQUEST_TIMEOUT_SECONDS: "29" }), /30 to 600/);
    assert.throws(() => configuredAiRequestTimeoutMs({ NODE_ENV: "test", AI_REQUEST_TIMEOUT_SECONDS: "601" }), /30 to 600/);
  });

  it("preserves Metadata Limited privacy and the review-only governance boundary", () => {
    const context = buildPrivacyAwareRecipeContext({ name: "Private mix", accessToken: "secret", filters: { libraryId: "library", pinnedTrackIds: ["track-1"], rules: [] }, automationPolicy: { enabled: true } }, "METADATA_LIMITED");
    const serialized = JSON.stringify(context.recipe); assert.doesNotMatch(serialized, /Private mix|secret|library|track-1/);
    const service = readFileSync(join(process.cwd(), "src/lib/recipeCopilot/service.ts"), "utf8");
    const component = readFileSync(join(process.cwd(), "src/components/RecipeCopilot.tsx"), "utf8");
    const api = readFileSync(join(process.cwd(), "src/lib/recipeCopilot/api.ts"), "utf8");
    for (const marker of ["assertAiExecutionPolicy", "previewAiRequest", "externalConfirmation", "AI_FEATURE_INVALID_STRUCTURED_OUTPUT", "enabled: false"]) assert.match(service, new RegExp(marker));
    assert.match(component, /review required/i); assert.match(component, /Nothing is approved or activated automatically/); assert.doesNotMatch(component.slice(component.indexOf("async function generate"), component.indexOf("function cancel")), /fetch\([^\n]*(?:approve|activate|save)/i);
    for (const field of ["requestId", "retryable", "provider", "model", "stage", "elapsedMs"]) assert.match(api, new RegExp(field));
  });
});
