import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { playlistConfigSchema } from "../playlistService";
import { defaultMixRecipeDocument, mixRecipeDocumentSchema } from "../mixRecipes/schema";
import { portableRecipeFromRecord } from "../playlistRecipes";
import { validateRecipe } from "../mixRecipes/validation";
import {
  DEFAULT_MAX_RECIPE_INHERITANCE_DEPTH,
  RECIPE_LAYER_PRIORITY,
  compareEffectiveRecipes,
  deleteRecipeValue,
  detectRecipeInheritanceCycle,
  flattenRecipeValues,
  resolveRecipeConfiguration,
  setRecipeValue,
  type JsonObject,
  type RecipeConflictFinding,
  type RecipeResolutionLayer,
  type RecipeResolutionLock,
  type RecipeResolutionResult,
} from "./resolver";

const CONFIG_SECTIONS = ["scoring", "targets", "bpmFlow", "discovery", "variety", "playlistIdentity", "refreshPolicy", "automationPolicy", "generation"] as const;
export const RECIPE_PRESET_TYPES = ["CATEGORY", "TRANSITION", "DISCOVERY", "VARIETY", "AUTOMATION"] as const;

function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }

export function recipeConfigurationSections(recipe: ReturnType<typeof portableRecipeFromRecord>) {
  return Object.fromEntries(CONFIG_SECTIONS.map((section) => [section, recipe[section]])) as JsonObject;
}

function builtInConfiguration() {
  const document = defaultMixRecipeDocument({ name: "System Defaults", category: "Custom" }, playlistConfigSchema.parse({}));
  return recipeConfigurationSections(document as ReturnType<typeof portableRecipeFromRecord>);
}

function sourceLayer(type: RecipeResolutionLayer["type"], record: any, values: unknown, name?: string): RecipeResolutionLayer {
  return { type, id: record?.id || null, name: name || record?.name || type.replaceAll("_", " "), version: record?.version || record?.recipeVersion || null, priority: RECIPE_LAYER_PRIORITY[type], values: object(values) };
}

function flattenLockValues(value: unknown, prefix = "", output: Array<[string, unknown]> = []) {
  const candidate = object(value);
  if (prefix && Object.prototype.hasOwnProperty.call(candidate, "value")) { output.push([prefix, value]); return output; }
  if (value && typeof value === "object" && !Array.isArray(value)) for (const [key, child] of Object.entries(candidate)) flattenLockValues(child, prefix ? `${prefix}.${key}` : key, output);
  else if (prefix) output.push([prefix, value]);
  return output;
}

function localValues(record: any) {
  const combined = structuredClone(object(record.localOverridesJson));
  for (const override of record.recipeOverrides || []) setRecipeValue(combined, override.fieldPath, override.valueJson);
  return combined;
}

export function legacyRecipeOverrideValues(record: any) {
  return recipeConfigurationSections(portableRecipeFromRecord(record));
}

export function legacyRecipeOverrideRows(record: any, userId: string) {
  return Array.from(flattenRecipeValues(legacyRecipeOverrideValues(record)).entries()).map(([fieldPath, value]) => ({ recipeId: record.id, fieldPath, valueJson: json(value), schemaVersion: 1, createdById: userId, updatedById: userId, reason: "Preserved legacy explicit value during inheritance adoption" }));
}

function locksFromJson(value: unknown, source: { id?: string | null; name: string; version?: number | null }, authority: number): RecipeResolutionLock[] {
  return flattenLockValues(value).map(([fieldPath, raw]) => {
    const wrapper = object(raw);
    const wrapped = Object.prototype.hasOwnProperty.call(wrapper, "value");
    return { fieldPath, value: wrapped ? wrapper.value : raw, authority, reason: wrapped && typeof wrapper.reason === "string" ? wrapper.reason : null, source: { ...source } };
  });
}

const recipeInclude = {
  recipeOverrides: { orderBy: { fieldPath: "asc" as const } },
  recipeCategory: { include: { preset: true } },
  transitionPreset: true,
  discoveryPreset: true,
  varietyPreset: true,
  automationPreset: true,
} as const;

async function loadChain(userId: string, target: any, proposedBaseId?: string | null) {
  const chain = [target];
  const seen = new Set([target.id]);
  let baseId = proposedBaseId === undefined ? target.baseRecipeId : proposedBaseId;
  while (baseId) {
    if (seen.has(baseId)) break;
    const base = await prisma.playlistRecipe.findFirst({ where: { id: baseId, userId, isArchived: false, deletedAt: null }, include: recipeInclude });
    if (!base) throw new Error("The selected base recipe is missing, archived, or unavailable.");
    chain.unshift(base);
    seen.add(base.id);
    if (chain.length > DEFAULT_MAX_RECIPE_INHERITANCE_DEPTH + 1) throw new Error(`Recipe inheritance may not exceed ${DEFAULT_MAX_RECIPE_INHERITANCE_DEPTH} base-recipe levels.`);
    baseId = base.baseRecipeId;
  }
  return chain;
}

