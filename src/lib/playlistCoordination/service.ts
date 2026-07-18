import { z } from "zod";
import prisma from "../prisma";
import { calculatePlaylistOverlap, canonicalTrackKey, artistKey, albumKey } from "./overlap";
import { PLAYLIST_RELATIONSHIP_TYPES, type CoordinationScoringContext, type CoordinationSettings, type PlaylistTrackFact } from "./types";
import { aggregateHistoricalUsage } from "./usage";
import { getCrossPlaylistVarietySettings, getEffectiveVarietyPolicy } from "./policy";

const CHUNK_SIZE = 500;
const bidirectionalTypes = new Set(["SISTER", "RELATED", "DISTINCT_FROM"]);

export const relationshipInputSchema = z.object({
  targetPlaylistId: z.string().uuid(),
  relationshipType: z.enum(PLAYLIST_RELATIONSHIP_TYPES),
  coordinationEnabled: z.boolean().default(true),
  bidirectional: z.boolean().optional(),
  sharedCoreAllowed: z.boolean().default(false),
  maximumSharedTrackPercentage: z.coerce.number().min(0).max(100).optional().nullable(),
  maximumSharedArtistPercentage: z.coerce.number().min(0).max(100).optional().nullable(),
  preset: z.enum(["CLOSELY_RELATED", "DISTINCT_VARIATIONS", "COMPANION_PLAYLISTS", "FULLY_DISTINCT"]).optional().nullable(),
});

export const coordinationSettingsSchema = z.object({
  coordinationEnabled: z.boolean().default(false),
  maximumSharedTrackPercentage: z.coerce.number().min(0).max(100).default(20),
  overlapEnforcement: z.enum(["OFF", "WARNING_ONLY", "SOFT_TARGET", "HARD_MAXIMUM"]).default("SOFT_TARGET"),
  keepDistinct: z.boolean().default(false),
  allowSharedCoreTracks: z.boolean().default(false),
  maximumSharedCoreTracks: z.coerce.number().int().min(0).max(500).optional().nullable(),
  preferGloballyUnusedTracks: z.boolean().default(false),
  unusedTrackPreferenceStrength: z.coerce.number().min(0).max(1).default(0.5),
  maximumCoordinationInfluence: z.coerce.number().min(0).max(20).default(12),
  crossPlaylistArtistBalancingEnabled: z.boolean().default(true),
  maximumSharedArtistPercentage: z.coerce.number().min(0).max(100).default(40).optional().nullable(),
  maximumSharedAlbumPercentage: z.coerce.number().min(0).max(100).default(25).optional().nullable(),
  maximumSharedTrackCount: z.coerce.number().int().min(0).max(1000).optional().nullable(),
  minimumUniqueTrackPercentage: z.coerce.number().min(0).max(100).default(70),
  minimumUniqueTrackCount: z.coerce.number().int().min(0).max(1000).optional().nullable(),
  uniqueTargetMode: z.enum(["PREFERRED", "STRICT"]).default("PREFERRED"),
  recentUsageLookbackDays: z.coerce.number().int().min(1).max(3650).optional().nullable().default(30),
  recentUsagePenaltyStrength: z.enum(["OFF", "LOW", "MEDIUM", "HIGH", "STRICT"]).default("MEDIUM"),
  sharedTrackAllowance: z.coerce.number().int().min(0).max(1000).default(0),
  coreTrackAllowance: z.coerce.number().int().min(0).max(1000).optional().nullable(),
  comparisonScope: z.enum(["ALL_MANAGED", "SELECTED_GROUPS", "SIMILAR_IDENTITIES", "RELATED_ONLY"]).default("ALL_MANAGED"),
  comparisonGroupIds: z.array(z.string().uuid()).max(50).default([]),
  automaticRepairEnabled: z.boolean().default(false),
  requireRepairPreview: z.boolean().default(true),
  excludedFromEnforcement: z.boolean().default(false),
  exclusivityBehavior: z.enum(["OFF", "PREFER_EXCLUSIVE", "STRICT_EXCLUSIVE"]).default("OFF"),
  exclusivityLookbackDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  ignoreManualAdditionsForExclusivity: z.boolean().default(true),
  maximumTracksPerArtistAcrossGroup: z.coerce.number().int().min(1).max(100).default(6).optional().nullable(),
  featuredArtistMatching: z.enum(["PRIMARY_ONLY", "ALL_CREDITED"]).default("PRIMARY_ONLY"),
  warnBeforeExceedingOverlap: z.boolean().default(true),
  excludedPlaylistIds: z.array(z.string().uuid()).max(100).default([]),
});

const defaultSettings: CoordinationSettings = {
  coordinationEnabled: false,
  maximumSharedTrackPercentage: 20,
  overlapEnforcement: "SOFT_TARGET",
  keepDistinct: false,
  allowSharedCoreTracks: false,
  maximumSharedCoreTracks: null,
  preferGloballyUnusedTracks: false,
  unusedTrackPreferenceStrength: 0.5,
  maximumCoordinationInfluence: 12,
  crossPlaylistArtistBalancingEnabled: true,
  maximumSharedArtistPercentage: 40,
  maximumSharedAlbumPercentage: 25,
  maximumSharedTrackCount: null,
  minimumUniqueTrackPercentage: 70,
  minimumUniqueTrackCount: null,
  uniqueTargetMode: "PREFERRED",
  recentUsageLookbackDays: 30,
  recentUsagePenaltyStrength: "MEDIUM",
  sharedTrackAllowance: 0,
  coreTrackAllowance: null,
  comparisonScope: "ALL_MANAGED",
  automaticRepairEnabled: false,
  requireRepairPreview: true,
  excludedFromEnforcement: false,
  exclusivityBehavior: "OFF",
  exclusivityLookbackDays: null,
  maximumTracksPerArtistAcrossGroup: 6,
  warnBeforeExceedingOverlap: true,
};

