import prisma from "../prisma";
import type { SmartActionCandidate, SmartActionProvider } from "./types";

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export const recentlyAddedProvider: SmartActionProvider = {
  id: "recently-added-matches",
  async generate(userId, options) {
    const matches = await prisma.recentlyAddedPlaylistMatch.findMany({
      where: {
        status: "pending",
        generatedPlaylist: { userId, ...(options?.playlistId ? { id: options.playlistId } : {}) },
        ...(options?.libraryId ? { track: { libraryId: options.libraryId } } : {}),
      },
      orderBy: [{ confidenceScore: "desc" }, { createdAt: "desc" }],
      take: Math.min(100, options?.limit || 50),
      include: {
        track: { include: { artist: { select: { title: true } }, album: { select: { title: true } } } },
        generatedPlaylist: { select: { id: true, plexPlaylistTitle: true, updatedAt: true, revisionCounter: true } },
      },
    });
    return matches.map((match): SmartActionCandidate => ({
      userId,
      libraryId: match.track.libraryId,
      playlistId: match.generatedPlaylistId,
      actionType: "TRACK_ADDITION",
      title: `Add “${match.track.title}” by ${match.track.artist.title} to ${match.generatedPlaylist.plexPlaylistTitle}`,
      summary: `A recently analyzed track strongly matches this playlist (${Math.round(match.compatibilityScore)} compatibility).`,
      explanation: `Mixarr matched ${match.track.title} by ${match.track.artist.title} from ${match.track.album.title} using playlist identity, metadata, and recent-library signals. The track is only appended after approval; existing and protected tracks remain unchanged.`,
      confidenceScore: Math.round(match.confidenceScore <= 1 ? match.confidenceScore * 100 : match.confidenceScore),
      priority: Math.round(match.compatibilityScore),
      sourceService: "recently-added",
      sourceVersion: "v2.1.0",
      actionPayload: { type: "TRACK_ADDITION", trackId: match.trackId, sourceMatchId: match.id, expectedPlaylistUpdatedAt: match.generatedPlaylist.updatedAt.toISOString(), expectedPlaylistRevision: match.generatedPlaylist.revisionCounter },
      previewPayload: {
        before: { trackCount: "Current playlist" }, after: { trackCount: "Current playlist + 1" },
        added: [{ id: match.trackId, title: match.track.title, artist: match.track.artist.title, reason: "Strong playlist compatibility" }],
        removed: [], reordered: [], unchanged: ["Existing track order", "Locked and protected tracks", "Playlist settings"], warnings: [],
      },
      expectedImpact: { playlistScoreBefore: null, playlistScoreAfter: null, tracksAdded: 1, tracksRemoved: 0, tracksReordered: 0, playlistsAffected: 1, protectedTracksChanged: 0, estimateNote: match.expectedScoreChange == null ? "Estimated outcome; the playlist will be revalidated before application." : `Estimated playlist score change: ${match.expectedScoreChange >= 0 ? "+" : ""}${match.expectedScoreChange}. Actual results can vary after revalidation.` },
      riskLevel: "LOW",
      deduplicationKey: `recent-add:${match.id}`,
      sourceFingerprint: `${match.createdAt.toISOString()}:${match.confidenceScore}`,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    }));
  },
};