function addPreset(layers: RecipeResolutionLayer[], locks: RecipeResolutionLock[], preset: any, type: RecipeResolutionLayer["type"], authority: number, expectedType: string) {
  if (!preset) return;
  if (preset.isArchived) throw new Error(`Preset "${preset.name}" is archived.`);
  if (preset.type !== expectedType) throw new Error(`Preset "${preset.name}" is not a ${expectedType.toLowerCase()} preset.`);
  layers.push(sourceLayer(type, preset, preset.configJson));
  locks.push(...locksFromJson(preset.locksJson, { id: preset.id, name: `${preset.name} lock`, version: preset.version }, authority));
}

export type RecipeResolutionContext = {
  playlistId?: string | null;
  groupPolicyIds?: string[];
  applyUserPreferences?: boolean;
  proposedChanges?: {
    baseRecipeId?: string | null;
    recipeCategoryId?: string | null;
    transitionPresetId?: string | null;
    discoveryPresetId?: string | null;
    varietyPresetId?: string | null;
    automationPresetId?: string | null;
    overrides?: JsonObject;
    resetFields?: string[];
    playlistOverrides?: JsonObject;
  };
};

async function presetById(userId: string, id: string | null | undefined, expectedType: string) {
  if (!id) return null;
  const preset = await prisma.recipePreset.findFirst({ where: { id, ownerId: userId, isArchived: false } });
  if (!preset) throw new Error(`The selected ${expectedType.toLowerCase()} preset is unavailable.`);
  return preset;
}

