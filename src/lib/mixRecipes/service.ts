import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { ensurePlaylistIdentity } from "../playlistIdentity";
import {
  exportTracksToPlex,
  generatePlaylistTracksWithStats,
  recordGeneratedPlaylist,
  rollbackCreatedPlexPlaylist,
} from "../playlistService";
import { safeRecordJobHistory } from "../jobHistory";
import {
  createPlaylistRecipeData,
  markPlaylistRecipeUsed,
  parsePlaylistRecipe,
  playlistRecipeSchema,
  portableRecipeFromRecord,
} from "../playlistRecipes";
import { resolveRecipeGenerationConfig } from "./schema";
import { validateRecipe } from "./validation";
import { persistEffectiveSnapshot, resolveOwnedRecipe } from "../recipeInheritance/service";
import { getBuiltInRecipe } from "../builtInRecipes/catalog";
import { markBuiltInRecipeUsed } from "../builtInRecipes/preferences";

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function getOwnedRecipe(userId: string, recipeIdOrSlug: string) {
  const recipe = await prisma.playlistRecipe.findFirst({
    where: {
      userId,
      isArchived: false,
      deletedAt: null,
      OR: [{ id: recipeIdOrSlug }, { slug: recipeIdOrSlug }],
    },
    include: { _count: { select: { generatedPlaylists: true } } },
  });
  if (!recipe) throw new Error("Mix recipe not found.");
  return recipe;
}

export async function validateOwnedRecipe(userId: string, recipeIdOrSlug: string) {
  const stored = await getOwnedRecipe(userId, recipeIdOrSlug);
  return { recipe: parsePlaylistRecipe(stored), result: validateRecipe(portableRecipeFromRecord(stored)) };
}

export async function createRecipeFromPlaylist({
  userId,
  playlistId,
  metadata,
  includedSections,
}: {
  userId: string;
  playlistId: string;
  metadata?: Record<string, unknown>;
  includedSections?: string[];
}) {
  const playlist = await prisma.generatedPlaylist.findFirst({
    where: { id: playlistId, userId },
    include: { identity: true, smartRefreshSettings: true, automationSettings: true },
  });
  if (!playlist) throw new Error("Generated playlist not found.");
  const identity = (playlist.identity?.effectiveProfileJson || playlist.identity?.userProfileJson || {}) as Record<string, any>;
  const allowed = new Set(includedSections || ["scoring", "targets", "bpmFlow", "discovery", "variety", "playlistIdentity", "refreshPolicy", "automationPolicy"]);
  const parsed = playlistRecipeSchema.parse({
    name: typeof metadata?.name === "string" ? metadata.name : `${playlist.plexPlaylistTitle} Recipe`,
    description: typeof metadata?.description === "string" ? metadata.description : playlist.identity?.description || null,
    category: typeof metadata?.category === "string" ? metadata.category : "Custom",
    artworkUrl: typeof metadata?.artworkUrl === "string" ? metadata.artworkUrl : null,
    sourcePlaylistId: playlist.id,
    enabled: true,
    filters: playlist.filtersJson,
    ...(allowed.has("playlistIdentity") ? {
      playlistIdentity: {
        personalitySummary: playlist.identity?.description || "",
        coreMoods: identity.coreMoods || [],
        preferredEnergyCharacter: identity.averageEnergy == null ? "unspecified" : identity.averageEnergy >= 0.7 ? "high" : identity.averageEnergy >= 0.4 ? "medium" : "low",
        preferredBpmMinimum: identity.bpmRange?.[0] || null,
        preferredBpmMaximum: identity.bpmRange?.[1] || null,
        preferredArtists: (identity.preferredArtists || []).map((item: any) => item.name).filter(Boolean),
        preferredGenres: (identity.preferredGenres || []).map((item: any) => item.name).filter(Boolean),
        identityLearningEnabled: playlist.identity?.learningEnabled !== false,
      },
    } : {}),
    ...(allowed.has("refreshPolicy") && playlist.smartRefreshSettings ? {
      refreshPolicy: {
        mode: playlist.smartRefreshSettings.refreshMode === "MANUAL_ONLY" ? "manual" : "scheduled",
        frequencyDays: Math.max(1, Math.round(playlist.smartRefreshSettings.minimumRefreshIntervalHours / 24)),
        strategy: playlist.smartRefreshSettings.allowAutomaticFullRegeneration ? "full_regeneration" : "replace_weak",
        weakTrackScoreThreshold: playlist.smartRefreshSettings.weakTrackThreshold,
      },
    } : {}),
    ...(allowed.has("automationPolicy") ? {
      automationPolicy: {
        enabled: false,
        requireExplicitConfirmation: true,
        libraryId: (playlist.filtersJson as any)?.libraryId || null,
        preserveManualEdits: true,
      },
    } : {}),
  });
  const created = await prisma.playlistRecipe.create({ data: createPlaylistRecipeData(userId, parsed) });
  await safeRecordJobHistory({
    userId, type: "mix_recipe", name: "Recipe created from playlist", status: "completed", trigger: "manual",
    summary: `Created recipe "${created.name}" from playlist "${playlist.plexPlaylistTitle}" without tracks or personal history.`,
    counts: { attempted: 1, processed: 1 },
    metadata: { recipeId: created.id, sourcePlaylistId: playlist.id, schemaVersion: created.schemaVersion, recipeVersion: created.recipeVersion },
  });
  return parsePlaylistRecipe(created);
}