function chunks<T>(items: T[]) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += CHUNK_SIZE) result.push(items.slice(index, index + CHUNK_SIZE));
  return result;
}

async function ownedPlaylists(userId: string, playlistIds: string[]) {
  return prisma.generatedPlaylist.findMany({
    where: { userId, id: { in: Array.from(new Set(playlistIds)) } },
    select: { id: true, userId: true, serverId: true, plexPlaylistTitle: true, trackCount: true },
  });
}

function normalizeRelationshipPair(sourcePlaylistId: string, targetPlaylistId: string, relationshipType: string, bidirectional: boolean) {
  if ((bidirectional || bidirectionalTypes.has(relationshipType)) && sourcePlaylistId.localeCompare(targetPlaylistId) > 0) {
    return { sourcePlaylistId: targetPlaylistId, targetPlaylistId: sourcePlaylistId };
  }
  return { sourcePlaylistId, targetPlaylistId };
}

async function assertCompatiblePlaylists(userId: string, sourcePlaylistId: string, targetPlaylistId: string) {
  if (sourcePlaylistId === targetPlaylistId) throw new Error("A playlist cannot be related to itself.");
  const playlists = await ownedPlaylists(userId, [sourcePlaylistId, targetPlaylistId]);
  if (playlists.length !== 2) throw new Error("One or more playlists were not found or are not accessible.");
  const serverIds = new Set(playlists.map((playlist) => playlist.serverId).filter(Boolean));
  if (serverIds.size > 1) throw new Error("These playlists use incompatible Plex servers, so tracks cannot be compared reliably.");
  return playlists;
}

