export type RecipeCopilotReadiness = {
  available?: boolean;
  providerId?: string | null;
  providerName?: string | null;
  modelId?: string | null;
  modelName?: string | null;
  privacyMode?: string;
  remoteOperationAllowed?: boolean;
  blockedReasonCode?: string | null;
  blockedReasonMessage?: string | null;
  requestedFeature?: string | null;
  failedCheck?: string | null;
  canConfigure?: boolean;
  settingsUrl?: string | null;
  // Backward-compatible response aliases.
  provider?: string | null;
  model?: string | null;
  code?: string | null;
  reason?: string | null;
  [key: string]: any;
};

const messages: Record<string, string> = {
  AI_PROVIDER_UNAVAILABLE: "Recipe Copilot is not ready because no enabled AI provider is configured.",
  AI_MODEL_UNAVAILABLE: "Recipe Copilot is not ready because no compatible model is selected.",
  AI_MODEL_PRICING_UNAVAILABLE: "Recipe Copilot cannot estimate this request because pricing is unavailable for the selected model.",
  AI_REQUEST_COST_LIMIT_EXCEEDED: "The estimated cost of this request exceeds the per-request AI cost limit. An administrator can raise it or choose Unlimited in AI Governance → Budgets → AI cost limits.",
  AI_DAILY_LIMIT_EXCEEDED: "The applicable daily AI limit has been reached. An administrator can raise it or choose Unlimited in AI Governance → Budgets → AI request limits.",
  AI_MONTHLY_REQUEST_LIMIT_EXCEEDED: "The applicable monthly AI request limit has been reached. An administrator can change it in AI Governance → Budgets → AI request limits.",
  AI_MONTHLY_BUDGET_EXCEEDED: "The configured AI monthly budget has been reached.",
  AI_PRIVACY_POLICY_BLOCKED: "The active AI privacy policy does not permit this request.",
  AI_PROVIDER_AUTH_FAILED: "The AI provider rejected its configured credentials.",
  AI_PROVIDER_RATE_LIMITED: "The AI provider temporarily rate-limited the request.",
  AI_PROVIDER_TEMPORARY_FAILURE: "The AI provider is temporarily unavailable.",
  AI_PROVIDER_TIMEOUT: "The AI provider did not respond before the configured timeout.",
  AI_PROVIDER_HTTP_ERROR: "The AI provider returned an HTTP error.",
  AI_PROVIDER_EMPTY_RESPONSE: "The AI provider returned no usable assistant content.",
  AI_PROVIDER_MALFORMED_JSON: "The AI provider returned malformed JSON.",
  AI_PROVIDER_UNSUPPORTED_RESPONSE_SHAPE: "The AI provider returned an unsupported response shape.",
  AI_PROVIDER_REFUSAL: "The AI provider refused the request.",
  AI_PROVIDER_TOOL_CALL_ONLY: "The AI provider returned a tool call without a final answer.",
  AI_PROVIDER_TRUNCATED_RESPONSE: "The AI provider stopped before returning a final answer.",
  AI_PROVIDER_INVALID_RESPONSE: "The AI provider returned a response that could not be converted into a valid recipe.",
  AI_FEATURE_INVALID_STRUCTURED_OUTPUT: "The AI provider returned content that did not match the Recipe Copilot schema.",
  AI_RECIPE_SCHEMA_INVALID: "The AI provider returned a response that did not match the recipe schema.",
};

export function recipeCopilotErrorMessage(code: string | null | undefined, fallback: string, requestAttempted: boolean) {
  if (code === "AI_RETRY_COST_LIMIT_EXCEEDED") {
    return requestAttempted
      ? "The first attempt failed temporarily, but another attempt would exceed the AI retry cost limit."
      : fallback;
  }
  return code && messages[code] ? messages[code] : fallback;
}

export function recipeCopilotCanRequest(input: { readiness: RecipeCopilotReadiness | null; running: boolean; action: string; instruction: string; playlistId: string }) {
  if (input.readiness?.available !== true || input.running) return false;
  if (["create", "refine", "optimize", "compare_intent"].includes(input.action) && !input.instruction.trim()) return false;
  if (input.action === "from_playlist" && !input.playlistId) return false;
  return true;
}

export function isRecipeCopilotSetupError(code: string | null | undefined) {
  return code === "AI_PROVIDER_UNAVAILABLE" || code === "AI_MODEL_UNAVAILABLE" || code === "AI_MODEL_PRICING_UNAVAILABLE";
}

const requestLimitCodes = new Set(["AI_DAILY_LIMIT_EXCEEDED", "AI_MONTHLY_REQUEST_LIMIT_EXCEEDED"]);
const costLimitCodes = new Set(["AI_REQUEST_COST_LIMIT_EXCEEDED", "AI_RETRY_COST_LIMIT_EXCEEDED"]);

/** A request-count limit is administrator configuration, so link straight to it. */
export function isRecipeCopilotRequestLimitError(code: string | null | undefined) {
  return !!code && requestLimitCodes.has(code);
}

/** A per-request cost ceiling is likewise configuration, not a setup failure. */
export function isRecipeCopilotCostLimitError(code: string | null | undefined) {
  return !!code && costLimitCodes.has(code);
}

export function recipeCopilotSettingsUrl(code: string | null | undefined) {
  if (isRecipeCopilotRequestLimitError(code)) return "/settings/ai?section=Budgets#ai-request-limits";
  if (isRecipeCopilotCostLimitError(code)) return "/settings/ai?section=Budgets#ai-cost-limits";
  return "/settings/ai";
}

/** Remaining-request summary shown beside the Ready and Blocked states. */
export function recipeCopilotDailyRequestSummary(daily: { effectiveMode?: string | null; limit?: number | null; usage?: number | null; remaining?: number | null; resetAt?: string | null } | null | undefined) {
  if (!daily || daily.limit == null) return "No daily AI request limit is configured.";
  const reset = daily.resetAt ? new Date(daily.resetAt) : null;
  const resets = reset && !Number.isNaN(reset.getTime()) ? ` Resets ${reset.toLocaleString()}.` : "";
  return `${Number(daily.usage || 0).toLocaleString()} of ${Number(daily.limit).toLocaleString()} daily AI requests used · ${Number(daily.remaining ?? 0).toLocaleString()} remaining.${resets}`;
}
