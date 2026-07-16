import { scoreTransition } from "../../../playlistScoring";
import { normalizeBpmFlowConfig, scoreBpmTransition } from "../bpmFlow";
import { clamp, positionalCurveScore, trackMetrics } from "./curvePreservation";
import type { PlaylistRegenerationRequest, RegenerationTrack, ReplacementCandidateScore } from "./types";
import type { PlaylistIdentityScoringContext } from "../../../playlistIdentity/types";
import { scorePlaylistIdentityTrack } from "../../../playlistIdentity/scoring";

type CandidateContext = {
  candidate: RegenerationTrack;
  original: RegenerationTrack;
  previous?: RegenerationTrack;
  next?: RegenerationTrack;
  playlist: RegenerationTrack[];
  position: number;
  request: PlaylistRegenerationRequest;
  identity?: PlaylistIdentityScoringContext;
};

type Weights = Omit<ReplacementCandidateScore, "candidateTrackId" | "totalScore" | "improvementOverOriginal" | "reasons">;

const BASE_WEIGHTS: Record<keyof Weights, number> = {
  playlistFitScore: 0.2,
  previousTransitionScore: 0.15,
  nextTransitionScore: 0.15,
  moodCurveScore: 0.15,
  bpmCurveScore: 0.15,
  energyCurveScore: 0.1,
  discoveryScore: 0.05,
  varietyScore: 0.03,
  metadataConfidenceScore: 0.02,
  identityMatchScore: 0,
  identityAdjustment: 0,
};

function weightsForMode(mode: PlaylistRegenerationRequest["mode"]) {
  const weights = { ...BASE_WEIGHTS };
  if (mode === "improve_bpm_flow") {
    weights.playlistFitScore = 0.1;
    weights.previousTransitionScore = 0.2;
    weights.nextTransitionScore = 0.2;
    weights.bpmCurveScore = 0.3;
  } else if (mode === "increase_discovery") {
    weights.playlistFitScore = 0.16;
    weights.discoveryScore = 0.24;
  } else if (mode === "smooth_mood_transitions") {
    weights.playlistFitScore = 0.1;
    weights.previousTransitionScore = 0.2;
    weights.nextTransitionScore = 0.2;
    weights.moodCurveScore = 0.25;
  } else if (mode === "increase_energy") {
    weights.playlistFitScore = 0.15;
    weights.energyCurveScore = 0.25;
  }
  const sum = Object.values(weights).reduce((total, value) => total + value, 0);
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value / sum])) as Record<keyof Weights, number>;
}

function average(values: Array<number | null | undefined>, fallback: number) {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : fallback;
}

