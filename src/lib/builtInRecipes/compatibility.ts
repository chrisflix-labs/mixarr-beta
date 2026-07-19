import prisma from "../prisma";
import { buildTrackWhereClause, playlistConfigSchema } from "../playlistService";
import { loadLibraryRecipeProfile, listOwnedMusicLibraries } from "../adaptiveRecipeMappingService";
import { resolveRecipeGenerationConfig } from "../mixRecipes/schema";
import type { BuiltInRecipeDefinition, MetadataRequirementId } from "./catalog";

export type RecipeCompatibilityLevel = "excellent" | "good" | "limited" | "poor" | "unavailable";
export type RecipeCompatibilityResult = {
  level: RecipeCompatibilityLevel;
  score: number;
  eligibleTrackCount: number;
  eligibleTrackCountExact: boolean;
  totalTrackCount: number;
  requiredMetadataSatisfied: boolean;
  missingRequiredMetadata: MetadataRequirementId[];
  missingRecommendedMetadata: MetadataRequirementId[];
  coverage: Record<MetadataRequirementId, number>;
  reasons: string[];
  libraryId: string | null;
  libraryName: string | null;
  calculatedAt: string;
  cacheSeconds: number;
};

export type RecipeLibraryStats = {
  libraryId: string | null;
  libraryName: string | null;
  totalTracks: number;
  coverage: Record<MetadataRequirementId, number>;
};

const EMPTY_COVERAGE: Record<MetadataRequirementId, number> = {
  playback_history: 0, ratings: 0, bpm: 0, mood: 0, energy: 0, genre: 0, artist: 0,
  album: 0, date_added: 0, release_year: 0, popularity: 0, local_analysis: 0,
};
const STATS_CACHE_MS = 2 * 60_000;
const statsCache = new Map<string, { expiresAt: number; libraryUpdatedAt: number; value: RecipeLibraryStats }>();

function clamp(value: number) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }

export function calculateRecipeCompatibility(
  recipe: BuiltInRecipeDefinition,
  stats: RecipeLibraryStats,
  exactEligibleTrackCount?: number,
): RecipeCompatibilityResult {
  const calculatedAt = new Date().toISOString();
  if (!stats.libraryId || stats.totalTracks === 0) return {
    level: "unavailable", score: 0, eligibleTrackCount: 0, eligibleTrackCountExact: false,
    totalTrackCount: 0, requiredMetadataSatisfied: false,
    missingRequiredMetadata: recipe.metadataRequirements.filter((item) => item.importance === "required").map((item) => item.id),
    missingRecommendedMetadata: recipe.metadataRequirements.filter((item) => item.importance === "recommended").map((item) => item.id),
    coverage: stats.coverage, reasons: ["Sync a Plex music library before calculating recipe compatibility."],
    libraryId: stats.libraryId, libraryName: stats.libraryName, calculatedAt, cacheSeconds: STATS_CACHE_MS / 1000,
  };

  const required = recipe.metadataRequirements.filter((item) => item.importance === "required");
  const recommended = recipe.metadataRequirements.filter((item) => item.importance === "recommended");
  const missingRequiredMetadata = required.filter((item) => stats.coverage[item.id] <= 0).map((item) => item.id);
  const missingRecommendedMetadata = recommended.filter((item) => stats.coverage[item.id] < .2).map((item) => item.id);
  const requiredCoverage = required.length ? Math.min(...required.map((item) => stats.coverage[item.id])) : 1;
  const recommendedCoverage = recommended.length ? recommended.reduce((sum, item) => sum + stats.coverage[item.id], 0) / recommended.length : 1;

  const metadataBoundRules = recipe.engineConfig.generation.rules.filter((item) => ["tempo", "energy", "valence", "year", "rating", "genre", "artist", "album"].includes(item.field));
  const ruleSelectivity = Math.max(.12, Math.pow(.78, metadataBoundRules.length));
  const estimatedEligible = Math.max(0, Math.min(stats.totalTracks, Math.round(stats.totalTracks * requiredCoverage * ruleSelectivity)));
  const eligibleTrackCount = exactEligibleTrackCount == null ? estimatedEligible : Math.max(0, exactEligibleTrackCount);
  const poolRatio = eligibleTrackCount / Math.max(1, recipe.targetTrackCount);
  const poolScore = clamp(poolRatio / 4);
  const score = Math.round(100 * (.55 * requiredCoverage + .25 * recommendedCoverage + .2 * poolScore));
  const requiredMetadataSatisfied = missingRequiredMetadata.length === 0;
  const level: RecipeCompatibilityLevel = !requiredMetadataSatisfied ? "unavailable"
    : score >= 85 && poolRatio >= 3 ? "excellent"
    : score >= 65 && poolRatio >= 1.5 ? "good"
    : score >= 45 && eligibleTrackCount > 0 ? "limited"
    : "poor";
  const reasons: string[] = [];
  if (level === "excellent") reasons.push(`${eligibleTrackCount.toLocaleString()} tracks form a strong candidate pool for the ${recipe.targetTrackCount}-track target.`);
  else if (level === "good") reasons.push(`${eligibleTrackCount.toLocaleString()} tracks should support the recipe with minor limitations.`);
  else if (level === "limited") reasons.push(`The estimated pool of ${eligibleTrackCount.toLocaleString()} tracks may produce repetition or a shorter playlist.`);
  else if (level === "poor") reasons.push(`Only about ${eligibleTrackCount.toLocaleString()} tracks appear eligible for the current recipe constraints.`);
  else reasons.push("A required metadata source has no coverage in this library.");
  if (missingRecommendedMetadata.length) reasons.push("Recommended metadata is sparse; Mixarr will use the recipe's configured fallback signals.");
  if (required.length && requiredCoverage < .5 && requiredMetadataSatisfied) reasons.push(`Required metadata covers ${Math.round(requiredCoverage * 100)}% of the library.`);
  if (!required.length && !recommended.length) reasons.push("No special metadata is required.");
  return {
    level, score, eligibleTrackCount, eligibleTrackCountExact: exactEligibleTrackCount != null,
    totalTrackCount: stats.totalTracks, requiredMetadataSatisfied, missingRequiredMetadata,
    missingRecommendedMetadata, coverage: stats.coverage, reasons,
    libraryId: stats.libraryId, libraryName: stats.libraryName, calculatedAt, cacheSeconds: STATS_CACHE_MS / 1000,
  };
}

