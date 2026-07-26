import type { AiModelCapabilities, AiProviderType } from "../contracts";

type ModelCapabilityMetadata = {
  modelCategory?: string | null;
  structuredOutput?: boolean | null;
  jsonMode?: boolean | null;
  maximumOutputTokens?: number | null;
  capabilityMetadata?: unknown;
};

const normal = (overrides: Partial<AiModelCapabilities> = {}): AiModelCapabilities => ({
  supportsStreaming: true,
  supportsJsonMode: false,
  supportsStructuredOutput: false,
  supportsReasoning: false,
  reasoningConsumesCompletionBudget: false,
  supportsReasoningEffort: false,
  supportsThinkingMode: false,
  outputTokenParameter: "max_tokens",
  defaultOutputTokens: 2_500,
  source: "CATALOG",
  ...overrides,
});

const deepSeekReasoning = normal({
  supportsJsonMode: true,
  supportsStructuredOutput: false,
  supportsReasoning: true,
  reasoningConsumesCompletionBudget: true,
  supportsReasoningEffort: true,
  supportsThinkingMode: true,
  defaultOutputTokens: 5_500,
});

const aliases: Array<{ provider: AiProviderType; matches: RegExp; capabilities: AiModelCapabilities }> = [
  { provider: "deepseek", matches: /^(deepseek-v4-pro|deepseek-v4-flash)$/i, capabilities: deepSeekReasoning },
  { provider: "deepseek", matches: /^(deepseek-reasoner|deepseek-r1(?:[-:].*)?)$/i, capabilities: deepSeekReasoning },
  { provider: "deepseek", matches: /^(deepseek-chat|deepseek-v3(?:[-:].*)?)$/i, capabilities: normal({ supportsJsonMode: true }) },
  { provider: "openai", matches: /^(o1|o3|o4)(?:[-:].*)?$/i, capabilities: normal({ supportsJsonMode: true, supportsStructuredOutput: true, supportsReasoning: true, reasoningConsumesCompletionBudget: true, supportsReasoningEffort: true, outputTokenParameter: "max_completion_tokens", defaultOutputTokens: 5_500 }) },
];

const providerDefaults: Partial<Record<AiProviderType, AiModelCapabilities>> = {
  deepseek: normal({ supportsJsonMode: true, supportsReasoning: true, reasoningConsumesCompletionBudget: true, defaultOutputTokens: 5_500, source: "CONSERVATIVE_DEFAULT", diagnostics: ["Unknown DeepSeek model; reasoning completion-budget reserve applied conservatively."] }),
  openai: normal({ supportsJsonMode: true, supportsStructuredOutput: true }),
  openrouter: normal({ supportsJsonMode: true }),
  litellm: normal({ supportsJsonMode: true }),
  anthropic: normal(),
  ollama: normal({ supportsJsonMode: true }),
};

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function resolveModelCapabilities(provider: AiProviderType, model: string, metadata: ModelCapabilityMetadata = {}): AiModelCapabilities {
  const catalog = aliases.find((entry) => entry.provider === provider && entry.matches.test(model))?.capabilities
    || providerDefaults[provider]
    || normal({ source: "CONSERVATIVE_DEFAULT", diagnostics: ["Unknown model capabilities; native structured-output and reasoning-specific parameters are disabled."] });
  const raw = metadataObject(metadata.capabilityMetadata);
  const declaredReasoning = metadata.modelCategory === "REASONING" || raw.supportsReasoning === true;
  const source = Object.keys(raw).length || metadata.modelCategory || metadata.structuredOutput != null || metadata.jsonMode != null ? "MODEL_METADATA" : catalog.source;
  return {
    ...catalog,
    supportsStreaming: typeof raw.supportsStreaming === "boolean" ? raw.supportsStreaming : catalog.supportsStreaming,
    supportsJsonMode: metadata.jsonMode ?? (typeof raw.supportsJsonMode === "boolean" ? raw.supportsJsonMode : catalog.supportsJsonMode),
    supportsStructuredOutput: metadata.structuredOutput ?? (typeof raw.supportsStructuredOutput === "boolean" ? raw.supportsStructuredOutput : catalog.supportsStructuredOutput),
    supportsReasoning: declaredReasoning || catalog.supportsReasoning,
    reasoningConsumesCompletionBudget: typeof raw.reasoningConsumesCompletionBudget === "boolean" ? raw.reasoningConsumesCompletionBudget : declaredReasoning || catalog.reasoningConsumesCompletionBudget,
    supportsReasoningEffort: typeof raw.supportsReasoningEffort === "boolean" ? raw.supportsReasoningEffort : catalog.supportsReasoningEffort,
    supportsThinkingMode: typeof raw.supportsThinkingMode === "boolean" ? raw.supportsThinkingMode : catalog.supportsThinkingMode,
    outputTokenParameter: raw.outputTokenParameter === "max_completion_tokens" ? "max_completion_tokens" : raw.outputTokenParameter === "max_tokens" ? "max_tokens" : catalog.outputTokenParameter,
    defaultOutputTokens: typeof raw.defaultOutputTokens === "number" ? raw.defaultOutputTokens : catalog.defaultOutputTokens,
    maximumOutputTokens: metadata.maximumOutputTokens ?? (typeof raw.maximumOutputTokens === "number" ? raw.maximumOutputTokens : catalog.maximumOutputTokens),
    source,
  };
}
