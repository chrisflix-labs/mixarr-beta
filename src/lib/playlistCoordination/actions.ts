import { z } from "zod";
import prisma from "../prisma";
import { comparePlaylists, getCoordinationSettings, listPlaylistRelationships } from "./service";

export const moveTrackInputSchema = z.object({
  trackId: z.string().uuid(),
  targetPlaylistId: z.string().uuid(),
  mode: z.enum(["MOVE", "COPY"]).default("MOVE"),
  preserveSourceLength: z.boolean().default(true),
  confirm: z.boolean().optional(),
});

async function loadMoveState(userId: string, sourcePlaylistId: string, targetPlaylistId: string, trackId: string) {
  const [source, target, track, neverRecommend, blocked, relationship] = await Promise.all([
    prisma.generatedPlaylist.findFirst({ where: { id: sourcePlaylistId, userId }, include: { tracks: { orderBy: { position: "asc" } } } }),
    prisma.generatedPlaylist.findFirst({ where: { id: targetPlaylistId, userId }, include: { tracks: { orderBy: { position: "asc" } } } }),
    prisma.track.findFirst({ where: { id: trackId, library: { server: { userId } }, syncStatus: "active", deletedAt: null, NOT: { localFileStatus: "missing" } }, include: { artist: true, album: true, audioFeature: true } }),
    prisma.userTrackPreference.findFirst({ where: { userId, trackId, state: "NEVER_RECOMMEND" } }),
    prisma.blockedTrack.findFirst({ where: { userId, trackId } }),
    prisma.playlistRelationship.findFirst({ where: { userId, OR: [{ sourcePlaylistId, targetPlaylistId }, { sourcePlaylistId: targetPlaylistId, targetPlaylistId: sourcePlaylistId }] } }),
  ]);
  if (!source || !target) throw new Error("Source or target playlist not found.");
  if (source.id === target.id) throw new Error("Source and target playlists must be different.");
  if (!relationship) throw new Error("Track movement is available only between related playlists.");
  if (!track || neverRecommend || blocked) throw new Error("The track is unavailable or excluded by a hard recommendation rule.");
  const sourceMembership = source.tracks.find((item) => item.trackId === trackId);
  if (!sourceMembership) throw new Error("The source playlist does not contain this track.");
  if (source.serverId && target.serverId && source.serverId !== target.serverId) throw new Error("The playlists use incompatible Plex servers.");
  if (target.tracks.some((item) => item.trackId === trackId)) throw new Error("The target playlist already contains this track.");
  return { source, target, track, sourceMembership };
}

export async function previewMoveTrack(userId: string, sourcePlaylistId: string, rawInput: unknown) {
  const input = moveTrackInputSchema.parse(rawInput);
  const state = await loadMoveState(userId, sourcePlaylistId, input.targetPlaylistId, input.trackId);
  const [before, targetSettings] = await Promise.all([
    comparePlaylists(userId, sourcePlaylistId, input.targetPlaylistId),
    getCoordinationSettings(userId, input.targetPlaylistId),
  ]);
  const projectedSharedCount = input.mode === "MOVE" ? before.sharedTrackCount : before.sharedTrackCount + 1;
  const projectedDenominator = Math.max(1, Math.min(input.mode === "MOVE" ? state.source.trackCount - 1 : state.source.trackCount, state.target.trackCount + 1));
  const projectedOverlap = Math.round((projectedSharedCount / projectedDenominator) * 10_000) / 100;
  const violatesHardMaximum = targetSettings.coordinationEnabled && targetSettings.overlapEnforcement === "HARD_MAXIMUM" && projectedOverlap > targetSettings.maximumSharedTrackPercentage;
  const targetBpms = await prisma.track.findMany({ where: { id: { in: state.target.tracks.map((item) => item.trackId).filter((id): id is string => Boolean(id)) } }, select: { effectiveBpm: true, bpm: true, audioFeature: { select: { energy: true, effectiveEnergy: true } } } });
  const knownBpms = targetBpms.map((item) => item.effectiveBpm ?? item.bpm).filter((value): value is number => value != null);
  const averageBpm = knownBpms.length ? knownBpms.reduce((sum, value) => sum + value, 0) / knownBpms.length : null;
  const trackBpm = state.track.effectiveBpm ?? state.track.bpm;
  const bpmFit = averageBpm == null || trackBpm == null ? "Insufficient data" : Math.abs(averageBpm - trackBpm) <= 12 ? "Strong" : Math.abs(averageBpm - trackBpm) <= 25 ? "Good" : "Weak";
  const warnings = [
    ...(violatesHardMaximum ? [`Projected overlap ${projectedOverlap}% exceeds the ${targetSettings.maximumSharedTrackPercentage}% hard maximum.`] : []),
    ...(input.preserveSourceLength && input.mode === "MOVE" ? ["A compatible source replacement will be selected when the move is applied."] : []),
  ];
  return {
    action: input.mode,
    canApply: !violatesHardMaximum,
    requiresConfirmation: true,
    track: { id: state.track.id, title: state.track.title, artist: state.track.artist.title, album: state.track.album.title, bpm: trackBpm },
    source: { id: state.source.id, title: state.source.plexPlaylistTitle, trackCountBefore: state.source.trackCount, trackCountAfter: input.mode === "MOVE" && !input.preserveSourceLength ? state.source.trackCount - 1 : state.source.trackCount },
    target: { id: state.target.id, title: state.target.plexPlaylistTitle, trackCountBefore: state.target.trackCount, trackCountAfter: state.target.trackCount + 1, bpmFit },
    overlap: { before: before.sharedTrackPercentage, after: projectedOverlap, limit: targetSettings.maximumSharedTrackPercentage, enforcement: targetSettings.overlapEnforcement },
    warnings,
  };
}