function scoreCandidateComponents(context: CandidateContext): Omit<ReplacementCandidateScore, "improvementOverOriginal"> {
  const { candidate, original, previous, next, playlist, request, identity } = context;
  const metrics = trackMetrics(candidate);
  const originalMetrics = trackMetrics(original);
  const previousMetrics = previous ? trackMetrics(previous) : null;
  const nextMetrics = next ? trackMetrics(next) : null;
  const rawFit = Number(candidate.score);
  const playlistFitScore = Number.isFinite(rawFit) ? clamp(rawFit) : 70;
  const previousTransitionScore = previous ? scoreTransition(previous, candidate).score : 100;
  const nextTransitionScore = next ? scoreTransition(candidate, next).score : 100;
  const expectedMood = request.preserveMoodCurve ? originalMetrics.mood : average([previousMetrics?.mood, nextMetrics?.mood], originalMetrics.mood ?? 0.5);
  const expectedBpm = request.preserveBpmCurve ? originalMetrics.bpm : average([previousMetrics?.bpm, nextMetrics?.bpm], originalMetrics.bpm ?? 120);
  const expectedEnergyBase = originalMetrics.energy ?? average([previousMetrics?.energy, nextMetrics?.energy], 0.5);
  const expectedEnergy = clamp(expectedEnergyBase + (request.mode === "increase_energy" ? request.energyAdjustment : 0), 0, 1);
  const moodCurveScore = positionalCurveScore(metrics.mood, expectedMood, 0.7);
  const energyCurveScore = positionalCurveScore(metrics.energy, expectedEnergy, 0.65);
  const bpmConfig = normalizeBpmFlowConfig((request as any).bpmFlow);
  const neighborBpmScore = average([
    previous ? scoreBpmTransition({ fromTrack: previous, toTrack: candidate, config: bpmConfig }).score : null,
    next ? scoreBpmTransition({ fromTrack: candidate, toTrack: next, config: bpmConfig }).score : null,
  ], 85);
  const bpmCurveScore = Math.round(average([positionalCurveScore(metrics.bpm, expectedBpm, 55), neighborBpmScore], 75));
  const popularityTarget = request.mode === "increase_discovery"
    ? clamp((originalMetrics.popularity ?? 50) - request.discoveryAdjustment * 50)
    : originalMetrics.popularity;
  const discoveryScore = positionalCurveScore(metrics.popularity, popularityTarget, 70);
  const artistRepeats = metrics.artist ? playlist.filter((track) => trackMetrics(track).artist === metrics.artist && track.id !== original.id).length : 0;
  const albumRepeats = metrics.album ? playlist.filter((track) => trackMetrics(track).album === metrics.album && track.id !== original.id).length : 0;
  const varietyScore = Math.round(clamp(100 - artistRepeats * 18 - albumRepeats * 12));
  const metadataConfidenceScore = metrics.metadataConfidence;
  const identityResult = scorePlaylistIdentityTrack(candidate, identity);
  const identityMatchScore = identityResult.matchScore;
  const identityAdjustment = identityResult.adjustment;
  const components = {
    playlistFitScore: Math.round(playlistFitScore),
    previousTransitionScore,
    nextTransitionScore,
    moodCurveScore,
    bpmCurveScore,
    energyCurveScore,
    discoveryScore,
    varietyScore,
    metadataConfidenceScore,
    identityMatchScore,
    identityAdjustment,
  };
  const weights = weightsForMode(request.mode);
  weights.identityMatchScore = identity ? ({ FLEXIBLE: 0.08, BALANCED: 0.16, STRONG: 0.25, STRICT: 0.35 }[identity.mode]) : 0;
  weights.identityAdjustment = 0;
  const weightSum = Object.values(weights).reduce((sum, value) => sum + value, 0);
  for (const key of Object.keys(weights) as Array<keyof Weights>) weights[key] /= weightSum;
  const totalScore = Math.round(Object.entries(components).reduce((total, [key, value]) => total + value * weights[key as keyof Weights], 0));
  const reasons: string[] = [];
  if (previousTransitionScore >= 80 && nextTransitionScore >= 80) reasons.push("Improves transitions on both sides");
  else if (previousTransitionScore >= 80 || nextTransitionScore >= 80) reasons.push("Improves a neighboring transition");
  if (moodCurveScore >= 85) reasons.push("Matches the mood target for this position");
  if (bpmCurveScore >= 85) reasons.push("Preserves the BPM curve");
  if (energyCurveScore >= 85) reasons.push(request.mode === "increase_energy" ? "Raises energy while preserving the curve" : "Preserves the energy curve");
  if (request.mode === "increase_discovery" && discoveryScore >= 80) reasons.push("Adds discovery without disrupting flow");
  if (varietyScore >= 90) reasons.push("Maintains artist and album variety");
  if (metadataConfidenceScore < 60) reasons.push("Selected with limited metadata confidence");
  reasons.push(...identityResult.reasons);
  return { candidateTrackId: candidate.id, totalScore, ...components, reasons };
}

export function scoreReplacementCandidate(context: CandidateContext): ReplacementCandidateScore {
  const candidate = scoreCandidateComponents(context);
  const original = scoreCandidateComponents({ ...context, candidate: context.original });
  return {
    ...candidate,
    improvementOverOriginal: candidate.totalScore - original.totalScore,
  };
}

export function duplicateTrackKey(track: RegenerationTrack) {
  const normalize = (value: unknown) => String(value || "").toLowerCase()
    .replace(/\b(remaster(?:ed)?|live|deluxe|version|edit|mono|stereo)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
  return `${normalize(track.title)}::${normalize(track.artist?.title || track.artist)}`;
}

export function rankReplacementCandidates(context: Omit<CandidateContext, "candidate"> & { candidates: RegenerationTrack[] }) {
  const existingIds = new Set(context.playlist.map((track) => track.id));
  const existingKeys = new Set(context.playlist.filter((track) => track.id !== context.original.id).map(duplicateTrackKey));
  return context.candidates
    .filter((candidate) => candidate.id !== context.original.id && !existingIds.has(candidate.id) && !existingKeys.has(duplicateTrackKey(candidate)))
    .filter((candidate) => !candidate.blocked && !candidate.regenerationExcluded)
    .filter((candidate) => {
      const memory = context.identity?.trackMemory[candidate.id];
      return !memory?.permanentRejection && memory?.rejectionState !== "NEVER_USE";
    })
    .map((candidate) => ({ candidate, score: scoreReplacementCandidate({ ...context, candidate }) }))
    .sort((left, right) => right.score.totalScore - left.score.totalScore);
}
