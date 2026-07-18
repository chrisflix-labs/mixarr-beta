import { analyzeBpmTransition } from "../smartMixEngine/v2/bpmFlow";
import { getTrackBpm, getTrackEnergy, getTrackMood, getTrackPopularity } from "../smartMixEngine/v2/metadataFallbacks";
import { getTrackMoodTags } from "../smartMixEngine/v2/moodBlending";
import { BUILT_IN_ROLE_PRESETS } from "./presets";
import type { BpmHandoffMode, BoundaryTrack, EnergyHandoffMode, HandoffAnalysis, MoodHandoffMode, PlaylistJourneySummary } from "./types";

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const round = (value: number, places = 1) => { const factor = 10 ** places; return Math.round(value * factor) / factor; };
const mean = (values: Array<number | null>) => { const known = values.filter((value): value is number => value != null); return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null; };
const median = (values: Array<number | null>) => { const known = values.filter((value): value is number => value != null).sort((a, b) => a - b); if (!known.length) return null; const middle = Math.floor(known.length / 2); return known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2; };
const range = (values: Array<number | null>): [number, number] | null => { const known = values.filter((value): value is number => value != null); return known.length ? [Math.min(...known), Math.max(...known)] : null; };

function normalizeUnit(value: number | null) {
  if (value == null) return null;
  return value > 1 ? clamp(value, 0, 100) / 100 : clamp(value, 0, 1);
}

function topMoods(tracks: BoundaryTrack[], limit = 3) {
  const counts = new Map<string, number>();
  for (const track of tracks) for (const mood of track.moods) counts.set(mood, (counts.get(mood) || 0) + 1);
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, limit).map(([mood]) => mood);
}

export function toBoundaryTrack(snapshot: any, track: any): BoundaryTrack {
  const moodTags = track ? getTrackMoodTags(track) : [];
  return {
    id: track?.id || snapshot.trackId || snapshot.id,
    snapshotId: snapshot.id,
    title: snapshot.title || track?.title || "Unknown track",
    artist: snapshot.artist || track?.artist?.title || null,
    album: snapshot.album || track?.album?.title || null,
    bpm: track ? getTrackBpm(track) : null,
    energy: track ? normalizeUnit(getTrackEnergy(track)) : null,
    moodIntensity: track ? normalizeUnit(getTrackMood(track)) : null,
    moods: moodTags,
    duration: track?.duration ?? null,
    popularity: track ? getTrackPopularity(track) : null,
    locked: Boolean(snapshot.locked || snapshot.automationProtected),
    liked: Boolean(snapshot.liked || Number(track?.rating) >= 8),
    available: Boolean(track && track.syncStatus === "active" && !track.deletedAt),
  };
}