function snapshotRows(playlistId: string, rows: any[]) {
  return rows.map((row, index) => ({
    generatedPlaylistId: playlistId,
    trackId: row.trackId,
    plexTrackRatingKey: row.plexTrackRatingKey,
    position: index + 1,
    title: row.title,
    artist: row.artist,
    album: row.album,
    locked: Boolean(row.locked),
    liked: Boolean(row.liked),
    regenerationExcluded: Boolean(row.regenerationExcluded),
    adaptiveScoreJson: row.adaptiveScoreJson,
    playbackScoreJson: row.playbackScoreJson,
    coordinationScoreJson: row.coordinationScoreJson,
  }));
}

async function replaceMemberships(tx: any, playlistId: string, rows: any[]) {
  await tx.generatedPlaylistTrack.deleteMany({ where: { generatedPlaylistId: playlistId } });
  if (rows.length) await tx.generatedPlaylistTrack.createMany({ data: snapshotRows(playlistId, rows) });
  await tx.generatedPlaylist.update({ where: { id: playlistId }, data: { trackCount: rows.length, lastRegeneratedAt: new Date(), revisionCounter: { increment: 1 } } });
}

export async function applyMoveTrack(userId: string, sourcePlaylistId: string, rawInput: unknown) {
  const input = moveTrackInputSchema.parse(rawInput);
  if (!input.confirm) throw new Error("Confirm the move preview before applying it.");
  const preview = await previewMoveTrack(userId, sourcePlaylistId, input);
  if (!preview.canApply) throw new Error(preview.warnings[0] || "The move violates a hard playlist rule.");
  const state = await loadMoveState(userId, sourcePlaylistId, input.targetPlaylistId, input.trackId);
  const originalSource: any[] = state.source.tracks.map((row) => ({ ...row }));
  const originalTarget: any[] = state.target.tracks.map((row) => ({ ...row }));
  const sourceRows: any[] = input.mode === "MOVE" ? originalSource.filter((row) => row.trackId !== input.trackId) : originalSource;
  const targetRows: any[] = originalTarget.concat({ ...state.sourceMembership, generatedPlaylistId: state.target.id, position: originalTarget.length + 1, locked: false });
  if (input.mode === "MOVE" && input.preserveSourceLength) {
    const { generatePlaylistTracksWithStats, playlistConfigSchema } = await import("../playlistService");
    const config = playlistConfigSchema.parse({ ...(state.source.filtersJson as any), limit: 1, pinnedTrackIds: [], excludedTrackIds: sourceRows.map((row) => row.trackId).filter(Boolean) });
    const replacement = await generatePlaylistTracksWithStats({ userId, config, personalizationPlaylistId: state.source.id });
    const candidate = replacement.tracks.find((item) => !targetRows.some((row) => row.trackId === item.id));
    if (!candidate) throw new Error("No compatible replacement could preserve the source playlist length.");
    sourceRows.push({ trackId: candidate.id, plexTrackRatingKey: candidate.ratingKey || candidate.plexId, title: candidate.title, artist: candidate.artist?.title, album: candidate.album?.title, locked: false, liked: false, regenerationExcluded: false, adaptiveScoreJson: candidate.adaptiveScore, playbackScoreJson: candidate.playbackScore, coordinationScoreJson: candidate.coordinationScore });
  }
  await prisma.$transaction(async (tx) => { await replaceMemberships(tx, state.source.id, sourceRows); await replaceMemberships(tx, state.target.id, targetRows); });
  const { syncGeneratedPlaylistToPlex } = await import("../playlistService");
  try {
    await syncGeneratedPlaylistToPlex(userId, state.source.id);
    await syncGeneratedPlaylistToPlex(userId, state.target.id);
  } catch (error) {
    await prisma.$transaction(async (tx) => { await replaceMemberships(tx, state.source.id, originalSource); await replaceMemberships(tx, state.target.id, originalTarget); });
    await Promise.allSettled([syncGeneratedPlaylistToPlex(userId, state.source.id), syncGeneratedPlaylistToPlex(userId, state.target.id)]);
    throw error;
  }
  return { applied: true, preview };
}

