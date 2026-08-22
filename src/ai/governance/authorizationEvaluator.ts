import type { AiErrorCategory } from "../errors";
import { canonicalFeatureId } from "../features/registry";
import { evaluateProviderLifecycleAuthorization } from "./providerLifecycle";

// v2.4.12 — single authoritative provider-feature authorization evaluator.
//
// This function is intentionally PURE: it receives already-resolved settings,
// provider, and model records and returns a structured decision. It performs no
// database, network, or environment access so the full authorization matrix can
// be unit tested deterministically, and so the API route, durable queue, and
// execution worker all reach the identical verdict for the same inputs.
//
// Governance is NOT weakened here. Provider approval and per-feature approval
// remain separate controls, external access still requires every external gate,
// and nothing is granted implicitly. The v2.4.11 defect was a duplicate global
// "allowed external features" list that shadowed the authoritative per-provider
// feature allowlist and reported the wrong error code; that duplicate gate is
// removed. The authoritative provider-feature control is provider.allowedFeaturesJson.

export const EXTERNAL_DATA_CATEGORIES_BY_FEATURE: Readonly<Record<string, string[]>> = {
  recipe_copilot: ["user_request", "recipe_configuration"],
  natural_language_playlist_requests: ["user_request"],
  playlist_ai_summaries: ["library_metadata", "playlist_metadata"],
  metadata_suggestions: ["library_metadata"],
  troubleshooting_explanations: ["diagnostic_data"],
  recommendation_explanations: ["library_metadata", "playlist_metadata"],
};

