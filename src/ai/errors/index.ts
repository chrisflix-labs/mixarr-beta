import { sanitizeErrorText } from "../../lib/supportRedaction";

export const AI_ERROR_CATEGORIES = [
  "AI_DISABLED", "FEATURE_DISABLED", "PROVIDER_NOT_CONFIGURED", "PROVIDER_DISABLED", "PROVIDER_NOT_FOUND", "PROVIDER_UNAVAILABLE", "PROVIDER_UNSUPPORTED", "MODEL_NOT_CONFIGURED", "MODEL_NOT_FOUND", "CAPABILITY_UNAVAILABLE", "AUTHENTICATION_FAILED", "PERMISSION_DENIED", "RATE_LIMITED", "BUDGET_EXCEEDED",
  "AI_PRIVACY_POLICY_BLOCKED", "AI_EXTERNAL_PROVIDER_BLOCKED", "AI_PAID_FALLBACK_BLOCKED", "AI_GLOBAL_BUDGET_EXCEEDED", "AI_PROVIDER_BUDGET_EXCEEDED", "AI_USER_BUDGET_EXCEEDED", "AI_DAILY_REQUEST_LIMIT_EXCEEDED", "AI_TOKEN_LIMIT_EXCEEDED", "AI_PROMPT_TOO_LARGE", "AI_RESPONSE_LIMIT_INVALID", "AI_MODEL_PRICING_MISSING", "AI_CONTEXT_TRIMMING_FAILED", "AI_BACKGROUND_REQUEST_BLOCKED", "AI_RETRY_COST_LIMIT_EXCEEDED", "AI_NO_ELIGIBLE_PROVIDER",
  "REQUEST_TIMEOUT", "REQUEST_CANCELLED", "CONNECTION_FAILED", "TLS_ERROR", "INVALID_REQUEST", "INVALID_RESPONSE", "STRUCTURED_RESPONSE_INVALID", "RESPONSE_TOO_LARGE", "STREAM_INTERRUPTED", "PROVIDER_OVERLOADED", "INTERNAL_AI_ERROR"
] as const;
export type AiErrorCategory = typeof AI_ERROR_CATEGORIES[number];

const publicMessages: Record<AiErrorCategory, string> = {
  AI_DISABLED: "AI is disabled in Mixarr settings.", FEATURE_DISABLED: "This AI feature is disabled.", PROVIDER_NOT_CONFIGURED: "No AI provider is configured for this feature.", PROVIDER_DISABLED: "The selected AI provider is disabled.", PROVIDER_NOT_FOUND: "The selected AI provider no longer exists.", PROVIDER_UNAVAILABLE: "The selected AI provider is currently unavailable.", PROVIDER_UNSUPPORTED: "This provider integration is not available.", MODEL_NOT_CONFIGURED: "No model is configured for this request.", MODEL_NOT_FOUND: "The configured model is unavailable.", CAPABILITY_UNAVAILABLE: "The provider does not have a required capability.", AUTHENTICATION_FAILED: "The provider rejected its configured credentials.", PERMISSION_DENIED: "The provider denied this request.", RATE_LIMITED: "The provider is rate limiting requests.", BUDGET_EXCEEDED: "The provider monthly budget has been reached.",
  AI_PRIVACY_POLICY_BLOCKED: "The configured AI privacy policy blocked this request.", AI_EXTERNAL_PROVIDER_BLOCKED: "External AI providers are blocked by the active privacy policy.", AI_PAID_FALLBACK_BLOCKED: "Fallback to a paid AI provider is disabled.", AI_GLOBAL_BUDGET_EXCEEDED: "The configured monthly AI budget has been reached.", AI_PROVIDER_BUDGET_EXCEEDED: "The selected provider budget has been reached.", AI_USER_BUDGET_EXCEEDED: "The requesting user's AI budget has been reached.", AI_DAILY_REQUEST_LIMIT_EXCEEDED: "The applicable AI request limit has been reached.", AI_TOKEN_LIMIT_EXCEEDED: "The AI request exceeds the applicable token limit.", AI_PROMPT_TOO_LARGE: "The AI request prompt exceeds the configured size limit.", AI_RESPONSE_LIMIT_INVALID: "The requested response limits are invalid.", AI_MODEL_PRICING_MISSING: "Pricing is required for this external AI model.", AI_CONTEXT_TRIMMING_FAILED: "The AI request could not be reduced to the configured context limit.", AI_BACKGROUND_REQUEST_BLOCKED: "Background AI requests are disabled by policy.", AI_RETRY_COST_LIMIT_EXCEEDED: "Retrying could exceed the configured AI cost limit.", AI_NO_ELIGIBLE_PROVIDER: "No provider satisfies the current privacy, budget, and capability policies.",
  REQUEST_TIMEOUT: "The AI request timed out.", REQUEST_CANCELLED: "The AI request was cancelled.", CONNECTION_FAILED: "Mixarr could not connect to the provider.", TLS_ERROR: "The provider TLS connection could not be verified.", INVALID_REQUEST: "The AI request is invalid.", INVALID_RESPONSE: "The provider returned an invalid response.", STRUCTURED_RESPONSE_INVALID: "The provider response did not match the required structure.", RESPONSE_TOO_LARGE: "The provider response exceeded the configured size limit.", STREAM_INTERRUPTED: "The provider stream ended unexpectedly.", PROVIDER_OVERLOADED: "The provider is temporarily overloaded.", INTERNAL_AI_ERROR: "The AI request could not be completed."
};

