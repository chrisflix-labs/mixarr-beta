import type { ZodType } from "zod";
import type { AiTimeoutPolicy, AiTimeoutPolicyOverride } from "../config/timeout";

export const AI_PROVIDER_TYPES = ["ollama", "litellm", "lm_studio", "deepseek", "openai", "chatgpt_subscription", "openai_compatible", "openrouter", "anthropic"] as const;
export type AiProviderType = typeof AI_PROVIDER_TYPES[number];

export const AI_CAPABILITIES = ["text_generation", "chat_messages", "system_instructions", "structured_json", "json_schema", "streaming", "request_cancellation", "model_discovery", "token_usage", "cost_reporting", "reasoning_models", "thinking_mode", "large_context", "custom_headers", "local_operation", "remote_operation", "health_testing"] as const;
export type AiCapability = typeof AI_CAPABILITIES[number];
export type AiCapabilityConfidence = "CONFIRMED" | "REPORTED" | "ASSUMED" | "MANUALLY_ENABLED" | "UNSUPPORTED" | "UNKNOWN";
export type AiCapabilityResult = Partial<Record<AiCapability, AiCapabilityConfidence>>;

export type AiMessage = { role: "user" | "assistant"; content: string };
export type AiUsage = { inputTokens?: number; outputTokens?: number; finalAnswerTokens?: number; totalTokens?: number; cachedTokens?: number; reasoningTokens?: number; acceptedPredictionTokens?: number; rejectedPredictionTokens?: number; providerReported?: boolean; providerRequestId?: string; rawUsage?: Record<string, unknown> };
export type AiThinkingMode = "disabled" | "enabled" | "provider_default";
export type AiReasoningEffort = "low" | "medium" | "high";
export type AiStructuredOutputMode = "strict_json_schema" | "json_object" | "prompt_only_json";
export type AiModelCapabilities = {
  supportsStreaming: boolean;
  supportsJsonMode: boolean;
  supportsStructuredOutput: boolean;
  supportsReasoning: boolean;
  reasoningConsumesCompletionBudget: boolean;
  supportsReasoningEffort: boolean;
  supportsThinkingMode: boolean;
  structuredOutputMode: AiStructuredOutputMode;
  providerNativeMaximumOutputTokens?: number;
  source: "CATALOG" | "MODEL_METADATA" | "CONSERVATIVE_DEFAULT";
  diagnostics?: string[];
};
export type AiModelCategory = "GENERAL" | "FAST" | "REASONING" | "LARGE_CONTEXT" | "LOCAL" | "REMOTE" | "UNKNOWN";
export type AiModelCompatibility = {
  ownedBy?: string;
  lifecycleState?: "ACTIVE" | "DEPRECATED" | "UNKNOWN";
  supportsTextInput: boolean;
  supportsTextOutput: boolean;
  supportsResponsesApi: boolean;
  supportsChatCompletions: boolean;
  supportsStreaming: boolean;
  supportsUsageReporting: boolean;
  suitableForConnectionTest: boolean;
  selectableAsDefault: boolean;
  reason?: string;
};
export type AiModel = { id: string; displayName: string; contextSize?: number; category: AiModelCategory; capabilities: AiCapabilityResult; available: boolean; compatibility?: AiModelCompatibility };

export type AiResponseFormat<T = unknown> = {
  type: "json";
  name: string;
  schema: ZodType<T>;
  jsonSchema?: Record<string, unknown>;
  unknownFields?: "reject" | "strip";
  allowEmbeddedJson?: boolean;
  knownRootWrappers?: string[];
  normalizeParsedValue?: (value: unknown) => { value: unknown; method?: string; details?: Record<string, unknown> };
  validationFailureStage?: (issues: Array<{ path: string; code: string; expected?: unknown; receivedType: string }>) => string;
};

export type AiRequest<T = unknown> = {
  featureKey: string;
  messages: AiMessage[];
  systemInstructions?: string;
  providerId?: string;
  model?: string;
  responseFormat?: AiResponseFormat<T>;
  stream?: boolean;
  temperature?: number;
  thinkingMode?: AiThinkingMode;
  reasoningEffort?: AiReasoningEffort;
  /** Informational cost-estimation target only. It is never sent to a provider or enforced. */
  estimatedOutputTokens?: number;
  resolvedModelCapabilities?: AiModelCapabilities;
  maxResponseBytes?: number;
  /** Explicit internal total-request override. null intentionally disables it. */
  timeoutMs?: number | null;
  /** Explicit per-phase internal override; omitted phases continue through precedence. */
  timeoutPolicy?: AiTimeoutPolicyOverride;
  signal?: AbortSignal;
  correlationId?: string;
  metadata?: Record<string, string | number | boolean>;
  metadataRecords?: Array<Record<string, unknown>>;
  privacyMode?: "LOCAL_ONLY" | "METADATA_LIMITED" | "ANONYMOUS_METADATA" | "FULL_METADATA";
  requestSource?: "FOREGROUND" | "BACKGROUND" | "CONNECTION_TEST" | "MODEL_DISCOVERY";
  backgroundApproval?: boolean;
  externalConfirmation?: boolean;
  idempotencyKey?: string;
  promptTemplateVersion?: string;
  contextSections?: Array<{ id: string; content: string; priority: "REQUIRED" | "HIGH" | "NORMAL" | "LOW" | "OPTIONAL"; kind?: "SYSTEM" | "SAFETY" | "SCHEMA" | "CONTEXT" | "METADATA" }>;
  contextTrimmingStrategy?: "REJECT" | "REMOVE_OLDEST" | "REMOVE_LOWEST_PRIORITY" | "REMOVE_DUPLICATES";
  allowFallback?: boolean;
  allowStreamingFallback?: boolean;
  requiredCapabilities?: AiCapability[];
};

