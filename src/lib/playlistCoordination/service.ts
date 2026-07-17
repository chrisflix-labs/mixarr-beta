import { z } from "zod";
import prisma from "../prisma";
import { calculatePlaylistOverlap, canonicalTrackKey, artistKey, albumKey } from "./overlap";
import { PLAYLIST_RELATIONSHIP_TYPES, type CoordinationScoringContext, type CoordinationSettings, type PlaylistTrackFact } from "./types";
import { aggregateHistoricalUsage } from "./usage";

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
  return settings ? { ...settings, excludedPlaylistIds: Array.isArray(settings.excludedPlaylistIdsJson) ? settings.excludedPlaylistIdsJson : [] } : { playlistId, ...defaultSettings, featuredArtistMatching: "PRIMARY_ONLY", excludedPlaylistIds: [] };
}

export async function updateCoordinationSettings(userId: string, playlistId: string, rawInput: unknown) {
  const input = coordinationSettingsSchema.parse(rawInput);
  const playlists = await ownedPlaylists(userId, [playlistId, ...input.excludedPlaylistIds]);
  if (playlists.length !== new Set([playlistId, ...input.excludedPlaylistIds]).size) throw new Error("An excluded playlist was not found or is not accessible.");
  const { excludedPlaylistIds, ...data } = input;
  return prisma.playlistCoordinationSetting.upsert({
    where: { playlistId },
    create: { playlistId, ...data, excludedPlaylistIdsJson: excludedPlaylistIds },
    update: { ...data, excludedPlaylistIdsJson: excludedPlaylistIds },
  });
}

async function loadPlaylistFacts(playlistIds: string[]) {
  if (!playlistIds.length) return new Map<string, PlaylistTrackFact[]>();
  const memberships = await prisma.generatedPlaylistTrack.findMany({
    where: { generatedPlaylistId: { in: playlistIds }, trackId: { not: null } },
    select: { generatedPlaylistId: true, trackId: true, plexTrackRatingKey: true, title: true, artist: true, album: true },
  });
  const trackIds = Array.from(new Set(memberships.map((row) => row.trackId).filter((id): id is string => Boolean(id))));
  const tracks: any[] = [];
  for (const batch of chunks(trackIds)) {
    tracks.push(...await prisma.track.findMany({
      where: { id: { in: batch }, syncStatus: "active", deletedAt: null, NOT: { localFileStatus: "missing" } },
      select: { id: true, ratingKey: true, title: true, normalizedTitle: true, artistId: true, albumId: true, canonicalRecordingId: true, artist: { select: { title: true } }, album: { select: { title: true } } },
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
      canonicalRecordingId: track.canonicalRecordingId,
    });
  }
  return result;
}

export async function comparePlaylists(userId: string, sourcePlaylistId: string, targetPlaylistId: string) {
  const playlists = await assertCompatiblePlaylists(userId, sourcePlaylistId, targetPlaylistId);
  const facts = await loadPlaylistFacts([sourcePlaylistId, targetPlaylistId]);
  const coreRows = await prisma.playlistSharedCoreTrack.findMany({
    where: { userId, playlistId: { in: [sourcePlaylistId, targetPlaylistId] } }, select: { trackId: true },
  });
  const coreFacts = await loadTrackFacts(coreRows.map((row) => row.trackId));
  const overlap = calculatePlaylistOverlap(facts.get(sourcePlaylistId) || [], facts.get(targetPlaylistId) || [], coreFacts.map(canonicalTrackKey));
  return { sourcePlaylist: playlists.find((item) => item.id === sourcePlaylistId), targetPlaylist: playlists.find((item) => item.id === targetPlaylistId), ...overlap };
}

async function loadTrackFacts(trackIds: string[]) {
  const result: PlaylistTrackFact[] = [];
  for (const batch of chunks(Array.from(new Set(trackIds)))) {
    const tracks = await prisma.track.findMany({ where: { id: { in: batch } }, include: { artist: { select: { title: true } }, album: { select: { title: true } } } });
    result.push(...tracks.map((track) => ({ trackId: track.id, ratingKey: track.ratingKey, title: track.title, normalizedTitle: track.normalizedTitle, artistId: track.artistId, artistName: track.artist.title, albumId: track.albumId, albumName: track.album.title, canonicalRecordingId: track.canonicalRecordingId })));
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
  const relatedPlaylistIds = Array.from(new Set(baseRelatedPlaylistIds.concat(chainMembers.map((member) => member.playlistId).filter((id) => id !== playlistId))));
  const excludedPlaylistIds = Array.from(new Set((stored.excludedPlaylistIds as string[]).filter((id) => id !== playlistId)));
  const authorizedRelated = await ownedPlaylists(userId, Array.from(new Set(relatedPlaylistIds.concat(excludedPlaylistIds))));
  if (authorizedRelated.length !== new Set(relatedPlaylistIds.concat(excludedPlaylistIds)).size) throw new Error("A related playlist was not found or is not accessible.");
  const relatedFacts = await loadPlaylistFacts(Array.from(new Set(relatedPlaylistIds.concat(excludedPlaylistIds))));
  const candidateFacts = await loadTrackFacts(candidateTrackIds);
  const candidateKeyById = new Map(candidateFacts.map((fact) => [fact.trackId, canonicalTrackKey(fact)]));
  const candidateKeys = new Set(candidateFacts.map(canonicalTrackKey));
  const globalRows: Array<{ trackId: string | null }> = [];
  const historicalRows: Array<{ trackId: string | null; occurredAt: Date }> = [];
  for (const batch of chunks(candidateTrackIds)) {
    globalRows.push(...await prisma.generatedPlaylistTrack.findMany({
      where: { trackId: { in: batch }, generatedPlaylist: { userId, ...(playlistId ? { NOT: { id: playlistId } } : {}) } }, select: { trackId: true },
    }));
    historicalRows.push(...await prisma.playlistMembershipEvent.findMany({
      where: { userId, trackId: { in: batch }, occurredAt: { gte: new Date(Date.now() - 365 * 86_400_000) } },
      select: { trackId: true, occurredAt: true },
    }));
  }
  const globalActiveUsage: Record<string, number> = {};
  for (const row of globalRows) increment(globalActiveUsage, candidateKeyById.get(row.trackId || "") || "");
  const globalHistoricalUsage = aggregateHistoricalUsage(historicalRows.map((row) => ({ trackKey: candidateKeyById.get(row.trackId || "") || "", occurredAt: row.occurredAt })).filter((row) => Boolean(row.trackKey)));
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
      maximumTracksPerArtistAcrossGroup: stored.maximumTracksPerArtistAcrossGroup,
      warnBeforeExceedingOverlap: stored.warnBeforeExceedingOverlap,
    },
    targetPlaylistSize,
    relatedPlaylistIds,
    excludedTrackKeys: Array.from(excludedTrackKeys),
    relatedTrackUsage,
    globalActiveUsage,
    globalHistoricalUsage,
    artistUsage,
    albumUsage,
    sharedCoreTrackKeys: coreFacts.map(canonicalTrackKey),
    maximumRelatedPlaylistSize: Math.max(1, ...relatedPlaylists.map((playlist) => playlist.trackCount)),
    ...(chainMembership ? { progression: { previousPlaylistId, nextPlaylistId, previousHandoffBpm, nextHandoffBpm } } : {}),
  };
}

