import prisma from "./prisma";
import {
  BUILT_IN_CONTEXT_PROFILES,
  CONTEXT_PROFILE_VERSION,
  contextInfluenceLevels,
  contextProfileSnapshot,
  contextToSmartMixSettings,
  customContextInputSchema,
  profileMatchesDate,
  type ContextInfluence,
  type ContextProfile,
} from "./contextualMixes";
import { normalizeSmartMixTuningConfig } from "./smartMixEngine/v2/tuning";

function mapCustomProfile(row: any): ContextProfile {
  const input = customContextInputSchema.parse({
    name: row.name,
    description: row.description,
    icon: row.icon,
    tags: row.tagsJson || [],
    contextType: row.contextType,
    isEnabled: row.isEnabled,
    availability: row.availabilityJson,
    behavior: row.behaviorJson,
  });
  return {
    ...input,
    id: row.id,
    userId: row.userId,
    builtInKey: null,
    builtInVersion: row.profileVersion || CONTEXT_PROFILE_VERSION,
    isBuiltIn: false,
    clonedFromBuiltInKey: row.clonedFromBuiltInKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getContextualMixSettings(userId: string) {
  return prisma.contextualMixSetting.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function updateContextualMixSettings(userId: string, input: any) {
  const defaultInfluence = contextInfluenceLevels.includes(input.defaultInfluence) ? input.defaultInfluence : "BALANCED";
  const timeZone = typeof input.timeZone === "string" && input.timeZone.length <= 80 ? (input.timeZone.trim() || null) : undefined;
  if (timeZone) {
    try { new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date()); } catch { throw new Error("Invalid timezone."); }
  }
  return prisma.contextualMixSetting.upsert({
    where: { userId },
    create: {
      userId,
      enabled: input.enabled ?? true,
      showSuggestions: input.showSuggestions ?? true,
      defaultInfluence,
      showBuiltInCards: input.showBuiltInCards ?? true,
      showCustomCards: input.showCustomCards ?? true,
      autoSuggestTimeAndDay: input.autoSuggestTimeAndDay ?? true,
      confirmBeforeReplacingManual: input.confirmBeforeReplacingManual ?? true,
      timeZone,
    },
    update: {
      ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
      ...(typeof input.showSuggestions === "boolean" ? { showSuggestions: input.showSuggestions } : {}),
      ...(typeof input.showBuiltInCards === "boolean" ? { showBuiltInCards: input.showBuiltInCards } : {}),
      ...(typeof input.showCustomCards === "boolean" ? { showCustomCards: input.showCustomCards } : {}),
      ...(typeof input.autoSuggestTimeAndDay === "boolean" ? { autoSuggestTimeAndDay: input.autoSuggestTimeAndDay } : {}),
      ...(typeof input.confirmBeforeReplacingManual === "boolean" ? { confirmBeforeReplacingManual: input.confirmBeforeReplacingManual } : {}),
      defaultInfluence,
      ...(timeZone !== undefined ? { timeZone } : {}),
    },
  });
}

export async function listContextProfiles(userId: string) {
  const [settings, rows] = await Promise.all([
    getContextualMixSettings(userId),
    prisma.contextProfile.findMany({ where: { userId }, orderBy: [{ isEnabled: "desc" }, { updatedAt: "desc" }] }),
  ]);
  const customProfiles = rows.map(mapCustomProfile);
  const suggested = settings.enabled && settings.showSuggestions && settings.autoSuggestTimeAndDay
    ? [...BUILT_IN_CONTEXT_PROFILES, ...customProfiles].filter((profile) => profile.isEnabled && profileMatchesDate(profile, new Date(), settings.timeZone || undefined)).slice(0, 3)
    : [];
  return {
    settings,
    builtInProfiles: settings.showBuiltInCards ? BUILT_IN_CONTEXT_PROFILES : [],
    customProfiles: settings.showCustomCards ? customProfiles : [],
    suggestedProfiles: suggested,
  };
}

export async function getOwnedContextProfile(userId: string, id: string) {
  const builtIn = BUILT_IN_CONTEXT_PROFILES.find((profile) => profile.id === id || profile.builtInKey === id);
  if (builtIn) return builtIn;
  const row = await prisma.contextProfile.findFirst({ where: { id, userId } });
  return row ? mapCustomProfile(row) : null;
}

export async function createCustomContext(userId: string, input: unknown, clone?: { key?: string | null; version?: string | null }) {
  const value = customContextInputSchema.parse(input);
  const row = await prisma.contextProfile.create({
    data: {
      userId,
      name: value.name,
      description: value.description,
      icon: value.icon,
      tagsJson: value.tags,
      contextType: value.contextType,
      isEnabled: value.isEnabled,
      availabilityJson: value.availability,
      behaviorJson: value.behavior,
      clonedFromBuiltInKey: clone?.key,
      clonedFromBuiltInVersion: clone?.version,
      profileVersion: CONTEXT_PROFILE_VERSION,
    },
  });
  console.info("[ContextualMix] custom_context_created", { userId, contextProfileId: row.id });
  return mapCustomProfile(row);
}

export async function updateCustomContext(userId: string, id: string, input: unknown) {
  const existing = await prisma.contextProfile.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Context profile not found.");
  const value = customContextInputSchema.parse(input);
  const row = await prisma.contextProfile.update({
    where: { id },
    data: { name: value.name, description: value.description, icon: value.icon, tagsJson: value.tags, contextType: value.contextType, isEnabled: value.isEnabled, availabilityJson: value.availability, behaviorJson: value.behavior },
  });
  console.info("[ContextualMix] custom_context_updated", { userId, contextProfileId: row.id });
  return mapCustomProfile(row);
}

export async function deleteCustomContext(userId: string, id: string) {
  const result = await prisma.contextProfile.deleteMany({ where: { id, userId } });
  if (!result.count) throw new Error("Context profile not found.");
  return true;
}

export async function cloneContextProfile(userId: string, id: string, requestedName?: string) {
  const source = await getOwnedContextProfile(userId, id);
  if (!source) throw new Error("Context profile not found.");
  const name = (requestedName || `${source.name} Copy`).trim().slice(0, 120);
  return createCustomContext(userId, { ...source, name, contextType: "CUSTOM", isEnabled: true }, {
    key: source.builtInKey || source.clonedFromBuiltInKey,
    version: source.builtInVersion,
  });
}

export async function resetClonedContext(userId: string, id: string) {
  const row = await prisma.contextProfile.findFirst({ where: { id, userId } });
  if (!row?.clonedFromBuiltInKey) throw new Error("This context is not a clone of a built-in profile.");
  const source = BUILT_IN_CONTEXT_PROFILES.find((profile) => profile.builtInKey === row.clonedFromBuiltInKey);
  if (!source) throw new Error("Original built-in context is unavailable.");
  const updated = await prisma.contextProfile.update({ where: { id }, data: { description: source.description, icon: source.icon, tagsJson: source.tags, availabilityJson: source.availability, behaviorJson: source.behavior, clonedFromBuiltInVersion: source.builtInVersion, profileVersion: CONTEXT_PROFILE_VERSION } });
  return mapCustomProfile(updated);
}

export async function resolveContextApplication({ userId, profileId, influence, currentTuning, mode = "REPLACE", manualFields = [] }: { userId: string; profileId: string; influence?: ContextInfluence; currentTuning?: unknown; mode?: "REPLACE" | "UNSET_ONLY"; manualFields?: string[] }) {
  const profile = await getOwnedContextProfile(userId, profileId);
  if (!profile || !profile.isEnabled) throw new Error("Context profile could not be loaded.");
  const current = normalizeSmartMixTuningConfig(currentTuning);
  const resolved = contextToSmartMixSettings(profile, current);
  const next = { ...resolved } as any;
  if (mode === "UNSET_ONLY") {
    for (const key of manualFields) if (key in current) next[key] = (current as any)[key];
  }
  const changes = Object.keys(resolved).filter((key) => key !== "tuningVersion" && JSON.stringify((current as any)[key]) !== JSON.stringify(next[key])).map((key) => ({ key, before: (current as any)[key], after: next[key] }));
  const selectedInfluence = contextInfluenceLevels.includes(influence as any) ? influence! : "BALANCED";
  console.info("[ContextualMix] context_settings_resolved", { userId, profileId: profile.id, influence: selectedInfluence, changedFields: changes.map((item) => item.key) });
  return { profile, tuningConfig: normalizeSmartMixTuningConfig(next), context: contextProfileSnapshot(profile, selectedInfluence, manualFields), changes };
}