export function summarizeJourneyPlaylist(playlist: any, trackMap: Map<string, any>): PlaylistJourneySummary {
  const tracks = [...(playlist.tracks || [])].sort((a, b) => a.position - b.position).map((snapshot) => toBoundaryTrack(snapshot, snapshot.trackId ? trackMap.get(snapshot.trackId) : null));
  const boundarySize = Math.max(1, Math.min(5, Math.ceil(tracks.length * 0.2)));
  const opening = tracks.slice(0, boundarySize);
  const ending = tracks.slice(-boundarySize);
  const knownFields = tracks.reduce((sum, track) => sum + Number(track.bpm != null) + Number(track.energy != null) + Number(track.moodIntensity != null || track.moods.length > 0), 0);
  const possibleFields = tracks.length * 3;
  const familiarity = tracks.length ? tracks.filter((track) => track.liked || (track.popularity ?? 0) >= 65).length / tracks.length * 100 : 0;
  return {
    playlistId: playlist.id,
    name: playlist.plexPlaylistTitle,
    trackCount: tracks.length,
    estimatedDurationMs: tracks.reduce((sum, track) => sum + (track.duration || 0), 0),
    startingBpm: median(opening.map((track) => track.bpm)),
    endingBpm: median(ending.map((track) => track.bpm)),
    startingBpmRange: range(opening.map((track) => track.bpm)),
    endingBpmRange: range(ending.map((track) => track.bpm)),
    startingEnergy: mean(opening.map((track) => track.energy)),
    endingEnergy: mean(ending.map((track) => track.energy)),
    primaryMoods: topMoods(tracks),
    startingMoods: topMoods(opening),
    endingMoods: topMoods(ending),
    moodIntensityStart: mean(opening.map((track) => track.moodIntensity)),
    moodIntensityEnd: mean(ending.map((track) => track.moodIntensity)),
    metadataConfidence: possibleFields ? round(knownFields / possibleFields * 100) : 0,
    missing: {
      bpm: tracks.filter((track) => track.bpm == null).length,
      energy: tracks.filter((track) => track.energy == null).length,
      mood: tracks.filter((track) => track.moodIntensity == null && !track.moods.length).length,
      unavailable: tracks.filter((track) => !track.available).length,
    },
    familiarityPercent: round(familiarity),
    energyCurve: tracks.map((track) => track.energy),
    bpmCurve: tracks.map((track) => track.bpm),
    moodCurve: tracks.map((track) => track.moodIntensity),
    tracks,
  };
}

export function analyzeEnergyHandoff(from: PlaylistJourneySummary, to: PlaylistJourneySummary, mode: EnergyHandoffMode) {
  const ending = from.endingEnergy;
  const starting = to.startingEnergy;
  if (ending == null || starting == null) return { score: null, difference: null, intendedDirection: mode, explanation: "Energy metadata is missing at this boundary." };
  const difference = round((starting - ending) * 100);
  if (mode === "INTENTIONAL_CONTRAST") return { score: 85, difference, intendedDirection: mode, explanation: `A ${Math.abs(difference)}-point energy change is allowed as intentional contrast.` };
  if (mode === "NO_PREFERENCE" || mode === "ENERGY_RESET") return { score: clamp(90 - Math.max(0, Math.abs(difference) - 35)), difference, intendedDirection: mode, explanation: `Energy changes by ${difference > 0 ? "+" : ""}${difference} points.` };
  const directionPenalty = mode === "GRADUAL_INCREASE" && difference < -2 ? Math.abs(difference) * 1.2 : mode === "GRADUAL_DECREASE" && difference > 2 ? Math.abs(difference) * 1.2 : 0;
  const targetGap = mode === "SMOOTH_CONTINUATION" ? 0 : mode === "GRADUAL_INCREASE" ? 8 : -8;
  const score = Math.round(clamp(100 - Math.abs(difference - targetGap) * 2.3 - directionPenalty));
  return { score, difference, intendedDirection: mode, explanation: `Ending energy ${Math.round(ending * 100)} and opening energy ${Math.round(starting * 100)} differ by ${difference > 0 ? "+" : ""}${difference} points.` };
}

export function analyzeBpmHandoff(from: PlaylistJourneySummary, to: PlaylistJourneySummary, mode: BpmHandoffMode, maxPreferredGap = 8) {
  const transition = analyzeBpmTransition({ fromBpm: from.endingBpm, toBpm: to.startingBpm, maxPreferredGap, halfDoubleTimeMatching: true });
  if (transition.effectiveGap == null) return { score: null, ...transition, intendedDirection: mode, explanation: "BPM metadata is missing at this boundary." };
  if (mode === "INTENTIONAL_RESET" || mode === "NO_GUIDANCE") return { score: Math.round(clamp(95 - Math.max(0, transition.effectiveGap - 24))), ...transition, intendedDirection: mode, explanation: `The raw change is ${transition.rawGap} BPM and the effective change is ${transition.effectiveGap} BPM.` };
  const directionPenalty = mode === "GRADUAL_RAMP_UP" && transition.direction === "down" ? 18 : mode === "GRADUAL_RAMP_DOWN" && transition.direction === "up" ? 18 : 0;
  const relationshipPenalty = (mode === "HALF_TIME" || mode === "DOUBLE_TIME") && transition.relationship === "direct" ? 30 : 0;
  const score = Math.round(clamp(100 - transition.effectiveGap * 3.2 - Number(transition.exceedsPreferredGap) * 12 - directionPenalty - relationshipPenalty));
  return { score, ...transition, intendedDirection: mode, explanation: `${transition.rawGap} BPM raw gap; ${transition.effectiveGap} BPM effective gap${transition.relationship === "direct" ? "" : ` through a ${transition.relationship} relationship`}.` };
}