export async function resolveOwnedRecipe(userId: string, recipeIdOrSlug: string, context: RecipeResolutionContext = {}): Promise<RecipeResolutionResult & { recipe: any; normalizedRecipe: any }> {
  const target = await prisma.playlistRecipe.findFirst({ where: { userId, isArchived: false, deletedAt: null, OR: [{ id: recipeIdOrSlug }, { slug: recipeIdOrSlug }] }, include: recipeInclude });
  if (!target) throw new Error("Mix recipe not found.");
  const proposed = context.proposedChanges || {};
  const allNodes = await prisma.playlistRecipe.findMany({ where: { userId, isArchived: false, deletedAt: null }, select: { id: true, name: true, baseRecipeId: true } });
  const cycle = detectRecipeInheritanceCycle(allNodes, target.id, proposed.baseRecipeId === undefined ? target.baseRecipeId : proposed.baseRecipeId);
  if (!cycle.valid) throw new Error(cycle.message || "Invalid recipe inheritance chain.");
  const chain = await loadChain(userId, target, proposed.baseRecipeId);
  const [globalDefaults, databaseLocks] = await Promise.all([
    prisma.globalRecipeDefaults.findUnique({ where: { scopeKey: "system" } }),
    prisma.recipeFieldLock.findMany({ where: { userId }, orderBy: [{ authority: "desc" }, { createdAt: "asc" }] }),
  ]);
  const layers: RecipeResolutionLayer[] = [sourceLayer("built_in_defaults", { id: "built-in", version: 1 }, builtInConfiguration(), "Built-in system defaults")];
  const locks: RecipeResolutionLock[] = [];
  if (globalDefaults) {
    layers.push(sourceLayer("global_defaults", globalDefaults, globalDefaults.configJson, "Administrator global defaults"));
    locks.push(...locksFromJson(globalDefaults.locksJson, { id: globalDefaults.id, name: "Administrator global policy", version: globalDefaults.version }, 1000));
  }

  for (const record of chain) {
    const isTarget = record.id === target.id;
    const inheritanceProposed = isTarget && (proposed.baseRecipeId !== undefined || Object.keys(proposed).some((key) => key.endsWith("PresetId") || key === "recipeCategoryId" || key === "overrides"));
    const inheritanceEnabled = record.inheritanceEnabled || !isTarget || inheritanceProposed;
    const categoryId = isTarget && proposed.recipeCategoryId !== undefined ? proposed.recipeCategoryId : record.recipeCategoryId;
    const category = categoryId ? (record.recipeCategory?.id === categoryId ? record.recipeCategory : await prisma.recipeCategory.findFirst({ where: { id: categoryId, userId, isArchived: false }, include: { preset: true } })) : null;
    if (category?.preset) addPreset(layers, locks, category.preset, "category_preset", 700, "CATEGORY");
    const transition = isTarget && proposed.transitionPresetId !== undefined ? await presetById(userId, proposed.transitionPresetId, "TRANSITION") : record.transitionPreset;
    const discovery = isTarget && proposed.discoveryPresetId !== undefined ? await presetById(userId, proposed.discoveryPresetId, "DISCOVERY") : record.discoveryPreset;
    const variety = isTarget && proposed.varietyPresetId !== undefined ? await presetById(userId, proposed.varietyPresetId, "VARIETY") : record.varietyPreset;
    const automation = isTarget && proposed.automationPresetId !== undefined ? await presetById(userId, proposed.automationPresetId, "AUTOMATION") : record.automationPreset;
    addPreset(layers, locks, transition, "transition_preset", 500, "TRANSITION");
    addPreset(layers, locks, discovery, "discovery_preset", 500, "DISCOVERY");
    addPreset(layers, locks, variety, "variety_preset", 500, "VARIETY");
    addPreset(layers, locks, automation, "automation_preset", 500, "AUTOMATION");
    if (!inheritanceEnabled) layers.push(sourceLayer("legacy_explicit", record, legacyRecipeOverrideValues(record), `${record.name} (legacy explicit values)`));
    else {
      const values = !record.inheritanceEnabled && isTarget ? legacyRecipeOverrideValues(record) : localValues(record);
      if (isTarget && proposed.overrides) for (const [path, value] of Array.from(flattenRecipeValues(proposed.overrides).entries())) setRecipeValue(values, path, value);
      if (isTarget) for (const path of proposed.resetFields || []) deleteRecipeValue(values, path);
      if (Object.keys(values).length) layers.push(sourceLayer(isTarget ? "recipe_override" : "base_recipe", record, values, record.name));
    }
  }

  if (context.groupPolicyIds?.length) {
    const policies = await prisma.recipeGroupPolicy.findMany({ where: { playlistGroupId: { in: context.groupPolicyIds }, playlistGroup: { userId } }, include: { playlistGroup: true }, orderBy: [{ priority: "asc" }, { playlistGroupId: "asc" }] });
    for (const policy of policies) {
      layers.push({ ...sourceLayer("group_policy", policy, policy.configJson, policy.playlistGroup.name), priority: RECIPE_LAYER_PRIORITY.group_policy + policy.priority / 1000 });
      locks.push(...locksFromJson(policy.locksJson, { id: policy.id, name: `${policy.playlistGroup.name} policy` }, 800 + policy.priority));
    }
  }
  if (context.playlistId) {
    const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: context.playlistId, userId }, include: { recipeOverrides: true } });
    if (!playlist) throw new Error("Generated playlist not found.");
    const values: JsonObject = {};
    for (const override of playlist.recipeOverrides) setRecipeValue(values, override.fieldPath, override.valueJson);
    if (Object.keys(values).length) layers.push(sourceLayer("playlist_override", playlist, values, playlist.plexPlaylistTitle));
  }
  if (proposed.playlistOverrides) layers.push(sourceLayer("playlist_override", { id: "preview" }, proposed.playlistOverrides, "Proposed playlist override"));
  if (context.applyUserPreferences) {
    const preferences = await prisma.userRecipePreference.findUnique({ where: { userId } });
    if (preferences) layers.push({ ...sourceLayer("user_preference", preferences, preferences.configJson, "User recipe preferences"), allowedFields: Array.isArray(preferences.allowedFieldsJson) ? preferences.allowedFieldsJson.filter((field): field is string => typeof field === "string") : [] });
  }
  for (const lock of databaseLocks) locks.push({ fieldPath: lock.fieldPath, value: lock.valueJson, authority: lock.authority, reason: lock.reason, source: { id: lock.id, name: `${lock.sourceType.replaceAll("_", " ")} lock` } });

  const result = resolveRecipeConfiguration({ layers, locks });
  const targetPortable = portableRecipeFromRecord(target);
  const candidate = { ...targetPortable, ...result.effectiveConfiguration, recipeVersion: target.recipeVersion };
  const validation = validateRecipe(candidate);
  if (!validation.valid) {
    const findings: RecipeConflictFinding[] = validation.errors.map((error) => ({ severity: "blocking", code: error.code || "RECIPE_VALIDATION_ERROR", fields: [error.path], message: error.message, suggestion: "Adjust or reset the invalid field." }));
    result.conflicts.push(...findings); result.errors.push(...findings); result.valid = false;
  }
  const normalizedRecipe = validation.normalizedRecipe || mixRecipeDocumentSchema.safeParse(candidate).data || candidate;
  return { ...result, recipe: target, normalizedRecipe };
}

