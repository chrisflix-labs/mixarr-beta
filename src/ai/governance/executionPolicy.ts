import prisma from "@/lib/prisma";
import type { AiCapability, AiRequest, ResolvedAiProviderConfig } from "../contracts";
import { AiError } from "../errors";
import { aiFeatureByKey, canonicalFeatureId } from "../features/registry";
import { evaluateProviderFeatureAuthorization, externalDataCategoriesForFeature, providerSlug, type AuthorizationDecision, type AuthorizationInput } from "./authorizationEvaluator";

function envDisablesAi() { return /^(0|false|off|disabled)$/i.test(String(process.env.MIXARR_AI_ENABLED || "true").trim()); }

// Confirmation failures carry richer UI context; other checks surface the
// structured decision (requested feature, provider, and the exact failed check).
function authorizationError(decision: AuthorizationDecision, context: { model: string; providerDisplayName: string }): AiError {
  const details: Record<string, unknown> = {
    requestedFeature: decision.requestedFeature,
    providerId: decision.providerId,
    providerSlug: decision.providerSlug,
    failedCheck: decision.failedCheck,
    ...decision.details,
  };
  if (decision.code === "AI_EXTERNAL_CONFIRMATION_REQUIRED") {
    return new AiError("AI_EXTERNAL_CONFIRMATION_REQUIRED", undefined, 409, undefined, { provider: context.providerDisplayName, model: context.model, feature: decision.requestedFeature, data_categories: decision.externalDataCategories, privacy_mode: decision.privacyMode });
  }
  return new AiError(decision.code as any, undefined, undefined, undefined, details);
}

// Sanitized server-side decision log (request ID + the same fields returned to
// admins). Never contains prompts, responses, secrets, or credentials.
function logAuthorizationDecision(correlationId: string | undefined, decision: AuthorizationDecision) {
  console.info("[AI] Provider feature authorization", {
    correlationId: correlationId || null,
    requestedFeature: decision.requestedFeature,
    providerId: decision.providerId,
    providerSlug: decision.providerSlug,
    external: decision.external,
    privacyMode: decision.privacyMode,
    decision: decision.allowed ? "ALLOWED" : "BLOCKED",
    failedCheck: decision.failedCheck,
    reasonCode: decision.code,
  });
}

async function resolveAuthorizationRecords(providerId: string, model: string) {
  return Promise.all([
    prisma.aiGlobalSetting.findUnique({ where: { id: "global" } }),
    prisma.aiGovernanceSetting.findUnique({ where: { id: "global" } }),
    prisma.aiProviderConfig.findUnique({ where: { id: providerId } }),
    prisma.aiProviderModel.findUnique({ where: { providerConfigId_modelIdentifier: { providerConfigId: providerId, modelIdentifier: model } } }),
  ]);
}

function buildAuthorizationInput(params: {
  request: AiRequest; requiredCapabilities: AiCapability[]; model: string;
  global: any; governance: any; provider: any; model_: any; featureSetting: any;
}): AuthorizationInput {
  const feature = canonicalFeatureId(params.request.featureKey);
  const privacyMode = params.request.privacyMode || params.governance?.privacyMode || "METADATA_LIMITED";
  return {
    requestedFeature: feature,
    privacyMode,
    externalConfirmation: params.request.externalConfirmation,
    requiredCapabilities: params.requiredCapabilities,
    aiEnvDisabled: envDisablesAi(),
    globalEnabled: !!params.global?.enabled,
    emergencyShutdown: !!params.global?.emergencyShutdown,
    featureImplemented: aiFeatureByKey.get(feature)?.implemented === true,
    featureEnabled: params.featureSetting?.enabled === true,
    externalProvidersAllowed: !!params.governance?.externalProvidersAllowed,
    requireExternalConfirmation: !!params.governance?.requireExternalConfirmation,
    allowedExternalDataJson: params.governance?.allowedExternalDataJson,
    provider: params.provider ? {
      id: params.provider.id, displayName: params.provider.displayName, providerType: params.provider.providerType,
      enabled: params.provider.enabled, approved: params.provider.approved, deleted: !!params.provider.deletedAt,
      allowedFeaturesJson: params.provider.allowedFeaturesJson, privacyModesJson: params.provider.privacyModesJson,
      allowExternalRequests: params.provider.allowExternalRequests, allowLibraryMetadata: params.provider.allowLibraryMetadata,
      allowDiagnosticData: params.provider.allowDiagnosticData, locationClassification: params.provider.locationClassification,
      administratorConfirmedLocal: params.provider.administratorConfirmedLocal, trustedNetwork: params.provider.trustedNetwork,
    } : { id: params.request.providerId || "unknown", displayName: "Unknown provider", enabled: false, approved: false, deleted: true, allowedFeaturesJson: [], privacyModesJson: [], allowExternalRequests: false, allowLibraryMetadata: false, allowDiagnosticData: false, locationClassification: "UNKNOWN", administratorConfirmedLocal: false, trustedNetwork: false },
    model: params.model_ ? {
      availabilityStatus: params.model_.availabilityStatus, deprecated: params.model_.deprecated, enabled: params.model_.enabled,
      approved: params.model_.approved, allowedFeaturesJson: params.model_.allowedFeaturesJson, capabilitiesJson: params.model_.capabilitiesJson,
      structuredOutput: params.model_.structuredOutput, jsonMode: params.model_.jsonMode, toolCalling: params.model_.toolCalling,
    } : null,
  };
}

