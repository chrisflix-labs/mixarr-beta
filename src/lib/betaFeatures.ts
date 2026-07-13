import prisma from "./prisma";
import { featureFlagRegistry, featureFlagKeys, type FeatureKey } from "./featureFlagRegistry";

export const BETA_FEATURE_SETTINGS_KEY = "betaFeatureSettings";

export const betaFeatureFlagDefinitions = featureFlagRegistry.map((definition) => ({
  ...definition,
  label: definition.name,
}));

export type BetaFeatureFlagName = FeatureKey;
export type BetaFeatureFlags = Record<BetaFeatureFlagName, boolean>;

export type BetaFeatureSettings = {
  enableExperimentalFeatures: boolean;
  flags: BetaFeatureFlags;
};

export const betaFeatureFlagNames = featureFlagKeys;

export const defaultBetaFeatureFlags: BetaFeatureFlags = Object.fromEntries(
  betaFeatureFlagDefinitions.map((flag) => [flag.key, false]),
) as BetaFeatureFlags;

export const defaultBetaFeatureSettings: BetaFeatureSettings = {
  enableExperimentalFeatures: false,
  flags: defaultBetaFeatureFlags,
};

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function getUnknownBetaFlagNames(input: unknown) {
  if (!input || typeof input !== "object") return [];
  const flags = (input as { flags?: unknown }).flags;
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return [];
  const known = new Set(betaFeatureFlagNames);
  return Object.keys(flags).filter((key) => !known.has(key as BetaFeatureFlagName));
}

export function normalizeBetaFeatureSettings(input: unknown): BetaFeatureSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      enableExperimentalFeatures: false,
      flags: { ...defaultBetaFeatureFlags },
    };
  }

  const source = input as Partial<BetaFeatureSettings>;
  const inputFlags = source.flags && typeof source.flags === "object" && !Array.isArray(source.flags)
    ? source.flags as Partial<Record<BetaFeatureFlagName, unknown>>
    : {};

  return {
    enableExperimentalFeatures: normalizeBoolean(source.enableExperimentalFeatures, false),
    flags: Object.fromEntries(
      betaFeatureFlagDefinitions.map((flag) => [
        flag.key,
        normalizeBoolean(inputFlags[flag.key], false),
      ]),
    ) as BetaFeatureFlags,
  };
}

export function getBetaFlags(settings: BetaFeatureSettings = defaultBetaFeatureSettings): BetaFeatureFlags {
  const normalized = normalizeBetaFeatureSettings(settings);
  if (!normalized.enableExperimentalFeatures) return { ...defaultBetaFeatureFlags };
  return { ...normalized.flags };
}

export function isExperimentalEnabled(settings: BetaFeatureSettings = defaultBetaFeatureSettings) {
  return normalizeBetaFeatureSettings(settings).enableExperimentalFeatures;
}

export function isFeatureEnabled(flagName: string, settings: BetaFeatureSettings = defaultBetaFeatureSettings) {
  if (!betaFeatureFlagNames.includes(flagName as BetaFeatureFlagName)) return false;
  const flags = getBetaFlags(settings);
  return flags[flagName as BetaFeatureFlagName] === true;
}

function parseStoredSettings(value: string | null | undefined) {
  if (!value) return defaultBetaFeatureSettings;
  try {
    return normalizeBetaFeatureSettings(JSON.parse(value));
  } catch {
    return defaultBetaFeatureSettings;
  }
}

export async function getBetaFeatureSettings(): Promise<BetaFeatureSettings> {
  try {
    const row = await prisma.systemState.findUnique({
      where: { key: BETA_FEATURE_SETTINGS_KEY },
      select: { value: true },
    });
    return parseStoredSettings(row?.value);
  } catch {
    return defaultBetaFeatureSettings;
  }
}

export async function saveBetaFeatureSettings(input: unknown): Promise<BetaFeatureSettings> {
  const settings = normalizeBetaFeatureSettings(input);
  const row = await prisma.systemState.upsert({
    where: { key: BETA_FEATURE_SETTINGS_KEY },
    update: { value: JSON.stringify(settings) },
    create: {
      key: BETA_FEATURE_SETTINGS_KEY,
      value: JSON.stringify(settings),
    },
    select: { value: true },
  });
  return parseStoredSettings(row.value);
}
