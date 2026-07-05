import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { APP_VERSION } from "./appVersion";
import { playlistConfigSchema, summarizePlaylistSafetyRules, type PlaylistConfigInput, type PlaylistRuleInput } from "./playlistService";

type RuleNode = PlaylistRuleInput | {
  type: "group";
  combinator: "AND" | "OR";
  children: RuleNode[];
};

export const playlistRecipeSchema = z.object({
  name: z.string().trim().min(1, "Recipe name is required.").max(120),
  description: z.string().trim().max(500).optional().nullable(),
  filters: playlistConfigSchema,
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
    return low && high ? `${low}-${high}` : low || high;
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
  if (genres.length) parts.push(`Genres: ${genres.slice(0, 3).join(", ")}${genres.length > 3 ? "..." : ""}`);

  const bpm = numericRangeLabel(rules, "tempo");
  const energy = numericRangeLabel(rules, "energy");
  const mood = numericRangeLabel(rules, "valence");
  const popularity = numericRangeLabel(rules, "popularity");
  if (bpm) parts.push(`BPM: ${bpm}`);
  if (energy) parts.push(`Energy: ${energy}`);
  if (mood) parts.push(`Mood: ${mood}`);
  if (popularity) parts.push(`Popularity: ${popularity}`);

  const otherRules = rules.filter((rule) => !["genre", "tempo", "energy", "valence", "popularity"].includes(rule.field));
  if (otherRules.length) parts.push(`${otherRules.length} other rule${otherRules.length === 1 ? "" : "s"}`);

  parts.push(`Limit: ${filters.limit}`);
  parts.push("Sort: Popularity");
  parts.push(`Duplicates: ${filters.duplicateStrategy === "allow" ? "Allowed" : "One per song"}`);

  const negative = negativeFilterLabels(filters.negativeFilters);
  if (negative.length) parts.push(`Filters: ${negative.slice(0, 3).join(", ")}${negative.length > 3 ? "..." : ""}`);

  parts.push(summarizePlaylistSafetyRules(filters));
  return parts.join(" · ");
}

export function parsePlaylistRecipe(recipe: any) {
  const filters = playlistConfigSchema.parse(recipe.filtersJson);
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    filters,
    filterSummary: summarizePlaylistRecipeFilters(filters),
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
    lastUsedAt: recipe.lastUsedAt,
    useCount: recipe.useCount,
    createdFromVersion: recipe.createdFromVersion,
    isFavorite: recipe.isFavorite,
    isArchived: recipe.isArchived,
  };
}

export function createPlaylistRecipeData(userId: string, input: PlaylistRecipeInput): Prisma.PlaylistRecipeCreateInput {
  return {
    user: { connect: { id: userId } },
    name: input.name,
    description: input.description || null,
    filtersJson: input.filters as Prisma.InputJsonValue,
    createdFromVersion: APP_VERSION,
  };
}

export function updatePlaylistRecipeData(input: PlaylistRecipeInput): Prisma.PlaylistRecipeUpdateInput {
  return {
    name: input.name,
    description: input.description || null,
    filtersJson: input.filters as Prisma.InputJsonValue,
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
