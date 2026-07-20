import type { ZodType } from "zod";

export const AI_PROVIDER_TYPES = ["ollama", "litellm", "lm_studio", "deepseek", "openai", "chatgpt_subscription", "openai_compatible", "openrouter", "anthropic"] as const;
export type AiProviderType = typeof AI_PROVIDER_TYPES[number];

export const AI_CAPABILITIES = ["text_generation", "chat_messages", "system_instructions", "structured_json", "json_schema", "streaming", "request_cancellation", "model_discovery", "token_usage", "cost_reporting", "reasoning_models", "large_context", "custom_headers", "local_operation", "remote_operation", "health_testing"] as const;
export type AiCapability = typeof AI_CAPABILITIES[number];
export type AiCapabilityConfidence = "CONFIRMED" | "REPORTED" | "ASSUMED" | "MANUALLY_ENABLED" | "UNSUPPORTED" | "UNKNOWN";
export type AiCapabilityResult = Partial<Record<AiCapability, AiCapabilityConfidence>>;

export type AiMessage = { role: "user" | "assistant"; content: string };
export type AiUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedTokens?: number; reasoningTokens?: number; providerReported?: boolean; providerRequestId?: string; rawUsage?: Record<string, unknown> };
export type AiModelCategory = "GENERAL" | "FAST" | "REASONING" | "LARGE_CONTEXT" | "LOCAL" | "REMOTE" | "UNKNOWN";
export type AiModel = { id: string; displayName: string; contextSize?: number; category: AiModelCategory; capabilities: AiCapabilityResult; available: boolean };

export type AiResponseFormat<T = unknown> = {
  type: "json";
  name: string;
  schema: ZodType<T>;
  unknownFields?: "reject" | "strip";
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
  maxOutputTokens?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  correlationId?: string;
  metadata?: Record<string, string | number | boolean>;
  metadataRecords?: Array<Record<string, unknown>>;
  privacyMode?: "LOCAL_ONLY" | "METADATA_LIMITED" | "ANONYMOUS_METADATA" | "FULL_METADATA";
  requestSource?: "FOREGROUND" | "BACKGROUND" | "CONNECTION_TEST" | "MODEL_DISCOVERY";
  backgroundApproval?: boolean;
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

export type AiConnectionTestResult = { connected: boolean; message: string; latencyMs: number; detectedApiType: string; capabilities: AiCapabilityResult; availableModelCount: number; defaultModelAvailable: boolean | null; testedAt: string };

export type ResolvedAiProviderConfig = {
  id: string;
  providerType: AiProviderType;
  displayName: string;
  enabled: boolean;
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
  maximumOutputTokens?: number;
  requestTimeoutMs: number;
  retryCount: number;
  initialRetryDelayMs: number;
  maximumRetryDelayMs: number;
  retryBackoffMultiplier: number;
  sslVerification: boolean;
  capabilityOverrides: AiCapabilityResult;
  customConfiguration: Record<string, unknown>;
};

export type AiProviderExecutionContext = { requestId: string; providerId: string; model: string; signal: AbortSignal; maxResponseBytes: number };

export interface AiProviderAdapter {
  readonly providerType: AiProviderType;
  readonly available: boolean;
  testConnection(config: ResolvedAiProviderConfig, signal?: AbortSignal): Promise<AiConnectionTestResult>;
  discoverModels(config: ResolvedAiProviderConfig, signal?: AbortSignal): Promise<AiModel[]>;
  detectCapabilities(config: ResolvedAiProviderConfig, model?: string, signal?: AbortSignal): Promise<AiCapabilityResult>;
  complete<T = unknown>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): Promise<AiResponse<T>>;
  stream?<T = unknown>(request: AiRequest<T>, config: ResolvedAiProviderConfig, context: AiProviderExecutionContext): AsyncIterable<AiStreamEvent>;
}