export class AiError extends Error {
  constructor(public category: AiErrorCategory, message = publicMessages[category], public status = statusForCategory(category), public retryAfterMs?: number, public details?: Record<string, unknown>) { super(message); Object.setPrototypeOf(this, new.target.prototype); this.name = "AiError"; }
  toSafePayload() { const error = { code: this.category, message: publicMessages[this.category], ...(this.details ? { details: this.details } : {}) }; return { error, ...error }; }
}

export function statusForCategory(category: AiErrorCategory) {
  if (["AI_DISABLED", "FEATURE_DISABLED", "PROVIDER_DISABLED", "CAPABILITY_UNAVAILABLE", "BUDGET_EXCEEDED", "AI_PRIVACY_POLICY_BLOCKED", "AI_EXTERNAL_PROVIDER_BLOCKED", "AI_PAID_FALLBACK_BLOCKED", "AI_GLOBAL_BUDGET_EXCEEDED", "AI_PROVIDER_BUDGET_EXCEEDED", "AI_USER_BUDGET_EXCEEDED", "AI_DAILY_REQUEST_LIMIT_EXCEEDED", "AI_TOKEN_LIMIT_EXCEEDED", "AI_PROMPT_TOO_LARGE", "AI_RESPONSE_LIMIT_INVALID", "AI_MODEL_PRICING_MISSING", "AI_CONTEXT_TRIMMING_FAILED", "AI_BACKGROUND_REQUEST_BLOCKED", "AI_RETRY_COST_LIMIT_EXCEEDED", "AI_NO_ELIGIBLE_PROVIDER"].includes(category)) return 409;
  if (["PROVIDER_NOT_CONFIGURED", "PROVIDER_NOT_FOUND", "MODEL_NOT_FOUND"].includes(category)) return 404;
  if (category === "AUTHENTICATION_FAILED") return 401;
  if (category === "PERMISSION_DENIED") return 403;
  if (["INVALID_REQUEST", "MODEL_NOT_CONFIGURED", "STRUCTURED_RESPONSE_INVALID", "RESPONSE_TOO_LARGE"].includes(category)) return 400;
  if (category === "RATE_LIMITED") return 429;
  if (category === "REQUEST_TIMEOUT") return 504;
  return 502;
}

export function normalizeProviderError(error: unknown, status?: number, retryAfterMs?: number): AiError {
  if (error instanceof AiError) return error;
  if ((error as Error)?.name === "AbortError") return new AiError("REQUEST_CANCELLED");
  if (status === 401) return new AiError("AUTHENTICATION_FAILED");
  if (status === 403) return new AiError("PERMISSION_DENIED");
  if (status === 408) return new AiError("REQUEST_TIMEOUT");
  if (status === 429) return new AiError("RATE_LIMITED", undefined, 429, retryAfterMs);
  if ([500, 502, 503, 504].includes(status || 0)) return new AiError("PROVIDER_OVERLOADED");
  const safe = sanitizeErrorText(error) || "Provider request failed.";
  if (/certificate|tls|ssl/i.test(safe)) return new AiError("TLS_ERROR");
  if (/timeout/i.test(safe)) return new AiError("REQUEST_TIMEOUT");
  return new AiError("CONNECTION_FAILED");
}

export function aiApiError(error: unknown) {
  const normalized = error instanceof AiError ? error : new AiError("INTERNAL_AI_ERROR");
  return { payload: normalized.toSafePayload(), status: normalized.status };
}
