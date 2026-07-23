import prisma from "@/lib/prisma";
import type { AiCapability, AiRequest, ResolvedAiProviderConfig } from "../contracts";
import { AiError } from "../errors";

const externalCategoriesForFeature: Record<string, string[]> = {
  recipe_copilot: ["user_request", "recipe_configuration"],
  natural_language_playlist_requests: ["user_request"],
  playlist_ai_summaries: ["library_metadata", "playlist_metadata"],
  metadata_suggestions: ["library_metadata"],
  troubleshooting_explanations: ["diagnostic_data"],
  recommendation_explanations: ["library_metadata", "playlist_metadata"],
};

function stringArray(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }
function envDisablesAi() { return /^(0|false|off|disabled)$/i.test(String(process.env.MIXARR_AI_ENABLED || "true").trim()); }

export async function assertAiExecutionPolicy(input: { request: AiRequest; provider: ResolvedAiProviderConfig; model: string; requiredCapabilities: AiCapability[] }) {
  const [global, governance, provider, model] = await Promise.all([
    prisma.aiGlobalSetting.findUnique({ where: { id: "global" } }),
    prisma.aiGovernanceSetting.findUnique({ where: { id: "global" } }),
    prisma.aiProviderConfig.findUnique({ where: { id: input.provider.id } }),
    prisma.aiProviderModel.findUnique({ where: { providerConfigId_modelIdentifier: { providerConfigId: input.provider.id, modelIdentifier: input.model } } }),
  ]);
  if (envDisablesAi() || !global?.enabled) throw new AiError("AI_DISABLED");
  if (global.emergencyShutdown) throw new AiError("AI_EMERGENCY_SHUTDOWN");
  if (!provider || provider.deletedAt) throw new AiError("PROVIDER_NOT_FOUND");
  if (!provider.enabled) throw new AiError("PROVIDER_DISABLED");
  if (!provider.approved) throw new AiError("AI_PROVIDER_NOT_APPROVED");
  const providerFeatures = stringArray(provider.allowedFeaturesJson);
  if (!providerFeatures.includes(input.request.featureKey)) throw new AiError("AI_PROVIDER_FEATURE_BLOCKED");
  const privacyMode = input.request.privacyMode || governance?.privacyMode || "METADATA_LIMITED";
  const providerPrivacyModes = stringArray(provider.privacyModesJson);
  if (!providerPrivacyModes.includes(privacyMode)) throw new AiError("PRIVACY_MODE_INCOMPATIBLE");
  const explicitlyLocal = provider.locationClassification === "LOCAL" && provider.administratorConfirmedLocal && provider.trustedNetwork;
  const external = !explicitlyLocal;
  if (privacyMode === "LOCAL_ONLY" && external) throw new AiError("AI_EXTERNAL_PROVIDER_BLOCKED");
  if (external) {
    if (!governance?.externalProvidersAllowed || !provider.allowExternalRequests) throw new AiError("AI_EXTERNAL_PROVIDER_BLOCKED");
    if (!stringArray(governance.allowedExternalFeaturesJson).includes(input.request.featureKey)) throw new AiError("AI_PROVIDER_FEATURE_BLOCKED");
    const categories = externalCategoriesForFeature[input.request.featureKey] || ["user_request"];
    const allowedCategories = stringArray(governance.allowedExternalDataJson);
    if (categories.some((category) => !allowedCategories.includes(category))) throw new AiError("AI_PRIVACY_POLICY_BLOCKED");
    if (categories.includes("library_metadata") && !provider.allowLibraryMetadata) throw new AiError("AI_PRIVACY_POLICY_BLOCKED");
    if (categories.includes("diagnostic_data") && !provider.allowDiagnosticData) throw new AiError("AI_PRIVACY_POLICY_BLOCKED");
    if (governance.requireExternalConfirmation && input.request.externalConfirmation !== true) throw new AiError("AI_EXTERNAL_CONFIRMATION_REQUIRED", undefined, 409, undefined, { provider: provider.displayName, model: input.model, feature: input.request.featureKey, data_categories: categories, privacy_mode: privacyMode });
  }
  if (!model || model.availabilityStatus !== "AVAILABLE" || model.deprecated) throw new AiError("MODEL_NOT_AVAILABLE");
  if (!model.enabled) throw new AiError("AI_MODEL_DISABLED");
  if (!model.approved) throw new AiError("AI_MODEL_NOT_APPROVED");
  if (!stringArray(model.allowedFeaturesJson).includes(input.request.featureKey)) throw new AiError("AI_MODEL_FEATURE_BLOCKED");
  const capabilities = new Set(stringArray(model.capabilitiesJson));
  if (model.structuredOutput) capabilities.add("structured_json");
  if (model.jsonMode) capabilities.add("json_schema");
  if (model.toolCalling) capabilities.add("tool_calling");
  const missing = input.requiredCapabilities.filter((capability) => !capabilities.has(capability));
  if (missing.length) throw new AiError("CAPABILITY_UNAVAILABLE", undefined, 409, undefined, { missing_capabilities: missing });
  return { external, privacyMode, externalDataCategories: external ? externalCategoriesForFeature[input.request.featureKey] || ["user_request"] : [], provider, model, governance, global };
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
