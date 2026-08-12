import type { Prisma } from "@prisma/client";
import { envBoolean as sharedEnvBoolean } from "./envBoolean";
import prisma from "./prisma";
import { isUserAdmin } from "./auth";
import { accessLevelRank, betaAccessLevelLabel, featureFlagByKey, featureFlagRegistry, isFeatureImplemented, normalizeBetaAccessLevel, type BetaAccessLevel, type FeatureFlagDefinition } from "./featureFlagRegistry";

export type FeatureStateReason = "enabled" | "disabled_by_default" | "beta_program_disabled" | "private_beta_unavailable" | "admin_required" | "server_disabled" | "emergency_disabled" | "unsupported_environment" | "missing_dependency";
export type FeatureContext = { userId?: string | null; isAdmin?: boolean; now?: Date; requireUserEnabled?: boolean };
export type ResolvedFeatureState = {
  key: string;
  enabled: boolean;
  available: boolean;
  reason: FeatureStateReason;
  accessLevel: BetaAccessLevel;
  serverAccessLevel: BetaAccessLevel;
  definition: FeatureFlagDefinition;
  userSelectable: boolean;
  explanation: string;
};

export class FeatureUnavailableError extends Error {
  code = "FEATURE_NOT_AVAILABLE" as const;
  constructor(public featureKey: string, public reason: FeatureStateReason, public status = 403) {
    super(`Feature ${featureKey} is unavailable: ${reason}`);
  }
}

export function resolveFeatureDecision(input: {
  definition: FeatureFlagDefinition;
  serverAccessLevel: BetaAccessLevel;
  userAccessLevel: BetaAccessLevel;
  betaOptIn: boolean;
  isAdmin: boolean;
  flagEnabled: boolean;
  requireUserEnabled: boolean;
  override?: { enabled?: boolean; forceDisabled?: boolean; minimumAccessLevel?: string | null; adminOnly?: boolean | null } | null;
  emergencyDisabled?: boolean;
  serverOverrideDisabled?: boolean;
  runtimeSupported?: boolean;
}): FeatureStateReason {
  const minimum = normalizeBetaAccessLevel(input.override?.minimumAccessLevel || input.definition.minimumAccessLevel);
  const adminOnly = input.override?.adminOnly ?? input.definition.adminOnly;
  if (input.emergencyDisabled || input.override?.forceDisabled) return "emergency_disabled";
  if (input.serverOverrideDisabled || input.override?.enabled === false || accessLevelRank(input.serverAccessLevel) < accessLevelRank(minimum)) return "server_disabled";
  if (input.runtimeSupported === false) return "unsupported_environment";
  if (!input.betaOptIn) return "beta_program_disabled";
  if (adminOnly && !input.isAdmin) return "admin_required";
  if (accessLevelRank(input.userAccessLevel) < accessLevelRank(minimum)) return "private_beta_unavailable";
  if (input.requireUserEnabled && !input.flagEnabled && !input.definition.defaultEnabled) return "disabled_by_default";
  return "enabled";
}

export function requiresBetaAcknowledgement(input: { enableBetaFeatures: boolean; acknowledged: boolean; hasExistingPreference: boolean; existingAccepted: boolean; legacyEnabled: boolean }) {
  if (!input.enableBetaFeatures || input.acknowledged || input.existingAccepted) return false;
  return input.hasExistingPreference || !input.legacyEnabled;
}

function envBoolean(value: string | undefined, fallback = false) {
  return sharedEnvBoolean(value, fallback);
}

function emergencyDisabledFeatures() {
  return new Set((process.env.MIXARR_DISABLED_FEATURES || "").split(",").map((value) => value.trim()).filter(Boolean));
}

export function configuredServerBetaLevel(): BetaAccessLevel {
  if (envBoolean(process.env.MIXARR_DEVELOPER_FEATURES_ENABLED) && process.env.NODE_ENV !== "production") return "DEVELOPER";
  if (envBoolean(process.env.MIXARR_PRIVATE_BETA_ENABLED)) return "PRIVATE_BETA";
  if (envBoolean(process.env.MIXARR_BETA_PROGRAM_ENABLED)) return "PUBLIC_BETA";
  return "STABLE";
}

async function legacyBetaSettings() {
  try {
    const row = await prisma.systemState.findUnique({ where: { key: "betaFeatureSettings" }, select: { value: true } });
    const parsed = row?.value ? JSON.parse(row.value) : null;
    return parsed && typeof parsed === "object" ? parsed as { enableExperimentalFeatures?: boolean; flags?: Record<string, boolean> } : null;
  } catch { return null; }
}

