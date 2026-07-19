import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { APP_VERSION } from "./appVersion";
import { playlistConfigSchema, summarizePlaylistSafetyRules, type PlaylistConfigInput, type PlaylistRuleInput } from "./playlistService";
import {
  defaultMixRecipeDocument,
  mixRecipeMetadataSchema,
  recipeAutomationPolicySchema,
  recipeBpmFlowSchema,
  recipeDiscoverySchema,
  recipeIdentityDefaultsSchema,
  recipeRefreshPolicySchema,
  recipeScoringSchema,
  recipeTargetsSchema,
  recipeVarietySchema,
  slugifyRecipeName,
  resolveRecipeGenerationConfig,
  type MixRecipeDocument,
} from "./mixRecipes/schema";
import { validateRecipe } from "./mixRecipes/validation";

type RuleNode = PlaylistRuleInput | {
  type: "group";
  combinator: "AND" | "OR";
  children: RuleNode[];
};

export const playlistRecipeSchema = z.object({
  name: z.string().trim().min(1, "Recipe name is required.").max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  category: z.string().trim().min(1).max(80).default("Custom"),
  artworkUrl: z.string().trim().max(500).optional().nullable(),
  enabled: z.boolean().default(true),
  sourcePlaylistId: z.string().uuid().optional().nullable(),
  filters: playlistConfigSchema,
  scoring: recipeScoringSchema.optional(),
  targets: recipeTargetsSchema.optional(),
  bpmFlow: recipeBpmFlowSchema.optional(),
  discovery: recipeDiscoverySchema.optional(),
  variety: recipeVarietySchema.optional(),
  playlistIdentity: recipeIdentityDefaultsSchema.optional(),
  refreshPolicy: recipeRefreshPolicySchema.optional(),
  automationPolicy: recipeAutomationPolicySchema.optional(),
});

export type PlaylistRecipeInput = z.infer<typeof playlistRecipeSchema>;

function collectRules(node: RuleNode | undefined, fallbackRules: PlaylistRuleInput[]): PlaylistRuleInput[] {
  if (!node) return fallbackRules;
  if (node.type !== "group") return [node];
  return node.children.reduce<PlaylistRuleInput[]>((rules, child) => rules.concat(collectRules(child, [])), []);
}

function numericRangeLabel(rules: PlaylistRuleInput[], field: string) {
  const relevant = rules.filter((rule) => rule.field === field);
  if (relevant.length === 0) return "";
  const exact = relevant.find((rule) => rule.operator === "eq");
  if (exact) return exact.value;
  const lower = relevant.find((rule) => rule.operator === "gte" || rule.operator === "gt");
  const upper = relevant.find((rule) => rule.operator === "lte" || rule.operator === "lt");
  if (lower || upper) {
    const low = lower ? `${lower.operator === "gt" ? ">" : ""}${lower.value}` : "";
    const high = upper ? `${upper.operator === "lt" ? "<" : ""}${upper.value}` : "";
    return low && high ? `${low}–${high}` : low || high;
  }
  return relevant.map((rule) => `${rule.field} ${rule.operator} ${rule.value}`).join(", ");
}

function negativeFilterLabels(filters: PlaylistConfigInput["negativeFilters"]) {
  const labels: string[] = [];
  if (filters.excludeHoliday) labels.push("no holiday");
  if (filters.excludeLive) labels.push("no live");
  if (filters.excludeRemasters) labels.push("no remasters");
  if (filters.excludeExplicit) labels.push("clean");
  if (filters.excludeIntroOutro) labels.push("no intros");
  if (filters.minRating != null) labels.push(`rating >= ${filters.minRating}`);
  if (filters.excludePlayedWithinDays != null) labels.push(`not played ${filters.excludePlayedWithinDays}d`);
  if (filters.minDurationMinutes != null || filters.maxDurationMinutes != null) {
    labels.push(`duration ${filters.minDurationMinutes ?? 0}-${filters.maxDurationMinutes ?? "any"} min`);
  }
  return labels;
}

