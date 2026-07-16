import { scorePlaylist } from "../../../playlistScoring";
import { durationWithinTolerance, trackMetrics } from "./curvePreservation";
import type { PlaylistRegenerationRequest, RegenerationPreview, RegenerationPreviewChange, RegenerationTrack, TrackWeaknessAnalysis } from "./types";
import type { PlaylistIdentityScoringContext } from "../../../playlistIdentity/types";
import { scorePlaylistIdentityTrack } from "../../../playlistIdentity/scoring";

export function buildRegenerationPreview({
  playlistId,
  originalTracks,
  proposedTracks,
  changes,
  weakness,
  request,
  tuningConfig,
  warnings = [],
  identity,
}: {
  playlistId: string;
  originalTracks: RegenerationTrack[];
  proposedTracks: RegenerationTrack[];
  changes: RegenerationPreviewChange[];
  weakness: TrackWeaknessAnalysis[];
  request: PlaylistRegenerationRequest;
  tuningConfig?: unknown;
  warnings?: string[];
  identity?: PlaylistIdentityScoringContext;
}): RegenerationPreview {
  const originalScore = scorePlaylist(originalTracks, tuningConfig);
  const proposedScore = scorePlaylist(proposedTracks, tuningConfig);
  const originalDurationMs = originalTracks.reduce((sum, track) => sum + trackMetrics(track).durationMs, 0);
  const proposedDurationMs = proposedTracks.reduce((sum, track) => sum + trackMetrics(track).durationMs, 0);
  const previewWarnings = [...warnings];
  if (request.preserveLength && originalTracks.length !== proposedTracks.length) {
    previewWarnings.push("Playlist length could not be preserved exactly.");
  }
  if (!durationWithinTolerance(originalDurationMs, proposedDurationMs, request.durationTolerance)) {
    previewWarnings.push(`Track count remains ${proposedTracks.length}. Estimated duration changes by ${Math.round((proposedDurationMs - originalDurationMs) / 60000)} minutes.`);
  }
  if (changes.length === 0) {
    previewWarnings.push("No replacement improved a position enough to justify a change.");
  }
  const originalIdentity = identity ? originalTracks.reduce((sum, track) => sum + scorePlaylistIdentityTrack(track, identity).matchScore, 0) / Math.max(1, originalTracks.length) : 50;
  const proposedIdentity = identity ? proposedTracks.reduce((sum, track) => sum + scorePlaylistIdentityTrack(track, identity).matchScore, 0) / Math.max(1, proposedTracks.length) : 50;
  const identityDelta = proposedIdentity - originalIdentity;
  const identityImpact = {
    level: (Math.abs(identityDelta) < 6 ? "Low" : Math.abs(identityDelta) < 14 ? "Medium" : "High") as "Low" | "Medium" | "High",
    summary: [
      identityDelta >= -4 ? "Core playlist character preserved" : "Playlist character may shift",
      identity?.profile.bpmRange ? "Preferred BPM range considered" : "BPM identity has insufficient data",
      `${changes.filter((change) => change.identityReasons?.length).length} replacement${changes.filter((change) => change.identityReasons?.length).length === 1 ? "" : "s"} include identity evidence`,
      "No locked tracks removed",
    ],
    lockedTracksRemoved: 0,
  };
  return {
    previewId: "",
    playlistId,
    mode: request.mode,
    originalPlaylistScore: originalScore.overallScore,
    proposedPlaylistScore: proposedScore.overallScore,
    estimatedImprovement: proposedScore.overallScore - originalScore.overallScore,
    originalDurationMs,
    proposedDurationMs,
    changes,
    warnings: previewWarnings.filter((warning, index, list) => list.indexOf(warning) === index),
    createdAt: new Date(),
    analyzedTrackCount: originalTracks.length,
    finalTrackIds: proposedTracks.map((track) => track.id),
    weakness,
    identityImpact,
  };
}