export const rebalanceInputSchema = z.object({ playlistIds: z.array(z.string().uuid()).min(2).max(25).optional(), confirm: z.boolean().optional(), changes: z.array(z.object({ playlistId: z.string().uuid(), removeTrackId: z.string().uuid(), addTrackId: z.string().uuid() })).max(100).optional() });

export async function previewPlaylistRebalance(userId: string, rawInput: unknown) {
  const input = rebalanceInputSchema.parse(rawInput);
  const allRelationships = input.playlistIds?.length
    ? (await Promise.all(input.playlistIds.map((id) => listPlaylistRelationships(userId, id)))).flat()
    : await prisma.playlistRelationship.findMany({ where: { userId, coordinationEnabled: true } });
  const unique = Array.from(new Map(allRelationships.map((item) => [item.id, item])).values());
  const pairs = await Promise.all(unique.map(async (relationship) => {
    const overlap = await comparePlaylists(userId, relationship.sourcePlaylistId, relationship.targetPlaylistId);
    const limit = relationship.maximumSharedTrackPercentage ?? 20;
    return { relationship, overlap, limit, needsRebalance: overlap.sharedTrackPercentage > limit };
  }));
  return { previewId: `rebalance-${Date.now()}`, requiresConfirmation: true, pairs, changes: input.changes || [], warnings: pairs.filter((pair) => pair.needsRebalance).length ? [] : ["No related playlist pair currently exceeds its configured track-overlap limit."] };
}

export async function applyPlaylistRebalance(userId: string, rawInput: unknown) {
  const input = rebalanceInputSchema.parse(rawInput);
  if (!input.confirm) throw new Error("Confirm the rebalance preview before applying it.");
  if (!input.changes?.length) return { applied: true, changesApplied: 0, message: "No selected rebalance changes required application." };
  const affected = Array.from(new Set(input.changes.map((change) => change.playlistId)));
  const playlists = await prisma.generatedPlaylist.findMany({ where: { userId, id: { in: affected } }, include: { tracks: { orderBy: { position: "asc" } } } });
  if (playlists.length !== affected.length) throw new Error("A rebalance playlist was not found or is not accessible.");
  await prisma.$transaction(async (tx) => {
    for (const playlist of playlists) {
      const changes = input.changes!.filter((change) => change.playlistId === playlist.id);
      const additions = await prisma.track.findMany({ where: { id: { in: changes.map((change) => change.addTrackId) }, library: { server: { userId } } }, include: { artist: true, album: true } });
      const additionById = new Map(additions.map((track) => [track.id, track]));
      const rows = playlist.tracks.map((row) => {
        const change = changes.find((item) => item.removeTrackId === row.trackId);
        if (!change) return row;
        if (row.locked) throw new Error(`Locked track ${row.title} cannot be removed by rebalance.`);
        const track = additionById.get(change.addTrackId);
        if (!track) throw new Error("A proposed replacement track is unavailable.");
        return { ...row, trackId: track.id, plexTrackRatingKey: track.ratingKey, title: track.title, artist: track.artist.title, album: track.album.title, locked: false, liked: false, regenerationExcluded: false };
      });
      await replaceMemberships(tx, playlist.id, rows);
    }
  });
  const { syncGeneratedPlaylistToPlex } = await import("../playlistService");
  await Promise.all(affected.map((playlistId) => syncGeneratedPlaylistToPlex(userId, playlistId)));
  return { applied: true, changesApplied: input.changes.length };
}