export function externalDataCategoriesForFeature(featureId: string): string[] {
  return EXTERNAL_DATA_CATEGORIES_BY_FEATURE[canonicalFeatureId(featureId)] || ["user_request"];
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export type AuthorizationProvider = {
  id: string;
  displayName: string;
  slug?: string | null;
  providerType?: string | null;
  enabled: boolean;
  approved: boolean;
  deleted: boolean;
  allowedFeaturesJson: unknown;
  privacyModesJson: unknown;
  allowExternalRequests: boolean;
  allowLibraryMetadata: boolean;
  allowDiagnosticData: boolean;
  locationClassification: string;
  administratorConfirmedLocal: boolean;
  trustedNetwork: boolean;
};

export type AuthorizationModel = {
  availabilityStatus: string;
  deprecated: boolean;
  enabled: boolean;
  approved: boolean;
  allowedFeaturesJson: unknown;
  capabilitiesJson: unknown;
  structuredOutput: boolean;
  jsonMode: boolean;
  toolCalling: boolean;
} | null;

export type AuthorizationInput = {
  requestedFeature: string;
  privacyMode: string;
  externalConfirmation?: boolean;
  requiredCapabilities: string[];
  aiEnvDisabled: boolean;
  globalEnabled: boolean;
  emergencyShutdown: boolean;
  featureImplemented: boolean;
  featureEnabled: boolean;
  externalProvidersAllowed: boolean;
  requireExternalConfirmation: boolean;
  allowedExternalDataJson: unknown;
  provider: AuthorizationProvider;
  model: AuthorizationModel;
};

export type AuthorizationDecision = {
  allowed: boolean;
  code: AiErrorCategory | null;
  failedCheck: string | null;
  requestedFeature: string;
  providerId: string;
  providerSlug: string;
  external: boolean;
  privacyMode: string;
  externalDataCategories: string[];
  details: Record<string, unknown>;
};

export function providerSlug(provider: Pick<AuthorizationProvider, "slug" | "providerType" | "displayName">): string {
  return String(provider.slug || provider.providerType || provider.displayName || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_") || "provider";
}

// Deterministic, ordered authorization. The first failed check decides the
// verdict and its accurate error code. AI_PROVIDER_FEATURE_BLOCKED is returned
// only for the exact provider-feature-approval failure.
export function evaluateProviderFeatureAuthorization(input: AuthorizationInput): AuthorizationDecision {
  const feature = canonicalFeatureId(input.requestedFeature);
  const slug = providerSlug(input.provider);
  const explicitlyLocal =
    input.provider.locationClassification === "LOCAL" &&
    input.provider.administratorConfirmedLocal &&
    input.provider.trustedNetwork;
  const external = !explicitlyLocal;
  const externalDataCategories = external ? externalDataCategoriesForFeature(feature) : [];
  const base = { requestedFeature: feature, providerId: input.provider.id, providerSlug: slug, external, privacyMode: input.privacyMode, externalDataCategories };
  const deny = (code: AiErrorCategory, failedCheck: string, details: Record<string, unknown> = {}): AuthorizationDecision =>
    ({ allowed: false, code, failedCheck, ...base, details });

  if (input.aiEnvDisabled || !input.globalEnabled) return deny("AI_DISABLED", "global_ai_enabled");
  if (input.emergencyShutdown) return deny("AI_EMERGENCY_SHUTDOWN", "emergency_shutdown");
  if (!input.featureImplemented) return deny("FEATURE_DISABLED", "feature_exists");
  if (!input.featureEnabled) return deny("FEATURE_DISABLED", "feature_enabled");

  const lifecycle = evaluateProviderLifecycleAuthorization("FEATURE_INFERENCE", {
    exists: true,
    deleted: input.provider.deleted,
    enabled: input.provider.enabled,
    approved: input.provider.approved,
  });
  if (!lifecycle.allowed) return deny(lifecycle.code!, lifecycle.failedCheck!);

  // Authoritative per-provider feature approval. Provider "approved" above does
  // not imply approval for every feature; this is a separate, granular control.
  const providerFeatures = toStringArray(input.provider.allowedFeaturesJson).map(canonicalFeatureId);
  if (!providerFeatures.includes(feature)) return deny("AI_PROVIDER_FEATURE_BLOCKED", "provider_feature_approval");

  const providerPrivacyModes = toStringArray(input.provider.privacyModesJson);
  if (!providerPrivacyModes.includes(input.privacyMode)) return deny("PRIVACY_MODE_INCOMPATIBLE", "privacy_mode_supported");

  if (input.privacyMode === "LOCAL_ONLY" && external) return deny("AI_EXTERNAL_PROVIDER_BLOCKED", "local_only_external");

  if (external) {
    if (!input.externalProvidersAllowed || !input.provider.allowExternalRequests) return deny("AI_EXTERNAL_PROVIDER_BLOCKED", "external_requests_allowed");
    const allowedCategories = toStringArray(input.allowedExternalDataJson);
    const missingCategory = externalDataCategories.find((category) => !allowedCategories.includes(category));
    if (missingCategory) return deny("AI_PRIVACY_POLICY_BLOCKED", "data_category_allowed", { data_category: missingCategory });
    if (externalDataCategories.includes("library_metadata") && !input.provider.allowLibraryMetadata) return deny("AI_PRIVACY_POLICY_BLOCKED", "provider_library_metadata");
    if (externalDataCategories.includes("diagnostic_data") && !input.provider.allowDiagnosticData) return deny("AI_PRIVACY_POLICY_BLOCKED", "provider_diagnostic_data");
    if (input.requireExternalConfirmation && input.externalConfirmation !== true) return deny("AI_EXTERNAL_CONFIRMATION_REQUIRED", "confirmation_satisfied", { data_categories: externalDataCategories });
  }

  if (!input.model || input.model.availabilityStatus !== "AVAILABLE" || input.model.deprecated) return deny("MODEL_NOT_AVAILABLE", "model_available");
  if (!input.model.enabled) return deny("AI_MODEL_DISABLED", "model_enabled");
  if (!input.model.approved) return deny("AI_MODEL_NOT_APPROVED", "model_approved");
  const modelFeatures = toStringArray(input.model.allowedFeaturesJson).map(canonicalFeatureId);
  if (!modelFeatures.includes(feature)) return deny("AI_MODEL_FEATURE_BLOCKED", "model_feature_approval");

  const capabilities = new Set(toStringArray(input.model.capabilitiesJson));
  if (input.model.structuredOutput) capabilities.add("structured_json");
  if (input.model.jsonMode) capabilities.add("json_schema");
  if (input.model.toolCalling) capabilities.add("tool_calling");
  const missing = Array.from(new Set(input.requiredCapabilities)).filter((capability) => !capabilities.has(capability));
  if (missing.length) return deny("CAPABILITY_UNAVAILABLE", "capability_supported", { missing_capabilities: missing });

  return { allowed: true, code: null, failedCheck: null, ...base, details: {} };
}
