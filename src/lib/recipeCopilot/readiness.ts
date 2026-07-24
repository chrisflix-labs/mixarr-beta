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
  AI_DAILY_LIMIT_EXCEEDED: "The applicable daily AI limit has been reached.",
  AI_MONTHLY_BUDGET_EXCEEDED: "The configured AI monthly budget has been reached.",
  AI_PRIVACY_POLICY_BLOCKED: "The active AI privacy policy does not permit this request.",
  AI_PROVIDER_AUTH_FAILED: "The AI provider rejected its configured credentials.",
  AI_PROVIDER_RATE_LIMITED: "The AI provider temporarily rate-limited the request.",
  AI_PROVIDER_TEMPORARY_FAILURE: "The AI provider is temporarily unavailable.",
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
