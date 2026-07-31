import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AiError } from "../ai/errors";
import { OpenAiCompatibleAdapter } from "../ai/providers/openAiCompatible";
import { resolveModelCapabilities } from "../ai/registry/modelCapabilities";
import { parseStructuredResponseDetailed, parseStructuredResponseWithProviderRepair } from "../ai/validation";
import { jsonSchemaExample, zodToJsonSchema } from "../ai/validation/jsonSchema";
import {
  PLAYLIST_SUMMARY_JSON_SCHEMA,
  PLAYLIST_SUMMARY_SCHEMA_EXAMPLE,
  PLAYLIST_SUMMARY_SYSTEM_PROMPT,
} from "../ai/playlistSummaries/prompts";
import {
  playlistSummaryResponseFormat,
  safePlaylistSummaryLogDetails,
} from "../ai/playlistSummaries/responseFormat";
import type { ResolvedAiProviderConfig } from "../ai/contracts";
import { summaryProviderResponseSchema } from "./aiAdvisory/contracts";

const item = {
  type: "ONE_SENTENCE" as const,
  text: "A factual three-track playlist summary.",
  usedFacts: ["trackCount"],
  unavailableFacts: [],
};
const canonical = { schemaVersion: "1.0", summaries: [item] };
const parse = (value: unknown) => parseStructuredResponseDetailed(JSON.stringify(value), playlistSummaryResponseFormat, 64_000);

describe("AI Playlist Summaries response normalization", () => {
  it("accepts canonical and explicitly empty canonical objects", () => {
    assert.deepEqual(parse(canonical).data, canonical);
    assert.deepEqual(parse({ summaries: [] }).data, { schemaVersion: "1.0", summaries: [] });
  });

  it("normalizes a bare summary array", () => {
    const result = parse([item]);
    assert.deepEqual(result.data, canonical);
    assert.equal(result.repairMethod, "WRAPPED_BARE_SUMMARY_ARRAY");
  });

  for (const wrapper of ["result", "data", "output", "response"] as const) {
    it(`normalizes ${wrapper}.summaries when it is the only candidate`, () => {
      assert.deepEqual(parse({ [wrapper]: { summaries: [item] } }).data, canonical);
    });
  }

  for (const alias of ["playlistSummaries", "playlist_summaries"] as const) {
    it(`normalizes the ${alias} alias when it is unambiguous`, () => {
      assert.deepEqual(parse({ [alias]: [item] }).data, canonical);
    });
  }

  it("retains generic fenced and brief-prose JSON extraction", () => {
    assert.deepEqual(parseStructuredResponseDetailed(`\`\`\`json\n${JSON.stringify(canonical)}\n\`\`\``, playlistSummaryResponseFormat, 64_000).data, canonical);
    assert.deepEqual(parseStructuredResponseDetailed(`Here is the requested object: ${JSON.stringify(canonical)} Thanks.`, playlistSummaryResponseFormat, 64_000).data, canonical);
  });

  it("removes harmless root metadata before strict validation", () => {
    const result = parse({ ...canonical, request: "provider-request-id", usage: { tokens: 12 } });
    assert.deepEqual(result.data, canonical);
    assert.deepEqual(Object.keys(result.data), ["schemaVersion", "summaries"]);
  });

  it("fails safely for missing, wrong-type, and ambiguous summary candidates", () => {
    assert.throws(() => parse({ items: [item] }), (error: any) => error instanceof AiError && error.details?.failure_stage === "NO_SUMMARY_CANDIDATE");
    assert.throws(() => parse({ summaries: { value: [item] } }), (error: any) => error instanceof AiError && error.details?.failure_stage === "SUMMARY_ROOT_NORMALIZATION");
    assert.throws(() => parse({ summaries: [item], result: { summaries: [item] } }), (error: any) => error instanceof AiError && error.details?.failure_stage === "AMBIGUOUS_SUMMARY_CANDIDATES");
  });

  it("does not strip or accept invalid fields inside summary items", () => {
    assert.throws(() => parse({ summaries: [{ ...item, privateComment: "do not accept" }] }), (error: any) => error instanceof AiError && error.details?.failure_stage === "SUMMARY_ITEM_VALIDATION" && Array.isArray(error.details?.issues) && error.details.issues.some((issue: any) => issue.code === "unrecognized_keys"));
    assert.throws(() => parse({ summaries: [{ ...item, text: "" }] }), (error: any) => error instanceof AiError && error.details?.failure_stage === "SUMMARY_ITEM_VALIDATION");
  });

  it("derives the provider schema and complete prompt example from the validation schema", () => {
    assert.deepEqual(PLAYLIST_SUMMARY_JSON_SCHEMA, zodToJsonSchema(summaryProviderResponseSchema));
    assert.deepEqual(PLAYLIST_SUMMARY_SCHEMA_EXAMPLE, jsonSchemaExample(PLAYLIST_SUMMARY_JSON_SCHEMA));
    summaryProviderResponseSchema.parse(PLAYLIST_SUMMARY_SCHEMA_EXAMPLE);
    assert.match(PLAYLIST_SUMMARY_SYSTEM_PROMPT, /root property must be named exactly "summaries"/);
    assert.match(PLAYLIST_SUMMARY_SYSTEM_PROMPT, /No prose|no prose/i);
    assert.ok(PLAYLIST_SUMMARY_SYSTEM_PROMPT.includes(JSON.stringify(PLAYLIST_SUMMARY_JSON_SCHEMA)));
  });

  it("emits only privacy-safe shape and validation diagnostics", () => {
    const privateValue = "Secret Track Name api-key=never-log-this";
    let details: Record<string, unknown> | undefined;
    try { parse({ result: { summaries: [{ ...item, text: "", usedFacts: [privateValue] }] } }); }
    catch (error) { details = (error as AiError).details; }
    const logged = JSON.stringify(safePlaylistSummaryLogDetails(details));
    assert.doesNotMatch(logged, /Secret Track Name|never-log-this|factual three-track/i);
    assert.match(logged, /rootValueType|rootPropertyNames|nestedWrapperPropertyNames|issues/);
  });
});

