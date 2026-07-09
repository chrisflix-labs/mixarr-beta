import {
  getSmartMixMetadataFallbacks,
  getTrackBpm,
  getTrackEnergy,
  getTrackMood,
  getTrackPopularity,
  NEUTRAL_POPULARITY_SCORE,
} from "./metadataFallbacks";
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
  const popularity = getTrackPopularity(track);
  const scoreBreakdown: SmartMixScoreBreakdown = {
    base: 50,
    bpm: scoreNumericField({
      value: getTrackBpm(track),
      rules: numericRulesFor(config, "tempo"),
      noRuleBonus: 1,
      matchBonus: 5,
      missPenalty: -2,
    }),
    mood: scoreNumericField({
      value: getTrackMood(track),
      rules: numericRulesFor(config, "valence"),
      noRuleBonus: 1,
      matchBonus: 4,
      missPenalty: -1.5,
    }),
    energy: scoreNumericField({
      value: getTrackEnergy(track),
      rules: numericRulesFor(config, "energy"),
      noRuleBonus: 1,
      matchBonus: 4,
      missPenalty: -1.5,
    }),
    popularity: clamp(popularity ?? NEUTRAL_POPULARITY_SCORE, 0, 100) / 10,
    fallbackPenalty: fallbackPenalty(fallback.metadataStatus.missingFields),
    diversity: 0,
  };

  const score = Object.values(scoreBreakdown)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);

  return {
    ...track,
    engineVersion: SMART_MIX_ENGINE_V2,
    score: roundScore(score),
    scoreBreakdown,
    metadataStatus: fallback.metadataStatus,
    fallbacksApplied: fallback.fallbacksApplied,
  };
}
