import type { AiModelCapabilities, AiProviderType } from "../contracts";

type ModelCapabilityMetadata = {
  modelCategory?: string | null;
  structuredOutput?: boolean | null;
  jsonMode?: boolean | null;
  providerNativeMaximumOutputTokens?: number | null;
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
  structuredOutputMode: "prompt_only_json",
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
  structuredOutputMode: "json_object",
});

const aliases: Array<{ provider: AiProviderType; matches: RegExp; capabilities: AiModelCapabilities }> = [
  { provider: "deepseek", matches: /^(deepseek-v4-pro|deepseek-v4-flash)$/i, capabilities: deepSeekReasoning },
  { provider: "deepseek", matches: /^(deepseek-reasoner|deepseek-r1(?:[-:].*)?)$/i, capabilities: deepSeekReasoning },
  { provider: "deepseek", matches: /^(deepseek-chat|deepseek-v3(?:[-:].*)?)$/i, capabilities: normal({ supportsJsonMode: true }) },
  { provider: "openai", matches: /^(o1|o3|o4)(?:[-:].*)?$/i, capabilities: normal({ supportsJsonMode: true, supportsStructuredOutput: true, supportsReasoning: true, reasoningConsumesCompletionBudget: true, supportsReasoningEffort: true, structuredOutputMode: "strict_json_schema" }) },
];

const providerDefaults: Partial<Record<AiProviderType, AiModelCapabilities>> = {
  deepseek: normal({ supportsJsonMode: true, supportsReasoning: true, reasoningConsumesCompletionBudget: true, structuredOutputMode: "json_object", source: "CONSERVATIVE_DEFAULT", diagnostics: ["Unknown DeepSeek model; structured requests disable thinking and use JSON object mode."] }),
  openai: normal({ supportsJsonMode: true, supportsStructuredOutput: true, structuredOutputMode: "strict_json_schema" }),
  openrouter: normal({ supportsJsonMode: true, structuredOutputMode: "json_object" }),
  litellm: normal({ supportsJsonMode: true, structuredOutputMode: "json_object" }),
  anthropic: normal(),
  ollama: normal({ supportsJsonMode: true, structuredOutputMode: "json_object" }),
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
    structuredOutputMode: raw.structuredOutputMode === "strict_json_schema" || raw.structuredOutputMode === "json_object" || raw.structuredOutputMode === "prompt_only_json" ? raw.structuredOutputMode : metadata.structuredOutput ? "strict_json_schema" : metadata.jsonMode ? "json_object" : catalog.structuredOutputMode,
    providerNativeMaximumOutputTokens: metadata.providerNativeMaximumOutputTokens ?? (typeof raw.providerNativeMaximumOutputTokens === "number" ? raw.providerNativeMaximumOutputTokens : catalog.providerNativeMaximumOutputTokens),
    source,
  };
}
