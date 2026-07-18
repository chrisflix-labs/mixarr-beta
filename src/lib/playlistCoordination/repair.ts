import { createHash } from "crypto";
import { z } from "zod";
import prisma from "../prisma";
import { createPlaylistVersionInTransaction } from "../playlists/versions/playlist-version-service";
import { albumKey, artistKey, calculatePlaylistOverlap, canonicalTrackKey } from "./overlap";
import { comparePlaylists, loadPlaylistFacts, refreshOverlapSummary } from "./service";
import type { PlaylistTrackFact } from "./types";

const repairPreviewSchema = z.object({
  playlistId: z.string().uuid(),
  comparisonPlaylistId: z.string().uuid().optional().nullable(),
  mode: z.enum(["TRACK", "ARTIST", "ALBUM", "ALL"]).default("ALL"),
  maximumReplacements: z.coerce.number().int().min(1).max(100).optional(),
});

const repairApplySchema = z.object({
  previewId: z.string().uuid(),
  proposalIds: z.array(z.string()).max(100).optional(),
  replacementSelections: z.record(z.string()).optional(),
  confirm: z.literal(true),
});

function playlistContentHash(rows: Array<{ trackId: string | null; position: number; locked: boolean; liked: boolean; updatedAt?: Date }>) {
  return createHash("sha256").update(rows.map((row) => `${row.position}:${row.trackId || "missing"}:${row.locked ? 1 : 0}:${row.liked ? 1 : 0}`).join("|")).digest("hex");
}