export function summarizePlaylistRecipeFilters(filters: PlaylistConfigInput) {
  const rules = collectRules(filters.ruleTree as RuleNode | undefined, filters.rules);
  const genres = rules.filter((rule) => rule.field === "genre").map((rule) => rule.value);
  const parts: string[] = [];
  if (filters.smartPresetName) parts.push(`Preset: ${filters.smartPresetName}`);
  if (filters.moodPresetName) parts.push(`Mood: ${filters.moodPresetName}${filters.moodPresetModified ? " modified" : ""}`);
  if (filters.bpmPresetName) parts.push(`BPM: ${filters.bpmPresetName}${filters.bpmPresetModified ? " modified" : ""}`);
  if (genres.length) parts.push(`Genres: ${genres.slice(0, 3).join(", ")}${genres.length > 3 ? "..." : ""}`);

  const bpm = numericRangeLabel(rules, "tempo");
  const energy = numericRangeLabel(rules, "energy");
  const mood = numericRangeLabel(rules, "valence");
  const popularity = numericRangeLabel(rules, "popularity");
  if (bpm && (!filters.bpmPresetName || filters.bpmPresetModified)) parts.push(`${filters.bpmPresetName ? "BPM range" : "BPM"}: ${bpm}`);
  if (energy) parts.push(`Energy: ${energy}`);
  if (mood) parts.push(`${filters.moodPresetName ? "Mood range" : "Mood"}: ${mood}`);
  if (popularity) parts.push(`Popularity: ${popularity}`);

  const otherRules = rules.filter((rule) => !["genre", "tempo", "energy", "valence", "popularity"].includes(rule.field));
  if (otherRules.length) parts.push(`${otherRules.length} other rule${otherRules.length === 1 ? "" : "s"}`);

  parts.push(`Limit: ${filters.limit}`);
  parts.push("Sort: Popularity");
  parts.push(`Duplicates: ${filters.duplicateStrategy === "allow" || filters.duplicateStrategy === "allow_alternate_copies" ? "Alternate copies allowed" : filters.duplicateStrategy === "prefer_highest_quality" ? "Highest-quality copy preferred" : filters.duplicateStrategy === "prefer_existing_playlist_copy" ? "Existing playlist copy preferred" : "Duplicate recordings avoided"}`);

  const negative = negativeFilterLabels(filters.negativeFilters);
  if (negative.length) parts.push(`Filters: ${negative.slice(0, 3).join(", ")}${negative.length > 3 ? "..." : ""}`);

  parts.push(summarizePlaylistSafetyRules(filters));
  return parts.join(" · ");
}

export function portableRecipeFromRecord(recipe: any): MixRecipeDocument {
  const filters = playlistConfigSchema.parse(recipe.filtersJson);
  const base = defaultMixRecipeDocument({
    name: recipe.name,
    slug: recipe.slug || slugifyRecipeName(recipe.name),
    description: recipe.description,
    category: recipe.category || "Custom",
    artworkUrl: recipe.artworkUrl || null,
    sourcePlaylistId: recipe.sourcePlaylistId || null,
  }, filters);
  const document = {
    ...base,
    schemaVersion: recipe.schemaVersion || 1,
    recipeVersion: recipe.recipeVersion || 1,
    scoring: recipeScoringSchema.parse(recipe.scoringJson || base.scoring),
    targets: recipeTargetsSchema.parse(recipe.targetsJson || base.targets),
    bpmFlow: recipeBpmFlowSchema.parse(recipe.bpmFlowJson || base.bpmFlow),
    discovery: recipeDiscoverySchema.parse(recipe.discoveryJson || base.discovery),
    variety: recipeVarietySchema.parse(recipe.varietyJson || base.variety),
    playlistIdentity: recipeIdentityDefaultsSchema.parse(recipe.identityDefaultsJson || base.playlistIdentity),
    refreshPolicy: recipeRefreshPolicySchema.parse(recipe.refreshPolicyJson || base.refreshPolicy),
    automationPolicy: recipeAutomationPolicySchema.parse(recipe.automationPolicyJson || base.automationPolicy),
  };
  const validation = validateRecipe(document);
  if (!validation.normalizedRecipe) throw new Error(validation.errors[0]?.message || "Stored recipe is invalid.");
  return validation.normalizedRecipe;
}

