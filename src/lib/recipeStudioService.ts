import prisma from "./prisma";
import { analyzeRecipeStudio, type LibraryAnalysisProfile } from "./recipeStudio";

const analysisCache = new Map<string, { expiresAt: number; profile: LibraryAnalysisProfile }>();
const analyticsCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof loadRecipeAnalytics>> }>();

function profileCacheKey(userId: string, libraryId: string) { return `${userId}:${libraryId}`; }

export async function getRecipeLibraryProfile(userId: string, requestedLibraryId?: string | null) {
  const library = requestedLibraryId
    ? await prisma.library.findFirst({ where: { id: requestedLibraryId, server: { userId } }, select: { id: true, name: true } })
    : await prisma.library.findFirst({ where: { server: { userId }, OR: [{ type: "artist" }, { type: "music" }] }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true } });
  if (!library) return { libraryId: null, libraryName: "No music library", totalTracks: 0, bpmTracks: 0, energyTracks: 0, moodTracks: 0, popularityTracks: 0, uniqueArtists: 0, uniqueAlbums: 0, explicitTracks: 0, liveTracks: 0, holidayTracks: 0, recentlyAddedTracks: 0, integrations: [], analyzedAt: new Date().toISOString() } satisfies LibraryAnalysisProfile;
  const cacheKey = profileCacheKey(userId, library.id);
  const cached = analysisCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;
  const active = { libraryId: library.id, syncStatus: "active" } as const;
  const recentBoundary = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [totalTracks, bpmTracks, energyTracks, moodTracks, popularityTracks, uniqueArtists, uniqueAlbums, explicitTracks, liveTracks, holidayTracks, recentlyAddedTracks, integrations] = await Promise.all([
    prisma.track.count({ where: active }),
    prisma.track.count({ where: { ...active, OR: [{ effectiveBpm: { not: null } }, { bpm: { not: null } }] } }),
    prisma.track.count({ where: { ...active, audioFeature: { is: { OR: [{ effectiveEnergy: { not: null } }, { energy: { not: null } }] } } } }),
    prisma.track.count({ where: { ...active, audioFeature: { is: { OR: [{ effectiveMood: { not: null } }, { valence: { not: null } }] } } } }),
    prisma.track.count({ where: { ...active, popularity: { isNot: null } } }),
    prisma.artist.count({ where: { libraryId: library.id, syncStatus: "active" } }),
    prisma.album.count({ where: { libraryId: library.id, syncStatus: "active" } }),
    prisma.track.count({ where: { ...active, isExplicit: true } }),
    prisma.track.count({ where: { ...active, isLive: true } }),
    prisma.track.count({ where: { ...active, isHoliday: true } }),
    prisma.track.count({ where: { ...active, addedAt: { gte: recentBoundary } } }),
    prisma.integrationConfiguration.findMany({ select: { key: true, enabled: true, status: true } }),
  ]);
  const profile: LibraryAnalysisProfile = { libraryId: library.id, libraryName: library.name, totalTracks, bpmTracks, energyTracks, moodTracks, popularityTracks, uniqueArtists, uniqueAlbums, explicitTracks, liveTracks, holidayTracks, recentlyAddedTracks, integrations, analyzedAt: new Date().toISOString() };
  analysisCache.set(cacheKey, { expiresAt: Date.now() + 30_000, profile });
  return profile;
}

export async function analyzeRecipeDraft(userId: string, recipe: Record<string, any>) {
  const profile = await getRecipeLibraryProfile(userId, recipe.filters?.libraryId || recipe.automationPolicy?.libraryId || null);
  return analyzeRecipeStudio(recipe, profile);
}

async function loadRecipeAnalytics(userId: string) {
  const recipeWhere = { userId, isArchived: false, deletedAt: null } as const;
  const [installed, active, builtIn, community, activePlaylists, updateCandidates, importWarnings, executions, failedRuns, automatedRuns, fallbackRuns, mostUsed, unused, averageCompatibility] = await Promise.all([
    prisma.playlistRecipe.count({ where: recipeWhere }),
    prisma.playlistRecipe.count({ where: { ...recipeWhere, enabled: true } }),
    prisma.playlistRecipe.count({ where: { ...recipeWhere, sourceRecipeId: { not: null } } }),
    prisma.playlistRecipe.count({ where: { ...recipeWhere, communityRecipeId: { not: null } } }),
    prisma.generatedPlaylist.count({ where: { userId, recipeId: { not: null } } }),
    prisma.playlistRecipe.count({ where: { ...recipeWhere, sourceRecipeId: { not: null }, sourceRecipeVersion: { not: null } } }),
    prisma.playlistRecipe.count({ where: { ...recipeWhere, quarantineState: { not: "NONE" } } }),
    prisma.jobHistory.count({ where: { userId, type: "mix_recipe" } }),
    prisma.jobHistory.count({ where: { userId, type: "mix_recipe", status: { in: ["failed", "interrupted"] } } }),
    prisma.generatedPlaylist.count({ where: { userId, recipeId: { not: null }, smartRefreshSettings: { is: { refreshMode: { not: "MANUAL_ONLY" } } } } }),
    prisma.jobHistory.count({ where: { userId, type: "playlist_generation", summary: { contains: "fallback", mode: "insensitive" } } }),
    prisma.playlistRecipe.findMany({ where: recipeWhere, orderBy: [{ useCount: "desc" }, { lastUsedAt: "desc" }], take: 8, select: { id: true, name: true, category: true, useCount: true, lastUsedAt: true, enabled: true, compatibilityStatus: true, riskLevel: true, _count: { select: { generatedPlaylists: true } } } }),
    prisma.playlistRecipe.findMany({ where: { ...recipeWhere, useCount: 0 }, orderBy: { updatedAt: "asc" }, take: 8, select: { id: true, name: true, updatedAt: true } }),
    prisma.playlistRecipe.aggregate({ where: recipeWhere, _avg: { riskScore: true } }),
  ]);
  const custom = Math.max(0, installed - builtIn - community);
  const successfulRuns = Math.max(0, executions - failedRuns);
  return {
    generatedAt: new Date().toISOString(),
    cacheSeconds: 30,
    summary: { installed, active, builtIn, custom, community, activePlaylists, recipesRequiringUpdates: updateCandidates, importWarnings, averageCompatibility: Math.round(100 - (averageCompatibility._avg.riskScore || 0)) },
    operations: { executions, successfulRuns, failedRuns, automatedRuns, manualRuns: Math.max(0, activePlaylists - automatedRuns), fallbackRuns, successRate: executions ? Math.round(successfulRuns / executions * 100) : null },
    mostUsed: mostUsed.map((recipe) => ({ ...recipe, playlistCount: recipe._count.generatedPlaylists, _count: undefined })),
    unused,
    privacy: "Operational recipe metrics only. Listening events and household member histories are not included.",
  };
}

export async function getRecipeAnalytics(userId: string) {
  const cached = analyticsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cached: true };
  const value = await loadRecipeAnalytics(userId);
  analyticsCache.set(userId, { expiresAt: Date.now() + 30_000, value });
  return { ...value, cached: false };
}
