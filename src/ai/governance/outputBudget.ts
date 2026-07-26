import type { AiModelCapabilities, AiOutputBudgetPolicy } from "../contracts";

export type CalculatedOutputBudget = {
  requestedFinalAnswerTokens: number;
  reasoningReserve: number;
  recommendedMinimum: number;
  requestedProviderOutputTokens: number;
  providerOutputTokens: number;
  retryProviderOutputTokens: number;
  availableOutputTokens: number;
  constrained: boolean;
};

const positive = (value: number | undefined, fallback = 0) => Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;

export function calculateOutputBudget(input: { policy: AiOutputBudgetPolicy; capabilities: AiModelCapabilities; availableOutputTokens: number }): CalculatedOutputBudget {
  const finalTarget = positive(input.policy.expectedFinalAnswerTokens);
  const minimumFinal = Math.min(finalTarget, positive(input.policy.minimumFinalAnswerTokens, finalTarget));
  const reasoningReserve = input.capabilities.reasoningConsumesCompletionBudget ? positive(input.policy.reasoningTokenReserve) : 0;
  const minimumReasoning = input.capabilities.reasoningConsumesCompletionBudget ? Math.min(reasoningReserve, positive(input.policy.minimumReasoningTokenReserve, reasoningReserve)) : 0;
  const desired = finalTarget + reasoningReserve;
  const minimum = minimumFinal + minimumReasoning;
  const available = Math.max(0, Math.floor(input.availableOutputTokens));
  const providerOutputTokens = Math.min(desired, available);
  const retryTarget = desired + positive(input.policy.truncationRetryIncrement);
  return {
    requestedFinalAnswerTokens: finalTarget,
    reasoningReserve,
    recommendedMinimum: minimum,
    requestedProviderOutputTokens: desired,
    providerOutputTokens,
    retryProviderOutputTokens: Math.min(retryTarget, available),
    availableOutputTokens: available,
    constrained: providerOutputTokens < desired,
  };
}

export const RECIPE_COPILOT_OUTPUT_BUDGET: AiOutputBudgetPolicy = {
  expectedFinalAnswerTokens: 2_500,
  minimumFinalAnswerTokens: 2_000,
  reasoningTokenReserve: 3_000,
  minimumReasoningTokenReserve: 2_000,
  truncationRetryIncrement: 1_500,
  allowTruncationRetry: true,
};
