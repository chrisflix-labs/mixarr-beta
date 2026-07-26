import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { z } from "zod";
import type { ResolvedAiProviderConfig } from "../ai/contracts";
import { resolveNormalizedOutputTokenLimit } from "../ai/governance/outputTokenLimits";
import { OpenAiCompatibleAdapter } from "../ai/providers/openAiCompatible";
import { normalizeAIResponse } from "../ai/providers/normalizeResponse";
import { resolveModelCapabilities } from "../ai/registry/modelCapabilities";

let server: http.Server;
let baseUrl = "";
const requests: Array<{ url: string; body: any }> = [];
const fixture = JSON.parse(readFileSync(join(process.cwd(), "src/lib/fixtures/deepseek-v4-truncated-before-final.json"), "utf8"));

before(async () => {
  let retryCalls = 0;
  server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    requests.push({ url: request.url || "", body });
    response.setHeader("content-type", "application/json");
    response.setHeader("x-request-id", `request-${requests.length}`);
    if (request.url?.endsWith("/models")) return response.end(JSON.stringify({ data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }] }));
    if (request.url === "/truncated/chat/completions") return response.end(JSON.stringify(fixture));
    if (request.url === "/partial/chat/completions") return response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: '{"ok":' }, finish_reason: "length" }], usage: { prompt_tokens: 20, completion_tokens: 128 } }));
    if (request.url === "/invalid/chat/completions") return response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "not json" }, finish_reason: "stop" }] }));
    if (request.url === "/retry/chat/completions") { retryCalls += 1; return response.end(JSON.stringify(retryCalls === 1 ? fixture : { choices: [{ message: { role: "assistant", content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 8 } })); }
    return response.end(JSON.stringify({ model: body.model, choices: [{ message: { role: "assistant", content: '{"ok":true}', reasoning_content: "private fixture reasoning" }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 4 } } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

function provider(path = "/success", customConfiguration: Record<string, unknown> = {}): ResolvedAiProviderConfig {
  return { id: "deepseek", providerType: "deepseek", displayName: "DeepSeek", enabled: true, approved: true, locationClassification: "REMOTE", baseUrl: `${baseUrl}${path}`, authenticationType: "BEARER", apiKey: "not-a-real-secret", secretHeaders: {}, nonSecretHeaders: {}, defaultModel: "deepseek-v4-pro", requestTimeoutMs: 120_000, retryCount: 1, initialRetryDelayMs: 1, maximumRetryDelayMs: 1, retryBackoffMultiplier: 1, sslVerification: true, capabilityOverrides: {}, customConfiguration };
}
const context = (providerType: "deepseek" | "openai_compatible" = "deepseek") => ({ requestId: "correlation", providerId: "deepseek", model: "deepseek-v4-pro", signal: new AbortController().signal, maxResponseBytes: 64_000, modelCapabilities: resolveModelCapabilities(providerType, "deepseek-v4-pro") });
const format = { type: "json" as const, name: "test", schema: z.object({ ok: z.literal(true) }).strict(), allowEmbeddedJson: false };

describe("v2.4.16 DeepSeek V4 thinking and truncation reliability", () => {
  it("uses the dedicated deterministic provider-test request with thinking disabled and an adequate allowance", async () => {
    requests.length = 0;
    const result = await new OpenAiCompatibleAdapter("deepseek").testConnection(provider(), undefined, "deepseek-v4-pro", { maxOutputTokens: 128, requestedMaxTokens: 128, effectiveMaxTokens: 128, outputTokenLimitingSource: "request", retryAttempt: 0, thinkingMode: "disabled" });
    const sent = requests.find((item) => item.url.endsWith("/chat/completions"))!.body;
    assert.deepEqual(sent.thinking, { type: "disabled" });
    assert.equal(sent.max_tokens, 128); assert.equal(sent.stream, false); assert.deepEqual(sent.response_format, { type: "json_object" });
    assert.equal("reasoning_effort" in sent, false); assert.equal("tools" in sent, false); assert.equal("tool_choice" in sent, false);
    assert.match(sent.messages[0].content, /valid JSON/); assert.equal(sent.messages[1].content, 'Return exactly this JSON object: {"ok":true}');
    assert.equal(result.connected, true); assert.equal(result.providerRequestId?.startsWith("request-"), true);
  });

  it("uses final content even when reasoning metadata is present and never returns the reasoning text", async () => {
    const response = await new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "structured", messages: [{ role: "user", content: "Return JSON" }], responseFormat: format, maxOutputTokens: 128 }, provider(), context());
    assert.equal(response.content, '{"ok":true}'); assert.equal(response.hasReasoningContent, true); assert.equal(response.reasoningCharacterCount, "private fixture reasoning".length);
    assert.doesNotMatch(JSON.stringify(response), /private fixture reasoning/);
  });

  it("classifies the reported HTTP-200 shape as truncated before final and sanitizes reasoning", async () => {
    let warning = ""; const original = console.warn; console.warn = (...values: unknown[]) => { warning += JSON.stringify(values); };
    try {
      await assert.rejects(() => new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "administrative_connection_test", messages: [{ role: "user", content: "JSON" }], responseFormat: format, maxOutputTokens: 128, requestSource: "CONNECTION_TEST" }, provider("/truncated"), context()), (error: any) => error.category === "AI_PROVIDER_TRUNCATED_BEFORE_FINAL" && error.details.parent_category === "AI_PROVIDER_TRUNCATED_RESPONSE" && error.details.http_status === 200 && error.details.finish_reason === "length" && error.details.has_reasoning_content === true && error.details.reasoning_character_count === "sanitized test reasoning".length && !JSON.stringify(error).includes("sanitized test reasoning"));
      assert.doesNotMatch(warning, /sanitized test reasoning/);
    } finally { console.warn = original; }
  });

  it("classifies partial final content separately", async () => {
    await assert.rejects(() => new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "structured", messages: [{ role: "user", content: "JSON" }], responseFormat: format, maxOutputTokens: 128 }, provider("/partial"), context()), (error: any) => error.category === "AI_PROVIDER_TRUNCATED_FINAL_RESPONSE" && error.details.final_content_character_count > 0);
  });

  it("classifies normal-finish invalid provider-test JSON separately", async () => {
    await assert.rejects(() => new OpenAiCompatibleAdapter("deepseek").testConnection(provider("/invalid"), undefined, "deepseek-v4-pro", { maxOutputTokens: 128, requestedMaxTokens: 128, effectiveMaxTokens: 128, outputTokenLimitingSource: "request", retryAttempt: 0, thinkingMode: "disabled" }), (error: any) => error.category === "AI_PROVIDER_INVALID_STRUCTURED_RESPONSE" && error.details.finish_reason === "stop");
  });

  it("supports one larger provider-test retry profile and the same tiny prompt", async () => {
    const adapter = new OpenAiCompatibleAdapter("deepseek"); const configured = provider("/retry");
    await assert.rejects(() => adapter.testConnection(configured, undefined, "deepseek-v4-pro", { maxOutputTokens: 128, requestedMaxTokens: 128, effectiveMaxTokens: 128, outputTokenLimitingSource: "request", retryAttempt: 0, thinkingMode: "disabled" }), (error: any) => error.category === "AI_PROVIDER_TRUNCATED_BEFORE_FINAL");
    const result = await adapter.testConnection(configured, undefined, "deepseek-v4-pro", { maxOutputTokens: 256, requestedMaxTokens: 256, effectiveMaxTokens: 256, outputTokenLimitingSource: "request", retryAttempt: 1, thinkingMode: "disabled" });
    assert.equal(result.connected, true);
    const sent = requests.filter((item) => item.url === "/retry/chat/completions").map((item) => item.body);
    assert.equal(sent.length, 2); assert.deepEqual(sent.map((item) => item.max_tokens), [128, 256]); assert.equal(sent.every((item) => item.thinking?.type === "disabled"), true);
  });

  it("never sends max_tokens zero and preserves zero-as-unlimited provider-test defaults", async () => {
    requests.length = 0;
    await new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "freeform", messages: [{ role: "user", content: "hello" }], maxOutputTokens: 0 }, provider(), context());
    const sent = requests.find((item) => item.url.endsWith("/chat/completions"))!.body;
    assert.equal(sent.max_tokens > 0, true); assert.notEqual(sent.max_tokens, 0);
    const limit = resolveNormalizedOutputTokenLimit({ requestedOutputTokens: 128, configuredProviderLimit: 0, configuredFeatureLimit: 0, configuredUserLimit: 0 });
    assert.equal(limit.effectiveOutputTokens, 128); assert.equal(limit.unlimited, true);
    const hard = resolveNormalizedOutputTokenLimit({ requestedOutputTokens: 128, configuredProviderLimit: 64 });
    assert.equal(hard.effectiveOutputTokens, 64); assert.equal(hard.limitingSource, "provider");
  });

  it("omits sampling in DeepSeek thinking mode and never sends DeepSeek fields to other compatible providers", async () => {
    requests.length = 0;
    await new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "advisory", messages: [{ role: "user", content: "advise" }], thinkingMode: "enabled", reasoningEffort: "medium", temperature: 0.7, maxOutputTokens: 128 }, provider("/success", { thinkingMode: "enabled" }), context());
    const thinking = requests.find((item) => item.url.endsWith("/chat/completions"))!.body;
    assert.deepEqual(thinking.thinking, { type: "enabled" }); assert.equal(thinking.reasoning_effort, "medium"); assert.equal("temperature" in thinking, false); assert.equal("top_p" in thinking, false); assert.equal("presence_penalty" in thinking, false); assert.equal("frequency_penalty" in thinking, false);
    requests.length = 0;
    const compatible = { ...provider(), providerType: "openai_compatible" as const };
    await new OpenAiCompatibleAdapter("openai_compatible").complete({ featureKey: "advisory", messages: [{ role: "user", content: "advise" }], thinkingMode: "enabled", maxOutputTokens: 128 }, compatible, context("openai_compatible"));
    const generic = requests.find((item) => item.url.endsWith("/chat/completions"))!.body;
    assert.equal("thinking" in generic, false); assert.equal("reasoning_effort" in generic, false);
  });

  it("forces structured DeepSeek requests off and always adds an explicit JSON instruction", async () => {
    requests.length = 0;
    await new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "structured", messages: [{ role: "user", content: "Return the object" }], responseFormat: format, maxOutputTokens: 128 }, provider("/success", { thinkingMode: "enabled" }), context());
    const sent = requests.find((item) => item.url.endsWith("/chat/completions"))!.body;
    assert.deepEqual(sent.thinking, { type: "disabled" }); assert.match(sent.messages[0].content, /valid JSON/i);
  });

  it("advertises both DeepSeek V4 models and keeps normal truncation off automatic retries", () => {
    for (const model of ["deepseek-v4-pro", "deepseek-v4-flash"]) { const capabilities = resolveModelCapabilities("deepseek", model); assert.equal(capabilities.supportsThinkingMode, true); assert.equal(capabilities.supportsReasoning, true); }
    const coordinator = readFileSync(join(process.cwd(), "src/ai/request-coordinator/index.ts"), "utf8");
    assert.doesNotMatch(coordinator, /const truncationRetry\s*=/); assert.doesNotMatch(coordinator, /Truncation recovery: restart/);
    const health = readFileSync(join(process.cwd(), "src/ai/health/service.ts"), "utf8");
    assert.match(health, /retryAttempt:\s*1/); assert.match(health, /prepareAiRetry/); assert.match(health, /retryLimit\.effectiveOutputTokens <= initialProfile\.effectiveMaxTokens/);
  });

  it("never lists reasoning_content as a final extractor path", () => {
    const source = readFileSync(join(process.cwd(), "src/ai/providers/normalizeResponse.ts"), "utf8");
    assert.doesNotMatch(source, /attempts\.push\(["']choices\[0\]\.message\.reasoning_content/);
    assert.throws(() => normalizeAIResponse(fixture, { providerType: "deepseek", provider: "DeepSeek", requestedModel: "deepseek-v4-pro", requestId: "fixture" }), (error: any) => !error.details.extractor_path_attempts.includes("choices[0].message.reasoning_content"));
  });
});