export const metadataConflictProvider: SmartActionProvider = {
  id: "metadata-conflicts",
  async generate(userId, options) {
    const tracks = await prisma.track.findMany({
      where: {
        library: { server: { userId }, ...(options?.libraryId ? { id: options.libraryId } : {}) },
        syncStatus: "active", deletedAt: null, apiBpm: { not: null }, localBpm: { not: null },
        metadataCorrections: { none: { field: "bpm", isActive: true, isVerified: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(300, (options?.limit || 50) * 6),
      include: { artist: { select: { title: true } }, album: { select: { title: true } } },
    });
    const candidates: SmartActionCandidate[] = [];
    for (const track of tracks as any[]) {
      const local = finite(track.localBpm);
      const api = finite(track.apiBpm);
      if (!local || !api) continue;
      const gap = Math.abs(local - api);
      const halfDouble = Math.abs(local * 2 - api) <= 2 || Math.abs(api * 2 - local) <= 2;
      if (gap < 8 && !halfDouble) continue;
      const suggested = Math.round(local * 100) / 100;
      candidates.push({
        userId, libraryId: track.libraryId, actionType: "METADATA_CORRECTION",
        title: `Review BPM for “${track.title}” by ${track.artist.title}`,
        summary: `Local analysis reports ${suggested} BPM while the API reports ${Math.round(api * 100) / 100} BPM.`,
        explanation: `${track.title} by ${track.artist.title} from ${track.album.title} has BPM sources that conflict${halfDouble ? " in a likely half-time or double-time pattern" : " beyond the normal tolerance"}. Mixarr recommends the local audio analysis value. Any verified manual correction remains protected.`,
        confidenceScore: halfDouble ? 92 : Math.min(90, 70 + Math.round(gap / 4)), priority: halfDouble ? 90 : 70,
        sourceService: "metadata-corrections", sourceVersion: "v2.2.7",
        actionPayload: { type: "METADATA_CORRECTION", trackId: track.id, field: "bpm", currentValue: track.effectiveBpm ?? track.bpm ?? api, suggestedValue: suggested, source: "local audio analysis" },
        previewPayload: { before: { bpm: track.effectiveBpm ?? track.bpm ?? api }, after: { bpm: suggested }, added: [], removed: [], reordered: [], unchanged: ["Verified manual metadata", "Track file", "Playlist membership"], warnings: ["Playlist scores may change after the corrected value is re-evaluated."] },
        expectedImpact: { tracksAdded: 0, tracksRemoved: 0, tracksReordered: 0, playlistsAffected: 0, protectedTracksChanged: 0 },
        riskLevel: "MODERATE", deduplicationKey: `metadata:bpm:${track.id}`,
        sourceFingerprint: `${local}:${api}:${track.updatedAt?.toISOString?.() || "unknown"}`,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      });
      if (candidates.length >= (options?.limit || 50)) break;
    }
    return candidates;
  },
};

export const smartRefreshProvider: SmartActionProvider = {
  id: "smart-refresh",
  async generate(userId, options) {
    const evaluations = await prisma.smartRefreshEvaluation.findMany({
      where: { userId, shouldRefresh: true, status: "COMPLETED", previewId: { not: null }, ...(options?.playlistId ? { generatedPlaylistId: options.playlistId } : {}) },
      orderBy: { evaluatedAt: "desc" },
      take: Math.min(100, (options?.limit || 50) * 3),
      include: { generatedPlaylist: { select: { id: true, plexPlaylistTitle: true, updatedAt: true, revisionCounter: true, filtersJson: true } } },
    });
    const seen = new Set<string>();
    const candidates: SmartActionCandidate[] = [];
    for (const evaluation of evaluations) {
      if (seen.has(evaluation.generatedPlaylistId) || !evaluation.previewId) continue;
      const filters = evaluation.generatedPlaylist.filtersJson as Record<string, unknown> | null;
      if (options?.libraryId && filters?.libraryId !== options.libraryId) continue;
      seen.add(evaluation.generatedPlaylistId);
      const mode = evaluation.recommendation === "FULL_REGENERATION" ? "FULL" : evaluation.recommendation === "REFRESH_METADATA_AFFECTED_TRACKS" ? "AFFECTED_SECTIONS" : "WEAK_TRACKS";
      const reasons = Array.isArray(evaluation.reasonsJson) ? evaluation.reasonsJson as Array<{ detail?: string; label?: string }> : [];
      candidates.push({
        userId, libraryId: typeof filters?.libraryId === "string" ? filters.libraryId : null, playlistId: evaluation.generatedPlaylistId,
        actionType: "PLAYLIST_REFRESH", title: `Refresh ${evaluation.generatedPlaylist.plexPlaylistTitle}`,
        summary: `${evaluation.weakTrackCount} weak tracks and ${evaluation.compatibleNewTrackCount} compatible candidates were found.`,
        explanation: reasons.map((reason) => reason.detail || reason.label).filter(Boolean).join(" ") || "Smart Refresh found a bounded playlist improvement. The stored preview will be revalidated before execution.",
        confidenceScore: Math.round(evaluation.confidence <= 1 ? evaluation.confidence * 100 : evaluation.confidence), priority: Math.round(evaluation.estimatedImprovement || 0),
        sourceService: "smart-refresh", sourceVersion: "v2.2.4",
        actionPayload: { type: "PLAYLIST_REFRESH", evaluationId: evaluation.id, previewId: evaluation.previewId, mode, expectedPlaylistUpdatedAt: evaluation.playlistUpdatedAt.toISOString(), expectedPlaylistRevision: evaluation.generatedPlaylist.revisionCounter },
        previewPayload: { before: { playlistScore: evaluation.currentScore }, after: { playlistScore: evaluation.estimatedScoreAfterRefresh }, added: [], removed: [], reordered: [], unchanged: ["Locked tracks", "Protected tracks", "Playlist identity safeguards"], warnings: mode === "FULL" ? ["Full regeneration requires individual review and confirmation."] : [] },
        expectedImpact: { playlistScoreBefore: evaluation.currentScore, playlistScoreAfter: evaluation.estimatedScoreAfterRefresh, tracksAdded: evaluation.compatibleNewTrackCount, tracksRemoved: evaluation.weakTrackCount, tracksReordered: 0, playlistsAffected: 1, protectedTracksChanged: 0 },
        riskLevel: mode === "FULL" ? "HIGH" : "MODERATE", deduplicationKey: `smart-refresh:${evaluation.generatedPlaylistId}`,
        sourceFingerprint: `${evaluation.id}:${evaluation.playlistUpdatedAt.toISOString()}`, expiresAt: new Date(Date.now() + 14 * 86_400_000),
      });
      if (candidates.length >= (options?.limit || 50)) break;
    }
    return candidates;
  },
};

export const defaultSmartActionProviders: SmartActionProvider[] = [recentlyAddedProvider, metadataConflictProvider, smartRefreshProvider];
