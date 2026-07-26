export function aiFailureStatus(category: string, options: { cancelled?: boolean; timedOut?: boolean } = {}) {
  if (options.cancelled || category === "REQUEST_CANCELLED") return "CANCELLED" as const;
  if (options.timedOut || ["AI_PROVIDER_TIMEOUT", "REQUEST_TIMEOUT", "PROVIDER_TIMEOUT"].includes(category)) return "TIMED_OUT" as const;
  if (["AI_PROVIDER_INVALID_RESPONSE", "AI_PROVIDER_EMPTY_RESPONSE", "AI_RECIPE_SCHEMA_INVALID", "STRUCTURED_RESPONSE_INVALID", "INVALID_RESPONSE"].includes(category)) return "INVALID_RESPONSE" as const;
  return "FAILED" as const;
}