function identityProfileFromRecipe(identity: ReturnType<typeof portableRecipeFromRecord>["playlistIdentity"]) {
  return {
    coreMoods: identity.coreMoods,
    secondaryMoods: [],
    averageEnergy: identity.preferredEnergyCharacter === "high" ? 0.8 : identity.preferredEnergyCharacter === "medium" ? 0.55 : identity.preferredEnergyCharacter === "low" ? 0.25 : null,
    bpmRange: identity.preferredBpmMinimum != null && identity.preferredBpmMaximum != null ? [identity.preferredBpmMinimum, identity.preferredBpmMaximum] : null,
    preferredArtists: identity.preferredArtists.map((name) => ({ name, score: 1 })),
    preferredGenres: identity.preferredGenres.map((name) => ({ name, score: 1 })),
    discoveryPreference: identity.discoveryTolerance / 100,
  };
}

export async function createPlaylistFromRecipe({
  userId,
  recipeId,
  playlistName,
  overrides,
  confirmAutomation = false,
}: {
  userId: string;
  recipeId: string;
  playlistName: string;
  overrides?: unknown;
  confirmAutomation?: boolean;
}) {
  const trimmedName = playlistName.trim();
  if (!trimmedName || trimmedName.length > 120) throw new Error("Playlist name is required and must be 120 characters or fewer.");
  const stored = await getOwnedRecipe(userId, recipeId);
  if (!stored.enabled) throw new Error("This recipe is disabled.");
  const playlistOverrides = overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides as Record<string, unknown> : {};
  const resolution = await resolveOwnedRecipe(userId, stored.id, { proposedChanges: { playlistOverrides: { generation: playlistOverrides } } });
  if (!resolution.valid) throw new Error(resolution.errors[0]?.message || "The effective recipe configuration is invalid.");
  const portable = resolution.normalizedRecipe;
  const config = resolveRecipeGenerationConfig(portable);
  let plexResult: Awaited<ReturnType<typeof exportTracksToPlex>> | null = null;
  let createdGeneratedPlaylistId: string | null = null;
  try {
    const generated = await generatePlaylistTracksWithStats({ userId, config });
    if (!generated.tracks.length) throw new Error("No tracks matched this recipe.");
    const trackIds = generated.tracks.map((track: any) => track.id);
    plexResult = await exportTracksToPlex({ userId, name: trimmedName, trackIds });
    const playlist = await recordGeneratedPlaylist({
      userId,
      serverId: plexResult.serverId,
      plexPlaylistRatingKey: plexResult.playlistId || null,
      plexPlaylistTitle: trimmedName,
      sourceType: "recipe",
      recipeId: stored.id,
      recipeName: stored.name,
      recipeVersion: stored.recipeVersion,
      recipeSchemaVersion: stored.schemaVersion,
      resolvedRecipeSnapshot: portable,
      playlistOverrides: overrides || {},
      filters: config,
      trackIds: plexResult.exportedTrackIds || trackIds,
      discoveryResult: generated.engine.diagnostics?.discovery || null,
    });
    createdGeneratedPlaylistId = playlist.id;
    if (Object.keys(playlistOverrides).length) {
      await prisma.playlistRecipeOverride.createMany({ data: Object.entries(playlistOverrides).map(([field, value]) => ({ playlistId: playlist.id, fieldPath: `generation.${field}`, valueJson: json(value), createdById: userId })) });
    }
    await persistEffectiveSnapshot({ recipeId: stored.id, playlistId: playlist.id, contextType: "generation", resolution });
    const identity = await ensurePlaylistIdentity(userId, playlist.id, "RECIPE");
    await prisma.playlistIdentity.update({
      where: { id: identity.id },
      data: {
        description: portable.playlistIdentity.personalitySummary || null,
        learningEnabled: portable.playlistIdentity.identityLearningEnabled,
        userProfileJson: json(identityProfileFromRecipe(portable.playlistIdentity)),
      },
    });
    if (portable.refreshPolicy.mode === "scheduled") {
      await prisma.smartRefreshSettings.upsert({
        where: { generatedPlaylistId: playlist.id },
        create: {
          generatedPlaylistId: playlist.id,
          refreshMode: confirmAutomation ? "SCHEDULED" : "MANUAL_ONLY",
          minimumRefreshIntervalHours: (portable.refreshPolicy.frequencyDays || 7) * 24,
          weakTrackThreshold: portable.refreshPolicy.weakTrackScoreThreshold,
          allowAutomaticWeakTrackRefresh: portable.refreshPolicy.strategy === "replace_weak",
          allowAutomaticFullRegeneration: portable.refreshPolicy.strategy === "full_regeneration",
        },
        update: {},
      });
    }
    if (portable.automationPolicy.enabled && confirmAutomation) {
      await prisma.playlistAutomationSettings.upsert({
        where: { generatedPlaylistId: playlist.id },
        create: { userId, generatedPlaylistId: playlist.id, mode: "automatic", useGlobalPolicy: true, requireApprovalForRegeneration: true },
        update: { mode: "automatic", paused: false },
      });
    }
    await markPlaylistRecipeUsed(userId, stored.id);
    if (stored.sourceRecipeId) {
      const source = getBuiltInRecipe(stored.sourceRecipeId);
      await markBuiltInRecipeUsed(userId, stored.sourceRecipeId, source?.version || stored.sourceRecipeVersion || 1);
    }
    await safeRecordJobHistory({
      userId, type: "mix_recipe", name: "Playlist generated from recipe", status: "completed", trigger: "manual",
      summary: `Created playlist "${trimmedName}" from recipe "${stored.name}" v${stored.recipeVersion}.`,
      counts: { attempted: config.limit, processed: playlist.trackCount, skipped: Math.max(0, config.limit - playlist.trackCount) },
      metadata: { recipeId: stored.id, recipeVersion: stored.recipeVersion, schemaVersion: stored.schemaVersion, generatedPlaylistId: playlist.id, automationConfirmed: confirmAutomation, resolverVersion: resolution.resolverVersion, configurationFingerprint: resolution.fingerprint, retryBehavior: "original_effective_configuration" },
    });
    return { playlist, trackCount: playlist.trackCount, automationActivated: portable.automationPolicy.enabled && confirmAutomation };
  } catch (error) {
    if (createdGeneratedPlaylistId && plexResult?.createdNewPlaylist) {
      await prisma.generatedPlaylist.deleteMany({ where: { id: createdGeneratedPlaylistId, userId } }).catch(() => undefined);
    }
    if (plexResult?.createdNewPlaylist) await rollbackCreatedPlexPlaylist({ userId, serverId: plexResult.serverId, playlistId: plexResult.playlistId }).catch(() => undefined);
    await safeRecordJobHistory({
      userId, type: "mix_recipe", name: "Recipe generation failed", status: "failed", trigger: "manual",
      summary: `Failed to generate playlist from recipe "${stored.name}".`, error,
      metadata: { recipeId: stored.id, recipeVersion: stored.recipeVersion, schemaVersion: stored.schemaVersion },
    });
    throw error;
  }
}
