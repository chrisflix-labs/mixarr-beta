import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateOutputBudget, RECIPE_COPILOT_OUTPUT_BUDGET } from "../ai/governance/outputBudget";
import { resolveModelCapabilities } from "../ai/registry/modelCapabilities";
import { normalizeAIResponse, normalizeAIUsage } from "../ai/providers/normalizeResponse";
import { RECIPE_COPILOT_SYSTEM_PROMPT } from "../ai/recipeCopilot/prompts";
import { recipeCopilotResponseSchema } from "./recipeCopilot/contracts";
import { isFallbackEligible } from "../ai/utilities/fallback";
import { AiError } from "../ai/errors";

describe("Recipe Copilot reasoning output budgets", () => {
  it("adds a shared completion-budget reserve only for reasoning models", () => {
    const reasoning = resolveModelCapabilities("deepseek", "deepseek-v4-pro");
    const chat = resolveModelCapabilities("deepseek", "deepseek-chat");
    const reasoningBudget = calculateOutputBudget({ policy: RECIPE_COPILOT_OUTPUT_BUDGET, capabilities: reasoning, availableOutputTokens: 7_000 });
    const chatBudget = calculateOutputBudget({ policy: RECIPE_COPILOT_OUTPUT_BUDGET, capabilities: chat, availableOutputTokens: 7_000 });
    assert.equal(reasoning.reasoningConsumesCompletionBudget, true);
    assert.deepEqual({ requested: reasoningBudget.requestedProviderOutputTokens, minimum: reasoningBudget.recommendedMinimum, retry: reasoningBudget.retryProviderOutputTokens }, { requested: 5_500, minimum: 4_000, retry: 7_000 });
    assert.deepEqual({ requested: chatBudget.requestedProviderOutputTokens, minimum: chatBudget.recommendedMinimum }, { requested: 2_500, minimum: 2_000 });
  });

  it("reports an insufficient configured cap without pretending it can satisfy the feature", () => {
    const capabilities = resolveModelCapabilities("deepseek", "deepseek-v4-pro");
    const budget = calculateOutputBudget({ policy: RECIPE_COPILOT_OUTPUT_BUDGET, capabilities, availableOutputTokens: 2_000 });
    assert.equal(budget.providerOutputTokens, 2_000);
    assert.equal(budget.recommendedMinimum, 4_000);
    assert.equal(budget.constrained, true);
  });

  it("preserves provider usage detail categories and derives final-answer tokens only from reported numeric counts", () => {
    const usage = normalizeAIUsage({ id: "usage-id", usage: { prompt_tokens: 1707, completion_tokens: 2000, total_tokens: 3707, completion_tokens_details: { reasoning_tokens: 1200, accepted_prediction_tokens: 7, rejected_prediction_tokens: 3 } } });
    assert.deepEqual(usage && { input: usage.inputTokens, output: usage.outputTokens, reasoning: usage.reasoningTokens, final: usage.finalAnswerTokens, accepted: usage.acceptedPredictionTokens, rejected: usage.rejectedPredictionTokens, total: usage.totalTokens }, { input: 1707, output: 2000, reasoning: 1200, final: 800, accepted: 7, rejected: 3, total: 3707 });
    assert.equal(normalizeAIUsage({ usage: { completion_tokens: 2000 } })?.finalAnswerTokens, undefined);
  });

  it("classifies length with empty final content and never exposes reasoning text", () => {
    const privateReasoning = "Redacted reasoning placeholder";
    assert.throws(() => normalizeAIResponse({ choices: [{ message: { role: "assistant", content: "", reasoning_content: privateReasoning }, finish_reason: "length" }], usage: { prompt_tokens: 1707, completion_tokens: 2000, total_tokens: 3707 } }, { providerType: "deepseek", provider: "DeepSeek", requestedModel: "deepseek-v4-pro", requestId: "truncated" }), (error: any) => error.category === "AI_PROVIDER_TRUNCATED_BEFORE_FINAL" && error.details.parent_category === "AI_PROVIDER_TRUNCATED_RESPONSE" && error.details.usage_output_tokens === 2000 && error.details.has_reasoning_content === true && !JSON.stringify(error.details).includes(privateReasoning));
  });

  it("centralizes provider parameters and keeps unknown compatible models conservative", () => {
    assert.equal(resolveModelCapabilities("deepseek", "deepseek-v4-pro").outputTokenParameter, "max_tokens");
    assert.equal(resolveModelCapabilities("openai", "o3").outputTokenParameter, "max_completion_tokens");
    assert.equal(resolveModelCapabilities("openai_compatible", "unknown-model").supportsJsonMode, false);
  });

  it("requires complete top-level Recipe Copilot JSON and contains concise JSON-only instructions", () => {
    assert.equal(recipeCopilotResponseSchema.safeParse({ schemaVersion: "1.0", action: "create" }).success, false);
    for (const marker of [/Return only the final JSON object/i, /Do not include Markdown fences/i, /Complete every required field/i, /concise/i, /prioritize valid final JSON/i]) assert.match(RECIPE_COPILOT_SYSTEM_PROMPT, marker);
  });

  it("makes repeated truncation fallback-eligible without making policy failures eligible", () => {
    assert.equal(isFallbackEligible(new AiError("AI_PROVIDER_TRUNCATED_RESPONSE")), false);
    assert.equal(isFallbackEligible(new AiError("AI_REQUIRED_OUTPUT_BUDGET_EXCEEDS_LIMIT")), false);
  });
});
