import type { AiCapabilityResult, AiProviderAdapter, AiProviderType } from "../contracts";
import { AI_PROVIDER_TYPES } from "../contracts";
import { AiError } from "../errors";
import { AnthropicAdapter } from "../providers/anthropic";
import { OllamaAdapter } from "../providers/ollama";
import { OpenAiCompatibleAdapter } from "../providers/openAiCompatible";
import { OpenAIProviderAdapter } from "../providers/openai";

export type AiProviderMetadata = {
  type: AiProviderType; displayName: string; description: string; available: boolean; experimental?: boolean;
  defaultBaseUrl?: string; defaultAuthenticationType: string; defaultLocation: "LOCAL" | "REMOTE" | "UNKNOWN";
  knownCapabilities: AiCapabilityResult; unavailableMessage?: string;
};

class UnavailableChatGptSubscriptionAdapter implements AiProviderAdapter {
  readonly providerType = "chatgpt_subscription" as const; readonly available = false;
  private fail(): never { throw new AiError("PROVIDER_UNSUPPORTED", "ChatGPT subscriptions do not provide OpenAI API access. Configure the OpenAI API provider with an API key instead."); }
  testConnection(): Promise<any> { return Promise.reject(this.fail()); } discoverModels(): Promise<any> { return Promise.reject(this.fail()); }
  detectCapabilities(): Promise<any> { return Promise.resolve({}); } complete(): Promise<any> { return Promise.reject(this.fail()); }
}

export class AiProviderRegistry {
  private adapters = new Map<AiProviderType, AiProviderAdapter>();
  private metadata = new Map<AiProviderType, AiProviderMetadata>();
  register(adapter: AiProviderAdapter, metadata: AiProviderMetadata) { if (this.adapters.has(adapter.providerType)) throw new Error(`AI provider adapter already registered: ${adapter.providerType}`); this.adapters.set(adapter.providerType, adapter); this.metadata.set(adapter.providerType, metadata); }
  get(type: AiProviderType) { const adapter = this.adapters.get(type); if (!adapter) throw new AiError("PROVIDER_UNSUPPORTED"); return adapter; }
  list() { return AI_PROVIDER_TYPES.map((type) => this.metadata.get(type)!).filter(Boolean); }
  supports(type: string): type is AiProviderType { return this.adapters.has(type as AiProviderType); }
}

const registry = new AiProviderRegistry();
const compatible = (type: AiProviderType, displayName: string, description: string, defaultBaseUrl: string | undefined, authentication: string, location: "LOCAL" | "REMOTE" | "UNKNOWN") => {
  const adapter = new OpenAiCompatibleAdapter(type);
  registry.register(adapter, { type, displayName, description, available: true, defaultBaseUrl, defaultAuthenticationType: authentication, defaultLocation: location, knownCapabilities: adapter.knownCapabilities() });
};

const ollama = new OllamaAdapter();
registry.register(ollama, { type: "ollama", displayName: "Ollama", description: "Local or remote Ollama server.", available: true, defaultBaseUrl: "http://ollama:11434", defaultAuthenticationType: "NONE", defaultLocation: "LOCAL", knownCapabilities: { chat_messages: "CONFIRMED", streaming: "CONFIRMED", structured_json: "REPORTED", model_discovery: "CONFIRMED", local_operation: "ASSUMED", remote_operation: "CONFIRMED" } });
compatible("litellm", "LiteLLM", "LiteLLM OpenAI-compatible proxy.", "http://localhost:4000/v1", "BEARER", "UNKNOWN");
compatible("lm_studio", "LM Studio", "Local or remote LM Studio server.", "http://localhost:1234/v1", "NONE", "LOCAL");
compatible("deepseek", "DeepSeek", "DeepSeek chat and reasoning models.", "https://api.deepseek.com", "BEARER", "REMOTE");
const openai = new OpenAIProviderAdapter();
registry.register(openai, { type: "openai", displayName: "OpenAI API", description: "Native OpenAI API using the Responses API for inference.", available: true, defaultBaseUrl: "https://api.openai.com/v1", defaultAuthenticationType: "BEARER", defaultLocation: "REMOTE", knownCapabilities: openai.knownCapabilities() });
const chatgpt = new UnavailableChatGptSubscriptionAdapter();
registry.register(chatgpt, { type: "chatgpt_subscription", displayName: "ChatGPT Subscription", description: "Consumer ChatGPT subscriptions are separate from OpenAI API access.", available: false, experimental: true, defaultAuthenticationType: "OFFICIAL_OAUTH", defaultLocation: "REMOTE", knownCapabilities: {}, unavailableMessage: "No official supported Mixarr integration is available. Browser cookies, profiles, session tokens, and web automation are never used. Configure the OpenAI API provider instead." });
compatible("openai_compatible", "OpenAI-Compatible API", "A configurable service implementing compatible model and chat endpoints.", undefined, "BEARER", "UNKNOWN");
compatible("openrouter", "OpenRouter", "OpenRouter multi-provider API.", "https://openrouter.ai/api/v1", "BEARER", "REMOTE");
const anthropic = new AnthropicAdapter();
registry.register(anthropic, { type: "anthropic", displayName: "Anthropic", description: "Native Anthropic Messages API.", available: true, defaultBaseUrl: "https://api.anthropic.com", defaultAuthenticationType: "PROVIDER_SPECIFIC", defaultLocation: "REMOTE", knownCapabilities: { chat_messages: "CONFIRMED", streaming: "CONFIRMED", token_usage: "CONFIRMED", structured_json: "ASSUMED", remote_operation: "CONFIRMED" } });

export const aiProviderRegistry = registry;