async function resolutionInputs(context: FeatureContext) {
  const userId = context.userId || null;
  const [legacy, preference, access, admin] = await Promise.all([
    legacyBetaSettings(),
    userId ? prisma.userBetaPreference.findUnique({ where: { userId } }).catch(() => null) : null,
    userId ? prisma.userBetaAccess.findUnique({ where: { userId } }).catch(() => null) : null,
    typeof context.isAdmin === "boolean" ? context.isAdmin : isUserAdmin(userId).catch(() => false),
  ]);
  const now = context.now || new Date();
  const flags = preference?.flagsJson && typeof preference.flagsJson === "object" && !Array.isArray(preference.flagsJson) ? preference.flagsJson as Record<string, unknown> : legacy?.flags || {};
  const betaOptIn = preference ? preference.enableBetaFeatures : legacy?.enableExperimentalFeatures === true;
  let userAccess = normalizeBetaAccessLevel(access?.accessLevel);
  if (access?.expiresAt && access.expiresAt <= now) userAccess = "STABLE";
  if (betaOptIn && accessLevelRank(userAccess) < accessLevelRank("PUBLIC_BETA")) userAccess = "PUBLIC_BETA";
  if (!betaOptIn) userAccess = "STABLE";
  return { legacy, preference, access, admin, flags, betaOptIn, userAccess };
}

function stateExplanation(reason: FeatureStateReason, definition: FeatureFlagDefinition) {
  const messages: Record<FeatureStateReason, string> = {
    enabled: `${definition.name} is enabled.`,
    disabled_by_default: `${definition.name} is available but individually disabled.`,
    beta_program_disabled: "Enable Beta Features and acknowledge the beta warning first.",
    private_beta_unavailable: `${betaAccessLevelLabel(definition.minimumAccessLevel)} access is required.`,
    admin_required: "Administrator permission is required.",
    server_disabled: "The server has not enabled this beta level or the administrator disabled this feature.",
    emergency_disabled: "This feature is disabled by an emergency server override.",
    unsupported_environment: "This feature is not supported in the current runtime environment.",
    missing_dependency: "A required dependency is unavailable.",
  };
  return messages[reason];
}

export async function getFeatureState(featureKey: string, context: FeatureContext = {}): Promise<ResolvedFeatureState> {
  const definition = featureFlagByKey.get(featureKey);
  if (!definition) throw new FeatureUnavailableError(featureKey, "server_disabled", 404);
  const inputs = await resolutionInputs(context);
  const override = await prisma.featureFlagOverride.findUnique({ where: { featureKey } }).catch(() => null);
  let serverAccessLevel = configuredServerBetaLevel();
  // v1.5.x installations used this persisted master setting before server-level
  // beta env configuration existed. Preserve that public-beta entitlement.
  if (inputs.legacy?.enableExperimentalFeatures && accessLevelRank(serverAccessLevel) < accessLevelRank("PUBLIC_BETA")) serverAccessLevel = "PUBLIC_BETA";
  let effectiveAccess = inputs.userAccess;
  if (accessLevelRank(effectiveAccess) > accessLevelRank(serverAccessLevel)) effectiveAccess = serverAccessLevel;
  const effectiveMinimum = normalizeBetaAccessLevel(override?.minimumAccessLevel || definition.minimumAccessLevel);
  const effectiveAdminOnly = override?.adminOnly ?? definition.adminOnly;
  const userSelectable = override?.userSelectable ?? true;
  const reason = resolveFeatureDecision({
    definition,
    serverAccessLevel,
    userAccessLevel: effectiveAccess,
    betaOptIn: inputs.betaOptIn,
    isAdmin: inputs.admin,
    flagEnabled: inputs.flags[featureKey] === true,
    requireUserEnabled: context.requireUserEnabled ?? true,
    override,
    emergencyDisabled: envBoolean(process.env.MIXARR_DISABLE_ALL_EXPERIMENTAL_FEATURES) || emergencyDisabledFeatures().has(featureKey),
    serverOverrideDisabled: Boolean(definition.serverOverride && process.env[definition.serverOverride] != null && !envBoolean(process.env[definition.serverOverride])),
    runtimeSupported: isFeatureImplemented(featureKey),
  });
  const available = reason === "enabled" || reason === "disabled_by_default";
  return { key: featureKey, enabled: reason === "enabled", available, reason, accessLevel: effectiveAccess, serverAccessLevel, definition: { ...definition, minimumAccessLevel: effectiveMinimum, adminOnly: effectiveAdminOnly, riskLevel: (override?.riskLevel as any) || definition.riskLevel }, userSelectable, explanation: stateExplanation(reason, definition) };
}

