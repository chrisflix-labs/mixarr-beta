import {
  getSmartMixMetadataStatus,
  getTrackBpm,
  getTrackEnergy,
  getTrackMood,
  getTrackPopularity,
  normalizeBpmFlowConfig,
  summarizeBpmFlow,
} from "./smartMixEngine/v2";

export const PLAYLIST_SCORE_VERSION = "2.0.4";

export type PlaylistScoreLabel = "Excellent" | "Strong" | "Good" | "Fair" | "Weak";

export type PlaylistWeakSpot = {
  index: number;
  trackId?: string | null;
  nextTrackId?: string | null;
  type: "transition" | "metadata";
  score?: number;
  reasons: string[];
};

export type PlaylistScoreSummary = {
  overallScore: number;
  compatibilityScore: number;
  bpmConsistencyScore: number;
  bpmFlowScore: number | null;
  energyFlowScore: number;
  moodConsistencyScore: number;
  discoveryBalanceScore: number;
  weakSpotCount: number;
  warnings: string[];
  scoreVersion: typeof PLAYLIST_SCORE_VERSION;
  labels: {
    overall: PlaylistScoreLabel;
    compatibility: PlaylistScoreLabel;
    bpmConsistency: PlaylistScoreLabel;
    bpmFlow?: PlaylistScoreLabel;
    energyFlow: PlaylistScoreLabel;
    moodConsistency: PlaylistScoreLabel;
    discoveryBalance: PlaylistScoreLabel;
  };
  weakSpots: PlaylistWeakSpot[];
  bpmFlow?: ReturnType<typeof summarizeBpmFlow>;
};

type TrackScoreMetadata = {
  bpm: number | null;
  energy: number | null;
  mood: number | null;
  popularity: number | null;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number) {
  return Math.round(clamp(value));
}

