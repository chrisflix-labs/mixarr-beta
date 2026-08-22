import type { AiErrorCategory } from "../errors";

export const AI_PROVIDER_OPERATIONS = [
  "PROVIDER_AUTHENTICATION",
  "PROVIDER_DISCOVERY",
  "PROVIDER_HEALTH_CHECK",
  "PROVIDER_TEST_INFERENCE",
  "FEATURE_INFERENCE",
] as const;

export type AiProviderOperation = typeof AI_PROVIDER_OPERATIONS[number];
export type AiProviderSetupOperation = Exclude<AiProviderOperation, "FEATURE_INFERENCE">;

export type ProviderLifecycleState = {
  exists: boolean;
  deleted: boolean;
  enabled: boolean;
  approved: boolean;
};

export type ProviderLifecycleDecision = {
  allowed: boolean;
  code: AiErrorCategory | null;
  failedCheck: "provider_exists" | "provider_enabled" | "provider_approved" | null;
  operation: AiProviderOperation;
  policyResult: "ALLOWED" | "BLOCKED";
  reason: string;
};

/**
 * Provider setup is an administrator-authorized lifecycle phase, not feature
 * inference. An enabled provider may be validated before production approval;
 * feature inference continues to require explicit provider approval.
 */
export function evaluateProviderLifecycleAuthorization(
  operation: AiProviderOperation,
  provider: ProviderLifecycleState,
): ProviderLifecycleDecision {
  const deny = (
    code: AiErrorCategory,
    failedCheck: ProviderLifecycleDecision["failedCheck"],
    reason: string,
  ): ProviderLifecycleDecision => ({
    allowed: false,
    code,
    failedCheck,
    operation,
    policyResult: "BLOCKED",
    reason,
  });

  if (!provider.exists || provider.deleted) {
    return deny("PROVIDER_NOT_FOUND", "provider_exists", "provider_missing_or_deleted");
  }
  if (!provider.enabled) {
    return deny("PROVIDER_DISABLED", "provider_enabled", "provider_disabled");
  }
  if (operation === "FEATURE_INFERENCE" && !provider.approved) {
    return deny("AI_PROVIDER_NOT_APPROVED", "provider_approved", "production_approval_required");
  }
  return {
    allowed: true,
    code: null,
    failedCheck: null,
    operation,
    policyResult: "ALLOWED",
    reason: operation === "FEATURE_INFERENCE" ? "production_provider_approved" : "setup_operation_permitted",
  };
}
