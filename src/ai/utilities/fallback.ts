import { normalizeProviderError, type AiError, type AiErrorCategory } from "../errors";

const fallbackCategories = new Set<AiErrorCategory>(["PROVIDER_UNAVAILABLE", "CONNECTION_FAILED", "RATE_LIMITED", "REQUEST_TIMEOUT", "TLS_ERROR", "PROVIDER_OVERLOADED", "AI_PROVIDER_TIMEOUT", "AI_PROVIDER_MALFORMED_JSON", "AI_PROVIDER_UNSUPPORTED_RESPONSE_SHAPE", "AI_PROVIDER_EMPTY_RESPONSE", "AI_PROVIDER_TRUNCATED_RESPONSE"]);

export function isFallbackEligible(error: AiError) {
  return fallbackCategories.has(error.category) || error.category === "AI_PROVIDER_HTTP_ERROR" && error.details?.retryable === true;
}

export async function executeEligibleFallback<T>(primary: () => Promise<T>, fallback?: (originalError: AiError) => Promise<T>) {
  try { return { value: await primary(), originalError: undefined }; }
  catch (error) {
    const normalized = normalizeProviderError(error);
    if (!fallback || !isFallbackEligible(normalized)) throw normalized;
    return { value: await fallback(normalized), originalError: normalized };
  }
}