function average(values: number[], fallback = 100) {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeFeature(value: number | null) {
  if (value == null) return null;
  return value > 1 ? clamp(value, 0, 100) / 100 : clamp(value, 0, 1);
}

function normalizePopularity(value: number | null) {
  if (value == null) return null;
  return clamp(value, 0, 100);
}

function metadataForTrack(track: any): TrackScoreMetadata {
  return {
    bpm: finiteNumber(getTrackBpm(track)),
    energy: normalizeFeature(getTrackEnergy(track)),
    mood: normalizeFeature(getTrackMood(track)),
    popularity: normalizePopularity(getTrackPopularity(track)),
  };
}

function transitionPenaltyForBpm(left: number | null, right: number | null) {
  if (left == null || right == null) return 8;
  const diff = Math.abs(left - right);
  if (diff <= 5) return 0;
  if (diff <= 10) return 5;
  if (diff <= 20) return 15;
  if (diff <= 35) return 30;
  return 45;
}

function transitionPenaltyForFeature(left: number | null, right: number | null, kind: "energy" | "mood") {
  if (left == null || right == null) return 8;
  const diff = Math.abs(left - right);
  if (diff <= (kind === "energy" ? 0.12 : 0.15)) return 0;
  if (diff <= (kind === "energy" ? 0.25 : 0.3)) return 8;
  if (diff <= (kind === "energy" ? 0.4 : 0.5)) return kind === "energy" ? 18 : 20;
  return kind === "energy" ? 30 : 32;
}

function transitionPenaltyForPopularity(left: number | null, right: number | null) {
  if (left == null || right == null) return 4;
  const diff = Math.abs(left - right);
  if (diff <= 25) return 0;
  if (diff <= 45) return 5;
  return 10;
}

export function playlistScoreLabel(score: number): PlaylistScoreLabel {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Strong";
  if (score >= 70) return "Good";
  if (score >= 60) return "Fair";
  return "Weak";
}

export function scoreTransition(leftTrack: any, rightTrack: any) {
  const left = metadataForTrack(leftTrack);
  const right = metadataForTrack(rightTrack);
  const reasons: string[] = [];
  const bpmPenalty = transitionPenaltyForBpm(left.bpm, right.bpm);
  const energyPenalty = transitionPenaltyForFeature(left.energy, right.energy, "energy");
  const moodPenalty = transitionPenaltyForFeature(left.mood, right.mood, "mood");
  const popularityPenalty = transitionPenaltyForPopularity(left.popularity, right.popularity);

  if (left.bpm == null || right.bpm == null) reasons.push("missing BPM data");
  else if (Math.abs(left.bpm - right.bpm) > 20) reasons.push("large BPM jump");

  if (left.energy == null || right.energy == null) reasons.push("missing energy data");
  else if (Math.abs(left.energy - right.energy) > 0.35) reasons.push("sharp energy change");

  if (left.mood == null || right.mood == null) reasons.push("missing mood data");
  else if (Math.abs(left.mood - right.mood) > 0.45) reasons.push("mood mismatch");

  if (left.popularity == null || right.popularity == null) reasons.push("missing popularity data");

  return {
    score: roundScore(100 - bpmPenalty - energyPenalty - moodPenalty - popularityPenalty),
    reasons,
  };
}

export function scoreBpmConsistency(tracks: any[]) {
  const metadata = tracks.map(metadataForTrack);
  const known = metadata.filter((track) => track.bpm != null);
  if (tracks.length === 0) return 0;
  if (known.length < 2) return tracks.length > 1 ? 60 : 100;

  const transitionScores: number[] = [];
  for (let index = 1; index < metadata.length; index += 1) {
    transitionScores.push(100 - transitionPenaltyForBpm(metadata[index - 1].bpm, metadata[index].bpm));
  }

  const missingRatio = 1 - known.length / tracks.length;
  return roundScore(average(transitionScores) - missingRatio * 12);
}

export function scoreEnergyFlow(tracks: any[]) {
  const metadata = tracks.map(metadataForTrack);
  const known = metadata.filter((track) => track.energy != null);
  if (tracks.length === 0) return 0;
  if (known.length < 2) return tracks.length > 1 ? 60 : 100;

  const transitionScores: number[] = [];
  let sharpChanges = 0;
  let directionChanges = 0;
  let previousDirection = 0;

  for (let index = 1; index < metadata.length; index += 1) {
    const left = metadata[index - 1].energy;
    const right = metadata[index].energy;
    transitionScores.push(100 - transitionPenaltyForFeature(left, right, "energy"));
    if (left != null && right != null) {
      const diff = right - left;
      if (Math.abs(diff) > 0.35) sharpChanges += 1;
      const direction = Math.abs(diff) < 0.08 ? 0 : Math.sign(diff);
      if (direction !== 0 && previousDirection !== 0 && direction !== previousDirection) directionChanges += 1;
      if (direction !== 0) previousDirection = direction;
    }
  }

  const missingRatio = 1 - known.length / tracks.length;
  const curvePenalty = Math.min(12, directionChanges * 2) + Math.min(12, sharpChanges * 4);
  return roundScore(average(transitionScores) - missingRatio * 10 - curvePenalty);
}

export function scoreMoodConsistency(tracks: any[]) {
  const metadata = tracks.map(metadataForTrack);
  const known = metadata.map((track) => track.mood).filter((value): value is number => value != null);
  if (tracks.length === 0) return 0;
  if (known.length < 2) return tracks.length > 1 ? 60 : 100;

  const sorted = [...known].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  const centerScores = known.map((value) => 100 - Math.min(45, Math.abs(value - median) * 90));
  const transitionScores: number[] = [];
  for (let index = 1; index < metadata.length; index += 1) {
    transitionScores.push(100 - transitionPenaltyForFeature(metadata[index - 1].mood, metadata[index].mood, "mood"));
  }

  const missingRatio = 1 - known.length / tracks.length;
  return roundScore((average(centerScores) * 0.45) + (average(transitionScores) * 0.55) - missingRatio * 10);
}

export function scoreDiscoveryBalance(tracks: any[]) {
  const popularityValues = tracks.map(metadataForTrack).map((track) => track.popularity).filter((value): value is number => value != null);
  if (tracks.length === 0) return 0;
  if (popularityValues.length === 0) return 60;

  const popular = popularityValues.filter((value) => value >= 75).length / popularityValues.length;
  const moderate = popularityValues.filter((value) => value >= 35 && value < 75).length / popularityValues.length;
  const deepCuts = popularityValues.filter((value) => value < 35).length / popularityValues.length;
  const missingRatio = 1 - popularityValues.length / tracks.length;

  let score = 100;
  if (popular > 0.6) score -= (popular - 0.6) * 80;
  if (popular < 0.15) score -= (0.15 - popular) * 40;
  if (deepCuts > 0.6) score -= (deepCuts - 0.6) * 80;
  if (deepCuts < 0.1) score -= (0.1 - deepCuts) * 50;
  if (moderate < 0.25) score -= (0.25 - moderate) * 70;
  score -= missingRatio * 12;

  return roundScore(score);
}

export function detectWeakSpots(tracks: any[]): PlaylistWeakSpot[] {
  const weakSpots: PlaylistWeakSpot[] = [];

  tracks.forEach((track, index) => {
    const missingFields = getSmartMixMetadataStatus(track).missingFields;
    if (missingFields.length >= 3) {
      weakSpots.push({
        index,
        trackId: track.id || track.trackId || null,
        type: "metadata",
        reasons: [`missing ${missingFields.join(", ")} data`],
      });
    }
  });

  for (let index = 1; index < tracks.length; index += 1) {
    const transition = tracks[index]?.bpmTransitionFromPrevious;
    if (transition?.difficulty === "Difficult" || transition?.difficulty === "Hard") {
      weakSpots.push({
        index,
        trackId: tracks[index - 1]?.id || tracks[index - 1]?.trackId || null,
        nextTrackId: tracks[index]?.id || tracks[index]?.trackId || null,
        type: "transition",
        score: transition.score ?? undefined,
        reasons: [transition.reason],
      });
      continue;
    }
    const legacyTransition = scoreTransition(tracks[index - 1], tracks[index]);
    const meaningfulReasons = legacyTransition.reasons.filter((reason) => (
      reason.includes("large")
      || reason.includes("sharp")
      || reason.includes("mismatch")
    ));
    if (legacyTransition.score < 60 || meaningfulReasons.length > 0) {
      weakSpots.push({
        index,
        trackId: tracks[index - 1]?.id || tracks[index - 1]?.trackId || null,
        nextTrackId: tracks[index]?.id || tracks[index]?.trackId || null,
        type: "transition",
        score: legacyTransition.score,
        reasons: meaningfulReasons.length ? meaningfulReasons : legacyTransition.reasons.slice(0, 2),
      });
    }
  }

  return weakSpots;
}

function scoreCompatibility(tracks: any[]) {
  if (tracks.length === 0) return 0;
  if (tracks.length === 1) return 100;

  const transitionScores: number[] = [];
  for (let index = 1; index < tracks.length; index += 1) {
    transitionScores.push(scoreTransition(tracks[index - 1], tracks[index]).score);
  }
  return roundScore(average(transitionScores));
}

function warningThreshold(total: number) {
  return Math.max(2, Math.ceil(total * 0.3));
}

function buildWarnings(tracks: any[], weakSpots: PlaylistWeakSpot[], scores: Omit<PlaylistScoreSummary, "warnings" | "scoreVersion" | "labels" | "weakSpots">) {
  const warnings: string[] = [];
  const total = tracks.length;
  const metadataStatuses = tracks.map(getSmartMixMetadataStatus);
  const missingBpm = metadataStatuses.filter((status) => !status.hasBpm).length;
  const missingEnergy = metadataStatuses.filter((status) => !status.hasEnergy).length;
  const missingMood = metadataStatuses.filter((status) => !status.hasMood).length;
  const missingPopularity = metadataStatuses.filter((status) => !status.hasPopularity).length;

  if (total === 0) warnings.push("Playlist has no tracks to score yet.");
  if (weakSpots.length > 0) warnings.push(`${weakSpots.length} track${weakSpots.length === 1 ? "" : "s"} may not flow well with neighboring tracks.`);
  if (missingBpm >= warningThreshold(total)) warnings.push("Several tracks are missing BPM data, so BPM scoring may be less accurate.");
  if (missingEnergy >= warningThreshold(total)) warnings.push("Energy data is incomplete for some tracks.");
  if (missingMood >= warningThreshold(total)) warnings.push("Mood data is incomplete for some tracks.");
  if (missingPopularity >= warningThreshold(total)) warnings.push("Popularity data is incomplete, so discovery balance may be less accurate.");
  if (scores.energyFlowScore < 70 && total > 2) warnings.push("Energy changes sharply in a few places.");
  if (scores.bpmFlow?.warnings?.length) warnings.push(...scores.bpmFlow.warnings.slice(0, 2));
  if (scores.discoveryBalanceScore < 70 && missingPopularity < total) {
    const popularKnown = tracks.map(metadataForTrack).filter((track) => track.popularity != null && track.popularity >= 75).length;
    const lowKnown = tracks.map(metadataForTrack).filter((track) => track.popularity != null && track.popularity < 35).length;
    warnings.push(popularKnown > lowKnown
      ? "Popularity balance leans heavily toward familiar tracks."
      : "Popularity balance leans heavily toward deeper cuts.");
  }

  return warnings.filter((warning, index, list) => list.indexOf(warning) === index).slice(0, 6);
}

export function scorePlaylist(tracks: any[], tuningConfig?: unknown): PlaylistScoreSummary {
  const compatibilityScore = scoreCompatibility(tracks);
  const bpmConsistencyScore = scoreBpmConsistency(tracks);
  const bpmFlow = summarizeBpmFlow(tracks, normalizeBpmFlowConfig((tuningConfig as any)?.bpmFlow ?? tuningConfig));
  const bpmFlowScore = bpmFlow.bpmFlowScore;
  const energyFlowScore = scoreEnergyFlow(tracks);
  const moodConsistencyScore = scoreMoodConsistency(tracks);
  const discoveryBalanceScore = scoreDiscoveryBalance(tracks);
  const overallScore = roundScore(
    compatibilityScore * 0.3
    + bpmConsistencyScore * 0.12
    + (bpmFlowScore ?? bpmConsistencyScore) * 0.08
    + energyFlowScore * 0.2
    + moodConsistencyScore * 0.15
    + discoveryBalanceScore * 0.15,
  );
  const weakSpots = detectWeakSpots(tracks);
  const baseScores = {
    overallScore,
    compatibilityScore,
    bpmConsistencyScore,
    bpmFlowScore,
    energyFlowScore,
    moodConsistencyScore,
    discoveryBalanceScore,
    weakSpotCount: weakSpots.length,
    bpmFlow,
  };

  return {
    ...baseScores,
    warnings: buildWarnings(tracks, weakSpots, baseScores),
    scoreVersion: PLAYLIST_SCORE_VERSION,
    labels: {
      overall: playlistScoreLabel(overallScore),
      compatibility: playlistScoreLabel(compatibilityScore),
      bpmConsistency: playlistScoreLabel(bpmConsistencyScore),
      bpmFlow: bpmFlowScore == null ? undefined : playlistScoreLabel(bpmFlowScore),
      energyFlow: playlistScoreLabel(energyFlowScore),
      moodConsistency: playlistScoreLabel(moodConsistencyScore),
      discoveryBalance: playlistScoreLabel(discoveryBalanceScore),
    },
    weakSpots,
  };
}
