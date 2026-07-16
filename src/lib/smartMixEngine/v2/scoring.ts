import {
  getSmartMixMetadataFallbacks,
  getTrackBpm,
  getTrackEnergy,
  getTrackMood,
  getTrackPopularity,
  NEUTRAL_POPULARITY_SCORE,
} from "./metadataFallbacks";
import { normalizeMoodBlendConfig, scoreMoodBlendForTrack } from "./moodBlending";
import { applyTuningToCandidateScore, normalizeSmartMixTuningConfig, tuningWeightFactor } from "./tuning";
import { SMART_MIX_ENGINE_V2, type SmartMixEngineV2Config, type SmartMixRuleLike, type SmartMixRuleTree, type SmartMixScoredTrack, type SmartMixScoreBreakdown } from "./types";
import { scorePersonalizationAdjustment } from "../../personalization/scoring";
import { scorePlaylistIdentityTrack } from "../../playlistIdentity/scoring";
import { scoreAdaptiveSmartMixTrack } from "../../adaptiveScoring/scoring";
import { scorePlaybackAwareTrack } from "../../playbackAwareness/scoring";

const metadataRuleFields = new Set(["tempo", "valence", "energy", "popularity"]);

function collectRules(node: SmartMixRuleTree | undefined, fallbackRules: SmartMixRuleLike[] = []): SmartMixRuleLike[] {
  if (!node) return fallbackRules;
  if (!("type" in node) || node.type !== "group") return [node as SmartMixRuleLike];
  return (node.children || []).flatMap((child) => collectRules(child, []));
}

function numericRulesFor(config: SmartMixEngineV2Config, field: string) {
  return collectRules(config.ruleTree, config.rules || []).filter((rule) => rule.field === field);
}

