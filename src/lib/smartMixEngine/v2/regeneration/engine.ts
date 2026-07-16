import { analyzePlaylistWeakness } from "./analyzer";
import { rankReplacementCandidates } from "./candidateScorer";
import { selectablePositions, trackMetrics } from "./curvePreservation";
import { buildRegenerationPreview } from "./preview";
import { REPLACEMENT_THRESHOLDS, type PlaylistRegenerationRequest, type PlaylistTrackState, type RegenerationPreviewChange, type RegenerationTrack } from "./types";
import type { PlaylistIdentityScoringContext } from "../../../playlistIdentity/types";

function targetIndexes({
  tracks,
  states,
  request,
  weakness,
}: {
  tracks: RegenerationTrack[];
  states: PlaylistTrackState[];
  request: PlaylistRegenerationRequest;
  weakness: ReturnType<typeof analyzePlaylistWeakness>;
}) {
  const selection = selectablePositions({ tracks, states, section: request.targetSection, targetTrackIds: request.targetTrackIds });
  const allowed = selection.filter(({ state }) => {
    if (request.preserveLockedTracks && (state?.locked || state?.regenerationExcluded)) return false;
    if (request.keepLikedTracks && state?.liked) return false;
    return true;
  });
  const byWeakness = new Map(weakness.map((item) => [item.position - 1, item]));
  let targets = allowed;
  if (request.mode === "replace_weak_tracks") {
    const threshold = REPLACEMENT_THRESHOLDS[request.replacementSensitivity];
    targets = allowed.filter(({ index }) => (byWeakness.get(index)?.overallWeakness || 0) >= threshold);
  } else if (request.mode === "replace_low_scoring") {
    targets = allowed.filter(({ index }) => (byWeakness.get(index)?.trackScore || 100) < request.scoreThreshold);
    if (request.lowestCount) targets = [...allowed].sort((left, right) => (byWeakness.get(right.index)?.overallWeakness || 0) - (byWeakness.get(left.index)?.overallWeakness || 0)).slice(0, request.lowestCount);
    if (request.replacementPercentage) targets = [...allowed].sort((left, right) => (byWeakness.get(right.index)?.overallWeakness || 0) - (byWeakness.get(left.index)?.overallWeakness || 0)).slice(0, Math.max(1, Math.ceil(tracks.length * request.replacementPercentage / 100)));
  } else if (request.mode === "improve_bpm_flow" || request.mode === "smooth_mood_transitions") {
    targets = [...allowed].sort((left, right) => (byWeakness.get(right.index)?.overallWeakness || 0) - (byWeakness.get(left.index)?.overallWeakness || 0));
  }
  return targets.slice(0, request.maximumReplacements).map(({ index }) => index);
}

export function regeneratePlaylist({
  playlistId,
  tracks,
  states,
  candidates,
  request,
  tuningConfig,
  identity,
}: {
  playlistId: string;
  tracks: RegenerationTrack[];
  states: PlaylistTrackState[];
  candidates: RegenerationTrack[];
  request: PlaylistRegenerationRequest;
  tuningConfig?: unknown;
  identity?: PlaylistIdentityScoringContext;
}) {
  const weakness = analyzePlaylistWeakness({ tracks, states, request });
  const positions = targetIndexes({ tracks, states, request, weakness });
  const proposedTracks = [...tracks];
  const availableCandidates = [...candidates];
  const changes: RegenerationPreviewChange[] = [];
  const warnings: string[] = [];

  if (positions.length === 0) {
    warnings.push(request.mode === "replace_weak_tracks"
      ? "No weak tracks found. This playlist already meets the selected quality threshold."
      : "No eligible tracks matched this regeneration action.");
  }

  for (const position of positions) {
    const original = tracks[position];
    const ranked = rankReplacementCandidates({
      candidates: availableCandidates,
      original,
      previous: proposedTracks[position - 1],
      next: proposedTracks[position + 1],
      playlist: proposedTracks,
      position,
      request,
      identity,
    });
    const best = ranked.find((item) => item.score.improvementOverOriginal >= request.minimumReplacementImprovement);
    if (!best) {
      warnings.push(`Position ${position + 1}: No replacement improved this position enough to justify a change.`);
      continue;
    }
    proposedTracks[position] = best.candidate;
    availableCandidates.splice(availableCandidates.findIndex((candidate) => candidate.id === best.candidate.id), 1);
    changes.push({
      position: position + 1,
      originalTrackId: original.id,
      proposedTrackId: best.candidate.id,
      originalScore: best.score.totalScore - best.score.improvementOverOriginal,
      proposedScore: best.score.totalScore,
      improvement: best.score.improvementOverOriginal,
      reasons: best.score.reasons,
      identityReasons: best.score.reasons.filter((reason) => /identity|playlist|mood|BPM|energy|artist|genre|rejected|accepted/i.test(reason)),
      originalMetrics: trackMetrics(original),
      proposedMetrics: trackMetrics(best.candidate),
      originalTrack: original,
      proposedTrack: best.candidate,
    });
  }

  const lockedTargetCount = selectablePositions({ tracks, states, section: request.targetSection, targetTrackIds: request.targetTrackIds })
    .filter(({ state }) => state?.locked || state?.regenerationExcluded).length;
  if (lockedTargetCount > 0) warnings.push("This transition could not be fully improved because one or more tracks are locked.");
  return buildRegenerationPreview({ playlistId, originalTracks: tracks, proposedTracks, changes, weakness, request, tuningConfig, warnings, identity });
}
