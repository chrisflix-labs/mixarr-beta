import { scorePlaylist } from "../../../playlistScoring";
import { durationWithinTolerance, trackMetrics } from "./curvePreservation";
import type { PlaylistRegenerationRequest, RegenerationPreview, RegenerationPreviewChange, RegenerationTrack, TrackWeaknessAnalysis } from "./types";

export function buildRegenerationPreview({
  playlistId,
  originalTracks,
  proposedTracks,
  changes,
  weakness,
  request,
  tuningConfig,
  warnings = [],
}: {
  playlistId: string;
  originalTracks: RegenerationTrack[];
  proposedTracks: RegenerationTrack[];
  changes: RegenerationPreviewChange[];
  weakness: TrackWeaknessAnalysis[];
  request: PlaylistRegenerationRequest;
  tuningConfig?: unknown;
  warnings?: string[];
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
  };
}