function numberFromRule(rule: SmartMixRuleLike) {
  const parsed = Number(rule.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericRuleMatches(value: number, rule: SmartMixRuleLike) {
  const expected = numberFromRule(rule);
  if (expected == null) return true;
  if (rule.operator === "eq") return value === expected;
  if (rule.operator === "gt") return value > expected;
  if (rule.operator === "lt") return value < expected;
  if (rule.operator === "gte") return value >= expected;
  if (rule.operator === "lte") return value <= expected;
  return true;
}

function scoreNumericField({
  value,
  rules,
  noRuleBonus,
  matchBonus,
  missPenalty,
}: {
  value: number | null;
  rules: SmartMixRuleLike[];
  noRuleBonus: number;
  matchBonus: number;
  missPenalty: number;
}) {
  if (value == null) return undefined;
  if (rules.length === 0) return noRuleBonus;
  return rules.every((rule) => numericRuleMatches(value, rule)) ? matchBonus : missPenalty;
}

function fallbackPenalty(missingFields: string[]) {
  return missingFields.reduce((penalty, field) => {
    if (field === "bpm") return penalty - 1.5;
    if (field === "popularity") return penalty - 0.5;
    return penalty - 1;
  }, 0);
}

function roundScore(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function hasSmartMixMetadataRule(config: SmartMixEngineV2Config) {
  return collectRules(config.ruleTree, config.rules || []).some((rule) => metadataRuleFields.has(rule.field));
}

export function applyAdaptiveScoringToTrack<TTrack extends Record<string, any>>(
  track: SmartMixScoredTrack<TTrack>,
  config: SmartMixEngineV2Config,
): SmartMixScoredTrack<TTrack> {
  const baseScore = roundScore(track.score);
  const scoreBreakdown = { ...track.scoreBreakdown };
  const personalizationScore = config.personalization?.profile.enabled
    ? scorePersonalizationAdjustment(baseScore, track, config.personalization)
    : null;
  const identityScore = scorePlaylistIdentityTrack(track, config.playlistIdentity);
  const adaptiveScore = config.adaptiveScoring
    ? scoreAdaptiveSmartMixTrack(baseScore, track, config.adaptiveScoring)
    : null;
  if (adaptiveScore) {
    const byKey = Object.fromEntries(adaptiveScore.components.map((item) => [item.key, item.appliedAdjustment]));
    scoreBreakdown.personalPreference = byKey.personalPreference || 0;
    scoreBreakdown.playlistIdentity = byKey.playlistIdentity || 0;
    scoreBreakdown.historicalAcceptance = byKey.historicalAcceptance || 0;
    scoreBreakdown.historicalRejection = byKey.historicalRejection || 0;
    scoreBreakdown.artistPreference = byKey.artistPreference || 0;
    scoreBreakdown.moodPreference = byKey.moodPreference || 0;
    scoreBreakdown.discoveryTolerance = byKey.discoveryTolerance || 0;
    scoreBreakdown.repeatTolerance = byKey.repeatTolerance || 0;
    scoreBreakdown.personalization = adaptiveScore.cappedAdjustment;
    scoreBreakdown.trackFeedback = personalizationScore?.components?.trackFeedbackAdjustment || 0;
    scoreBreakdown.artistFeedback = personalizationScore?.components?.artistFeedbackAdjustment || 0;
    scoreBreakdown.playlistFitFeedback = personalizationScore?.components?.playlistFitAdjustment || 0;
  } else {
    if (personalizationScore) {
      scoreBreakdown.playlistPreference = personalizationScore.playlistContextScore;
      scoreBreakdown.personalization = personalizationScore.personalizationAdjustment;
      scoreBreakdown.trackFeedback = personalizationScore.components?.trackFeedbackAdjustment || 0;
      scoreBreakdown.artistFeedback = personalizationScore.components?.artistFeedbackAdjustment || 0;
      scoreBreakdown.playlistFitFeedback = personalizationScore.components?.playlistFitAdjustment || 0;
      scoreBreakdown.learnedProfile = personalizationScore.components?.learnedProfileAdjustment || 0;
    }
    if (identityScore.applied) scoreBreakdown.playlistIdentity = identityScore.adjustment;
  }
  const legacyScoreBeforeIdentity = personalizationScore?.finalScore ?? baseScore;
  const finalScore = adaptiveScore
    ? adaptiveScore.personalizedScore
    : identityScore.excluded ? legacyScoreBeforeIdentity : roundScore(legacyScoreBeforeIdentity + identityScore.adjustment);
  const alreadyExcluded = adaptiveScore?.excluded || personalizationScore?.excluded || identityScore.excluded;
  const playbackScore = !alreadyExcluded && config.playbackScoring
    ? scorePlaybackAwareTrack(finalScore, track, config.playbackScoring)
    : null;
  if (playbackScore) {
    scoreBreakdown.playback = playbackScore.appliedAdjustment;
    for (const item of playbackScore.reasons) {
      if (item.key === "recent") scoreBreakdown.recentlyPlayedPlayback = (scoreBreakdown.recentlyPlayedPlayback || 0) + item.adjustment;
      if (item.key === "completion") scoreBreakdown.playbackCompletion = (scoreBreakdown.playbackCompletion || 0) + item.adjustment;
      if (item.key === "replay") scoreBreakdown.playbackReplay = (scoreBreakdown.playbackReplay || 0) + item.adjustment;
      if (item.key === "skip") scoreBreakdown.playbackSkip = (scoreBreakdown.playbackSkip || 0) + item.adjustment;
      if (item.key === "forgotten") scoreBreakdown.forgottenFavorite = (scoreBreakdown.forgottenFavorite || 0) + item.adjustment;
      if (item.key === "discovery") scoreBreakdown.playbackDiscovery = (scoreBreakdown.playbackDiscovery || 0) + item.adjustment;
    }
  }
  const scoreAfterPlayback = playbackScore?.finalScore ?? finalScore;
  return {
    ...track,
    score: scoreAfterPlayback,
    baseScore,
    personalizedScore: scoreAfterPlayback,
    scoreBreakdown,
    ...(personalizationScore ? { personalizationScore } : {}),
    ...(identityScore.applied ? { playlistIdentityScore: identityScore } : {}),
    ...(adaptiveScore ? { adaptiveScore } : {}),
    ...(playbackScore ? { playbackScore } : {}),
    ...(alreadyExcluded || playbackScore?.excluded
      ? { exclusionReason: adaptiveScore?.exclusionReason || personalizationScore?.exclusionReason || identityScore.exclusionReason || playbackScore?.exclusionReason }
      : {}),
  };
}

export function scoreSmartMixTrack<TTrack extends Record<string, any>>(
  track: TTrack,
  config: SmartMixEngineV2Config,
): SmartMixScoredTrack<TTrack> {
  const fallback = getSmartMixMetadataFallbacks(track);
  const tuning = normalizeSmartMixTuningConfig(config.tuningConfig);
  const recentlyUsedTrackIds = new Set(Array.isArray(config.recentlyUsedTrackIds) ? config.recentlyUsedTrackIds : []);
  const moodBlend = normalizeMoodBlendConfig(config);
  const popularity = getTrackPopularity(track);
  const basePopularityScore = clamp(popularity ?? NEUTRAL_POPULARITY_SCORE, 0, 100) / 10;
  const recentlyUsedPenalty = tuning.avoidRecentlyUsedTracks && track.id && recentlyUsedTrackIds.has(track.id)
    ? -(8 + tuning.recommendationStrength / 100 * 6)
    : 0;
  const scoreBreakdown: SmartMixScoreBreakdown = {
    base: 50,
    bpm: scoreNumericField({
      value: getTrackBpm(track),
      rules: numericRulesFor(config, "tempo"),
      noRuleBonus: 1 * tuningWeightFactor(tuning.bpmWeight),
      matchBonus: 5 * tuningWeightFactor(tuning.bpmWeight),
      missPenalty: -2 * tuningWeightFactor(tuning.bpmWeight),
    }),
    mood: scoreNumericField({
      value: getTrackMood(track),
      rules: numericRulesFor(config, "valence"),
      noRuleBonus: 1 * tuningWeightFactor(tuning.moodWeight),
      matchBonus: 4 * tuningWeightFactor(tuning.moodWeight),
      missPenalty: -1.5 * tuningWeightFactor(tuning.moodWeight),
    }),
    energy: scoreNumericField({
      value: getTrackEnergy(track),
      rules: numericRulesFor(config, "energy"),
      noRuleBonus: 1 * tuningWeightFactor(tuning.energyWeight),
      matchBonus: 4 * tuningWeightFactor(tuning.energyWeight),
      missPenalty: -1.5 * tuningWeightFactor(tuning.energyWeight),
    }),
    popularity: basePopularityScore,
    fallbackPenalty: fallbackPenalty(fallback.metadataStatus.missingFields),
    recentlyUsedPenalty,
    diversity: 0,
  };
  const moodBlendScore = moodBlend.enabled && moodBlend.moodBlendMode !== "smooth_transition"
    ? scoreMoodBlendForTrack({ track, config, position: 0, limit: config.limit })
    : null;
  if (moodBlendScore) scoreBreakdown.moodBlend = moodBlendScore.score;

  const untunedScore = Object.values(scoreBreakdown)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  const tunedScore = applyTuningToCandidateScore({
    track,
    baseScore: untunedScore,
    tuningConfig: tuning,
    recentlyUsedTrackIds,
  });
  scoreBreakdown.tuning = roundScore(tunedScore - untunedScore);

  const fallbacksApplied = [
    ...fallback.fallbacksApplied,
    ...(recentlyUsedPenalty < 0 ? ["recently used: softened ranking"] : []),
  ];

  const baseTrack = {
    ...track,
    engineVersion: SMART_MIX_ENGINE_V2,
    score: roundScore(tunedScore),
    baseScore: roundScore(tunedScore),
    personalizedScore: roundScore(tunedScore),
    scoreBreakdown,
    metadataStatus: fallback.metadataStatus,
    fallbacksApplied,
    ...(moodBlendScore ? { moodBlend: moodBlendScore.data } : {}),
  } as SmartMixScoredTrack<TTrack>;
  return applyAdaptiveScoringToTrack(baseTrack, config);
}
