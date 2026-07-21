import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ResolvedAiProviderConfig } from "../ai/contracts";
import { AiError } from "../ai/errors";
import { OpenAIProviderAdapter, classifyOpenAiHttpError, classifyOpenAiModel, extractOpenAiResponseText, normalizeOpenAiBaseUrl } from "../ai/providers/openai";

let server: http.Server;
let baseUrl = "";
let lastRequest: { url?: string; method?: string; authorization?: string; body?: any } = {};

before(async () => {
  server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    lastRequest = { url: request.url, method: request.method, authorization: request.headers.authorization, body };
    response.setHeader("content-type", "application/json");
    response.setHeader("x-request-id", "req_safe_test");
    if (request.url === "/v1/models") return response.end(JSON.stringify({ data: [{ id: "gpt-5.6-luna", owned_by: "openai" }, { id: "text-embedding-3-small", owned_by: "openai" }, { id: "gpt-4o-transcribe", owned_by: "openai" }] }));
    if (request.url === "/v1/responses" && body?.model === "bad-json") return response.end("not-json");
    if (request.url === "/v1/responses" && body?.model?.startsWith("error-")) {
      const status = Number(body.model.slice(6)); response.statusCode = status;
      const error = status === 429 ? { type: "rate_limit_error", code: "rate_limit_exceeded", message: "Please retry later." } : status === 404 ? { type: "invalid_request_error", code: "model_not_found", param: "model", message: "The requested model was not found." } : { type: "invalid_request_error", code: "invalid_value", param: "input", message: "Invalid input." };
      return response.end(JSON.stringify({ error }));
    }
    if (request.url === "/v1/responses" && body?.model === "quota") { response.statusCode = 429; return response.end(JSON.stringify({ error: { type: "insufficient_quota", code: "insufficient_quota", message: "You exceeded your current quota and billing limit." } })); }
    if (request.url === "/v1/responses") return response.end(JSON.stringify({ id: "resp_test", object: "response", status: "completed", model: body.model, output: [{ type: "message", status: "completed", content: [{ type: "output_text", text: "MIXARR_OK" }] }], usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10, input_tokens_details: { cached_tokens: 1 }, output_tokens_details: { reasoning_tokens: 2 } } }));
    response.statusCode = 404; response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

function config(patch: Partial<ResolvedAiProviderConfig> = {}): ResolvedAiProviderConfig {
  return { id: "provider-test", providerType: "openai", displayName: "OpenAI", enabled: true, locationClassification: "REMOTE", baseUrl, authenticationType: "BEARER", apiKey: "sk-test-not-real", secretHeaders: {}, nonSecretHeaders: {}, defaultModel: "gpt-5.6-luna", requestTimeoutMs: 5000, retryCount: 0, initialRetryDelayMs: 100, maximumRetryDelayMs: 1000, retryBackoffMultiplier: 2, sslVerification: true, capabilityOverrides: {}, customConfiguration: {}, ...patch };
}

describe("v2.4.3 native OpenAI adapter", () => {
  it("uses the Models API and conservatively distinguishes eligible text models", async () => {
    const models = await new OpenAIProviderAdapter().discoverModels(config());
    assert.equal(lastRequest.url, "/v1/models");
    assert.equal(lastRequest.authorization, "Bearer sk-test-not-real");
    assert.equal(models.find((model) => model.id === "gpt-5.6-luna")?.compatibility?.suitableForConnectionTest, true);
    assert.equal(models.find((model) => model.id.includes("embedding"))?.compatibility?.suitableForConnectionTest, false);
    assert.equal(models.find((model) => model.id.includes("transcribe"))?.compatibility?.suitableForConnectionTest, false);
  });

  it("sends the exact minimal Responses API test payload and extracts Responses usage", async () => {
    const result = await new OpenAIProviderAdapter().testConnection(config(), undefined, "gpt-5.6-luna");
    assert.equal(lastRequest.url, "/v1/responses");
    assert.deepEqual(lastRequest.body, { model: "gpt-5.6-luna", input: "Reply with exactly: MIXARR_OK", max_output_tokens: 16 });
    for (const unsupported of ["messages", "max_tokens", "temperature", "top_p", "response_format", "reasoning_effort", "tools", "stream"]) assert.equal(unsupported in lastRequest.body, false);
    assert.equal(result.connected, true); assert.equal(result.endpointMode, "RESPONSES_API"); assert.equal(result.responseId, "resp_test"); assert.equal(result.providerRequestId, "req_safe_test");
    assert.deepEqual({ input: result.usage?.inputTokens, output: result.usage?.outputTokens, total: result.usage?.totalTokens, cached: result.usage?.cachedTokens, reasoning: result.usage?.reasoningTokens }, { input: 7, output: 3, total: 10, cached: 1, reasoning: 2 });
  });

  it("parses nested output_text without requiring a Chat Completions choices array", () => {
    assert.equal(extractOpenAiResponseText({ output: [{ content: [{ type: "output_text", text: "hello" }] }] }), "hello");
    assert.equal(extractOpenAiResponseText({ output_text: "shortcut" }), "shortcut");
  });

  it("normalizes API roots without duplicate v1 paths and rejects endpoint or dashboard URLs", () => {
    assert.equal(normalizeOpenAiBaseUrl("https://api.openai.com"), "https://api.openai.com/v1");
    assert.equal(normalizeOpenAiBaseUrl("https://api.openai.com/v1/"), "https://api.openai.com/v1");
    assert.equal(normalizeOpenAiBaseUrl("https://api.openai.com/v1/v1"), "https://api.openai.com/v1");
    assert.throws(() => normalizeOpenAiBaseUrl("https://api.openai.com/v1/responses"), (error: any) => error.category === "PROVIDER_ENDPOINT_INVALID");
    assert.throws(() => normalizeOpenAiBaseUrl("https://platform.openai.com/api-keys"), (error: any) => error.category === "PROVIDER_ENDPOINT_INVALID");
    assert.throws(() => normalizeOpenAiBaseUrl("https://api.openai.com/v1?api_key=secret"), (error: any) => error.category === "PROVIDER_ENDPOINT_INVALID");
  });

  it("maps provider HTTP failures by cause and retains only sanitized diagnostics", () => {
    const cases: Array<[number, any, string]> = [
      [400, { error: { code: "invalid_value", message: "Invalid input" } }, "PROVIDER_REQUEST_INVALID"],
      [401, { error: { code: "invalid_api_key", message: "Bad key" } }, "PROVIDER_UNAUTHORIZED"],
      [403, { error: { code: "permission_denied", message: "Denied" } }, "PROVIDER_PERMISSION_DENIED"],
      [404, { error: { code: "model_not_found", param: "model", message: "Model missing" } }, "MODEL_NOT_AVAILABLE"],
      [429, { error: { code: "rate_limit_exceeded", message: "Slow down" } }, "PROVIDER_RATE_LIMITED"],
      [429, { error: { code: "insufficient_quota", message: "Billing quota exhausted" } }, "PROVIDER_QUOTA_EXCEEDED"],
      [500, { error: { code: "server_error", message: "Unavailable" } }, "PROVIDER_SERVICE_ERROR"],
      [408, { error: { code: "timeout", message: "Timeout" } }, "PROVIDER_TIMEOUT"],
    ];
    for (const [status, body, category] of cases) { const error = classifyOpenAiHttpError(status, body, "req_123"); assert.equal(error.category, category); assert.equal(error.details?.http_status, status); assert.equal(error.details?.provider_request_id, "req_123"); }
    const modelCompatibility = classifyOpenAiHttpError(400, { error: { param: "model", code: "unsupported_model", message: "Model does not support this operation" } });
    assert.equal(modelCompatibility.category, "MODEL_NOT_COMPATIBLE");
  });

  it("returns malformed success as PROVIDER_RESPONSE_INVALID and real fetch failures as PROVIDER_CONNECTION_FAILED", async () => {
    await assert.rejects(() => new OpenAIProviderAdapter().testConnection(config({ defaultModel: "bad-json" }), undefined, "bad-json"), (error: any) => error.category === "PROVIDER_RESPONSE_INVALID");
    await assert.rejects(() => new OpenAIProviderAdapter().testConnection(config({ baseUrl: "http://127.0.0.1:1/v1" })), (error: any) => error.category === "PROVIDER_CONNECTION_FAILED");
  });

  it("never sends redacted or placeholder credentials", async () => {
    for (const apiKey of ["********", "configured", "stored", ""]) await assert.rejects(() => new OpenAIProviderAdapter().discoverModels(config({ apiKey })), (error: any) => error.category === "PROVIDER_SECRET_UNAVAILABLE");
  });
});

describe("v2.4.3 OpenAI health, audit, governance, and UI contracts", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  it("registers native OpenAI separately while compatible providers keep chat completions", () => { const registry = read("src/ai/registry/providerRegistry.ts"); const compatible = read("src/ai/providers/openAiCompatible.ts"); assert.match(registry, /new OpenAIProviderAdapter/); assert.doesNotMatch(registry, /compatible\("openai"/); assert.match(compatible, /chatCompletionEndpoint/); });
  it("tracks authentication, discovery, and inference independently without discovery claiming healthy inference", () => { const schema = read("prisma/schema.prisma"); const health = read("src/ai/health/service.ts"); for (const field of ["authenticationState", "discoveryState", "inferenceState", "lastSuccessfulInferenceAt", "lastFailedRequestAt"]) assert.match(schema, new RegExp(field)); assert.match(health, /healthState: current\?\.inferenceState === "HEALTHY" \? "HEALTHY" : "AUTHENTICATED"/); assert.match(health, /inferenceState: "FAILED"/); });
  it("selects a compatible test model deterministically and never changes the default during testing", () => { const health = read("src/ai/health/service.ts"); assert.match(health, /orderBy: \{ modelIdentifier: "asc" \}/); assert.match(health, /eligible\.find\(\(model\) => model\.modelIdentifier === defaultModel\) \|\| eligible\[0\]/); assert.match(health, /MODEL_NOT_AVAILABLE/); assert.match(health, /MODEL_NOT_COMPATIBLE/); const testFunction = health.slice(health.indexOf("export async function testAiProviderConnection"), health.indexOf("export async function verifyAiProviderCredentials")); assert.doesNotMatch(testFunction, /defaultModel:\s/); });
  it("classifies native OpenAI as paid independently from missing model pricing and keeps paid permission enforcement", () => { const classification = read("src/ai/governance/classification.ts"); const governance = read("src/ai/governance/service.ts"); assert.match(classification, /provider\.providerType === "openai"[\s\S]*classification: "EXTERNAL_PAID"/); assert.match(governance, /PAID_PROVIDER_NOT_PERMITTED/); assert.match(governance, /administrativeInferenceTest/); });
  it("records explicit test stages, safe provider diagnostics, request IDs, usage, and non-zero-assuming cost states", () => { const schema = read("prisma/schema.prisma"); const governance = read("src/ai/governance/service.ts"); for (const field of ["testStage", "governanceResult", "modelCompatibilityResult", "httpStatus", "providerErrorCode", "providerRequestId", "costState"]) assert.match(schema, new RegExp(field)); for (const state of ["NO_BILLABLE_USAGE_REPORTED", "NOT_SENT", "USAGE_UNAVAILABLE", "USAGE_RECORDED_PRICING_NOT_CONFIGURED"]) assert.match(governance, new RegExp(state)); });
  it("offers distinct credential, discovery, and inference actions with model compatibility and duplicate-click protection", () => { const ui = read("src/components/AiProviderDashboard.tsx"); for (const marker of [/Verify credentials/, /Discover models/, /Test inference/, /Current default:/, /Responses API/, /incompatible/, /Correlation ID:/, /provider_request_id/, /disabled=\{!!busyId \|\| !testModel\}/]) assert.match(ui, marker); assert.match(ui, /Existing secrets are never returned/); });
  it("keeps existing secrets on blank edits and rejects redacted placeholders server-side", () => { const wizard = read("src/lib/aiProviderWizard.ts"); const service = read("src/ai/services/providerService.ts"); assert.match(wizard, /apiKeyAction.*keep/); assert.match(service, /existing\?\.encryptedSecretPayload/); assert.match(service, /\*\+\|configured\|stored/); });
  it("ships the additive v2.4.3 migration without destructive statements", () => { const sql = read("prisma/migrations/20260722010000_openai_provider_hotfix_v243/migration.sql"); assert.doesNotMatch(sql, /^\s*(DROP|DELETE|TRUNCATE|UPDATE)\b/im); assert.match(sql, /ALTER TABLE "AiProviderHealth"/); assert.match(sql, /ALTER TABLE "AiRequestAudit"/); });
});