function numericScore(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  const source = value as Record<string, unknown>;
  for (const key of ["finalScore", "personalizedScore", "score", "totalAdjustment"]) {
    const number = Number(source[key]);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function factFromCandidate(track: any): PlaylistTrackFact {
  return {
    trackId: track.id,
    ratingKey: track.ratingKey || track.plexId,
    title: track.title,
    normalizedTitle: track.normalizedTitle,
    artistId: track.artistId,
    artistName: track.artist?.title,
    albumId: track.albumId,
    albumName: track.album?.title,
    albumArtistName: track.album?.artist?.title,
    canonicalRecordingId: track.canonicalRecordingId,
  };
}

async function resolveComparisonPlaylist(userId: string, playlistId: string, requested?: string | null) {
  if (requested) return requested;
  const highest = await prisma.playlistOverlapSummary.findFirst({
    where: { OR: [{ playlistAId: playlistId }, { playlistBId: playlistId }], withinPolicy: false },
    orderBy: [{ excessSharedTrackCount: "desc" }, { sharedTrackPercentage: "desc" }],
    select: { playlistAId: true, playlistBId: true },
  });
  const comparisonPlaylistId = highest ? (highest.playlistAId === playlistId ? highest.playlistBId : highest.playlistAId) : null;
  if (!comparisonPlaylistId) throw new Error("No analyzed playlist pair above policy is available. Run overlap analysis or choose a comparison playlist.");
  const owned = await prisma.generatedPlaylist.count({ where: { userId, id: comparisonPlaylistId } });
  if (!owned) throw new Error("Comparison playlist not found.");
  return comparisonPlaylistId;
}

export async function previewOverlapRepair(userId: string, rawInput: unknown) {
  const input = repairPreviewSchema.parse(rawInput);
  const comparisonPlaylistId = await resolveComparisonPlaylist(userId, input.playlistId, input.comparisonPlaylistId);
  const [playlist, comparison, before, facts] = await Promise.all([
    prisma.generatedPlaylist.findFirst({
      where: { id: input.playlistId, userId },
      include: { tracks: { orderBy: { position: "asc" } }, identity: { include: { trackMemories: { where: { manualAddCount: { gt: 0 } }, select: { trackId: true } } } } },
    }),
    prisma.generatedPlaylist.findFirst({ where: { id: comparisonPlaylistId, userId }, include: { tracks: { orderBy: { position: "asc" } } } }),
    comparePlaylists(userId, input.playlistId, comparisonPlaylistId),
    loadPlaylistFacts([input.playlistId, comparisonPlaylistId]),
  ]);
  if (!playlist || !comparison) throw new Error("Playlist not found or not accessible.");
  const designations = await prisma.playlistTrackDesignation.findMany({ where: { userId, playlistId: input.playlistId }, select: { trackId: true, isCore: true, isSharedAllowed: true } });
  const coreIds = new Set(designations.filter((item) => item.isCore).map((item) => item.trackId));
  const allowedIds = new Set(designations.filter((item) => item.isSharedAllowed).map((item) => item.trackId));
  const manualIds = new Set(playlist.identity?.trackMemories.map((item) => item.trackId) || []);
  const sharedIds = new Set((before.sharedTracks as Array<{ trackId?: string | null }>).map((item) => item.trackId).filter((id): id is string => Boolean(id)));
  const sharedArtistKeys = new Set(before.sharedArtistKeys);
  const sharedAlbumKeys = new Set(before.sharedAlbumKeys);
  const sourceFactsByTrackId = new Map((facts.get(playlist.id) || []).filter((fact) => fact.trackId).map((fact) => [fact.trackId as string, fact]));
  const contributesToSelectedMode = (trackId: string | null) => {
    if (!trackId) return false;
    const fact = sourceFactsByTrackId.get(trackId);
    const sharedTrack = sharedIds.has(trackId);
    const sharedArtist = Boolean(fact && sharedArtistKeys.has(artistKey(fact)));
    const sharedAlbum = Boolean(fact && sharedAlbumKeys.has(albumKey(fact)));
    if (input.mode === "TRACK") return sharedTrack;
    if (input.mode === "ARTIST") return sharedArtist;
    if (input.mode === "ALBUM") return sharedAlbum;
    return sharedTrack || sharedArtist || sharedAlbum;
  };
  const desired = Math.min(input.maximumReplacements || 100, Math.max(
    input.mode === "TRACK" ? before.excessSharedTrackCount : 0,
    input.mode === "ARTIST" ? (before.sharedArtistPercentage > before.policy.maximumArtistOverlapPercent ? Math.ceil(before.tracksFromSharedArtists / 4) : 0) : 0,
    input.mode === "ALBUM" ? before.dominatingAlbumKeys.length : 0,
    input.mode === "ALL" ? Math.max(before.excessSharedTrackCount, before.dominatingAlbumKeys.length, before.excessiveArtistKeys.length) : 0,
  ));
  const removable = playlist.tracks
    .filter((row) => row.trackId && contributesToSelectedMode(row.trackId) && !row.locked && !row.automationProtected && !row.liked && !coreIds.has(row.trackId) && !manualIds.has(row.trackId) && !allowedIds.has(row.trackId))
    .sort((left, right) => numericScore(left.adaptiveScoreJson) - numericScore(right.adaptiveScoreJson) || left.position - right.position)
    .slice(0, desired);
  const protectedShared = playlist.tracks.filter((row) => row.trackId && contributesToSelectedMode(row.trackId) && !removable.some((item) => item.id === row.id));
  const relaxedConstraints: string[] = [];
  if (desired > removable.length) relaxedConstraints.push(`${desired - removable.length} additional replacement${desired - removable.length === 1 ? " was" : "s were"} not proposed because matching tracks are locked, core, liked, manually added, protected, or explicitly allowed.`);

  let candidates: any[] = [];
  if (removable.length) {
    const { generatePlaylistTracksWithStats, playlistConfigSchema } = await import("../playlistService");
    const excludedTrackIds = Array.from(new Set(playlist.tracks.concat(comparison.tracks).map((row) => row.trackId).filter((id): id is string => Boolean(id))));
    const config = playlistConfigSchema.parse({
      ...(playlist.filtersJson as any),
      limit: Math.min(200, Math.max(25, removable.length * 8)),
      pinnedTrackIds: playlist.tracks.filter((row) => row.locked || row.liked || coreIds.has(row.trackId || "")).map((row) => row.trackId).filter(Boolean),
      excludedTrackIds,
    });
    const generated = await generatePlaylistTracksWithStats({ userId, config, personalizationPlaylistId: playlist.id });
    candidates = generated.tracks;
  }
  const targetKeys = new Set((facts.get(comparison.id) || []).map(canonicalTrackKey));
  const usedCandidateKeys = new Set<string>();
  const proposals = removable.flatMap((remove, index) => {
    const eligibleCandidates = candidates.filter((candidate) => {
      const key = canonicalTrackKey(factFromCandidate(candidate));
      return key && !targetKeys.has(key) && !usedCandidateKeys.has(key);
    });
    const replacement = eligibleCandidates[0];
    if (!replacement) return [];
    const replacementFact = factFromCandidate(replacement);
    usedCandidateKeys.add(canonicalTrackKey(replacementFact));
    const originalScore = numericScore(remove.adaptiveScoreJson);
    const replacementScore = Number(replacement.score || 0);
    return [{
      id: `proposal-${index + 1}`,
      position: remove.position,
      remove: { trackId: remove.trackId, title: remove.title, artist: remove.artist, album: remove.album, score: originalScore, locked: false, core: false, manuallyAdded: false },
      replacement: { trackId: replacement.id, title: replacement.title, artist: replacement.artist?.title, album: replacement.album?.title, score: replacementScore, ratingKey: replacement.ratingKey || replacement.plexId, fact: replacementFact },
      alternatives: eligibleCandidates.slice(1, 4).map((candidate) => ({
        trackId: candidate.id,
        title: candidate.title,
        artist: candidate.artist?.title,
        album: candidate.album?.title,
        score: Number(candidate.score || 0),
        ratingKey: candidate.ratingKey || candidate.plexId,
        fact: factFromCandidate(candidate),
      })),
      reasons: {
        remove: `Contributes to unhealthy ${input.mode.toLowerCase()} overlap and is the weakest eligible track at this position.`,
        replacement: "Matches the saved Smart Mix filters, is unused in the comparison playlist, and improves cross-playlist variety.",
      },
      impact: {
        score: Math.round((replacementScore - originalScore) * 100) / 100,
        mood: "Preserved by Smart Mix eligibility and scoring",
        bpmFlow: "Re-evaluated by the Smart Mix transition scorer",
        energyFlow: "Preserved by saved energy targets",
        artistVariety: "Improved when the replacement artist is not shared",
        albumVariety: "Improved when the replacement album is not shared",
      },
    }];
  });
  if (proposals.length < removable.length) relaxedConstraints.push(`${removable.length - proposals.length} removable track${removable.length - proposals.length === 1 ? " had" : "s had"} no unused eligible replacement. Playlist quality constraints were not silently relaxed.`);
  const replacementById = new Map(proposals.map((proposal) => [proposal.remove.trackId, proposal.replacement.fact]));
  const nextFacts = (facts.get(playlist.id) || []).map((fact) => replacementById.get(fact.trackId || "") || fact);
  const coreKeys = (facts.get(playlist.id) || []).filter((fact) => fact.trackId && coreIds.has(fact.trackId)).map(canonicalTrackKey);
  const allowedKeys = (facts.get(playlist.id) || []).filter((fact) => fact.trackId && allowedIds.has(fact.trackId)).map(canonicalTrackKey);
  const after = calculatePlaylistOverlap(nextFacts, facts.get(comparison.id) || [], coreKeys, { ...before.policy, coreTrackKeys: coreKeys, allowedSharedTrackKeys: allowedKeys });
  const preview = await prisma.playlistRepairPreview.create({
    data: {
      userId,
      playlistId: playlist.id,
      comparisonPlaylistId: comparison.id,
      mode: input.mode,
      playlistRevision: playlist.revisionCounter,
      playlistContentHash: playlistContentHash(playlist.tracks),
      policySnapshotJson: before.policy,
      overlapBeforeJson: { track: before.sharedTrackPercentage, artist: before.sharedArtistPercentage, album: before.sharedAlbumPercentage, unique: before.sourceUniqueTrackPercentage, excessTracks: before.excessSharedTrackCount },
      overlapAfterJson: { track: after.sharedTrackPercentage, artist: after.sharedArtistPercentage, album: after.sharedAlbumPercentage, unique: after.sourceUniqueTrackPercentage, excessTracks: after.excessSharedTrackCount },
      proposalsJson: proposals,
      relaxedConstraintsJson: relaxedConstraints,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  console.info(`[OverlapRepair] Preview userId=${userId} playlistId=${playlist.id} comparisonPlaylistId=${comparison.id} replacements=${proposals.length} durationPolicy=${before.policy.maximumTrackOverlapPercent}`);
  return {
    previewId: preview.id,
    status: preview.status,
    expiresAt: preview.expiresAt,
    requiresConfirmation: true,
    playlist: { id: playlist.id, title: playlist.plexPlaylistTitle, revision: playlist.revisionCounter },
    comparisonPlaylist: { id: comparison.id, title: comparison.plexPlaylistTitle },
    policy: before.policy,
    before: preview.overlapBeforeJson,
    after: preview.overlapAfterJson,
    proposals,
    protectedSharedTracks: protectedShared.map((row) => ({ trackId: row.trackId, title: row.title, reason: row.locked ? "Locked" : coreIds.has(row.trackId || "") ? "Core track" : row.liked ? "Liked track" : manualIds.has(row.trackId || "") ? "Manually added" : row.automationProtected ? "Automation protected" : "Shared track allowed" })),
    relaxedConstraints,
    noChangesApplied: true,
  };
}

function replacementMembership(playlistId: string, original: any, proposal: any) {
  return {
    generatedPlaylistId: playlistId,
    trackId: proposal.replacement.trackId,
    plexTrackRatingKey: proposal.replacement.ratingKey,
    position: original.position,
    title: proposal.replacement.title,
    artist: proposal.replacement.artist,
    album: proposal.replacement.album,
    locked: false,
    liked: false,
    regenerationExcluded: false,
    automationProtected: false,
    protectionReason: null,
    adaptiveScoreJson: { finalScore: proposal.replacement.score },
    coordinationScoreJson: { reason: proposal.reasons.replacement },
  };
}

export async function applyOverlapRepair(userId: string, rawInput: unknown) {
  const input = repairApplySchema.parse(rawInput);
  const preview = await prisma.playlistRepairPreview.findFirst({ where: { id: input.previewId, userId }, include: { playlist: { include: { tracks: { orderBy: { position: "asc" } } } }, comparisonPlaylist: true } });
  if (!preview) throw new Error("Repair preview not found.");
  if (preview.status !== "READY") throw new Error("This repair preview is no longer available to apply.");
  if (preview.expiresAt <= new Date()) throw new Error("This repair preview expired. Recalculate suggestions before applying changes.");
  if (preview.playlist.revisionCounter !== preview.playlistRevision || playlistContentHash(preview.playlist.tracks) !== preview.playlistContentHash) throw new Error("The playlist changed after this preview was generated. Recalculate suggestions before applying it.");
  const allProposals = Array.isArray(preview.proposalsJson) ? preview.proposalsJson as any[] : [];
  const selectedIds = input.proposalIds ? new Set(input.proposalIds) : null;
  const proposals = allProposals
    .filter((proposal) => !selectedIds || selectedIds.has(proposal.id))
    .map((proposal) => {
      const selectedTrackId = input.replacementSelections?.[proposal.id];
      if (!selectedTrackId || selectedTrackId === proposal.replacement.trackId) return proposal;
      const alternative = Array.isArray(proposal.alternatives) ? proposal.alternatives.find((item: any) => item.trackId === selectedTrackId) : null;
      if (!alternative) throw new Error("A selected alternate replacement is not part of this preview. Recalculate suggestions.");
      return { ...proposal, replacement: alternative };
    });
  if (!proposals.length) throw new Error("Select at least one replacement to apply.");
  const replacementTrackIds = proposals.map((proposal) => proposal.replacement.trackId);
  if (new Set(replacementTrackIds).size !== replacementTrackIds.length) throw new Error("Each selected replacement must be unique.");
  const currentByTrack = new Map(preview.playlist.tracks.map((row) => [row.trackId, row]));
  const core = await prisma.playlistTrackDesignation.findMany({ where: { userId, playlistId: preview.playlistId, isCore: true, trackId: { in: proposals.map((proposal) => proposal.remove.trackId) } }, select: { trackId: true } });
  if (core.length) throw new Error("A proposed removal was marked as core after preview generation. Recalculate suggestions.");
  for (const proposal of proposals) {
    const row = currentByTrack.get(proposal.remove.trackId);
    if (!row || row.locked || row.liked || row.automationProtected) throw new Error("A proposed removal is no longer eligible. Recalculate suggestions.");
  }
  const originalRows = preview.playlist.tracks.map((row) => ({ ...row }));
  const proposalByTrack = new Map(proposals.map((proposal) => [proposal.remove.trackId, proposal]));
  const nextRows = originalRows.map((row) => proposalByTrack.has(row.trackId) ? replacementMembership(preview.playlistId, row, proposalByTrack.get(row.trackId)) : row);
  const before = preview.overlapBeforeJson as any;
  const after = preview.overlapAfterJson as any;
  const version = await prisma.$transaction(async (tx) => {
    const fresh = await tx.generatedPlaylist.findUnique({ where: { id: preview.playlistId }, select: { revisionCounter: true } });
    if (!fresh || fresh.revisionCounter !== preview.playlistRevision) throw new Error("The playlist changed after this preview was generated. Recalculate suggestions before applying it.");
    const createdVersion = await createPlaylistVersionInTransaction(tx, {
      generatedPlaylistId: preview.playlistId,
      reason: "cross_playlist_overlap_repair",
      label: "Cross-playlist overlap repair",
      description: `Reduced overlap with ${preview.comparisonPlaylist?.plexPlaylistTitle || "managed playlists"} from ${before.track}% toward ${after.track}%; ${proposals.length} track${proposals.length === 1 ? "" : "s"} replaced.`,
      force: true,
      isAutomatic: false,
    });
    await tx.generatedPlaylistTrack.deleteMany({ where: { generatedPlaylistId: preview.playlistId } });
    await tx.generatedPlaylistTrack.createMany({ data: nextRows.map((row: any, index) => ({
      generatedPlaylistId: preview.playlistId, trackId: row.trackId, plexTrackRatingKey: row.plexTrackRatingKey, position: index + 1,
      title: row.title, artist: row.artist, album: row.album, locked: Boolean(row.locked), liked: Boolean(row.liked),
      regenerationExcluded: Boolean(row.regenerationExcluded), automationProtected: Boolean(row.automationProtected), protectionReason: row.protectionReason,
      adaptiveScoreJson: row.adaptiveScoreJson, playbackScoreJson: row.playbackScoreJson, coordinationScoreJson: row.coordinationScoreJson, explanationJson: row.explanationJson,
    })) });
    await tx.generatedPlaylist.update({ where: { id: preview.playlistId }, data: { trackCount: nextRows.length, lastRegeneratedAt: new Date(), revisionCounter: { increment: 1 } } });
    await tx.playlistRepairPreview.update({ where: { id: preview.id }, data: { status: "APPLIED", appliedAt: new Date() } });
    await tx.playlistOverlapSummary.updateMany({ where: { OR: [{ playlistAId: preview.playlistId }, { playlistBId: preview.playlistId }] }, data: { stale: true } });
    await tx.playlistCoordinationSetting.updateMany({ where: { playlistId: preview.playlistId }, data: { analysisStale: true } });
    await tx.playlistHistoryEntry.create({ data: {
      userId, generatedPlaylistId: preview.playlistId, playlistName: preview.playlist.plexPlaylistTitle, eventType: "cross_playlist_overlap_repair", sourceType: preview.playlist.sourceType,
      engineVersion: "v2.2.2", trackCount: nextRows.length, previousTrackCount: originalRows.length, replacedCount: proposals.length,
      warningsJson: { policy: preview.policySnapshotJson, relaxedConstraints: preview.relaxedConstraintsJson },
      summary: `Cross-playlist overlap repair reduced overlap with ${preview.comparisonPlaylist?.plexPlaylistTitle || "managed playlists"} from ${before.track}% toward ${after.track}%.`,
    } });
    return createdVersion;
  });
  const { syncGeneratedPlaylistToPlex } = await import("../playlistService");
  try {
    await syncGeneratedPlaylistToPlex(userId, preview.playlistId);
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await tx.generatedPlaylistTrack.deleteMany({ where: { generatedPlaylistId: preview.playlistId } });
      await tx.generatedPlaylistTrack.createMany({ data: originalRows.map((row, index) => ({
        generatedPlaylistId: preview.playlistId, trackId: row.trackId, plexTrackRatingKey: row.plexTrackRatingKey, position: index + 1, title: row.title, artist: row.artist, album: row.album,
        locked: row.locked, liked: row.liked, regenerationExcluded: row.regenerationExcluded, automationProtected: row.automationProtected, protectionReason: row.protectionReason,
        adaptiveScoreJson: row.adaptiveScoreJson, playbackScoreJson: row.playbackScoreJson, coordinationScoreJson: row.coordinationScoreJson, explanationJson: row.explanationJson,
      })) as any });
      await tx.generatedPlaylist.update({ where: { id: preview.playlistId }, data: { trackCount: originalRows.length, revisionCounter: { increment: 1 } } });
      await tx.playlistRepairPreview.update({ where: { id: preview.id }, data: { status: "SYNC_FAILED" } });
    });
    await syncGeneratedPlaylistToPlex(userId, preview.playlistId).catch(() => undefined);
    throw error;
  }
  if (preview.comparisonPlaylistId) await refreshOverlapSummary(userId, preview.playlistId, preview.comparisonPlaylistId);
  console.info(`[OverlapRepair] Applied playlistId=${preview.playlistId} comparisonPlaylistId=${preview.comparisonPlaylistId || "all"} replacements=${proposals.length} overlapBefore=${before.track} overlapAfter=${after.track}`);
  return { applied: true, previewId: preview.id, replacementsApplied: proposals.length, versionId: version.id, overlapBefore: before, overlapAfter: after };
}

export async function getRepairPreview(userId: string, previewId: string) {
  const preview = await prisma.playlistRepairPreview.findFirst({ where: { id: previewId, userId }, include: { playlist: { select: { id: true, plexPlaylistTitle: true } }, comparisonPlaylist: { select: { id: true, plexPlaylistTitle: true } } } });
  if (!preview) return null;
  return { ...preview, proposals: preview.proposalsJson, policy: preview.policySnapshotJson, before: preview.overlapBeforeJson, after: preview.overlapAfterJson, relaxedConstraints: preview.relaxedConstraintsJson };
}
