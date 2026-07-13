import { scoreTransition } from "../../../playlistScoring";
import { trackMetrics, clamp } from "./curvePreservation";
import type { PlaylistRegenerationRequest, PlaylistTrackState, RegenerationTrack, TrackWeaknessAnalysis } from "./types";

function round(value: number) {
  return Math.round(clamp(value));
}

export function analyzePlaylistWeakness({
  tracks,
  states,
  request,
}: {
  tracks: RegenerationTrack[];
  states: PlaylistTrackState[];
  request: PlaylistRegenerationRequest;
}): TrackWeaknessAnalysis[] {
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  tracks.forEach((track) => {
    const metrics = trackMetrics(track);
    if (metrics.artist) artistCounts.set(metrics.artist, (artistCounts.get(metrics.artist) || 0) + 1);
    if (metrics.album) albumCounts.set(metrics.album, (albumCounts.get(metrics.album) || 0) + 1);
  });

  return tracks.map((track, index) => {
    const metrics = trackMetrics(track);
    const state = states[index] || { trackId: track.id, position: index + 1, locked: false };
    const previous = index > 0 ? scoreTransition(tracks[index - 1], track) : null;
    const next = index < tracks.length - 1 ? scoreTransition(track, tracks[index + 1]) : null;
    const neighborScores = [previous?.score, next?.score].filter((value): value is number => typeof value === "number");
    const transitionQuality = neighborScores.length ? neighborScores.reduce((sum, value) => sum + value, 0) / neighborScores.length : 100;
    const providedTrackScore = Number(track.score);
    const trackScore = Number.isFinite(providedTrackScore) ? clamp(providedTrackScore) : transitionQuality;
    const previousMetrics = index > 0 ? trackMetrics(tracks[index - 1]) : null;
    const nextMetrics = index < tracks.length - 1 ? trackMetrics(tracks[index + 1]) : null;
    const expectedMood = previousMetrics?.mood != null && nextMetrics?.mood != null ? (previousMetrics.mood + nextMetrics.mood) / 2 : metrics.mood;
    const expectedBpm = previousMetrics?.bpm != null && nextMetrics?.bpm != null ? (previousMetrics.bpm + nextMetrics.bpm) / 2 : metrics.bpm;
    const expectedEnergy = previousMetrics?.energy != null && nextMetrics?.energy != null ? (previousMetrics.energy + nextMetrics.energy) / 2 : metrics.energy;
    const moodPenalty = metrics.mood == null || expectedMood == null ? 0 : clamp(Math.abs(metrics.mood - expectedMood) * 55);
    const bpmPenalty = metrics.bpm == null || expectedBpm == null ? 0 : clamp(Math.abs(metrics.bpm - expectedBpm) / 55 * 100);
    const energyPenalty = metrics.energy == null || expectedEnergy == null ? 0 : clamp(Math.abs(metrics.energy - expectedEnergy) * 60);
    const varietyPenalty = clamp(Math.max(0, (metrics.artist ? artistCounts.get(metrics.artist) || 0 : 0) - 2) * 10
      + Math.max(0, (metrics.album ? albumCounts.get(metrics.album) || 0 : 0) - 1) * 6, 0, 35);
    const discoveryTarget = clamp(50 - request.discoveryAdjustment * 50);
    const discoveryPenalty = metrics.popularity == null ? 0 : request.mode === "increase_discovery"
      ? clamp(Math.max(0, metrics.popularity - discoveryTarget) * 0.45)
      : 0;
    const metadataConfidencePenalty = clamp((100 - metrics.metadataConfidence) * 0.12, 0, 12);
    const signalPenalty = track.disliked || track.skipCount > 2 ? 18 : 0;
    const weaknessWithoutConfidence = (100 - trackScore) * 0.26
      + (100 - transitionQuality) * 0.42
      + moodPenalty * 0.09
      + bpmPenalty * 0.09
      + energyPenalty * 0.06
      + varietyPenalty * 0.05
      + discoveryPenalty * 0.03
      + signalPenalty;
    // Missing metadata lowers confidence, but is capped so it can never make a healthy track weak by itself.
    const overallWeakness = round(weaknessWithoutConfidence + Math.min(metadataConfidencePenalty, weaknessWithoutConfidence > 25 ? 12 : 5));
    const reasons: string[] = [];
    const transitionReasons = [...(previous?.reasons || []), ...(next?.reasons || [])];
    if (transitionReasons.includes("large BPM jump")) reasons.push("Large BPM jump with a neighboring track");
    if (transitionReasons.includes("mood mismatch") || moodPenalty >= 25) reasons.push("Mood does not fit this playlist position");
    if (transitionReasons.includes("sharp energy change") || energyPenalty >= 25) reasons.push("Energy breaks the surrounding curve");
    if (varietyPenalty >= 10) reasons.push(metrics.artist && (artistCounts.get(metrics.artist) || 0) > 2 ? "Artist appears too frequently" : "Album appears too frequently");
    if (discoveryPenalty >= 10) reasons.push("Track does not match the selected discovery level");
    if (signalPenalty) reasons.push("Skip or dislike signals reduced this track's fit");
    const confidenceReasons = metrics.metadataConfidence < 70 ? ["Low-confidence or missing metadata affected scoring confidence"] : [];
    if (reasons.length === 0 && overallWeakness >= 45) reasons.push("Overall playlist fit is below the target for this position");
    return {
      trackId: track.id,
      position: index + 1,
      overallWeakness,
      trackScore: round(trackScore),
      previousTransitionScore: previous?.score,
      nextTransitionScore: next?.score,
      moodPenalty: round(moodPenalty),
      bpmPenalty: round(bpmPenalty),
      energyPenalty: round(energyPenalty),
      varietyPenalty: round(varietyPenalty),
      discoveryPenalty: round(discoveryPenalty),
      metadataConfidencePenalty: round(metadataConfidencePenalty),
      reasons,
      confidenceReasons,
      locked: Boolean(state.locked || state.regenerationExcluded),
      liked: Boolean(state.liked),
    };
  });
}

