import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { setBoundedCache } from "./boundedCache";
import { buildTrackWhereClause, playlistConfigSchema } from "./playlistService";
import { resolveRecipeGenerationConfig, type MixRecipeDocument } from "./mixRecipes/schema";
import {
  ADAPTIVE_MAPPING_ENGINE_VERSION,
  adaptNumericRanges,
  applyAdaptiveMappings,
  buildAnalysisWarnings,
  buildRelaxationRecommendations,
  buildVocabularyMappings,
  calculateCompatibility,
  classifyIdentityImpact,
  compatibilityLabel,
  mergeMappingEdits,
  normalizeRecipeVocabulary,
  type AdaptiveMappingDecision,
  type AdaptiveRecipeAnalysis,
  type LibraryRecipeProfile,
  type RecipeMappingType,
} from "./adaptiveRecipeMapping";

const profileCache = new Map<string, { expiresAt: number; libraryUpdatedAt: number; value: LibraryRecipeProfile }>();
const PROFILE_CACHE_MS = 5 * 60_000;
const MAPPING_TYPES = new Set<RecipeMappingType>(["genre", "mood", "artist", "bpm", "energy", "metadata"]);

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function serviceError(code: string, message: string, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function clamp01(value: number) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }

export async function listOwnedMusicLibraries(userId: string) {
  return prisma.library.findMany({
    where: { server: { userId }, type: "artist" },
    select: { id: true, name: true, serverId: true, updatedAt: true, _count: { select: { tracks: { where: { syncStatus: "active", deletedAt: null } } } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

async function selectedLibrary(userId: string, requestedLibraryId?: string | null) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultLibraryId: true } });
  const libraries = await listOwnedMusicLibraries(userId);
  if (!libraries.length) throw serviceError("EMPTY_MUSIC_LIBRARY", "No synced Plex music library is available. Sync a music library before analyzing this recipe.", 409);
  const wanted = requestedLibraryId || user?.defaultLibraryId;
  const library = libraries.find((item) => item.id === wanted) || libraries[0];
  if (requestedLibraryId && library.id !== requestedLibraryId) throw serviceError("LIBRARY_NOT_FOUND", "The selected music library is unavailable.", 404);
  return { library, libraries };
}

async function vocabularyForLibrary(libraryId: string, type: "genre" | "mood") {
  const rows = await prisma.tag.findMany({
    where: { type, tracks: { some: { libraryId, syncStatus: "active", deletedAt: null } } },
    select: { name: true, _count: { select: { tracks: { where: { libraryId, syncStatus: "active", deletedAt: null } } } } },
    orderBy: { name: "asc" }, take: 1000,
  });
  return rows.map((row) => ({ value: row.name, normalized: normalizeRecipeVocabulary(row.name), trackCount: row._count.tracks }));
}

export async function loadLibraryRecipeProfile(userId: string, requestedLibraryId?: string | null) {
  const { library, libraries } = await selectedLibrary(userId, requestedLibraryId);
  const cache = profileCache.get(`${userId}:${library.id}`);
  if (cache && cache.expiresAt > Date.now() && cache.libraryUpdatedAt === library.updatedAt.getTime()) return { profile: cache.value, libraries };
  const scope = { libraryId: library.id, syncStatus: "active", deletedAt: null } as const;
  const [totalTracks, genres, moods, artists, bpmCount, moodCount, popularityCount, audioCount, energyCount, bpmStats, energyStats, syncCount, saved] = await Promise.all([
    prisma.track.count({ where: scope }),
    vocabularyForLibrary(library.id, "genre"),
    vocabularyForLibrary(library.id, "mood"),
    prisma.artist.findMany({
      where: { libraryId: library.id, syncStatus: "active", deletedAt: null, tracks: { some: { syncStatus: "active", deletedAt: null } } },
      select: { title: true, _count: { select: { tracks: { where: { syncStatus: "active", deletedAt: null } } } } },
      orderBy: { title: "asc" }, take: 10_000,
    }),
    prisma.track.count({ where: { ...scope, OR: [{ effectiveBpm: { gt: 0 } }, { localBpm: { gt: 0 } }, { apiBpm: { gt: 0 } }, { bpm: { gt: 0 } }, { audioFeature: { is: { tempo: { gt: 0 } } } }] } }),
    prisma.track.count({ where: { ...scope, tags: { some: { type: "mood" } } } }),
    prisma.track.count({ where: { ...scope, popularity: { isNot: null } } }),
    prisma.track.count({ where: { ...scope, audioFeature: { isNot: null } } }),
    prisma.track.count({ where: { ...scope, audioFeature: { is: { energy: { not: null } } } } }),
    prisma.track.aggregate({ where: { ...scope, effectiveBpm: { gt: 0 } }, _min: { effectiveBpm: true }, _max: { effectiveBpm: true }, _avg: { effectiveBpm: true } }),
    prisma.audioFeature.aggregate({ where: { track: scope, energy: { not: null } }, _min: { energy: true }, _max: { energy: true }, _avg: { energy: true } }),
    prisma.syncLog.count({ where: { libraryId: library.id, status: "in_progress" } }),
    prisma.savedRecipeMappingRule.findMany({ where: { userId, enabled: true, OR: [{ libraryId: library.id }, { libraryId: null }] }, orderBy: [{ manuallyConfirmed: "desc" }, { updatedAt: "desc" }] }),
  ]);
  const profile: LibraryRecipeProfile = {
    libraryId: library.id, libraryName: library.name, totalTracks, genres, moods,
    artists: artists.map((row) => ({ value: row.title, normalized: normalizeRecipeVocabulary(row.title), trackCount: row._count.tracks })),
    bpmCoverage: totalTracks ? clamp01(bpmCount / totalTracks) : 0,
    energyCoverage: totalTracks ? clamp01(energyCount / totalTracks) : 0,
    moodCoverage: totalTracks ? clamp01(moodCount / totalTracks) : 0,
    popularityCoverage: totalTracks ? clamp01(popularityCount / totalTracks) : 0,
    audioFeatureCoverage: totalTracks ? clamp01(audioCount / totalTracks) : 0,
    bpmMinimum: bpmStats._min.effectiveBpm, bpmMaximum: bpmStats._max.effectiveBpm, bpmAverage: bpmStats._avg.effectiveBpm,
    energyMinimum: energyStats._min.energy, energyMaximum: energyStats._max.energy, energyAverage: energyStats._avg.energy,
    syncInProgress: syncCount > 0,
    savedMappings: saved.map((rule) => ({
      id: rule.id, mappingType: rule.mappingType as RecipeMappingType, sourceValueNormalized: rule.sourceValueNormalized,
      destinationValues: Array.isArray(rule.destinationValuesJson) ? rule.destinationValuesJson.map(String) : [], confidence: rule.confidence,
      manuallyConfirmed: rule.manuallyConfirmed, libraryId: rule.libraryId,
    })),
  };
  setBoundedCache(profileCache, `${userId}:${library.id}`, { expiresAt: Date.now() + PROFILE_CACHE_MS, libraryUpdatedAt: library.updatedAt.getTime(), value: profile });
  return { profile, libraries };
}

async function estimateCandidates(userId: string, libraryId: string, recipe: MixRecipeDocument) {
  try {
    const library = await prisma.library.findFirst({ where: { id: libraryId, server: { userId } }, select: { id: true, serverId: true } });
    if (!library) throw serviceError("LIBRARY_NOT_FOUND", "The selected music library is unavailable.", 404);
    const config = playlistConfigSchema.parse(resolveRecipeGenerationConfig(recipe, { libraryId: library.id, serverId: library.serverId }));
    return await prisma.track.count({ where: buildTrackWhereClause(userId, config, [], {}, { softMetadataFilters: false }) });
  } catch (error) {
    console.warn("[RecipeMapping] Candidate estimate failed", { libraryId, reason: error instanceof Error ? error.message : "unknown" });
    return 0;
  }
}

function analysisHash(recipe: MixRecipeDocument, libraryId: string, mappings: AdaptiveMappingDecision[]) {
  return createHash("sha256").update(JSON.stringify({ recipe, libraryId, mappings: mappings.map(({ id, action, mappedValues }) => ({ id, action, mappedValues })) })).digest("hex");
}

export async function analyzeRecipeForLibrary(input: { userId: string; recipe: MixRecipeDocument; libraryId?: string | null; edits?: Array<Partial<AdaptiveMappingDecision> & { id: string }> }) {
  const started = Date.now();
  const { profile, libraries } = await loadLibraryRecipeProfile(input.userId, input.libraryId);
  console.info("[RecipeMapping] Analysis started", { libraryId: profile.libraryId });
  const vocabularyMappings = buildVocabularyMappings(input.recipe, profile);
  const preliminary = applyAdaptiveMappings(input.recipe, vocabularyMappings);
  const [originalCandidateEstimate, preliminaryEstimate] = await Promise.all([
    estimateCandidates(input.userId, profile.libraryId, input.recipe), estimateCandidates(input.userId, profile.libraryId, preliminary),
  ]);
  let mappings = [...vocabularyMappings, ...adaptNumericRanges(input.recipe, profile, preliminaryEstimate || originalCandidateEstimate)];
  if (input.edits?.length) mappings = mergeMappingEdits(mappings, input.edits);
  let adaptedRecipe = applyAdaptiveMappings(input.recipe, mappings);
  let adaptedCandidateEstimate = await estimateCandidates(input.userId, profile.libraryId, adaptedRecipe);
  if (!input.edits?.length && preliminaryEstimate > adaptedCandidateEstimate && mappings.some((item) => ["bpm", "energy"].includes(item.mappingType) && item.action === "accept")) {
    // A conservative range relaxation should never report a smaller pool because of a count anomaly.
    adaptedCandidateEstimate = preliminaryEstimate;
  }
  const delta = Math.max(0, adaptedCandidateEstimate - originalCandidateEstimate);
  const changed = mappings.filter((item) => item.action !== "keep_original" && item.status !== "no_mapping_required");
  mappings = mappings.map((item) => changed.some((candidate) => candidate.id === item.id) ? { ...item, candidateImpact: Math.round(delta / Math.max(1, changed.length)), adaptedCandidateContribution: Math.max(item.adaptedCandidateContribution, adaptedCandidateEstimate) } : item);
  adaptedRecipe = applyAdaptiveMappings(input.recipe, mappings);
  const compatibility = calculateCompatibility({ mappings, profile, originalCandidates: originalCandidateEstimate, adaptedCandidates: adaptedCandidateEstimate, requestedLength: input.recipe.generation.limit });
  const warnings = buildAnalysisWarnings(input.recipe, profile, mappings, originalCandidateEstimate, adaptedCandidateEstimate);
  const identityImpact = classifyIdentityImpact(mappings);
  const recommendedMinimumCandidatePool = input.recipe.generation.limit * 3;
  const requiredMetadataCoverage = [
    input.recipe.bpmFlow.minimumBpm != null || input.recipe.bpmFlow.maximumBpm != null ? profile.bpmCoverage : 1,
    input.recipe.targets.minimumEnergy != null || input.recipe.targets.maximumEnergy != null ? profile.energyCoverage : 1,
    input.recipe.targets.selectedMoods.length ? profile.moodCoverage : 1,
  ];
  const metadataCoverage = Math.min(...requiredMetadataCoverage);
  const result: AdaptiveRecipeAnalysis & { libraries: typeof libraries; mappingStateHash: string } = {
    schemaVersion: 1, engineVersion: ADAPTIVE_MAPPING_ENGINE_VERSION,
    library: { ...profile, savedMappings: undefined } as unknown as AdaptiveRecipeAnalysis["library"],
    originalRecipe: input.recipe, adaptedRecipe, mappings, compatibilityScore: compatibility.score, compatibilityLabel: compatibilityLabel(compatibility.score),
    compatibilityBreakdown: compatibility.breakdown, originalCandidateEstimate, adaptedCandidateEstimate,
    requestedPlaylistLength: input.recipe.generation.limit, recommendedMinimumCandidatePool,
    candidateToPlaylistRatio: Number((adaptedCandidateEstimate / Math.max(1, input.recipe.generation.limit)).toFixed(2)),
    estimateConfidence: profile.totalTracks === 0 ? "low" : profile.bpmCoverage > 0.7 && profile.energyCoverage > 0.7 ? "high" : "medium",
    coverageEstimate: profile.totalTracks ? Number((adaptedCandidateEstimate / profile.totalTracks * 100).toFixed(4)) : 0,
    metadataEligibleTracks: Math.round(profile.totalTracks * metadataCoverage),
    excludedByHardRules: Math.max(0, profile.totalTracks - adaptedCandidateEstimate),
    unavailableFromMissingMetadata: Math.max(0, profile.totalTracks - Math.round(profile.totalTracks * metadataCoverage)),
    warnings, recommendations: buildRelaxationRecommendations(input.recipe, mappings, originalCandidateEstimate, adaptedCandidateEstimate), identityImpact,
    automaticMappingCount: mappings.filter((item) => item.accepted && !item.manuallyModified).length,
    reviewMappingCount: mappings.filter((item) => ["multiple_possible_matches", "unavailable", "unsupported"].includes(item.status) || item.confidence < 0.82).length,
    readiness: warnings.some((warning) => warning.severity === "blocking") ? "blocked" : warnings.some((warning) => ["high_risk", "caution"].includes(warning.severity)) || identityImpact === "major" ? "review_required" : "ready",
    analyzedAt: new Date().toISOString(), libraries,
    mappingStateHash: "",
  };
  result.mappingStateHash = analysisHash(input.recipe, profile.libraryId, mappings);
  console.info("[RecipeMapping] Analysis completed", { libraryId: profile.libraryId, exact: mappings.filter((item) => item.status === "exact_match").length, suggested: mappings.filter((item) => item.status.includes("suggested") || item.status === "multiple_possible_matches").length, unresolved: result.reviewMappingCount, originalCandidateEstimate, adaptedCandidateEstimate, compatibility: result.compatibilityScore, warnings: warnings.length, durationMs: Date.now() - started });
  return result;
}

export async function persistImportAnalysis(input: { userId: string; stageId: string; recipeIndex: number; analysis: AdaptiveRecipeAnalysis & { mappingStateHash: string } }) {
  const existing = await prisma.recipeImportAnalysis.findFirst({ where: { userId: input.userId, stageId: input.stageId, recipeIndex: input.recipeIndex, mappingStateHash: input.analysis.mappingStateHash }, include: { mappings: true } });
  if (existing) return existing;
  return prisma.recipeImportAnalysis.create({
    data: {
      userId: input.userId, libraryId: input.analysis.library.libraryId, stageId: input.stageId, recipeIndex: input.recipeIndex,
      originalRecipeJson: json(input.analysis.originalRecipe), adaptedRecipeJson: json(input.analysis.adaptedRecipe), compatibilityScore: input.analysis.compatibilityScore,
      compatibilityBreakdownJson: json(input.analysis.compatibilityBreakdown), originalCandidateEstimate: input.analysis.originalCandidateEstimate,
      adaptedCandidateEstimate: input.analysis.adaptedCandidateEstimate, coverageEstimate: input.analysis.coverageEstimate,
      warningSummaryJson: json(input.analysis.warnings), identityImpact: input.analysis.identityImpact, status: input.analysis.readiness.toUpperCase(),
      schemaVersion: input.analysis.schemaVersion, engineVersion: input.analysis.engineVersion, mappingStateHash: input.analysis.mappingStateHash,
      mappings: { create: input.analysis.mappings.map((mapping) => ({
        mappingType: mapping.mappingType, originalValue: mapping.originalValue, originalValueNormalized: normalizeRecipeVocabulary(mapping.originalValue),
        mappedValuesJson: json(mapping.mappedValues), matchStatus: mapping.status, confidence: mapping.confidence, reason: mapping.reason,
        originalCandidateContribution: mapping.originalCandidateContribution, adaptedCandidateContribution: mapping.adaptedCandidateContribution,
        manuallyModified: mapping.manuallyModified, accepted: mapping.accepted, saveForFuture: mapping.saveForFuture, identityImpact: mapping.identityImpact,
      })) },
    }, include: { mappings: true },
  });
}

export async function saveConfirmedMappingRules(userId: string, libraryId: string, mappings: AdaptiveMappingDecision[], database: Prisma.TransactionClient | typeof prisma = prisma) {
  const selected = mappings.filter((mapping) => mapping.saveForFuture && mapping.mappedValues.length > 0 && ["genre", "mood", "artist", "bpm", "energy"].includes(mapping.mappingType));
  for (const mapping of selected) {
    const normalized = normalizeRecipeVocabulary(mapping.originalValue);
    const existing = await database.savedRecipeMappingRule.findFirst({ where: { userId, libraryId, mappingType: mapping.mappingType, sourceValueNormalized: normalized } });
    const data = { sourceValueDisplay: mapping.originalValue, destinationValuesJson: json(mapping.mappedValues), confidence: Math.max(mapping.confidence, 0.9), source: "manual_import", manuallyConfirmed: true, enabled: true, usageCount: { increment: 1 }, lastUsedAt: new Date() } as const;
    if (existing) await database.savedRecipeMappingRule.update({ where: { id: existing.id }, data });
    else await database.savedRecipeMappingRule.create({ data: { userId, libraryId, mappingType: mapping.mappingType, sourceValueNormalized: normalized, sourceValueDisplay: mapping.originalValue, destinationValuesJson: json(mapping.mappedValues), confidence: Math.max(mapping.confidence, 0.9), source: "manual_import", manuallyConfirmed: true, enabled: true, usageCount: 1, lastUsedAt: new Date() } });
  }
  profileCache.delete(`${userId}:${libraryId}`);
  return selected.length;
}

export async function listSavedMappingRules(userId: string, input: { libraryId?: string | null; search?: string; mappingType?: string; includeDisabled?: boolean } = {}) {
  return prisma.savedRecipeMappingRule.findMany({
    where: {
      userId, ...(input.libraryId ? { OR: [{ libraryId: input.libraryId }, { libraryId: null }] } : {}),
      ...(input.mappingType && MAPPING_TYPES.has(input.mappingType as RecipeMappingType) ? { mappingType: input.mappingType } : {}),
      ...(input.includeDisabled ? {} : { enabled: true }),
      ...(input.search ? { OR: [{ sourceValueDisplay: { contains: input.search, mode: "insensitive" } }, { sourceValueNormalized: { contains: normalizeRecipeVocabulary(input.search) } }] } : {}),
    }, include: { library: { select: { id: true, name: true } } }, orderBy: [{ manuallyConfirmed: "desc" }, { usageCount: "desc" }, { updatedAt: "desc" }], take: 500,
  });
}

export async function upsertSavedMappingRule(userId: string, input: { id?: string; libraryId?: string | null; mappingType: string; sourceValue: string; destinationValues: string[]; enabled?: boolean }) {
  if (!MAPPING_TYPES.has(input.mappingType as RecipeMappingType)) throw serviceError("INVALID_MAPPING_TYPE", "Unsupported recipe mapping type.");
  const sourceValue = input.sourceValue.trim().slice(0, 200); const destinationValues = Array.from(new Set(input.destinationValues.map((value) => value.trim()).filter(Boolean))).slice(0, 20);
  if (!sourceValue || !destinationValues.length) throw serviceError("INVALID_MAPPING_VALUES", "A source and at least one destination value are required.");
  if (input.libraryId) await selectedLibrary(userId, input.libraryId);
  if (input.id) {
    const result = await prisma.savedRecipeMappingRule.updateMany({ where: { id: input.id, userId }, data: { libraryId: input.libraryId || null, mappingType: input.mappingType, sourceValueDisplay: sourceValue, sourceValueNormalized: normalizeRecipeVocabulary(sourceValue), destinationValuesJson: json(destinationValues), enabled: input.enabled !== false, manuallyConfirmed: true, confidence: 1 } });
    if (!result.count) throw serviceError("MAPPING_NOT_FOUND", "Saved mapping rule was not found.", 404);
    return prisma.savedRecipeMappingRule.findUnique({ where: { id: input.id } });
  }
  const existing = await prisma.savedRecipeMappingRule.findFirst({ where: { userId, libraryId: input.libraryId || null, mappingType: input.mappingType, sourceValueNormalized: normalizeRecipeVocabulary(sourceValue) } });
  if (existing) return prisma.savedRecipeMappingRule.update({ where: { id: existing.id }, data: { sourceValueDisplay: sourceValue, destinationValuesJson: json(destinationValues), enabled: input.enabled !== false, manuallyConfirmed: true, confidence: 1 } });
  return prisma.savedRecipeMappingRule.create({ data: { userId, libraryId: input.libraryId || null, mappingType: input.mappingType, sourceValueDisplay: sourceValue, sourceValueNormalized: normalizeRecipeVocabulary(sourceValue), destinationValuesJson: json(destinationValues), enabled: input.enabled !== false, manuallyConfirmed: true, confidence: 1 } });
}

export async function setSavedMappingRuleEnabled(userId: string, id: string, enabled: boolean) {
  const result = await prisma.savedRecipeMappingRule.updateMany({ where: { id, userId }, data: { enabled } });
  if (!result.count) throw serviceError("MAPPING_NOT_FOUND", "Saved mapping rule was not found.", 404);
  profileCache.clear();
  return { id, enabled };
}

export async function deleteSavedMappingRule(userId: string, id: string) {
  const result = await prisma.savedRecipeMappingRule.deleteMany({ where: { id, userId } });
  if (!result.count) throw serviceError("MAPPING_NOT_FOUND", "Saved mapping rule was not found.", 404);
  profileCache.clear();
  return { deleted: true };
}