export async function getCoordinationDashboard(userId: string) {
  const relationships = await prisma.playlistRelationship.findMany({
    where: { userId }, include: { sourcePlaylist: { select: { id: true, plexPlaylistTitle: true, updatedAt: true } }, targetPlaylist: { select: { id: true, plexPlaylistTitle: true, updatedAt: true } } }, orderBy: { updatedAt: "desc" },
  });
  const playlistIds = Array.from(new Set(relationships.flatMap((item) => [item.sourcePlaylistId, item.targetPlaylistId])));
  const cachedRows = playlistIds.length ? await prisma.playlistOverlapSummary.findMany({ where: { playlistAId: { in: playlistIds }, playlistBId: { in: playlistIds } } }) : [];
  const cachedByPair = new Map(cachedRows.map((row) => [`${row.playlistAId}:${row.playlistBId}`, row]));
  const pairs = await Promise.all(relationships.map(async (relationship) => {
    const [playlistAId, playlistBId] = [relationship.sourcePlaylistId, relationship.targetPlaylistId].sort();
    const cached = cachedByPair.get(`${playlistAId}:${playlistBId}`);
    const changedAt = Math.max(relationship.sourcePlaylist.updatedAt.getTime(), relationship.targetPlaylist.updatedAt.getTime());
    const overlap: any = cached && cached.calculatedAt.getTime() >= changedAt
      ? cached
      : await comparePlaylists(userId, relationship.sourcePlaylistId, relationship.targetPlaylistId);
    if (!cached || cached.calculatedAt.getTime() < changedAt) {
      await prisma.playlistOverlapSummary.upsert({
        where: { playlistAId_playlistBId: { playlistAId, playlistBId } },
        create: { playlistAId, playlistBId, sharedTrackCount: overlap.sharedTrackCount, sharedTrackPercentage: overlap.sharedTrackPercentage, jaccardSimilarity: overlap.jaccardSimilarity, sharedArtistCount: overlap.sharedArtistCount, sharedArtistPercentage: overlap.sharedArtistPercentage, sharedAlbumCount: overlap.sharedAlbumCount, sharedAlbumPercentage: overlap.sharedAlbumPercentage, sharedCoreTrackCount: overlap.sharedCoreTrackCount, similarityScore: overlap.similarityScore },
        update: { sharedTrackCount: overlap.sharedTrackCount, sharedTrackPercentage: overlap.sharedTrackPercentage, jaccardSimilarity: overlap.jaccardSimilarity, sharedArtistCount: overlap.sharedArtistCount, sharedArtistPercentage: overlap.sharedArtistPercentage, sharedAlbumCount: overlap.sharedAlbumCount, sharedAlbumPercentage: overlap.sharedAlbumPercentage, sharedCoreTrackCount: overlap.sharedCoreTrackCount, similarityScore: overlap.similarityScore, calculatedAt: new Date() },
      });
    }
    const limit = relationship.maximumSharedTrackPercentage ?? 20;
    const status = !relationship.coordinationEnabled ? "Coordination disabled" : overlap.sharedTrackPercentage > limit ? "Over limit" : overlap.sharedTrackPercentage >= limit * 0.8 ? "Near limit" : "Healthy";
    return { relationshipId: relationship.id, relationshipType: relationship.relationshipType, playlistA: relationship.sourcePlaylist, playlistB: relationship.targetPlaylist, limit, status, ...overlap };
  }));
  const [sharedCoreCount, progressionChainCount] = await Promise.all([
    prisma.playlistSharedCoreTrack.count({ where: { userId } }),
    prisma.playlistProgressionChain.count({ where: { userId } }),
  ]);
  const coordinatedPlaylistIds = new Set(relationships.flatMap((item) => [item.sourcePlaylistId, item.targetPlaylistId]));
  return {
    summary: {
      coordinatedPlaylists: coordinatedPlaylistIds.size,
      relationships: relationships.length,
      highOverlapPairs: pairs.filter((pair) => pair.status === "Over limit").length,
      duplicateTracks: pairs.reduce((sum, pair) => sum + pair.sharedTrackCount, 0),
      sharedCoreTracks: sharedCoreCount,
      progressionChains: progressionChainCount,
      overlapWarnings: pairs.filter((pair) => ["Over limit", "Near limit"].includes(pair.status)).length,
    },
    pairs,
  };
}

