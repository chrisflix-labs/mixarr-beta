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

  return {
    ...track,
    engineVersion: SMART_MIX_ENGINE_V2,
    score: roundScore(tunedScore),
    scoreBreakdown,
    metadataStatus: fallback.metadataStatus,
    fallbacksApplied,
    ...(moodBlendScore ? { moodBlend: moodBlendScore.data } : {}),
  };
}