export async function isFeatureAvailable(featureKey: string, context: FeatureContext = {}) { return (await getFeatureState(featureKey, { ...context, requireUserEnabled: false })).available; }
export async function isFeatureEnabled(featureKey: string, context: FeatureContext = {}) { return (await getFeatureState(featureKey, context)).enabled; }
export async function requireFeature(featureKey: string, context: FeatureContext = {}) {
  const state = await getFeatureState(featureKey, context);
  if (!state.enabled) {
    console.warn("[FeatureFlag] Feature unavailable", { feature: featureKey, reason: state.reason, userId: context.userId || null });
    throw new FeatureUnavailableError(featureKey, state.reason);
  }
  console.info("[FeatureFlag] Feature enabled", { feature: featureKey, userId: context.userId || null, accessLevel: state.accessLevel });
  return state;
}

export async function listAvailableFeatures(context: FeatureContext = {}) {
  const states = await Promise.all(featureFlagRegistry.map((definition) => getFeatureState(definition.key, context)));
  return states.filter((state) => state.available || state.reason === "emergency_disabled");
}

export async function getBetaStatus(context: FeatureContext = {}) {
  const inputs = await resolutionInputs(context);
  const serverAccessLevel = configuredServerBetaLevel();
  const states = await Promise.all(featureFlagRegistry.map((definition) => getFeatureState(definition.key, context)));
  return {
    enabled: inputs.betaOptIn,
    accessLevel: states[0]?.accessLevel || "STABLE",
    serverAccessLevel: states[0]?.serverAccessLevel || serverAccessLevel,
    isAdmin: inputs.admin,
    warningAcceptedAt: inputs.preference?.warningAcceptedAt?.toISOString() || null,
    features: states,
    enabledFeatures: states.filter((state) => state.enabled).map((state) => state.key),
  };
}

export async function saveUserBetaPreferences(userId: string, input: unknown) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const flagsSource = source.flags && typeof source.flags === "object" && !Array.isArray(source.flags) ? source.flags as Record<string, unknown> : {};
  const [existing, legacy] = await Promise.all([
    prisma.userBetaPreference.findUnique({ where: { userId }, select: { flagsJson: true, warningAcceptedAt: true } }),
    legacyBetaSettings(),
  ]);
  const existingFlags = existing?.flagsJson && typeof existing.flagsJson === "object" && !Array.isArray(existing.flagsJson) ? existing.flagsJson as Record<string, unknown> : {};
  const flags = Object.fromEntries(featureFlagRegistry.map((definition) => [definition.key, Object.prototype.hasOwnProperty.call(flagsSource, definition.key) ? flagsSource[definition.key] === true : existingFlags[definition.key] === true]));
  const enableBetaFeatures = source.enableBetaFeatures === true || source.enableExperimentalFeatures === true;
  // v1.5.x stored the beta master toggle globally before acknowledgement and
  // per-user preference records existed. Treat an already-enabled legacy
  // setting as accepted during its first compatible per-user save; brand-new
  // opt-ins must still use the explicit confirmation flow.
  const grandfatherLegacyOptIn = !existing && legacy?.enableExperimentalFeatures === true;
  if (requiresBetaAcknowledgement({ enableBetaFeatures, acknowledged: source.acknowledged === true, hasExistingPreference: Boolean(existing), existingAccepted: Boolean(existing?.warningAcceptedAt), legacyEnabled: legacy?.enableExperimentalFeatures === true })) throw new Error("BETA_ACKNOWLEDGEMENT_REQUIRED");
  const warningAcceptedAt = source.acknowledged === true || grandfatherLegacyOptIn ? new Date() : existing?.warningAcceptedAt || null;
  return prisma.userBetaPreference.upsert({
    where: { userId },
    update: { enableBetaFeatures, flagsJson: flags as Prisma.InputJsonValue, warningAcceptedAt },
    create: { userId, enableBetaFeatures, flagsJson: flags as Prisma.InputJsonValue, warningAcceptedAt },
  });
}

export async function recordBetaUsage(input: { userId?: string | null; featureKey: string; playlistId?: string | null; action: string; success: boolean; fallbackUsed?: boolean; engineVersion?: string | null; scoringModel?: string | null; errorCode?: string | null; durationMs?: number | null; metadata?: Record<string, unknown> }) {
  try {
    return await prisma.betaFeatureUsage.create({ data: { userId: input.userId || null, featureKey: input.featureKey, playlistId: input.playlistId || null, action: input.action, success: input.success, fallbackUsed: input.fallbackUsed || false, engineVersion: input.engineVersion || null, scoringModel: input.scoringModel || null, errorCode: input.errorCode || null, durationMs: input.durationMs ?? null, metadataJson: input.metadata as Prisma.InputJsonValue | undefined } });
  } catch (error) {
    console.warn("[BetaUsage] Unable to record beta usage", { feature: input.featureKey, action: input.action });
    return null;
  }
}

export const featureFlagService = { isFeatureAvailable, isFeatureEnabled, getFeatureState, requireFeature, listAvailableFeatures };