export async function previewRecipeImpact(userId: string, recipeId: string, proposedChanges: RecipeResolutionContext["proposedChanges"]) {
  const before = await resolveOwnedRecipe(userId, recipeId);
  const after = await resolveOwnedRecipe(userId, recipeId, { proposedChanges });
  const dependents = await prisma.playlistRecipe.findMany({ where: { userId, baseRecipeId: recipeId, isArchived: false, deletedAt: null }, select: { id: true, name: true } });
  const playlists = await prisma.generatedPlaylist.count({ where: { userId, recipeId } });
  const dependentChanges = [];
  for (const dependent of dependents) {
    const current = await resolveOwnedRecipe(userId, dependent.id);
    dependentChanges.push({ recipe: dependent, fingerprint: current.fingerprint });
  }
  return { valid: after.valid, beforeFingerprint: before.fingerprint, afterFingerprint: after.fingerprint, changes: compareEffectiveRecipes(before, after), conflicts: after.conflicts, affected: { recipes: dependents.length, playlists, automations: 0 }, dependents: dependentChanges };
}

export async function saveRecipeOverride(userId: string, recipeId: string, fieldPath: string, value: unknown, reason?: string) {
  const recipe = await prisma.playlistRecipe.findFirst({ where: { id: recipeId, userId, isArchived: false, deletedAt: null } });
  if (!recipe) throw new Error("Mix recipe not found.");
  await prisma.$transaction([
    prisma.recipeOverride.upsert({ where: { recipeId_fieldPath: { recipeId, fieldPath } }, create: { recipeId, fieldPath, valueJson: json(value), createdById: userId, updatedById: userId, reason }, update: { valueJson: json(value), updatedById: userId, reason } }),
    prisma.playlistRecipe.update({ where: { id: recipeId }, data: { inheritanceEnabled: true } }),
    prisma.recipeInheritanceAudit.create({ data: { actorId: userId, action: "OVERRIDE_SET", entityType: "PlaylistRecipe", entityId: recipeId, changedFieldsJson: json([fieldPath]), nextJson: json({ [fieldPath]: value }), reason } }),
  ]);
  return resolveOwnedRecipe(userId, recipeId);
}

export async function resetRecipeOverrides(userId: string, recipeId: string, fieldPaths: string[]) {
  const recipe = await prisma.playlistRecipe.findFirst({ where: { id: recipeId, userId, isArchived: false, deletedAt: null } });
  if (!recipe) throw new Error("Mix recipe not found.");
  const paths = Array.from(new Set(fieldPaths.filter(Boolean)));
  await prisma.$transaction([
    prisma.recipeOverride.deleteMany({ where: { recipeId, ...(paths.length ? { fieldPath: { in: paths } } : {}) } }),
    prisma.recipeInheritanceAudit.create({ data: { actorId: userId, action: paths.length ? "OVERRIDE_RESET" : "ALL_OVERRIDES_RESET", entityType: "PlaylistRecipe", entityId: recipeId, changedFieldsJson: json(paths) } }),
  ]);
  return resolveOwnedRecipe(userId, recipeId);
}

export async function assignBaseRecipe(userId: string, recipeId: string, baseRecipeId: string | null) {
  const recipes = await prisma.playlistRecipe.findMany({ where: { userId, isArchived: false, deletedAt: null } });
  if (!recipes.some((recipe) => recipe.id === recipeId)) throw new Error("Mix recipe not found.");
  if (baseRecipeId && !recipes.some((recipe) => recipe.id === baseRecipeId)) throw new Error("Base recipe not found.");
  const cycle = detectRecipeInheritanceCycle(recipes, recipeId, baseRecipeId);
  if (!cycle.valid) throw new Error(cycle.message || "Invalid inheritance chain.");
  const target = recipes.find((recipe) => recipe.id === recipeId)!;
  await prisma.$transaction(async (tx) => {
    if (!target.inheritanceEnabled) await tx.recipeOverride.createMany({ data: legacyRecipeOverrideRows(target, userId), skipDuplicates: true });
    await tx.playlistRecipe.update({ where: { id: recipeId }, data: { baseRecipeId, inheritanceEnabled: true } });
    await tx.recipeInheritanceAudit.create({ data: { actorId: userId, action: baseRecipeId ? "BASE_ASSIGNED" : "BASE_REMOVED", entityType: "PlaylistRecipe", entityId: recipeId, nextJson: json({ baseRecipeId }), changedFieldsJson: json(!target.inheritanceEnabled ? ["legacy explicit values preserved"] : []) } });
  });
  return resolveOwnedRecipe(userId, recipeId);
}

export async function persistEffectiveSnapshot(input: { recipeId: string; playlistId?: string | null; contextType: string; resolution: RecipeResolutionResult }) {
  return prisma.effectiveRecipeSnapshot.create({ data: { recipeId: input.recipeId, playlistId: input.playlistId || null, contextType: input.contextType, effectiveConfigJson: json(input.resolution.effectiveConfiguration), provenanceJson: json(input.resolution.fields), inheritanceChainJson: json(input.resolution.inheritanceChain), conflictsJson: json(input.resolution.conflicts), warningsJson: json(input.resolution.warnings), resolverVersion: input.resolution.resolverVersion, schemaVersion: input.resolution.schemaVersion, fingerprint: input.resolution.fingerprint } });
}
