import { z } from "zod";
import prisma from "../prisma";

export const DEFAULT_VARIETY_POLICY = {
  maximumTrackOverlapPercent: 20,
  maximumArtistOverlapPercent: 35,
  maximumAlbumOverlapPercent: 25,
  maximumSharedTrackCount: null as number | null,
  minimumUniqueTrackPercent: 70,
  minimumUniqueTrackCount: null as number | null,
  recentUsageLookbackDays: 30 as number | null,
  recentUsagePenaltyStrength: "MEDIUM" as const,
  sharedTrackAllowance: 0,
  coreTrackAllowance: null as number | null,
  exclusivityBehavior: "OFF" as const,
  automaticRepairEnabled: false,
  requireRepairPreview: true,
  comparisonScope: "ALL_MANAGED" as const,
  analysisConcurrency: 2,
  analysisBatchSize: 20,
};

export const varietySettingsSchema = z.object({
  maximumTrackOverlapPercent: z.coerce.number().min(0).max(100).default(20),
  maximumArtistOverlapPercent: z.coerce.number().min(0).max(100).default(35),
  maximumAlbumOverlapPercent: z.coerce.number().min(0).max(100).default(25),
  maximumSharedTrackCount: z.coerce.number().int().min(0).max(1000).nullable().optional(),
  minimumUniqueTrackPercent: z.coerce.number().min(0).max(100).default(70),
  minimumUniqueTrackCount: z.coerce.number().int().min(0).max(1000).nullable().optional(),
  recentUsageLookbackDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
  recentUsagePenaltyStrength: z.enum(["OFF", "LOW", "MEDIUM", "HIGH", "STRICT"]).default("MEDIUM"),
  sharedTrackAllowance: z.coerce.number().int().min(0).max(1000).default(0),
  coreTrackAllowance: z.coerce.number().int().min(0).max(1000).nullable().optional(),
  exclusivityBehavior: z.enum(["OFF", "PREFER_EXCLUSIVE", "STRICT_EXCLUSIVE"]).default("OFF"),
  automaticRepairEnabled: z.boolean().default(false),
  requireRepairPreview: z.boolean().default(true),
  comparisonScope: z.enum(["ALL_MANAGED", "SELECTED_GROUPS", "SIMILAR_IDENTITIES", "RELATED_ONLY"]).default("ALL_MANAGED"),
  analysisConcurrency: z.coerce.number().int().min(1).max(4).default(2),
  analysisBatchSize: z.coerce.number().int().min(5).max(50).default(20),
});