export function parsePlaylistRecipe(recipe: any) {
  const portable = portableRecipeFromRecord(recipe);
  const validation = validateRecipe(portable);
  const resolvedFilters = resolveRecipeGenerationConfig(portable);
  return {
    id: recipe.id,
    name: recipe.name,
    slug: recipe.slug || portable.metadata.slug,
    description: recipe.description,
    category: recipe.category || "Custom",
    artworkUrl: recipe.artworkUrl || null,
    enabled: recipe.enabled !== false,
    schemaVersion: portable.schemaVersion,
    recipeVersion: portable.recipeVersion,
    sourcePlaylistId: recipe.sourcePlaylistId || null,
    filters: resolvedFilters,
    scoring: portable.scoring,
    targets: portable.targets,
    bpmFlow: portable.bpmFlow,
    discovery: portable.discovery,
    variety: portable.variety,
    playlistIdentity: portable.playlistIdentity,
    refreshPolicy: portable.refreshPolicy,
    automationPolicy: portable.automationPolicy,
    portableRecipe: portable,
    validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings },
    filterSummary: summarizePlaylistRecipeFilters(resolvedFilters),
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
    lastUsedAt: recipe.lastUsedAt,
    useCount: recipe.useCount,
    createdFromVersion: recipe.createdFromVersion,
    isFavorite: recipe.isFavorite,
    isArchived: recipe.isArchived,
    deletedAt: recipe.deletedAt || null,
    playlistCount: recipe._count?.generatedPlaylists ?? recipe.playlistCount ?? 0,
  };
}

export function createPlaylistRecipeData(userId: string, input: PlaylistRecipeInput): Prisma.PlaylistRecipeCreateInput {
  const document = defaultMixRecipeDocument({
    name: input.name,
    description: input.description || null,
    category: input.category,
    artworkUrl: input.artworkUrl || null,
    sourcePlaylistId: input.sourcePlaylistId || null,
  }, input.filters);
  const resolved = {
    ...document,
    scoring: input.scoring || document.scoring,
    targets: input.targets || document.targets,
    bpmFlow: input.bpmFlow || document.bpmFlow,
    discovery: input.discovery || document.discovery,
    variety: input.variety || document.variety,
    playlistIdentity: input.playlistIdentity || document.playlistIdentity,
    refreshPolicy: input.refreshPolicy || document.refreshPolicy,
    automationPolicy: input.automationPolicy || document.automationPolicy,
  };
  const validation = validateRecipe(resolved);
  if (!validation.normalizedRecipe) throw new Error(validation.errors[0]?.message || "Invalid recipe.");
  const recipe = validation.normalizedRecipe;
  return {
    user: { connect: { id: userId } },
    name: input.name,
    slug: `${slugifyRecipeName(input.name)}-${crypto.randomUUID().slice(0, 8)}`,
    description: input.description || null,
    category: input.category,
    artworkUrl: input.artworkUrl || null,
    enabled: input.enabled,
    schemaVersion: recipe.schemaVersion,
    recipeVersion: recipe.recipeVersion,
    filtersJson: recipe.generation as Prisma.InputJsonValue,
    scoringJson: recipe.scoring as Prisma.InputJsonValue,
    targetsJson: recipe.targets as Prisma.InputJsonValue,
    bpmFlowJson: recipe.bpmFlow as Prisma.InputJsonValue,
    discoveryJson: recipe.discovery as Prisma.InputJsonValue,
    varietyJson: recipe.variety as Prisma.InputJsonValue,
    identityDefaultsJson: recipe.playlistIdentity as Prisma.InputJsonValue,
    refreshPolicyJson: recipe.refreshPolicy as Prisma.InputJsonValue,
    automationPolicyJson: recipe.automationPolicy as Prisma.InputJsonValue,
    ...(input.sourcePlaylistId ? { sourcePlaylist: { connect: { id: input.sourcePlaylistId } } } : {}),
    createdFromVersion: APP_VERSION,
    revisions: {
      create: {
        recipeVersion: 1,
        schemaVersion: recipe.schemaVersion,
        changeType: input.sourcePlaylistId ? "CREATED_FROM_PLAYLIST" : "CREATED",
        portableSnapshotJson: recipe as Prisma.InputJsonValue,
      },
    },
  };
}