export function analyzeMoodHandoff(from: PlaylistJourneySummary, to: PlaylistJourneySummary, mode: MoodHandoffMode) {
  const fromSet = new Set(from.endingMoods.map((mood) => mood.toLowerCase()));
  const toSet = new Set(to.startingMoods.map((mood) => mood.toLowerCase()));
  const union = new Set(Array.from(fromSet).concat(Array.from(toSet)));
  const shared = Array.from(fromSet).filter((mood) => toSet.has(mood));
  const intensityDifference = from.moodIntensityEnd != null && to.moodIntensityStart != null ? round((to.moodIntensityStart - from.moodIntensityEnd) * 100) : null;
  if (!union.size && intensityDifference == null) return { score: null, compatibility: "Unable to evaluate", sharedMoods: [], intensityDifference, intendedDirection: mode, explanation: "Mood metadata is missing at this boundary." };
  if (mode === "INTENTIONAL_CONTRAST") return { score: 85, compatibility: "Intentional contrast", sharedMoods: shared, intensityDifference, intendedDirection: mode, explanation: "The chain explicitly allows contrasting moods here." };
  const tagScore = union.size ? shared.length / union.size * 100 : 55;
  const intensityScore = intensityDifference == null ? 60 : clamp(100 - Math.abs(intensityDifference) * 2);
  let directionPenalty = 0;
  if (intensityDifference != null && mode === "EMOTIONAL_BUILD" && intensityDifference < 0) directionPenalty = 20;
  if (intensityDifference != null && ["EMOTIONAL_RELEASE", "CALM_RESET"].includes(mode) && intensityDifference > 0) directionPenalty = 20;
  const score = Math.round(clamp(tagScore * 0.6 + intensityScore * 0.4 - directionPenalty));
  return { score, compatibility: score >= 80 ? "Strong" : score >= 60 ? "Compatible" : score >= 40 ? "Noticeable change" : "Conflicting", sharedMoods: shared, intensityDifference, intendedDirection: mode, explanation: shared.length ? `Shared boundary moods: ${shared.join(", ")}.` : "The boundary uses different dominant mood tags." };
}

function qualityFor(score: number | null, intentional: boolean): HandoffAnalysis["quality"] {
  if (intentional && score != null) return "Intentional Contrast";
  if (score == null) return "Unable to Evaluate";
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Smooth";
  if (score >= 50) return "Noticeable";
  return "Abrupt";
}