export async function loadRecipeLibraryStats(userId: string): Promise<RecipeLibraryStats> {
  const libraries = await listOwnedMusicLibraries(userId);
  if (!libraries.length) return { libraryId: null, libraryName: null, totalTracks: 0, coverage: { ...EMPTY_COVERAGE } };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultLibraryId: true } });
  const library = libraries.find((item) => item.id === user?.defaultLibraryId) || libraries[0];
  const cacheKey = `${userId}:${library.id}`;
  const cached = statsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && cached.libraryUpdatedAt === library.updatedAt.getTime()) return cached.value;

  const { profile } = await loadLibraryRecipeProfile(userId, library.id);
  const scope = { libraryId: library.id, syncStatus: "active", deletedAt: null } as const;
  const [ratings, genres, dates, years, history, localAnalysis] = await Promise.all([
    prisma.track.count({ where: { ...scope, rating: { not: null } } }),
    prisma.track.count({ where: { ...scope, tags: { some: { type: "genre" } } } }),
    prisma.track.count({ where: { ...scope, OR: [{ addedAt: { not: null } }, { plexAddedAt: { not: null } }] } }),
    prisma.track.count({ where: { ...scope, album: { year: { not: null } } } }),
    prisma.userTrackPlaybackProfile.count({ where: { userId, track: scope } }),
    prisma.track.count({ where: { ...scope, audioFeature: { is: { OR: [{ localEnergy: { not: null } }, { localMood: { not: null } }, { dynamicComplexity: { not: null } }] } } } }),
  ]);
  const total = profile.totalTracks;
  const coverage: Record<MetadataRequirementId, number> = {
    playback_history: total ? clamp(history / total) : 0,
    ratings: total ? clamp(ratings / total) : 0,
    bpm: profile.bpmCoverage, mood: profile.moodCoverage, energy: profile.energyCoverage,
    genre: total ? clamp(genres / total) : 0,
    artist: total ? 1 : 0, album: total ? 1 : 0,
    date_added: total ? clamp(dates / total) : 0,
    release_year: total ? clamp(years / total) : 0,
    popularity: profile.popularityCoverage,
    local_analysis: total ? clamp(localAnalysis / total) : 0,
  };
  const value = { libraryId: library.id, libraryName: library.name, totalTracks: total, coverage };
  statsCache.set(cacheKey, { expiresAt: Date.now() + STATS_CACHE_MS, libraryUpdatedAt: library.updatedAt.getTime(), value });
  return value;
}

export async function getRecipeCompatibility(userId: string, recipe: BuiltInRecipeDefinition, exact = false) {
  const stats = await loadRecipeLibraryStats(userId);
  if (!exact || !stats.libraryId) return calculateRecipeCompatibility(recipe, stats);
  const library = await prisma.library.findFirst({ where: { id: stats.libraryId, server: { userId } }, select: { id: true, serverId: true } });
  if (!library) return calculateRecipeCompatibility(recipe, stats);
  try {
    const config = playlistConfigSchema.parse(resolveRecipeGenerationConfig(recipe.engineConfig, { libraryId: library.id, serverId: library.serverId }));
    const count = await prisma.track.count({ where: buildTrackWhereClause(userId, config, [], {}, { softMetadataFilters: false }) });
    return calculateRecipeCompatibility(recipe, stats, count);
  } catch (error) {
    console.warn("[BuiltInRecipes] Exact compatibility count failed", { recipeId: recipe.id, reason: error instanceof Error ? error.message : "unknown" });
    return calculateRecipeCompatibility(recipe, stats);
  }
}

export function clearRecipeCompatibilityCache(userId?: string) {
  if (!userId) return statsCache.clear();
  for (const key of Array.from(statsCache.keys())) if (key.startsWith(`${userId}:`)) statsCache.delete(key);
}