export async function assertAiExecutionPolicy(input: { request: AiRequest; provider: ResolvedAiProviderConfig; model: string; requiredCapabilities: AiCapability[] }) {
  const feature = canonicalFeatureId(input.request.featureKey);
  const [[global, governance, provider, model], featureSetting] = await Promise.all([
    resolveAuthorizationRecords(input.provider.id, input.model),
    prisma.aiFeatureSetting.findUnique({ where: { featureKey: feature } }),
  ]);
  const authorizationInput = buildAuthorizationInput({ request: input.request, requiredCapabilities: input.requiredCapabilities, model: input.model, global, governance, provider, model_: model, featureSetting });
  const decision = evaluateProviderFeatureAuthorization(authorizationInput);
  logAuthorizationDecision(input.request.correlationId, decision);
  if (!decision.allowed) throw authorizationError(decision, { model: input.model, providerDisplayName: provider?.displayName || input.provider.displayName });
  return { external: decision.external, privacyMode: decision.privacyMode, externalDataCategories: decision.externalDataCategories, provider, model, governance, global };
}

// Administrator-safe "effective authorization" diagnostics. Returns the full
// ordered checklist for a provider+feature+model without short-circuiting, plus
// the final decision. Never exposes credentials, headers, or request content.
export async function getEffectiveAuthorization(input: { providerId: string; feature: string; model?: string; privacyMode?: string; externalConfirmation?: boolean }) {
  const feature = canonicalFeatureId(input.feature);
  const [global, governance, provider, featureSetting] = await Promise.all([
    prisma.aiGlobalSetting.findUnique({ where: { id: "global" } }),
    prisma.aiGovernanceSetting.findUnique({ where: { id: "global" } }),
    prisma.aiProviderConfig.findUnique({ where: { id: input.providerId } }),
    prisma.aiFeatureSetting.findUnique({ where: { featureKey: feature } }),
  ]);
  const model = input.model || provider?.defaultModel || undefined;
  const modelRow = provider && model ? await prisma.aiProviderModel.findUnique({ where: { providerConfigId_modelIdentifier: { providerConfigId: provider.id, modelIdentifier: model } } }) : null;
  const definition = aiFeatureByKey.get(feature);
  const requiredCapabilities = (definition?.requiredCapabilities || ["chat_messages", "structured_json"]) as AiCapability[];
  const request = { featureKey: feature, privacyMode: input.privacyMode as any, externalConfirmation: input.externalConfirmation, providerId: input.providerId, messages: [] } as unknown as AiRequest;
  const authorizationInput = buildAuthorizationInput({ request, requiredCapabilities, model: model || "", global, governance, provider, model_: modelRow, featureSetting });
  const decision = evaluateProviderFeatureAuthorization(authorizationInput);
  const external = authorizationInput.provider.locationClassification === "LOCAL" && authorizationInput.provider.administratorConfirmedLocal && authorizationInput.provider.trustedNetwork ? false : true;
  const dataCategories = external ? externalDataCategoriesForFeature(feature) : [];
  const allowedCategories = Array.isArray(governance?.allowedExternalDataJson) ? (governance!.allowedExternalDataJson as unknown[]).map(String) : [];
  const providerFeatures = Array.isArray(provider?.allowedFeaturesJson) ? (provider!.allowedFeaturesJson as unknown[]).map((value) => canonicalFeatureId(value)) : [];
  const modelFeatures = Array.isArray(modelRow?.allowedFeaturesJson) ? (modelRow!.allowedFeaturesJson as unknown[]).map((value) => canonicalFeatureId(value)) : [];
  const checks = [
    { check: "feature_exists", label: "Requested canonical feature", value: feature, passed: !!definition?.implemented },
    { check: "feature_enabled", label: "Feature enabled", passed: featureSetting?.enabled === true },
    { check: "global_ai_enabled", label: "Global AI access", passed: !!global?.enabled && !envDisablesAi() },
    { check: "provider_enabled", label: "Provider enabled", passed: !!provider?.enabled && !provider?.deletedAt },
    { check: "provider_approved", label: "Provider approved", passed: !!provider?.approved },
    { check: "external", label: external ? "Remote provider" : "Local provider", passed: true },
    { check: "external_requests_allowed", label: "External requests allowed", passed: !external || (!!governance?.externalProvidersAllowed && !!provider?.allowExternalRequests) },
    { check: "provider_feature_approval", label: "Provider approved for feature", passed: providerFeatures.includes(feature) },
    { check: "privacy_mode_supported", label: "Privacy mode permitted", value: authorizationInput.privacyMode, passed: Array.isArray(provider?.privacyModesJson) && (provider!.privacyModesJson as unknown[]).map(String).includes(authorizationInput.privacyMode) },
    { check: "data_category_allowed", label: "Required data categories permitted", value: dataCategories.join(", ") || "none", passed: !external || dataCategories.every((category) => allowedCategories.includes(category)) },
    { check: "model_available", label: "Selected model available", value: model || null, passed: !!modelRow && modelRow.availabilityStatus === "AVAILABLE" && !modelRow.deprecated && modelRow.enabled && modelRow.approved },
    { check: "model_feature_approval", label: "Model approved for feature", passed: modelFeatures.includes(feature) },
    { check: "capability_supported", label: "Model capabilities supported", passed: decision.failedCheck !== "capability_supported" },
    { check: "confirmation_satisfied", label: "Confirmation requirement", passed: decision.failedCheck !== "confirmation_satisfied" },
  ];
  return {
    requestedFeature: feature,
    provider: provider ? { id: provider.id, displayName: provider.displayName, slug: providerSlug({ slug: null, providerType: provider.providerType, displayName: provider.displayName }) } : null,
    model: model || null,
    remote: external,
    privacyMode: authorizationInput.privacyMode,
    allowed: decision.allowed,
    failedCheck: decision.failedCheck,
    blockingReasonCode: decision.code,
    checks,
  };
}