export async function setSharedCoreTracks(userId: string, playlistId: string, trackIds: string[], shared: boolean, relationshipId?: string | null) {
  if (!(await ownedPlaylists(userId, [playlistId])).length) throw new Error("Playlist not found.");
  const ownedTrackCount = await prisma.track.count({ where: { id: { in: Array.from(new Set(trackIds)) }, library: { server: { userId } } } });
  if (ownedTrackCount !== new Set(trackIds).size) throw new Error("One or more tracks were not found or are not accessible.");
  if (!shared) {
    await prisma.playlistSharedCoreTrack.deleteMany({ where: { userId, playlistId, trackId: { in: trackIds }, ...(relationshipId ? { relationshipId } : {}) } });
    await prisma.generatedPlaylist.update({ where: { id: playlistId }, data: { revisionCounter: { increment: 1 } } });
    return { updated: trackIds.length, shared: false };
  }
  const settings = await getCoordinationSettings(userId, playlistId);
  const currentCount = await prisma.playlistSharedCoreTrack.count({ where: { userId, playlistId } });
  if (settings.maximumSharedCoreTracks != null && currentCount + trackIds.length > settings.maximumSharedCoreTracks) throw new Error("The shared-core track limit would be exceeded.");
  await prisma.playlistSharedCoreTrack.createMany({ data: Array.from(new Set(trackIds)).map((trackId) => ({ userId, playlistId, trackId, relationshipId: relationshipId || null, scopeKey: relationshipId || "GLOBAL" })), skipDuplicates: true });
  await prisma.generatedPlaylist.update({ where: { id: playlistId }, data: { revisionCounter: { increment: 1 } } });
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
  return prisma.playlistOverlapSummary.upsert({
    where: { playlistAId_playlistBId: { playlistAId, playlistBId } },
    create: { playlistAId, playlistBId, sharedTrackCount: overlap.sharedTrackCount, sharedTrackPercentage: overlap.sharedTrackPercentage, jaccardSimilarity: overlap.jaccardSimilarity, sharedArtistCount: overlap.sharedArtistCount, sharedArtistPercentage: overlap.sharedArtistPercentage, sharedAlbumCount: overlap.sharedAlbumCount, sharedAlbumPercentage: overlap.sharedAlbumPercentage, sharedCoreTrackCount: overlap.sharedCoreTrackCount, similarityScore: overlap.similarityScore },
    update: { sharedTrackCount: overlap.sharedTrackCount, sharedTrackPercentage: overlap.sharedTrackPercentage, jaccardSimilarity: overlap.jaccardSimilarity, sharedArtistCount: overlap.sharedArtistCount, sharedArtistPercentage: overlap.sharedArtistPercentage, sharedAlbumCount: overlap.sharedAlbumCount, sharedAlbumPercentage: overlap.sharedAlbumPercentage, sharedCoreTrackCount: overlap.sharedCoreTrackCount, similarityScore: overlap.similarityScore, calculatedAt: new Date() },
  });
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