export function updatePlaylistRecipeData(input: PlaylistRecipeInput, existing?: any): Prisma.PlaylistRecipeUpdateInput {
  const currentVersion = existing?.recipeVersion || 1;
  const document = defaultMixRecipeDocument({
    name: input.name, slug: existing?.slug || slugifyRecipeName(input.name), description: input.description,
    category: input.category, artworkUrl: input.artworkUrl, sourcePlaylistId: input.sourcePlaylistId,
  }, input.filters);
  const recipe = validateRecipe({
    ...document,
    recipeVersion: currentVersion + 1,
    scoring: input.scoring || document.scoring,
    targets: input.targets || document.targets,
    bpmFlow: input.bpmFlow || document.bpmFlow,
    discovery: input.discovery || document.discovery,
    variety: input.variety || document.variety,
    playlistIdentity: input.playlistIdentity || document.playlistIdentity,
    refreshPolicy: input.refreshPolicy || document.refreshPolicy,
    automationPolicy: input.automationPolicy || document.automationPolicy,
  });
  if (!recipe.normalizedRecipe) throw new Error(recipe.errors[0]?.message || "Invalid recipe.");
  const normalized = recipe.normalizedRecipe;
  const behaviorChanged = !existing || [
    [existing.filtersJson, normalized.generation], [existing.scoringJson, normalized.scoring], [existing.targetsJson, normalized.targets],
    [existing.bpmFlowJson, normalized.bpmFlow], [existing.discoveryJson, normalized.discovery], [existing.varietyJson, normalized.variety],
    [existing.identityDefaultsJson, normalized.playlistIdentity], [existing.refreshPolicyJson, normalized.refreshPolicy],
    [existing.automationPolicyJson, normalized.automationPolicy],
  ].some(([left, right]) => JSON.stringify(left) !== JSON.stringify(right));
  const nextVersion = behaviorChanged ? currentVersion + 1 : currentVersion;
  const snapshot = { ...normalized, recipeVersion: nextVersion };
  return {
    name: input.name,
    description: input.description || null,
    category: input.category,
    artworkUrl: input.artworkUrl || null,
    enabled: input.enabled,
    filtersJson: normalized.generation as Prisma.InputJsonValue,
    scoringJson: normalized.scoring as Prisma.InputJsonValue,
    targetsJson: normalized.targets as Prisma.InputJsonValue,
    bpmFlowJson: normalized.bpmFlow as Prisma.InputJsonValue,
    discoveryJson: normalized.discovery as Prisma.InputJsonValue,
    varietyJson: normalized.variety as Prisma.InputJsonValue,
    identityDefaultsJson: normalized.playlistIdentity as Prisma.InputJsonValue,
    refreshPolicyJson: normalized.refreshPolicy as Prisma.InputJsonValue,
    automationPolicyJson: normalized.automationPolicy as Prisma.InputJsonValue,
    ...(behaviorChanged ? {
      recipeVersion: nextVersion,
      revisions: { create: { recipeVersion: nextVersion, schemaVersion: normalized.schemaVersion, changeType: "UPDATED", portableSnapshotJson: snapshot as Prisma.InputJsonValue } },
    } : {}),
  };
}

export function duplicateRecipeName(originalName: string, existingNames: string[]) {
  const usedNames = new Set(existingNames);
  const baseName = `${originalName} Copy`;

  if (!usedNames.has(baseName)) return baseName;

  for (let copyNumber = 2; copyNumber < 1000; copyNumber += 1) {
    const candidate = `${baseName} ${copyNumber}`;
    if (!usedNames.has(candidate)) return candidate;
  }

  return `${baseName} ${Date.now()}`;
}

export async function markPlaylistRecipeUsed(userId: string, recipeId: string) {
  return prisma.playlistRecipe.updateMany({
    where: { id: recipeId, userId },
    data: {
      lastUsedAt: new Date(),
      useCount: { increment: 1 },
    },
  });
}