export async function currentEmergencyShutdown() {
  const global = await prisma.aiGlobalSetting.findUnique({ where: { id: "global" }, select: { emergencyShutdown: true, emergencyShutdownReason: true, emergencyShutdownBy: true, emergencyShutdownAt: true } });
  return { environmentDisabled: envDisablesAi(), active: envDisablesAi() || !!global?.emergencyShutdown, databaseActive: !!global?.emergencyShutdown, reason: global?.emergencyShutdownReason, actorId: global?.emergencyShutdownBy, changedAt: global?.emergencyShutdownAt };
}

export async function setEmergencyShutdown(input: { active: boolean; actorId: string; reason?: string }) {
  const previous = await prisma.aiGlobalSetting.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} });
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.aiGlobalSetting.update({ where: { id: "global" }, data: input.active ? { emergencyShutdown: true, emergencyShutdownReason: input.reason?.trim().slice(0, 1000) || "Emergency shutdown activated by an administrator.", emergencyShutdownBy: input.actorId, emergencyShutdownAt: now } : { emergencyShutdown: false, emergencyShutdownReason: null, emergencyShutdownBy: input.actorId, emergencyShutdownAt: now } });
    if (input.active) await tx.aiJob.updateMany({ where: { status: { in: ["PENDING", "QUEUED", "WAITING_RATE_LIMIT", "WAITING_PROVIDER", "RETRYING", "RUNNING"] } }, data: { cancellationRequestedAt: now, waitingReason: "EMERGENCY_SHUTDOWN" } });
    await tx.aiGovernanceAudit.create({ data: { actorId: input.actorId, action: input.active ? "EMERGENCY_AI_SHUTDOWN_ACTIVATED" : "EMERGENCY_AI_SHUTDOWN_DEACTIVATED", entityType: "AiGlobalSetting", entityId: "global", previousValueJson: { emergencyShutdown: previous.emergencyShutdown, reason: previous.emergencyShutdownReason } as any, newValueJson: { emergencyShutdown: updated.emergencyShutdown, reason: updated.emergencyShutdownReason } as any, reason: input.reason?.slice(0, 1000) } });
    return { environmentDisabled: envDisablesAi(), active: envDisablesAi() || updated.emergencyShutdown, databaseActive: updated.emergencyShutdown, reason: updated.emergencyShutdownReason, actorId: updated.emergencyShutdownBy, changedAt: updated.emergencyShutdownAt };
  });
}