export async function listPlaylistRelationships(userId: string, playlistId: string) {
  if (!(await ownedPlaylists(userId, [playlistId])).length) throw new Error("Playlist not found.");
  return prisma.playlistRelationship.findMany({
    where: { userId, OR: [{ sourcePlaylistId: playlistId }, { targetPlaylistId: playlistId }] },
    include: {
      sourcePlaylist: { select: { id: true, plexPlaylistTitle: true, engineVersion: true, trackCount: true } },
      targetPlaylist: { select: { id: true, plexPlaylistTitle: true, engineVersion: true, trackCount: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function createPlaylistRelationship(userId: string, sourcePlaylistId: string, rawInput: unknown) {
  const input = relationshipInputSchema.parse(rawInput);
  const bidirectional = input.bidirectional ?? bidirectionalTypes.has(input.relationshipType);
  await assertCompatiblePlaylists(userId, sourcePlaylistId, input.targetPlaylistId);
  if (["PARENT", "CHILD"].includes(input.relationshipType)) {
    const existingLinks = await prisma.playlistRelationship.findMany({ where: { userId, relationshipType: { in: ["PARENT", "CHILD"] } }, select: { sourcePlaylistId: true, targetPlaylistId: true, relationshipType: true } });
    const edges = new Map<string, string[]>();
    for (const link of existingLinks) {
      const parent = link.relationshipType === "PARENT" ? link.sourcePlaylistId : link.targetPlaylistId;
      const child = link.relationshipType === "PARENT" ? link.targetPlaylistId : link.sourcePlaylistId;
      edges.set(parent, (edges.get(parent) || []).concat(child));
    }
    const parent = input.relationshipType === "PARENT" ? sourcePlaylistId : input.targetPlaylistId;
    const child = input.relationshipType === "PARENT" ? input.targetPlaylistId : sourcePlaylistId;
    const pending = [child];
    const visited = new Set<string>();
    while (pending.length) {
      const current = pending.shift()!;
      if (current === parent) throw new Error("This parent-child link would create a circular relationship.");
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...(edges.get(current) || []));
    }
  }
  const pair = normalizeRelationshipPair(sourcePlaylistId, input.targetPlaylistId, input.relationshipType, bidirectional);
  try {
    return await prisma.playlistRelationship.create({
      data: { userId, ...pair, ...input, targetPlaylistId: pair.targetPlaylistId, sourcePlaylistId: pair.sourcePlaylistId, bidirectional },
      include: { sourcePlaylist: true, targetPlaylist: true },
    });
  } catch (error: any) {
    if (error?.code === "P2002") throw new Error("This playlist relationship already exists.");
    throw error;
  }
}

export async function updatePlaylistRelationship(userId: string, playlistId: string, relationshipId: string, rawInput: unknown) {
  const existing = await prisma.playlistRelationship.findFirst({
    where: { id: relationshipId, userId, OR: [{ sourcePlaylistId: playlistId }, { targetPlaylistId: playlistId }] },
  });
  if (!existing) throw new Error("Playlist relationship not found.");
  const input = relationshipInputSchema.partial().omit({ targetPlaylistId: true, relationshipType: true }).parse(rawInput);
  return prisma.playlistRelationship.update({ where: { id: existing.id }, data: input });
}

export async function deletePlaylistRelationship(userId: string, playlistId: string, relationshipId: string) {
  const result = await prisma.playlistRelationship.deleteMany({
    where: { id: relationshipId, userId, OR: [{ sourcePlaylistId: playlistId }, { targetPlaylistId: playlistId }] },
  });
  if (!result.count) throw new Error("Playlist relationship not found.");
  return { deleted: true };
}

export async function getCoordinationSettings(userId: string, playlistId: string) {
  if (!(await ownedPlaylists(userId, [playlistId])).length) throw new Error("Playlist not found.");
  const settings = await prisma.playlistCoordinationSetting.findUnique({ where: { playlistId } });
  const global = await getCrossPlaylistVarietySettings(userId);
  return settings ? {
    ...settings,
    excludedPlaylistIds: Array.isArray(settings.excludedPlaylistIdsJson) ? settings.excludedPlaylistIdsJson : [],
    comparisonGroupIds: Array.isArray(settings.comparisonGroupIdsJson) ? settings.comparisonGroupIdsJson : [],
    inheritanceLabel: "Playlist override",
  } : {
    playlistId,
    ...defaultSettings,
    maximumSharedTrackPercentage: global.maximumTrackOverlapPercent,
    maximumSharedArtistPercentage: global.maximumArtistOverlapPercent,
    maximumSharedAlbumPercentage: global.maximumAlbumOverlapPercent,
    maximumSharedTrackCount: global.maximumSharedTrackCount,
    minimumUniqueTrackPercentage: global.minimumUniqueTrackPercent,
    minimumUniqueTrackCount: global.minimumUniqueTrackCount,
    recentUsageLookbackDays: global.recentUsageLookbackDays,
    recentUsagePenaltyStrength: global.recentUsagePenaltyStrength,
    sharedTrackAllowance: global.sharedTrackAllowance,
    coreTrackAllowance: global.coreTrackAllowance,
    comparisonScope: global.comparisonScope,
    automaticRepairEnabled: global.automaticRepairEnabled,
    requireRepairPreview: global.requireRepairPreview,
    exclusivityBehavior: global.exclusivityBehavior,
    featuredArtistMatching: "PRIMARY_ONLY",
    excludedPlaylistIds: [],
    comparisonGroupIds: [],
    inheritanceLabel: "Using user preference",
  };
}

export async function updateCoordinationSettings(userId: string, playlistId: string, rawInput: unknown) {
  const input = coordinationSettingsSchema.parse(rawInput);
  const playlists = await ownedPlaylists(userId, [playlistId, ...input.excludedPlaylistIds]);
  if (playlists.length !== new Set([playlistId, ...input.excludedPlaylistIds]).size) throw new Error("An excluded playlist was not found or is not accessible.");
  const { excludedPlaylistIds, comparisonGroupIds, ...data } = input;
  const settings = await prisma.playlistCoordinationSetting.upsert({
    where: { playlistId },
    create: { playlistId, ...data, excludedPlaylistIdsJson: excludedPlaylistIds, comparisonGroupIdsJson: comparisonGroupIds, analysisStale: true },
    update: { ...data, excludedPlaylistIdsJson: excludedPlaylistIds, comparisonGroupIdsJson: comparisonGroupIds, analysisStale: true },
  });
  await prisma.playlistOverlapSummary.updateMany({ where: { OR: [{ playlistAId: playlistId }, { playlistBId: playlistId }] }, data: { stale: true } });
  return settings;
}

export async function loadPlaylistFacts(playlistIds: string[]) {
  if (!playlistIds.length) return new Map<string, PlaylistTrackFact[]>();
  const memberships: Array<{ generatedPlaylistId: string; trackId: string | null; plexTrackRatingKey: string | null; title: string; artist: string | null; album: string | null }> = [];
  for (const playlistBatch of chunks(Array.from(new Set(playlistIds)))) {
    memberships.push(...await prisma.generatedPlaylistTrack.findMany({
      where: { generatedPlaylistId: { in: playlistBatch }, trackId: { not: null } },
      select: { generatedPlaylistId: true, trackId: true, plexTrackRatingKey: true, title: true, artist: true, album: true },
    }));
  }
  const trackIds = Array.from(new Set(memberships.map((row) => row.trackId).filter((id): id is string => Boolean(id))));
  const tracks: any[] = [];
  for (const batch of chunks(trackIds)) {
    tracks.push(...await prisma.track.findMany({
      where: { id: { in: batch }, syncStatus: "active", deletedAt: null, NOT: { localFileStatus: "missing" } },
      select: { id: true, ratingKey: true, title: true, normalizedTitle: true, artistId: true, albumId: true, canonicalRecordingId: true, artist: { select: { title: true } }, album: { select: { title: true, artist: { select: { title: true } } } } },
    }));
  }
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const result = new Map<string, PlaylistTrackFact[]>(playlistIds.map((id) => [id, []]));
  for (const membership of memberships) {
    const track = membership.trackId ? byId.get(membership.trackId) : null;
    if (!track) continue;
    result.get(membership.generatedPlaylistId)?.push({
      trackId: track.id,
      ratingKey: track.ratingKey || membership.plexTrackRatingKey,
      title: track.title || membership.title,
      normalizedTitle: track.normalizedTitle,
      artistId: track.artistId,
      artistName: track.artist?.title || membership.artist,
      albumId: track.albumId,
      albumName: track.album?.title || membership.album,
      albumArtistName: track.album?.artist?.title,
      canonicalRecordingId: track.canonicalRecordingId,
    });
  }
  return result;
}

export async function comparePlaylists(userId: string, sourcePlaylistId: string, targetPlaylistId: string) {
  const playlists = await assertCompatiblePlaylists(userId, sourcePlaylistId, targetPlaylistId);
  const facts = await loadPlaylistFacts([sourcePlaylistId, targetPlaylistId]);
  const [coreRows, designations, policy, history] = await Promise.all([
    prisma.playlistSharedCoreTrack.findMany({ where: { userId, playlistId: { in: [sourcePlaylistId, targetPlaylistId] } }, select: { trackId: true } }),
    prisma.playlistTrackDesignation.findMany({ where: { userId, playlistId: { in: [sourcePlaylistId, targetPlaylistId] }, OR: [{ isCore: true }, { isSharedAllowed: true }] }, select: { trackId: true, isCore: true, isSharedAllowed: true } }),
    getEffectiveVarietyPolicy(userId, sourcePlaylistId, targetPlaylistId),
    (() => {
      const [playlistAId, playlistBId] = [sourcePlaylistId, targetPlaylistId].sort();
      return prisma.playlistOverlapSnapshot.findMany({ where: { userId, playlistAId, playlistBId }, orderBy: { calculatedAt: "desc" }, take: 90 });
    })(),
  ]);
  const designationFacts = await loadTrackFacts(Array.from(new Set(coreRows.map((row) => row.trackId).concat(designations.map((row) => row.trackId)))));
  const factKeyById = new Map(designationFacts.map((fact) => [fact.trackId, canonicalTrackKey(fact)]));
  const coreKeys = new Set(coreRows.map((row) => factKeyById.get(row.trackId)).concat(designations.filter((row) => row.isCore).map((row) => factKeyById.get(row.trackId))).filter((key): key is string => Boolean(key)));
  const allowedKeys = new Set(designations.filter((row) => row.isSharedAllowed).map((row) => factKeyById.get(row.trackId)).filter((key): key is string => Boolean(key)));
  const sourceFacts = facts.get(sourcePlaylistId) || [];
  const targetFacts = facts.get(targetPlaylistId) || [];
  const overlap = calculatePlaylistOverlap(sourceFacts, targetFacts, coreKeys, {
    ...policy,
    allowedSharedTrackKeys: allowedKeys,
    coreTrackKeys: coreKeys,
    allowedArtistKeys: policy.allowedArtistIds.map((id: string) => `artist:${id}`),
    allowedAlbumKeys: policy.allowedAlbumIds.map((id: string) => `album:${id}`),
  });
  const sharedSet = new Set(overlap.sharedTrackKeys);
  const sourceUniqueSet = new Set(sourceFacts.map(canonicalTrackKey).filter((key) => key && !sharedSet.has(key)));
  const targetUniqueSet = new Set(targetFacts.map(canonicalTrackKey).filter((key) => key && !sharedSet.has(key)));
  const summaryTrack = (track: PlaylistTrackFact) => ({ trackId: track.trackId, title: track.title, artist: track.artistName, album: track.albumName, key: canonicalTrackKey(track), core: coreKeys.has(canonicalTrackKey(track)), sharedAllowed: allowedKeys.has(canonicalTrackKey(track)) });
  return {
    sourcePlaylist: playlists.find((item) => item.id === sourcePlaylistId),
    targetPlaylist: playlists.find((item) => item.id === targetPlaylistId),
    ...overlap,
    withinPolicy: policy.ignored || policy.excludedFromEnforcement || overlap.withinPolicy,
    warnings: policy.ignored || policy.excludedFromEnforcement ? [] : overlap.warnings,
    policy,
    history: history.reverse(),
    sharedTracks: sourceFacts.filter((track) => sharedSet.has(canonicalTrackKey(track))).map(summaryTrack),
    sourceUniqueTracks: sourceFacts.filter((track) => sourceUniqueSet.has(canonicalTrackKey(track))).map(summaryTrack),
    targetUniqueTracks: targetFacts.filter((track) => targetUniqueSet.has(canonicalTrackKey(track))).map(summaryTrack),
  };
}

async function loadTrackFacts(trackIds: string[]) {
  const result: PlaylistTrackFact[] = [];
  for (const batch of chunks(Array.from(new Set(trackIds)))) {
    const tracks = await prisma.track.findMany({ where: { id: { in: batch } }, include: { artist: { select: { title: true } }, album: { select: { title: true, artist: { select: { title: true } } } } } });
    result.push(...tracks.map((track) => ({ trackId: track.id, ratingKey: track.ratingKey, title: track.title, normalizedTitle: track.normalizedTitle, artistId: track.artistId, artistName: track.artist.title, albumId: track.albumId, albumName: track.album.title, albumArtistName: (track as any).album?.artist?.title, canonicalRecordingId: track.canonicalRecordingId })));
  }
  return result;
}

function increment(record: Record<string, number>, key: string) {
  if (key) record[key] = (record[key] || 0) + 1;
}

export async function loadCoordinationScoringContext({ userId, playlistId, candidateTrackIds, targetPlaylistSize, draft }: { userId: string; playlistId?: string | null; candidateTrackIds: string[]; targetPlaylistSize: number; draft?: { enabled?: boolean; relationshipType?: string; relatedPlaylistIds?: string[]; maximumSharedTrackPercentage?: number; overlapEnforcement?: string; allowSharedCoreTracks?: boolean; preferGloballyUnusedTracks?: boolean; unusedTrackPreferenceStrength?: number; crossPlaylistArtistBalancingEnabled?: boolean; keepDistinct?: boolean } | null }): Promise<CoordinationScoringContext | undefined> {
  if (!playlistId && !draft?.enabled) return undefined;
  const stored: any = playlistId ? await getCoordinationSettings(userId, playlistId) : {
    ...defaultSettings,
    coordinationEnabled: true,
    maximumSharedTrackPercentage: draft?.maximumSharedTrackPercentage ?? 20,
    overlapEnforcement: draft?.overlapEnforcement || "SOFT_TARGET",
    keepDistinct: draft?.keepDistinct ?? false,
    allowSharedCoreTracks: draft?.allowSharedCoreTracks ?? false,
    preferGloballyUnusedTracks: draft?.preferGloballyUnusedTracks ?? false,
    unusedTrackPreferenceStrength: draft?.unusedTrackPreferenceStrength ?? 0.5,
    crossPlaylistArtistBalancingEnabled: draft?.crossPlaylistArtistBalancingEnabled ?? true,
    excludedPlaylistIds: draft?.relationshipType === "DISTINCT_FROM" ? draft.relatedPlaylistIds || [] : [],
  };
  if (!stored.coordinationEnabled) return undefined;
  if (stored.excludedFromEnforcement) return undefined;
  const relationships = playlistId ? await listPlaylistRelationships(userId, playlistId) : [];
  const chainMembership = playlistId ? await prisma.playlistProgressionMember.findFirst({
    where: { playlistId, chain: { userId } },
    include: { chain: { include: { members: { orderBy: { sequencePosition: "asc" } } } } },
  }) : null;
  const baseRelatedPlaylistIds = playlistId
    ? relationships.filter((item) => item.coordinationEnabled).map((item) => item.sourcePlaylistId === playlistId ? item.targetPlaylistId : item.sourcePlaylistId)
    : Array.from(new Set(draft?.relatedPlaylistIds || []));
  const chainMembers = chainMembership?.chain.members || [];
  const chainIndex = chainMembers.findIndex((member) => member.playlistId === playlistId);
  const previousPlaylistId = chainIndex > 0 ? chainMembers[chainIndex - 1].playlistId : undefined;
  const nextPlaylistId = chainIndex >= 0 && chainIndex < chainMembers.length - 1 ? chainMembers[chainIndex + 1].playlistId : undefined;
  let relatedPlaylistIds = Array.from(new Set(baseRelatedPlaylistIds.concat(chainMembers.map((member) => member.playlistId).filter((id) => id !== playlistId))));
  if (playlistId && stored.comparisonScope === "ALL_MANAGED") {
    relatedPlaylistIds = (await prisma.generatedPlaylist.findMany({ where: { userId, NOT: { id: playlistId } }, select: { id: true } })).map((item) => item.id);
  } else if (playlistId && stored.comparisonScope === "SELECTED_GROUPS" && stored.comparisonGroupIds?.length) {
    relatedPlaylistIds = (await prisma.playlistGroupMembership.findMany({ where: { playlistGroupId: { in: stored.comparisonGroupIds }, playlist: { userId }, NOT: { playlistId } }, select: { playlistId: true }, distinct: ["playlistId"] })).map((item) => item.playlistId);
  }
  const excludedPlaylistIds = Array.from(new Set((stored.excludedPlaylistIds as string[]).filter((id) => id !== playlistId)));
  const authorizedRelated = await ownedPlaylists(userId, Array.from(new Set(relatedPlaylistIds.concat(excludedPlaylistIds))));
  if (authorizedRelated.length !== new Set(relatedPlaylistIds.concat(excludedPlaylistIds)).size) throw new Error("A related playlist was not found or is not accessible.");
  const relatedFacts = await loadPlaylistFacts(Array.from(new Set(relatedPlaylistIds.concat(excludedPlaylistIds))));
  const candidateFacts = await loadTrackFacts(candidateTrackIds);
  const candidateKeyById = new Map(candidateFacts.map((fact) => [fact.trackId, canonicalTrackKey(fact)]));
  const candidateKeys = new Set(candidateFacts.map(canonicalTrackKey));
  const globalRows: Array<{ trackId: string | null }> = [];
  const historicalRows: Array<{ trackId: string | null; occurredAt: Date }> = [];
  const historyCutoff = stored.recentUsageLookbackDays == null ? undefined : new Date(Date.now() - stored.recentUsageLookbackDays * 86_400_000);
  for (const batch of chunks(candidateTrackIds)) {
    globalRows.push(...await prisma.generatedPlaylistTrack.findMany({
      where: { trackId: { in: batch }, generatedPlaylist: { userId, ...(playlistId ? { NOT: { id: playlistId } } : {}) } }, select: { trackId: true },
    }));
    historicalRows.push(...await prisma.playlistMembershipEvent.findMany({
      where: { userId, trackId: { in: batch }, ...(historyCutoff ? { occurredAt: { gte: historyCutoff } } : {}) },
      select: { trackId: true, occurredAt: true },
    }));
  }
  const globalActiveUsage: Record<string, number> = {};
  for (const row of globalRows) increment(globalActiveUsage, candidateKeyById.get(row.trackId || "") || "");
  const globalHistoricalUsage = aggregateHistoricalUsage(historicalRows.map((row) => ({ trackKey: candidateKeyById.get(row.trackId || "") || "", occurredAt: row.occurredAt })).filter((row) => Boolean(row.trackKey)));
  const recentCutoff = stored.recentUsageLookbackDays == null ? new Date(0) : new Date(Date.now() - stored.recentUsageLookbackDays * 86_400_000);
  const recentTrackUsage: Record<string, number> = {};
  for (const row of historicalRows) if (row.occurredAt >= recentCutoff) increment(recentTrackUsage, candidateKeyById.get(row.trackId || "") || "");
  const relatedTrackUsage: Record<string, number> = {};
  const artistUsage: Record<string, number> = {};
  const albumUsage: Record<string, number> = {};
  const excludedTrackKeys = new Set<string>();
  for (const relatedId of relatedPlaylistIds) {
    for (const fact of relatedFacts.get(relatedId) || []) {
      const key = canonicalTrackKey(fact);
      if (candidateKeys.has(key)) increment(relatedTrackUsage, key);
      increment(artistUsage, artistKey(fact));
      increment(albumUsage, albumKey(fact));
    }
  }
  for (const excludedId of excludedPlaylistIds) for (const fact of relatedFacts.get(excludedId) || []) excludedTrackKeys.add(canonicalTrackKey(fact));
  const designationRows: Array<{ trackId: string; playlistId: string; isCore: boolean; isSharedAllowed: boolean; exclusivityMode: string }> = [];
  if (playlistId) for (const batch of chunks(candidateTrackIds)) designationRows.push(...await prisma.playlistTrackDesignation.findMany({
    where: {
      userId,
      trackId: { in: batch },
      OR: [
        { playlistId, OR: [{ isCore: true }, { isSharedAllowed: true }] },
        { NOT: [{ playlistId }, { exclusivityMode: "NONE" }], OR: [{ exclusiveUntil: null }, { exclusiveUntil: { gt: new Date() } }] },
      ],
    },
    select: { trackId: true, playlistId: true, isCore: true, isSharedAllowed: true, exclusivityMode: true },
  }));
  const coreRows = await prisma.playlistSharedCoreTrack.findMany({ where: { userId, playlistId: { in: Array.from(new Set((playlistId ? [playlistId] : []).concat(relatedPlaylistIds))) } }, select: { trackId: true } });
  const coreFacts = await loadTrackFacts(coreRows.map((row) => row.trackId));
  const relatedPlaylists = await ownedPlaylists(userId, relatedPlaylistIds);
  const boundaryBpm = async (boundaryPlaylistId: string | undefined, order: "asc" | "desc") => {
    if (!boundaryPlaylistId) return null;
    const membership = await prisma.generatedPlaylistTrack.findFirst({ where: { generatedPlaylistId: boundaryPlaylistId, trackId: { not: null } }, orderBy: { position: order }, select: { trackId: true } });
    if (!membership?.trackId) return null;
    const track = await prisma.track.findUnique({ where: { id: membership.trackId }, select: { effectiveBpm: true, bpm: true, audioFeature: { select: { tempo: true } } } });
    return track?.effectiveBpm ?? track?.bpm ?? track?.audioFeature?.tempo ?? null;
  };
  const [previousHandoffBpm, nextHandoffBpm] = await Promise.all([boundaryBpm(previousPlaylistId, "desc"), boundaryBpm(nextPlaylistId, "asc")]);
  return {
    settings: {
      coordinationEnabled: stored.coordinationEnabled,
      maximumSharedTrackPercentage: stored.maximumSharedTrackPercentage,
      overlapEnforcement: stored.overlapEnforcement as CoordinationSettings["overlapEnforcement"],
      keepDistinct: stored.keepDistinct,
      allowSharedCoreTracks: stored.allowSharedCoreTracks,
      maximumSharedCoreTracks: stored.maximumSharedCoreTracks,
      preferGloballyUnusedTracks: stored.preferGloballyUnusedTracks,
      unusedTrackPreferenceStrength: stored.unusedTrackPreferenceStrength,
      maximumCoordinationInfluence: stored.maximumCoordinationInfluence,
      crossPlaylistArtistBalancingEnabled: stored.crossPlaylistArtistBalancingEnabled,
      maximumSharedArtistPercentage: stored.maximumSharedArtistPercentage,
      maximumSharedAlbumPercentage: stored.maximumSharedAlbumPercentage,
      maximumSharedTrackCount: stored.maximumSharedTrackCount,
      minimumUniqueTrackPercentage: stored.minimumUniqueTrackPercentage,
      minimumUniqueTrackCount: stored.minimumUniqueTrackCount,
      uniqueTargetMode: stored.uniqueTargetMode,
      recentUsageLookbackDays: stored.recentUsageLookbackDays,
      recentUsagePenaltyStrength: stored.recentUsagePenaltyStrength,
      sharedTrackAllowance: stored.sharedTrackAllowance,
      coreTrackAllowance: stored.coreTrackAllowance,
      comparisonScope: stored.comparisonScope,
      automaticRepairEnabled: stored.automaticRepairEnabled,
      requireRepairPreview: stored.requireRepairPreview,
      excludedFromEnforcement: stored.excludedFromEnforcement,
      exclusivityBehavior: stored.exclusivityBehavior,
      exclusivityLookbackDays: stored.exclusivityLookbackDays,
      maximumTracksPerArtistAcrossGroup: stored.maximumTracksPerArtistAcrossGroup,
      warnBeforeExceedingOverlap: stored.warnBeforeExceedingOverlap,
    },
    targetPlaylistSize,
    relatedPlaylistIds,
    excludedTrackKeys: Array.from(excludedTrackKeys),
    relatedTrackUsage,
    globalActiveUsage,
    globalHistoricalUsage,
    recentTrackUsage,
    artistUsage,
    albumUsage,
    sharedCoreTrackKeys: Array.from(new Set(coreFacts.map(canonicalTrackKey).concat(designationRows.filter((row) => row.playlistId === playlistId && row.isCore).map((row) => candidateKeyById.get(row.trackId) || "")).filter(Boolean))),
    allowedSharedTrackKeys: designationRows.filter((row) => row.playlistId === playlistId && row.isSharedAllowed).map((row) => candidateKeyById.get(row.trackId) || "").filter(Boolean),
    exclusiveTrackKeys: designationRows.filter((row) => row.playlistId !== playlistId && row.exclusivityMode !== "NONE").map((row) => candidateKeyById.get(row.trackId) || "").filter(Boolean),
    maximumRelatedPlaylistSize: Math.max(1, ...relatedPlaylists.map((playlist) => playlist.trackCount)),
    ...(chainMembership ? { progression: { previousPlaylistId, nextPlaylistId, previousHandoffBpm, nextHandoffBpm } } : {}),
  };
}

export async function getCoordinationDashboard(userId: string) {
  const [playlists, relationships, sharedCoreCount, progressionChainCount, latestAnalysis] = await Promise.all([
    prisma.generatedPlaylist.findMany({ where: { userId }, select: { id: true, plexPlaylistTitle: true, trackCount: true, updatedAt: true }, orderBy: { plexPlaylistTitle: "asc" } }),
    prisma.playlistRelationship.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }),
    prisma.playlistSharedCoreTrack.count({ where: { userId } }),
    prisma.playlistProgressionChain.count({ where: { userId } }),
    prisma.jobHistory.findFirst({ where: { userId, type: "cross_playlist_analysis" }, orderBy: { startedAt: "desc" } }),
  ]);
  const playlistIds = playlists.map((item) => item.id);
  const cachedRows = playlistIds.length ? await prisma.playlistOverlapSummary.findMany({ where: { playlistAId: { in: playlistIds }, playlistBId: { in: playlistIds } }, orderBy: { sharedTrackPercentage: "desc" } }) : [];
  const playlistById = new Map(playlists.map((playlist) => [playlist.id, playlist]));
  const relationshipByPair = new Map(relationships.map((relationship) => [[relationship.sourcePlaylistId, relationship.targetPlaylistId].sort().join(":"), relationship]));
  const pairs = cachedRows.map((overlap) => {
    const relationship = relationshipByPair.get(`${overlap.playlistAId}:${overlap.playlistBId}`);
    const playlistA = playlistById.get(overlap.playlistAId)!;
    const playlistB = playlistById.get(overlap.playlistBId)!;
    const changedAt = Math.max(playlistA.updatedAt.getTime(), playlistB.updatedAt.getTime());
    const stale = overlap.stale || overlap.calculatedAt.getTime() < changedAt;
    const limit = Number((overlap.policySnapshotJson as any)?.maximumTrackOverlapPercent ?? relationship?.maximumSharedTrackPercentage ?? 20);
    const status = stale ? "Analysis stale" : relationship && !relationship.coordinationEnabled ? "Coordination disabled" : !overlap.withinPolicy ? "Over limit" : overlap.sharedTrackPercentage >= limit * 0.8 ? "Near limit" : "Healthy";
    return { relationshipId: relationship?.id || `analysis:${overlap.id}`, relationshipType: relationship?.relationshipType || "ANALYZED_PAIR", playlistA, playlistB, limit, status, ...overlap, stale };
  });
  const averageTrackOverlap = pairs.length ? Math.round((pairs.reduce((sum, pair) => sum + pair.sharedTrackPercentage, 0) / pairs.length) * 100) / 100 : 0;
  return {
    summary: {
      managedPlaylists: playlists.length,
      coordinatedPlaylists: playlists.length,
      relationships: relationships.length,
      highOverlapPairs: pairs.filter((pair) => pair.status === "Over limit").length,
      pairsAboveLimit: pairs.filter((pair) => pair.status === "Over limit").length,
      averageTrackOverlap,
      duplicateTracks: pairs.reduce((sum, pair) => sum + pair.sharedTrackCount, 0),
      sharedCoreTracks: sharedCoreCount,
      progressionChains: progressionChainCount,
      overlapWarnings: pairs.filter((pair) => ["Over limit", "Near limit"].includes(pair.status)).length,
    },
    pairs,
    playlists,
    analysis: latestAnalysis || { status: "not_calculated", summary: "Analysis required" },
  };
}

export async function setSharedCoreTracks(userId: string, playlistId: string, trackIds: string[], shared: boolean, relationshipId?: string | null) {
  if (!(await ownedPlaylists(userId, [playlistId])).length) throw new Error("Playlist not found.");
  const ownedTrackCount = await prisma.track.count({ where: { id: { in: Array.from(new Set(trackIds)) }, library: { server: { userId } } } });
  if (ownedTrackCount !== new Set(trackIds).size) throw new Error("One or more tracks were not found or are not accessible.");
  if (!shared) {
    await prisma.$transaction([
      prisma.playlistSharedCoreTrack.deleteMany({ where: { userId, playlistId, trackId: { in: trackIds }, ...(relationshipId ? { relationshipId } : {}) } }),
      prisma.playlistTrackDesignation.updateMany({ where: { userId, playlistId, trackId: { in: trackIds } }, data: { isCore: false } }),
      prisma.generatedPlaylist.update({ where: { id: playlistId }, data: { revisionCounter: { increment: 1 } } }),
      prisma.playlistOverlapSummary.updateMany({ where: { OR: [{ playlistAId: playlistId }, { playlistBId: playlistId }] }, data: { stale: true } }),
    ]);
    return { updated: trackIds.length, shared: false };
  }
  const settings = await getCoordinationSettings(userId, playlistId);
  const currentCount = await prisma.playlistSharedCoreTrack.count({ where: { userId, playlistId } });
  if (settings.maximumSharedCoreTracks != null && currentCount + trackIds.length > settings.maximumSharedCoreTracks) throw new Error("The shared-core track limit would be exceeded.");
  await prisma.$transaction(async (tx) => {
    await tx.playlistSharedCoreTrack.createMany({ data: Array.from(new Set(trackIds)).map((trackId) => ({ userId, playlistId, trackId, relationshipId: relationshipId || null, scopeKey: relationshipId || "GLOBAL" })), skipDuplicates: true });
    for (const trackId of Array.from(new Set(trackIds))) await tx.playlistTrackDesignation.upsert({ where: { playlistId_trackId: { playlistId, trackId } }, create: { userId, playlistId, trackId, isCore: true }, update: { isCore: true } });
    await tx.generatedPlaylist.update({ where: { id: playlistId }, data: { revisionCounter: { increment: 1 } } });
    await tx.playlistOverlapSummary.updateMany({ where: { OR: [{ playlistAId: playlistId }, { playlistBId: playlistId }] }, data: { stale: true } });
  });
  return { updated: trackIds.length, shared: true };
}

export async function listSharedCoreTracks(userId: string, playlistId: string, trackId?: string | null) {
  if (!(await ownedPlaylists(userId, [playlistId])).length) throw new Error("Playlist not found.");
  return prisma.playlistSharedCoreTrack.findMany({
    where: { userId, ...(trackId ? { trackId } : { playlistId }) },
    include: { playlist: { select: { id: true, plexPlaylistTitle: true } }, relationship: { select: { id: true, relationshipType: true, sourcePlaylistId: true, targetPlaylistId: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function refreshOverlapSummary(userId: string, sourcePlaylistId: string, targetPlaylistId: string) {
  const overlap = await comparePlaylists(userId, sourcePlaylistId, targetPlaylistId);
  const [playlistAId, playlistBId] = [sourcePlaylistId, targetPlaylistId].sort();
  const data = {
    sharedTrackCount: overlap.sharedTrackCount,
    sharedTrackPercentage: overlap.sharedTrackPercentage,
    jaccardSimilarity: overlap.jaccardSimilarity,
    sharedArtistCount: overlap.sharedArtistCount,
    sharedArtistPercentage: overlap.sharedArtistPercentage,
    sharedAlbumCount: overlap.sharedAlbumCount,
    sharedAlbumPercentage: overlap.sharedAlbumPercentage,
    sharedCoreTrackCount: overlap.sharedCoreTrackCount,
    similarityScore: overlap.similarityScore,
    playlistASize: playlistAId === sourcePlaylistId ? overlap.sourceTrackCount : overlap.targetTrackCount,
    playlistBSize: playlistBId === targetPlaylistId ? overlap.targetTrackCount : overlap.sourceTrackCount,
    overlapPercentA: playlistAId === sourcePlaylistId ? overlap.overlapPercentOfSource : overlap.overlapPercentOfTarget,
    overlapPercentB: playlistBId === targetPlaylistId ? overlap.overlapPercentOfTarget : overlap.overlapPercentOfSource,
    uniquePercentA: playlistAId === sourcePlaylistId ? overlap.sourceUniqueTrackPercentage : overlap.targetUniqueTrackPercentage,
    uniquePercentB: playlistBId === targetPlaylistId ? overlap.targetUniqueTrackPercentage : overlap.sourceUniqueTrackPercentage,
    policySharedTrackCount: overlap.policySharedTrackCount,
    excessSharedTrackCount: overlap.excessSharedTrackCount,
    tracksFromSharedArtists: overlap.tracksFromSharedArtists,
    artistConcentrationScore: overlap.artistConcentrationScore,
    albumsDominatingCount: overlap.dominatingAlbumKeys.length,
    withinPolicy: overlap.withinPolicy,
    policySnapshotJson: overlap.policy,
    warningsJson: overlap.warnings,
    stale: false,
    calculatedAt: new Date(),
  };
  const summary = await prisma.playlistOverlapSummary.upsert({
    where: { playlistAId_playlistBId: { playlistAId, playlistBId } },
    create: { playlistAId, playlistBId, ...data },
    update: data,
  });
  return summary;
}

export const progressionChainInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  maximumAdjacentOverlapPercentage: z.coerce.number().min(0).max(100).default(15),
  maximumChainOverlapPercentage: z.coerce.number().min(0).max(100).default(20),
  members: z.array(z.object({
    playlistId: z.string().uuid(),
    targetMood: z.string().trim().max(80).optional().nullable(),
    minimumEnergy: z.coerce.number().min(0).max(1).optional().nullable(),
    maximumEnergy: z.coerce.number().min(0).max(1).optional().nullable(),
    minimumBpm: z.coerce.number().min(20).max(300).optional().nullable(),
    maximumBpm: z.coerce.number().min(20).max(300).optional().nullable(),
    recommendedDuration: z.coerce.number().int().min(1).max(1440).optional().nullable(),
    handoffBehavior: z.enum(["NONE", "SMOOTH", "SHARED_TRANSITION_TRACK"]).default("SMOOTH"),
  }).superRefine((member, context) => {
    if (member.minimumEnergy != null && member.maximumEnergy != null && member.minimumEnergy > member.maximumEnergy) context.addIssue({ code: z.ZodIssueCode.custom, message: "Minimum energy cannot exceed maximum energy." });
    if (member.minimumBpm != null && member.maximumBpm != null && member.minimumBpm > member.maximumBpm) context.addIssue({ code: z.ZodIssueCode.custom, message: "Minimum BPM cannot exceed maximum BPM." });
  })).min(2).max(25),
});

export async function listProgressionChains(userId: string) {
  return prisma.playlistProgressionChain.findMany({
    where: { userId },
    include: { members: { orderBy: { sequencePosition: "asc" }, include: { playlist: { select: { id: true, plexPlaylistTitle: true, trackCount: true } } } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function saveProgressionChain(userId: string, rawInput: unknown, chainId?: string) {
  const input = progressionChainInputSchema.parse(rawInput);
  const memberIds = input.members.map((member) => member.playlistId);
  if (new Set(memberIds).size !== memberIds.length) throw new Error("A playlist can appear only once in a progression chain.");
  const playlists = await ownedPlaylists(userId, memberIds);
  if (playlists.length !== memberIds.length) throw new Error("A progression playlist was not found or is not accessible.");
  const serverIds = new Set(playlists.map((playlist) => playlist.serverId).filter(Boolean));
  if (serverIds.size > 1) throw new Error("Progression playlists must use the same Plex server.");
  if (chainId) {
    const existing = await prisma.playlistProgressionChain.findFirst({ where: { id: chainId, userId } });
    if (!existing) throw new Error("Progression chain not found.");
  }
  return prisma.$transaction(async (tx) => {
    const chain = chainId
      ? await tx.playlistProgressionChain.update({ where: { id: chainId }, data: { name: input.name, maximumAdjacentOverlapPercentage: input.maximumAdjacentOverlapPercentage, maximumChainOverlapPercentage: input.maximumChainOverlapPercentage } })
      : await tx.playlistProgressionChain.create({ data: { userId, name: input.name, maximumAdjacentOverlapPercentage: input.maximumAdjacentOverlapPercentage, maximumChainOverlapPercentage: input.maximumChainOverlapPercentage } });
    await tx.playlistProgressionMember.deleteMany({ where: { chainId: chain.id } });
    await tx.playlistProgressionMember.createMany({ data: input.members.map((member, index) => ({ chainId: chain.id, sequencePosition: index + 1, ...member })) });
    for (const member of input.members) {
      await tx.playlistCoordinationSetting.upsert({ where: { playlistId: member.playlistId }, create: { playlistId: member.playlistId, coordinationEnabled: true }, update: { coordinationEnabled: true } });
    }
    return tx.playlistProgressionChain.findUnique({ where: { id: chain.id }, include: { members: { orderBy: { sequencePosition: "asc" }, include: { playlist: { select: { id: true, plexPlaylistTitle: true, trackCount: true } } } } } });
  });
}

export async function deleteProgressionChain(userId: string, chainId: string) {
  const result = await prisma.playlistProgressionChain.deleteMany({ where: { id: chainId, userId } });
  if (!result.count) throw new Error("Progression chain not found.");
  return { deleted: true };
}