export type AiResponse<T = unknown> = {
  requestId: string;
  providerId: string;
  providerType: AiProviderType;
  model: string;
  content?: string;
  data?: T;
  usage?: AiUsage;
  estimatedCost?: number;
  actualCost?: number;
  finishReason?: string;
  latencyMs: number;
  retryCount: number;
  streaming: boolean;
  warnings: string[];
  thinkingModeRequested?: AiThinkingMode;
  hasReasoningContent?: boolean;
  reasoningCharacterCount?: number;
  finalContentCharacterCount?: number;
  structuredOutputMode?: AiStructuredOutputMode;
  transport?: { httpStatus?: number; contentType?: string; bodyLength?: number; endpointHostname?: string; streamed?: boolean; providerRequestId?: string };
};

export type AiStreamEvent =
  | { type: "started"; requestId: string }
  | { type: "text_delta"; delta: string }
  | { type: "structured_delta"; delta: string }
  | { type: "usage"; usage: AiUsage }
  | { type: "warning"; message: string }
  | { type: "completed"; finishReason?: string }
  | { type: "cancelled" }
  | { type: "failed"; code: string; message: string };

export type AiProviderTestProfile = { retryAttempt: number; thinkingMode: "disabled" };
export type AiConnectionTestResult = { connected: boolean; message: string; latencyMs: number; detectedApiType: string; capabilities: AiCapabilityResult; availableModelCount: number; defaultModelAvailable: boolean | null; testedAt: string; model?: string; modelReturned?: string; endpointMode?: string; authenticationResult?: string; discoveryResult?: string; inferenceResult?: string; responseId?: string; providerRequestId?: string; usage?: AiUsage; retryAttempted?: boolean; thinkingModeRequested?: AiThinkingMode; hasReasoningContent?: boolean; reasoningCharacterCount?: number; finalContentCharacterCount?: number; structuredOutputMode?: AiStructuredOutputMode };

export type ResolvedAiProviderConfig = {
  id: string;
  providerType: AiProviderType;
  displayName: string;
  enabled: boolean;
  approved?: boolean;
  allowedFeatures?: string[];
  privacyModes?: string[];
  allowLibraryMetadata?: boolean;
  allowDiagnosticData?: boolean;
  allowUserNotes?: boolean;
  allowExternalRequests?: boolean;
  locationClassification: "LOCAL" | "REMOTE" | "USER_CLASSIFIED" | "UNKNOWN";
  baseUrl?: string;
  authenticationType: "NONE" | "API_KEY_HEADER" | "BEARER" | "BASIC" | "PROVIDER_SPECIFIC" | "OFFICIAL_OAUTH" | "CUSTOM_SECRET_HEADERS";
  apiKey?: string;
  secretHeaders: Record<string, string>;
  nonSecretHeaders: Record<string, string>;
  defaultModel?: string;
  fastModel?: string;
  reasoningModel?: string;
  fallbackProviderId?: string;
  maximumContextTokens?: number;
  /** Deprecated single timeout retained for rollback compatibility. */
  requestTimeoutMs: number;
  timeoutOverrideEnabled?: boolean;
  timeoutPolicy?: AiTimeoutPolicy;
  retryCount: number;
  initialRetryDelayMs: number;
  maximumRetryDelayMs: number;
  retryBackoffMultiplier: number;
  sslVerification: boolean;
  capabilityOverrides: AiCapabilityResult;
  customConfiguration: Record<string, unknown>;
};

export type AiProviderLifecycle = {
  connectionEstablished(): void;
  responseActivity(options?: { meaningful?: boolean; producedOutput?: boolean }): void;
  registerForceCleanup(cleanup: () => void): () => void;
};

export type AiProviderExecutionContext = { requestId: string; providerId: string; model: string; signal: AbortSignal; maxResponseBytes: number; modelCapabilities?: AiModelCapabilities; lifecycle?: AiProviderLifecycle };

export interface AiProviderAdapter {
  readonly providerType: AiProviderType;
  readonly available: boolean;
  testConnection(config: ResolvedAiProviderConfig, signal?: AbortSignal, model?: string, profile?: AiProviderTestProfile): Promise<AiConnectionTestResult>;
  discoverModels(config: ResolvedAiProviderConfig, signal?: AbortSignal): Promise<AiModel[]>;
  detectCapabilities(config: ResolvedAiProviderConfig, model?: string, signal?: AbortSignal): Promise<AiCapabilityResult>;
  complete<T = unknown>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): Promise<AiResponse<T>>;
  stream?<T = unknown>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): AsyncIterable<AiStreamEvent>;
}