describe("AI Playlist Summaries one-shot repair", () => {
  it("repairs an invalid response into the canonical shape", async () => {
    let repairs = 0;
    const result = await parseStructuredResponseWithProviderRepair({
      content: JSON.stringify({ items: [item] }), format: playlistSummaryResponseFormat, maxBytes: 64_000, providerRepairAttempts: 1,
      repair: async (_content, details) => { repairs += 1; assert.equal(details?.failure_stage, "NO_SUMMARY_CANDIDATE"); return JSON.stringify(canonical); },
    });
    assert.equal(repairs, 1);
    assert.equal(result.providerRepairUsed, true);
    assert.deepEqual(result.data, canonical);
  });

  it("returns a typed failure when the single repair is still invalid", async () => {
    let repairs = 0;
    await assert.rejects(() => parseStructuredResponseWithProviderRepair({
      content: JSON.stringify({ items: [item] }), format: playlistSummaryResponseFormat, maxBytes: 64_000, providerRepairAttempts: 1,
      repair: async () => { repairs += 1; return JSON.stringify({ summaries: "still wrong" }); },
    }), (error: any) => error instanceof AiError && error.category === "AI_PROVIDER_INVALID_RESPONSE" && error.details?.repair_attempted === true && error.details?.repair_failed === true);
    assert.equal(repairs, 1);
  });

  it("never invokes repair more than once", async () => {
    let repairs = 0;
    await assert.rejects(() => parseStructuredResponseWithProviderRepair({
      content: "not json", format: playlistSummaryResponseFormat, maxBytes: 64_000, providerRepairAttempts: 99,
      repair: async () => { repairs += 1; return "also not json"; },
    }));
    assert.equal(repairs, 1);
  });
});

describe("AI Playlist Summaries provider integration", () => {
  let server: Server;
  let baseUrl = "";
  const requests: any[] = [];

  before(async () => {
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const parsed = body ? JSON.parse(body) : {};
        requests.push(parsed);
        response.writeHead(200, { "content-type": "application/json", "x-request-id": "provider-safe-id" });
        response.end(JSON.stringify({ id: "completion", model: parsed.model, choices: [{ message: { content: JSON.stringify({ items: [item] }) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

  it("uses DeepSeek's strongest supported JSON-object mode and rejects HTTP 200 schema failures", async () => {
    const config: ResolvedAiProviderConfig = { id: "deepseek", providerType: "deepseek", displayName: "DeepSeek", enabled: true, approved: true, locationClassification: "REMOTE", baseUrl, authenticationType: "BEARER", apiKey: "fixture-key", secretHeaders: {}, nonSecretHeaders: {}, defaultModel: "deepseek-v4-pro", requestTimeoutMs: 30_000, retryCount: 0, initialRetryDelayMs: 1, maximumRetryDelayMs: 1, retryBackoffMultiplier: 1, sslVerification: true, capabilityOverrides: {}, customConfiguration: {} };
    const capabilities = resolveModelCapabilities("deepseek", "deepseek-v4-pro");
    const response = await new OpenAiCompatibleAdapter("deepseek").complete({ featureKey: "playlist_ai_summaries", messages: [{ role: "user", content: "fixture" }], responseFormat: playlistSummaryResponseFormat }, config, { requestId: "playlist-request-id", providerId: config.id, model: "deepseek-v4-pro", signal: new AbortController().signal, maxResponseBytes: 64_000, modelCapabilities: capabilities });
    assert.equal(response.transport?.httpStatus, 200);
    assert.throws(() => parseStructuredResponseDetailed(response.content || "", playlistSummaryResponseFormat, 64_000), (error: any) => error.details.failure_stage === "NO_SUMMARY_CANDIDATE");
    const sent = requests.at(-1);
    assert.deepEqual(sent.response_format, { type: "json_object" });
    assert.deepEqual(sent.thinking, { type: "disabled" });
    assert.equal(sent.stream, false);
    assert.match(sent.messages[0].content, /"summaries"/);
    assert.equal(capabilities.structuredOutputMode, "json_object");
  });

  it("keeps explicit provider capability modes instead of assuming OpenAI parity", () => {
    assert.equal(resolveModelCapabilities("openai", "gpt-4.1").structuredOutputMode, "strict_json_schema");
    assert.equal(resolveModelCapabilities("anthropic", "claude-sonnet").structuredOutputMode, "prompt_only_json");
    assert.equal(resolveModelCapabilities("ollama", "llama3").structuredOutputMode, "json_object");
  });
});