export function analyzePlaylistHandoff(input: {
  fromMemberId: string; toMemberId: string; from: PlaylistJourneySummary; to: PlaylistJourneySummary;
  energyMode: EnergyHandoffMode; bpmMode: BpmHandoffMode; moodMode: MoodHandoffMode; maxPreferredBpmGap?: number;
}): HandoffAnalysis {
  const energy = analyzeEnergyHandoff(input.from, input.to, input.energyMode);
  const bpm = analyzeBpmHandoff(input.from, input.to, input.bpmMode, input.maxPreferredBpmGap);
  const mood = analyzeMoodHandoff(input.from, input.to, input.moodMode);
  const scores = [energy.score, bpm.score, mood.score].filter((score): score is number => score != null);
  const qualityScore = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
  const confidence = Math.round((input.from.metadataConfidence + input.to.metadataConfidence) / 2);
  const warnings = [
    ...(input.from.missing.unavailable || input.to.missing.unavailable ? ["One or more boundary tracks are unavailable."] : []),
    ...(energy.score == null ? ["Energy handoff could not be evaluated."] : energy.score < 50 ? ["Energy handoff needs attention."] : []),
    ...(bpm.score == null ? ["BPM handoff could not be evaluated."] : bpm.score < 50 ? ["BPM handoff needs attention."] : []),
    ...(mood.score == null ? ["Mood handoff could not be evaluated."] : mood.score < 50 ? ["Mood handoff needs attention."] : []),
  ];
  const intentional = input.energyMode === "INTENTIONAL_CONTRAST" || input.moodMode === "INTENTIONAL_CONTRAST" || input.bpmMode === "INTENTIONAL_RESET";
  return {
    fromMemberId: input.fromMemberId, toMemberId: input.toMemberId, fromPlaylistId: input.from.playlistId, toPlaylistId: input.to.playlistId,
    quality: qualityFor(qualityScore, intentional), qualityScore, energyScore: energy.score, bpmScore: bpm.score, moodScore: mood.score,
    confidence, energy, bpm, mood, warnings, explanations: [energy.explanation, bpm.explanation, mood.explanation],
  };
}

export function calculateRoleProgressionScore(roleKeys: Array<string | null>) {
  const pairs = roleKeys.slice(0, -1).map((key, index) => ({ key, next: roleKeys[index + 1] }));
  if (!pairs.length || !pairs.some((pair) => pair.key && pair.next)) return { score: null, explanations: ["Assign roles to evaluate role progression."] };
  let total = 0;
  const explanations: string[] = [];
  for (const pair of pairs) {
    if (!pair.key || !pair.next) { total += 60; explanations.push("A playlist without a role reduces role-progression confidence."); continue; }
    const preset = BUILT_IN_ROLE_PRESETS.find((role) => role.key === pair.key);
    const expected = preset?.expectedNextRoles.includes(pair.next) || pair.key === "custom" || pair.next === "custom";
    total += expected ? 100 : 65;
    explanations.push(expected ? `${preset?.name || pair.key} naturally leads into ${pair.next}.` : `${preset?.name || pair.key} does not normally lead into ${pair.next}, but the sequence is allowed.`);
  }
  return { score: Math.round(total / pairs.length), explanations };
}

export function calculateChainScores(handoffs: HandoffAnalysis[], roleKeys: Array<string | null>, summaries: PlaylistJourneySummary[], identityScores: Array<number | null> = []) {
  const category = (key: "energyScore" | "bpmScore" | "moodScore" | "qualityScore") => { const values = handoffs.map((handoff) => handoff[key]).filter((value): value is number => value != null); return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null; };
  const role = calculateRoleProgressionScore(roleKeys);
  const metadata = summaries.length ? Math.round(summaries.reduce((sum, summary) => sum + summary.metadataConfidence, 0) / summaries.length) : 0;
  const discovery = summaries.length > 1 ? Math.round(clamp(100 - Math.max(...summaries.map((summary) => summary.familiarityPercent)) + Math.min(...summaries.map((summary) => summary.familiarityPercent)))) : 75;
  const knownIdentityScores = identityScores.filter((value): value is number => value != null);
  const scores = {
    roleProgression: role.score,
    energyContinuity: category("energyScore"),
    bpmContinuity: category("bpmScore"),
    moodProgression: category("moodScore"),
    boundaryTransitions: category("qualityScore"),
    discoveryBalance: discovery,
    playlistIdentityMatch: knownIdentityScores.length ? Math.round(knownIdentityScores.reduce((sum, value) => sum + value, 0) / knownIdentityScores.length) : null,
    metadataConfidence: metadata,
  };
  const weighted = Object.values(scores).filter((value): value is number => value != null);
  return { overall: weighted.length ? Math.round(weighted.reduce((sum, value) => sum + value, 0) / weighted.length) : null, ...scores, explanations: role.explanations };
}