export const pairPolicySchema = z.object({
  playlistAId: z.string().uuid(),
  playlistBId: z.string().uuid(),
  ignored: z.boolean().default(false),
  allowedTrackOverlapPercent: z.coerce.number().min(0).max(100).nullable().optional(),
  allowedArtistOverlapPercent: z.coerce.number().min(0).max(100).nullable().optional(),
  allowedAlbumOverlapPercent: z.coerce.number().min(0).max(100).nullable().optional(),
  maximumSharedTrackCount: z.coerce.number().int().min(0).max(1000).nullable().optional(),
  sharedTrackAllowance: z.coerce.number().int().min(0).max(1000).nullable().optional(),
  allowedArtistIds: z.array(z.string().uuid()).max(500).default([]),
  allowedAlbumIds: z.array(z.string().uuid()).max(500).default([]),
  similarPlaylistAllowance: z.boolean().default(false),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const designationSchema = z.object({
  trackIds: z.array(z.string().uuid()).min(1).max(250),
  isCore: z.boolean().optional(),
  isSharedAllowed: z.boolean().optional(),
  exclusivityMode: z.enum(["NONE", "THIS_PLAYLIST", "SELECTED_PLAYLISTS", "ALL_OTHER_MANAGED", "PREFER_EXCLUSIVE", "PLAYLIST_GROUP"]).optional(),
  excludedPlaylistIds: z.array(z.string().uuid()).max(100).optional(),
  exclusiveGroupId: z.string().uuid().nullable().optional(),
  exclusiveUntil: z.coerce.date().nullable().optional(),
  ignoreWhenManuallyAdded: z.boolean().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export function canonicalPlaylistPair(first: string, second: string) {
  if (first === second) throw new Error("A playlist cannot be compared with itself.");
  return first.localeCompare(second) < 0
    ? { playlistAId: first, playlistBId: second }
    : { playlistAId: second, playlistBId: first };
}

async function assertOwnedPlaylists(userId: string, ids: string[]) {
  const unique = Array.from(new Set(ids));
  const count = await prisma.generatedPlaylist.count({ where: { userId, id: { in: unique } } });
  if (count !== unique.length) throw new Error("One or more playlists were not found or are not accessible.");
}

async function markUserAnalysisStale(userId: string, playlistIds?: string[]) {
  const owned = await prisma.generatedPlaylist.findMany({ where: { userId, ...(playlistIds?.length ? { id: { in: playlistIds } } : {}) }, select: { id: true } });
  const ids = owned.map((playlist) => playlist.id);
  if (!ids.length) return;
  await prisma.$transaction([
    prisma.playlistCoordinationSetting.updateMany({ where: { playlistId: { in: ids } }, data: { analysisStale: true } }),
    prisma.playlistOverlapSummary.updateMany({ where: { OR: [{ playlistAId: { in: ids } }, { playlistBId: { in: ids } }] }, data: { stale: true } }),
  ]);
}

export async function getCrossPlaylistVarietySettings(userId: string) {
  const stored = await prisma.crossPlaylistVarietySetting.findUnique({ where: { userId } });
  return stored || { userId, ...DEFAULT_VARIETY_POLICY, inheritanceLabel: "Using global default" };
}

export async function updateCrossPlaylistVarietySettings(userId: string, rawInput: unknown) {
  const input = varietySettingsSchema.parse(rawInput);
  const settings = await prisma.crossPlaylistVarietySetting.upsert({ where: { userId }, create: { userId, ...input }, update: input });
  await markUserAnalysisStale(userId);
  return { ...settings, inheritanceLabel: "Using user preference" };
}

export async function getPlaylistPairPolicy(userId: string, first: string, second: string) {
  const pair = canonicalPlaylistPair(first, second);
  await assertOwnedPlaylists(userId, [pair.playlistAId, pair.playlistBId]);
  return prisma.playlistPairPolicy.findUnique({ where: { userId_playlistAId_playlistBId: { userId, ...pair } } });
}

export async function upsertPlaylistPairPolicy(userId: string, rawInput: unknown) {
  const parsed = pairPolicySchema.parse(rawInput);
  const pair = canonicalPlaylistPair(parsed.playlistAId, parsed.playlistBId);
  await assertOwnedPlaylists(userId, [pair.playlistAId, pair.playlistBId]);
  const { playlistAId: _playlistAId, playlistBId: _playlistBId, allowedArtistIds, allowedAlbumIds, ...policy } = parsed;
  const data = { ...policy, allowedArtistIdsJson: allowedArtistIds, allowedAlbumIdsJson: allowedAlbumIds };
  const result = await prisma.playlistPairPolicy.upsert({
    where: { userId_playlistAId_playlistBId: { userId, ...pair } },
    create: { userId, ...pair, ...data },
    update: data,
  });
  await markUserAnalysisStale(userId, [pair.playlistAId, pair.playlistBId]);
  return { ...result, inheritanceLabel: "Playlist-pair override" };
}

export async function getEffectiveVarietyPolicy(userId: string, playlistId: string, comparisonPlaylistId?: string | null) {
  await assertOwnedPlaylists(userId, comparisonPlaylistId ? [playlistId, comparisonPlaylistId] : [playlistId]);
  const [global, playlist, pair] = await Promise.all([
    getCrossPlaylistVarietySettings(userId),
    prisma.playlistCoordinationSetting.findUnique({ where: { playlistId } }),
    comparisonPlaylistId ? getPlaylistPairPolicy(userId, playlistId, comparisonPlaylistId) : null,
  ]);
  const effective = {
    maximumTrackOverlapPercent: pair?.allowedTrackOverlapPercent ?? playlist?.maximumSharedTrackPercentage ?? global.maximumTrackOverlapPercent,
    maximumArtistOverlapPercent: pair?.allowedArtistOverlapPercent ?? playlist?.maximumSharedArtistPercentage ?? global.maximumArtistOverlapPercent,
    maximumAlbumOverlapPercent: pair?.allowedAlbumOverlapPercent ?? playlist?.maximumSharedAlbumPercentage ?? global.maximumAlbumOverlapPercent,
    maximumSharedTrackCount: pair?.maximumSharedTrackCount ?? playlist?.maximumSharedTrackCount ?? global.maximumSharedTrackCount,
    minimumUniqueTrackPercent: playlist?.minimumUniqueTrackPercentage ?? global.minimumUniqueTrackPercent,
    minimumUniqueTrackCount: playlist?.minimumUniqueTrackCount ?? global.minimumUniqueTrackCount,
    recentUsageLookbackDays: playlist?.recentUsageLookbackDays ?? global.recentUsageLookbackDays,
    recentUsagePenaltyStrength: playlist?.recentUsagePenaltyStrength ?? global.recentUsagePenaltyStrength,
    sharedTrackAllowance: pair?.sharedTrackAllowance ?? playlist?.sharedTrackAllowance ?? global.sharedTrackAllowance,
    allowedArtistIds: Array.isArray(pair?.allowedArtistIdsJson) ? pair.allowedArtistIdsJson.filter((item): item is string => typeof item === "string") : [],
    allowedAlbumIds: Array.isArray(pair?.allowedAlbumIdsJson) ? pair.allowedAlbumIdsJson.filter((item): item is string => typeof item === "string") : [],
    coreTrackAllowance: playlist?.coreTrackAllowance ?? global.coreTrackAllowance,
    exclusivityBehavior: playlist?.exclusivityBehavior ?? global.exclusivityBehavior,
    automaticRepairEnabled: playlist?.automaticRepairEnabled ?? global.automaticRepairEnabled,
    requireRepairPreview: playlist?.requireRepairPreview ?? global.requireRepairPreview,
    comparisonScope: playlist?.comparisonScope ?? global.comparisonScope,
    ignored: pair?.ignored || false,
    excludedFromEnforcement: playlist?.excludedFromEnforcement || false,
  };
  return {
    ...effective,
    sources: {
      global: "id" in global ? "Using user preference" : "Using global default",
      playlist: playlist ? "Playlist override" : "Using user preference",
      pair: pair ? "Playlist-pair override" : null,
    },
  };
}

export async function setPlaylistTrackDesignations(userId: string, playlistId: string, rawInput: unknown) {
  const input = designationSchema.parse(rawInput);
  await assertOwnedPlaylists(userId, [playlistId, ...(input.excludedPlaylistIds || [])]);
  const memberships = await prisma.generatedPlaylistTrack.findMany({ where: { generatedPlaylistId: playlistId, trackId: { in: input.trackIds } }, select: { trackId: true } });
  const memberIds = new Set(memberships.map((row) => row.trackId).filter(Boolean));
  if (memberIds.size !== new Set(input.trackIds).size) throw new Error("Core and sharing designations can only be applied to tracks currently in this playlist.");
  await prisma.$transaction(async (tx) => {
    for (const trackId of input.trackIds) {
      await tx.playlistTrackDesignation.upsert({
        where: { playlistId_trackId: { playlistId, trackId } },
        create: {
          userId, playlistId, trackId,
          isCore: input.isCore || false,
          isSharedAllowed: input.isSharedAllowed || false,
          exclusivityMode: input.exclusivityMode || "NONE",
          excludedPlaylistIdsJson: input.excludedPlaylistIds || [],
          exclusiveGroupId: input.exclusiveGroupId,
          exclusiveUntil: input.exclusiveUntil,
          ignoreWhenManuallyAdded: input.ignoreWhenManuallyAdded ?? true,
          reason: input.reason,
        },
        update: {
          ...(input.isCore !== undefined ? { isCore: input.isCore } : {}),
          ...(input.isSharedAllowed !== undefined ? { isSharedAllowed: input.isSharedAllowed } : {}),
          ...(input.exclusivityMode !== undefined ? { exclusivityMode: input.exclusivityMode } : {}),
          ...(input.excludedPlaylistIds !== undefined ? { excludedPlaylistIdsJson: input.excludedPlaylistIds } : {}),
          ...(input.exclusiveGroupId !== undefined ? { exclusiveGroupId: input.exclusiveGroupId } : {}),
          ...(input.exclusiveUntil !== undefined ? { exclusiveUntil: input.exclusiveUntil } : {}),
          ...(input.ignoreWhenManuallyAdded !== undefined ? { ignoreWhenManuallyAdded: input.ignoreWhenManuallyAdded } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        },
      });
      if (input.isCore === true) await tx.playlistSharedCoreTrack.upsert({ where: { playlistId_trackId_scopeKey: { playlistId, trackId, scopeKey: "GLOBAL" } }, create: { userId, playlistId, trackId, scopeKey: "GLOBAL" }, update: {} });
      if (input.isCore === false) await tx.playlistSharedCoreTrack.deleteMany({ where: { userId, playlistId, trackId, scopeKey: "GLOBAL" } });
    }
  });
  await markUserAnalysisStale(userId, [playlistId]);
  return listPlaylistTrackDesignations(userId, playlistId);
}

export async function listPlaylistTrackDesignations(userId: string, playlistId: string, coreOnly = false) {
  await assertOwnedPlaylists(userId, [playlistId]);
  return prisma.playlistTrackDesignation.findMany({
    where: { userId, playlistId, ...(coreOnly ? { isCore: true } : {}) },
    include: { track: { select: { id: true, title: true, ratingKey: true, artist: { select: { title: true } }, album: { select: { title: true } } } } },
    orderBy: [{ isCore: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });
}

export const varietyResetSchema = z.object({
  scope: z.enum(["CALCULATED_DATA", "POLICIES", "PAIR_EXCEPTIONS", "CORE_DESIGNATIONS", "EXCLUSIVITY_RULES"]),
  confirm: z.literal(true),
});

export async function resetCrossPlaylistVariety(userId: string, rawInput: unknown) {
  const { scope } = varietyResetSchema.parse(rawInput);
  const owned = await prisma.generatedPlaylist.findMany({ where: { userId }, select: { id: true } });
  const playlistIds = owned.map((playlist) => playlist.id);
  const result = await prisma.$transaction(async (tx) => {
    if (scope === "CALCULATED_DATA") {
      const summaries = await tx.playlistOverlapSummary.deleteMany({ where: { playlistAId: { in: playlistIds }, playlistBId: { in: playlistIds } } });
      const snapshots = await tx.playlistOverlapSnapshot.deleteMany({ where: { userId } });
      const previews = await tx.playlistRepairPreview.deleteMany({ where: { userId, status: { not: "APPLIED" } } });
      await tx.playlistCoordinationSetting.updateMany({ where: { playlistId: { in: playlistIds } }, data: { analysisStale: true } });
      return { removed: summaries.count + snapshots.count + previews.count };
    }
    if (scope === "POLICIES") {
      const global = await tx.crossPlaylistVarietySetting.deleteMany({ where: { userId } });
      const playlist = await tx.playlistCoordinationSetting.deleteMany({ where: { playlistId: { in: playlistIds } } });
      await tx.playlistOverlapSummary.updateMany({ where: { playlistAId: { in: playlistIds }, playlistBId: { in: playlistIds } }, data: { stale: true } });
      return { removed: global.count + playlist.count };
    }
    if (scope === "PAIR_EXCEPTIONS") return { removed: (await tx.playlistPairPolicy.deleteMany({ where: { userId } })).count };
    if (scope === "CORE_DESIGNATIONS") {
      const legacy = await tx.playlistSharedCoreTrack.deleteMany({ where: { userId } });
      const updated = await tx.playlistTrackDesignation.updateMany({ where: { userId, isCore: true }, data: { isCore: false } });
      return { removed: legacy.count + updated.count };
    }
    const updated = await tx.playlistTrackDesignation.updateMany({ where: { userId, NOT: { exclusivityMode: "NONE" } }, data: { exclusivityMode: "NONE", exclusiveUntil: null, exclusiveGroupId: null, excludedPlaylistIdsJson: [] } });
    return { removed: updated.count };
  });
  console.info("[CrossPlaylistVariety] Reset", { userId, scope, removed: result.removed });
  return { scope, ...result };
}
