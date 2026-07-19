import { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { safeRecordJobHistory } from "../jobHistory";
import { createPlaylistRecipeData, parsePlaylistRecipe, playlistRecipeSchema, updatePlaylistRecipeData } from "../playlistRecipes";
import { BUILT_IN_RECIPES, compareRecipeVersions, getBuiltInRecipe, type BuiltInRecipeDefinition } from "./catalog";
import { calculateRecipeCompatibility, getRecipeCompatibility, loadRecipeLibraryStats } from "./compatibility";
import { markBuiltInRecipeUsed, setBuiltInRecipePreference } from "./preferences";

function recipeInput(definition: BuiltInRecipeDefinition, overrides: { name?: string; description?: string | null } = {}) {
  const document = definition.engineConfig;
  return playlistRecipeSchema.parse({
    name: overrides.name || definition.name,
    description: overrides.description === undefined ? definition.longDescription : overrides.description,
    category: document.metadata.category,
    artworkUrl: null,
    enabled: true,
    filters: document.generation,
    scoring: document.scoring,
    targets: document.targets,
    bpmFlow: document.bpmFlow,
    discovery: document.discovery,
    variety: document.variety,
    playlistIdentity: document.playlistIdentity,
    refreshPolicy: document.refreshPolicy,
    automationPolicy: document.automationPolicy,
  });
}

async function userRecipeState(userId: string) {
  const [preferences, installed] = await Promise.all([
    prisma.builtInRecipePreference.findMany({ where: { userId } }),
    prisma.playlistRecipe.findMany({
      where: { userId, sourceRecipeId: { not: null }, isArchived: false, deletedAt: null },
      select: { id: true, name: true, sourceRecipeId: true, sourceRecipeVersion: true, recipeVersion: true, updatedAt: true },
    }),
  ]);
  return {
    preferences: new Map(preferences.map((item) => [item.recipeId, item])),
    installed: new Map(installed.filter((item) => item.sourceRecipeId).map((item) => [item.sourceRecipeId!, item])),
  };
}

function decorate(definition: BuiltInRecipeDefinition, state: Awaited<ReturnType<typeof userRecipeState>>, compatibility: Awaited<ReturnType<typeof getRecipeCompatibility>>) {
  const preference = state.preferences.get(definition.id);
  const installed = state.installed.get(definition.id);
  return {
    ...definition,
    engineConfig: undefined,
    preference: {
      favorite: preference?.favorite || false,
      hidden: preference?.hidden || false,
      lastUsedAt: preference?.lastUsedAt || null,
      lastUsedVersion: preference?.lastUsedVersion || null,
      useCount: preference?.useCount || 0,
    },
    installedRecipe: installed ? {
      id: installed.id, name: installed.name, recipeVersion: installed.recipeVersion,
      sourceRecipeVersion: installed.sourceRecipeVersion,
      updateStatus: compareRecipeVersions(installed.sourceRecipeVersion, definition.version),
      updatedAt: installed.updatedAt,
    } : null,
    compatibility,
  };
}

export async function listBuiltInRecipesWithCompatibility(userId: string) {
  const [state, stats] = await Promise.all([userRecipeState(userId), loadRecipeLibraryStats(userId)]);
  return BUILT_IN_RECIPES.map((definition) => decorate(definition, state, calculateRecipeCompatibility(definition, stats)));
}

export async function getBuiltInRecipeDetails(userId: string, recipeId: string) {
  const definition = getBuiltInRecipe(recipeId);
  if (!definition) return null;
  const [state, compatibility] = await Promise.all([userRecipeState(userId), getRecipeCompatibility(userId, definition, true)]);
  return {
    ...decorate(definition, state, compatibility),
    advancedEngineConfig: definition.engineConfig,
  };
}

export async function installBuiltInRecipe(userId: string, recipeId: string) {
  const definition = getBuiltInRecipe(recipeId);
  if (!definition) throw Object.assign(new Error("Built-in recipe not found."), { status: 404 });
  const input = recipeInput(definition);
  let result: { recipe: any; created: boolean; restored: boolean } | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const existing = await tx.playlistRecipe.findFirst({ where: { userId, sourceRecipeId: recipeId } });
        if (existing && !existing.isArchived && !existing.deletedAt) return { recipe: existing, created: false, restored: false };
        if (existing) {
          const restored = await tx.playlistRecipe.update({
            where: { id: existing.id },
            data: { ...updatePlaylistRecipeData(input, existing), sourceRecipeVersion: definition.version, isArchived: false, deletedAt: null, enabled: true },
          });
          await tx.recipeInheritanceAudit.create({ data: { actorId: userId, action: "BUILTIN_REINSTALLED", entityType: "PlaylistRecipe", entityId: restored.id, nextJson: { sourceRecipeId: definition.id, sourceRecipeVersion: definition.version } as Prisma.InputJsonValue } });
          return { recipe: restored, created: true, restored: true };
        }
        const created = await tx.playlistRecipe.create({
          data: { ...createPlaylistRecipeData(userId, input), sourceRecipeId: definition.id, sourceRecipeVersion: definition.version },
        });
        await tx.recipeInheritanceAudit.create({ data: { actorId: userId, action: "BUILTIN_INSTALLED", entityType: "PlaylistRecipe", entityId: created.id, nextJson: { sourceRecipeId: definition.id, sourceRecipeVersion: definition.version } as Prisma.InputJsonValue } });
        return { recipe: created, created: true, restored: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error: any) {
      if (error?.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  if (!result) throw new Error("Recipe installation could not acquire a safe transaction.");
  if (!result.created) return { recipe: parsePlaylistRecipe(result.recipe), created: false };
  await Promise.all([
    safeRecordJobHistory({ userId, type: "mix_recipe", name: result.restored ? "Built-in recipe reinstalled" : "Built-in recipe installed", status: "completed", trigger: "manual", summary: `${result.restored ? "Reinstalled" : "Installed"} built-in recipe "${definition.name}".`, counts: { attempted: 1, processed: 1 }, metadata: { recipeId: result.recipe.id, sourceRecipeId: definition.id, sourceRecipeVersion: definition.version } }),
    markBuiltInRecipeUsed(userId, definition.id, definition.version),
  ]);
  return { recipe: parsePlaylistRecipe(result.recipe), created: true, restored: result.restored };
}

export async function restoreBuiltInRecipe(userId: string, installedRecipeId: string) {
  const existing = await prisma.playlistRecipe.findFirst({ where: { id: installedRecipeId, userId, isArchived: false, deletedAt: null } });
  if (!existing) throw Object.assign(new Error("Installed recipe not found."), { status: 404 });
  if (!existing.sourceRecipeId) throw Object.assign(new Error("This recipe was not installed from the built-in library."), { status: 409 });
  const definition = getBuiltInRecipe(existing.sourceRecipeId);
  if (!definition) throw Object.assign(new Error("The source built-in recipe is no longer bundled. Your installed copy remains unchanged."), { status: 409 });
  const input = recipeInput(definition, { name: existing.name, description: existing.description });
  const previous = { sourceRecipeVersion: existing.sourceRecipeVersion, recipeVersion: existing.recipeVersion };
  const updated = await prisma.$transaction(async (tx) => {
    const recipe = await tx.playlistRecipe.update({
      where: { id: existing.id },
      data: { ...updatePlaylistRecipeData(input, existing), sourceRecipeVersion: definition.version },
    });
    await tx.recipeInheritanceAudit.create({ data: { actorId: userId, action: "BUILTIN_RESTORED", entityType: "PlaylistRecipe", entityId: existing.id, previousJson: previous as Prisma.InputJsonValue, nextJson: { sourceRecipeId: definition.id, sourceRecipeVersion: definition.version, recipeVersion: recipe.recipeVersion } as Prisma.InputJsonValue } });
    return recipe;
  });
  await safeRecordJobHistory({ userId, type: "mix_recipe", name: "Built-in recipe restored", status: "completed", trigger: "manual", summary: `Restored "${updated.name}" to ${definition.name} v${definition.version} defaults.`, counts: { attempted: 1, processed: 1 }, metadata: { recipeId: updated.id, sourceRecipeId: definition.id, sourceRecipeVersion: definition.version, previousSourceRecipeVersion: previous.sourceRecipeVersion } });
  return parsePlaylistRecipe(updated);
}

export async function updateBuiltInPreference(userId: string, recipeId: string, patch: { favorite?: boolean; hidden?: boolean }) {
  const definition = getBuiltInRecipe(recipeId);
  if (!definition) throw Object.assign(new Error("Built-in recipe not found."), { status: 404 });
  const preference = await setBuiltInRecipePreference(userId, recipeId, patch);
  console.info("[BuiltInRecipes] Preference updated", { userId, recipeId, favorite: patch.favorite, hidden: patch.hidden });
  return preference;
}

export async function recordBuiltInRecipeUse(userId: string, recipeId: string) {
  const definition = getBuiltInRecipe(recipeId);
  if (!definition) throw Object.assign(new Error("Built-in recipe not found."), { status: 404 });
  const installed = await prisma.playlistRecipe.findFirst({ where: { userId, sourceRecipeId: recipeId, isArchived: false, deletedAt: null }, select: { id: true } });
  await markBuiltInRecipeUsed(userId, definition.id, definition.version);
  return { success: true, installedRecipeId: installed?.id || null };
}

export async function restoreAllHiddenBuiltInRecipes(userId: string) {
  const result = await prisma.builtInRecipePreference.updateMany({ where: { userId, hidden: true }, data: { hidden: false } });
  return { restored: result.count };
}
