import { getTrackBpm, getTrackEnergy, getTrackMood } from "./metadataFallbacks";
import type { SmartMixTuningConfig } from "./tuning";
import { PLAYLIST_GENERATION_LIMITS } from "../../playlistGenerationLimits";
import type { PlaylistGenerationControl } from "../../playlistGenerationControl";

export const bpmFlowModes = ["RAMP_UP", "RAMP_DOWN", "STEADY", "NATURAL", "DISABLED"] as const;
export const bpmStartingModes = ["AUTO", "LOWEST", "HIGHEST", "CUSTOM", "SEED"] as const;

export type BpmFlowMode = typeof bpmFlowModes[number];
export type BpmStartingMode = typeof bpmStartingModes[number];

export type BpmFlowConfig = {
  enabled: boolean;
  mode: BpmFlowMode;
  strength: number;
  maxPreferredGap: number;
  allowJumps: boolean;
  halfDoubleTimeMatching: boolean;
  startingBpmMode: BpmStartingMode;
  customStartingBpm: number | null;
};

export type BpmTransitionDifficulty = "Easy" | "Moderate" | "Difficult" | "Hard" | "Unknown";
export type BpmTransitionRelationship = "direct" | "half-time" | "double-time" | "unknown";
export type BpmTransitionDirection = "up" | "down" | "steady" | "unknown";

export type BpmTransitionAnalysis = {
  fromBpm: number | null;
  toBpm: number | null;
  rawGap: number | null;
  effectiveGap: number | null;
  normalizedFromBpm: number | null;
  normalizedToBpm: number | null;
  relationship: BpmTransitionRelationship;
  direction: BpmTransitionDirection;
  exceedsPreferredGap: boolean;
  exceedsHardGap: boolean;
};

export type BpmTransitionScore = BpmTransitionAnalysis & {
  score: number | null;
  difficulty: BpmTransitionDifficulty;
  directionConflict: boolean;
  reason: string;
};

export type BpmFlowSummary = {
  config: BpmFlowConfig;
  transitionAnalyses: BpmTransitionScore[];
  averageTransitionScore: number | null;
  medianEffectiveGap: number | null;
  averageEffectiveGap: number | null;
  largestEffectiveGap: number | null;
  easyTransitionCount: number;
  moderateTransitionCount: number;
  difficultTransitionCount: number;
  hardTransitionCount: number;
  unknownTransitionCount: number;
  halfDoubleTimeMatchCount: number;
  directionConflictCount: number;
  fallbackTransitionCount: number;
  validBpmTrackCount: number;
  missingBpmTrackCount: number;
  startingBpm: number | null;
  endingBpm: number | null;
  lowestBpm: number | null;
  highestBpm: number | null;
  bpmFlowScore: number | null;
  warnings: string[];
  explanation: string;
};

export const DEFAULT_BPM_FLOW_CONFIG: BpmFlowConfig = {
  enabled: false,
  mode: "DISABLED",
  strength: 70,
  maxPreferredGap: 8,
  allowJumps: false,
  halfDoubleTimeMatching: true,
  startingBpmMode: "AUTO",
  customStartingBpm: null,
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function normalizedSlider(value: number) {
  return clamp(value, 0, 100) / 100;
}

function tuningWeightFactor(value: number) {
  return 0.2 + normalizedSlider(value) * 1.6;
}

function hasValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function normalizeBpmFlowConfig(value: unknown): BpmFlowConfig {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<BpmFlowConfig>
    : {};
  const mode = hasValue(bpmFlowModes, source.mode) ? source.mode : DEFAULT_BPM_FLOW_CONFIG.mode;
  const customStartingBpm = finiteNumber(source.customStartingBpm);

  return {
    enabled: Boolean(source.enabled ?? mode !== "DISABLED"),
    mode,
    strength: clamp(finiteNumber(source.strength) ?? DEFAULT_BPM_FLOW_CONFIG.strength, 0, 100),
    maxPreferredGap: clamp(finiteNumber(source.maxPreferredGap) ?? DEFAULT_BPM_FLOW_CONFIG.maxPreferredGap, 1, 40),
    allowJumps: Boolean(source.allowJumps ?? DEFAULT_BPM_FLOW_CONFIG.allowJumps),
    halfDoubleTimeMatching: Boolean(source.halfDoubleTimeMatching ?? DEFAULT_BPM_FLOW_CONFIG.halfDoubleTimeMatching),
    startingBpmMode: hasValue(bpmStartingModes, source.startingBpmMode) ? source.startingBpmMode : DEFAULT_BPM_FLOW_CONFIG.startingBpmMode,
    customStartingBpm: customStartingBpm == null ? null : clamp(customStartingBpm, 40, 240),
  };
}

function transitionDirection(from: number | null, to: number | null): BpmTransitionDirection {
  if (from == null || to == null) return "unknown";
  const diff = to - from;
  if (Math.abs(diff) <= 1) return "steady";
  return diff > 0 ? "up" : "down";
}

function directionConflict(direction: BpmTransitionDirection, mode: BpmFlowMode) {
  if (direction === "unknown" || direction === "steady") return false;
  if (mode === "RAMP_UP") return direction === "down";
  if (mode === "RAMP_DOWN") return direction === "up";
  return false;
}

export function analyzeBpmTransition({
  fromBpm,
  toBpm,
  maxPreferredGap,
  halfDoubleTimeMatching,
  tolerance = 2,
}: {
  fromBpm: number | null;
  toBpm: number | null;
  maxPreferredGap: number;
  halfDoubleTimeMatching: boolean;
  tolerance?: number;
}): BpmTransitionAnalysis {
  if (fromBpm == null || toBpm == null) {
    return {
      fromBpm,
      toBpm,
      rawGap: null,
      effectiveGap: null,
      normalizedFromBpm: null,
      normalizedToBpm: null,
      relationship: "unknown",
      direction: "unknown",
      exceedsPreferredGap: false,
      exceedsHardGap: false,
    };
  }

  const rawGap = Math.abs(toBpm - fromBpm);
  const candidates: Array<Pick<BpmTransitionAnalysis, "effectiveGap" | "normalizedFromBpm" | "normalizedToBpm" | "relationship">> = [
    {
      effectiveGap: rawGap,
      normalizedFromBpm: fromBpm,
      normalizedToBpm: toBpm,
      relationship: "direct",
    },
  ];

  if (halfDoubleTimeMatching) {
    candidates.push(
      {
        effectiveGap: Math.abs(fromBpm - toBpm / 2),
        normalizedFromBpm: fromBpm,
        normalizedToBpm: toBpm / 2,
        relationship: "half-time",
      },
      {
        effectiveGap: Math.abs(fromBpm * 2 - toBpm),
        normalizedFromBpm: fromBpm * 2,
        normalizedToBpm: toBpm,
        relationship: "double-time",
      },
      {
        effectiveGap: Math.abs(fromBpm / 2 - toBpm),
        normalizedFromBpm: fromBpm / 2,
        normalizedToBpm: toBpm,
        relationship: "half-time",
      },
      {
        effectiveGap: Math.abs(fromBpm - toBpm * 2),
        normalizedFromBpm: fromBpm,
        normalizedToBpm: toBpm * 2,
        relationship: "double-time",
      },
    );
  }

  const sorted = candidates
    .filter((candidate) => candidate.relationship === "direct" || candidate.effectiveGap! <= tolerance)
    .sort((left, right) => {
      if (left.effectiveGap !== right.effectiveGap) return left.effectiveGap! - right.effectiveGap!;
      if (left.relationship === "direct") return -1;
      if (right.relationship === "direct") return 1;
      return 0;
    });
  const best = sorted[0] || candidates[0];
  const effectiveGap = round(best.effectiveGap || 0);

  return {
    fromBpm,
    toBpm,
    rawGap: round(rawGap),
    effectiveGap,
    normalizedFromBpm: round(best.normalizedFromBpm || fromBpm),
    normalizedToBpm: round(best.normalizedToBpm || toBpm),
    relationship: best.relationship || "direct",
    direction: transitionDirection(best.normalizedFromBpm || fromBpm, best.normalizedToBpm || toBpm),
    exceedsPreferredGap: effectiveGap > maxPreferredGap,
    exceedsHardGap: effectiveGap > maxPreferredGap * 1.75,
  };
}

export function scoreBpmTransition({
  fromTrack,
  toTrack,
  config,
}: {
  fromTrack: any;
  toTrack: any;
  config: BpmFlowConfig;
}): BpmTransitionScore {
  const analysis = analyzeBpmTransition({
    fromBpm: getTrackBpm(fromTrack),
    toBpm: getTrackBpm(toTrack),
    maxPreferredGap: config.maxPreferredGap,
    halfDoubleTimeMatching: config.halfDoubleTimeMatching,
  });

  if (analysis.effectiveGap == null) {
    return {
      ...analysis,
      score: null,
      difficulty: "Unknown",
      directionConflict: false,
      reason: "BPM unknown for one or both tracks.",
    };
  }

  const conflict = directionConflict(analysis.direction, config.mode);
  const strengthFactor = 0.5 + config.strength / 100;
  let score = 100;
  score -= Math.min(55, (analysis.effectiveGap / Math.max(1, config.maxPreferredGap)) * 20 * strengthFactor);
  if (analysis.exceedsPreferredGap) score -= config.allowJumps ? 10 + config.strength * 0.08 : 18 + config.strength * 0.14;
  if (analysis.exceedsHardGap) score -= config.allowJumps ? 12 : 26;
  if (conflict) score -= 12 + config.strength * 0.12;
  if (analysis.relationship !== "direct") score += 6;

  const rounded = Math.round(clamp(score, 0, 100));
  const difficulty: BpmTransitionDifficulty = rounded >= 90
    ? "Easy"
    : rounded >= 70
    ? "Moderate"
    : rounded >= 40
    ? "Difficult"
    : "Hard";
  const reasonParts = [
    `${analysis.effectiveGap} BPM effective gap`,
    analysis.relationship !== "direct" ? `${analysis.relationship} match` : "",
    conflict ? "ramp direction conflict" : "",
    analysis.exceedsPreferredGap ? `exceeds preferred gap by ${round(analysis.effectiveGap - config.maxPreferredGap, 1)} BPM` : "",
  ].filter(Boolean);

  return {
    ...analysis,
    score: rounded,
    difficulty,
    directionConflict: conflict,
    reason: reasonParts.join("; ") || "Smooth BPM transition.",
  };
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarizeBpmFlow(tracks: any[], configValue: unknown): BpmFlowSummary {
  const config = normalizeBpmFlowConfig(configValue);
  const bpms = tracks.map(getTrackBpm);
  const knownBpms = bpms.filter((value): value is number => value != null);
  const transitionAnalyses: BpmTransitionScore[] = [];
  for (let index = 1; index < tracks.length; index += 1) {
    transitionAnalyses.push(scoreBpmTransition({ fromTrack: tracks[index - 1], toTrack: tracks[index], config }));
  }

  const knownScores = transitionAnalyses.map((transition) => transition.score).filter((value): value is number => value != null);
  const effectiveGaps = transitionAnalyses.map((transition) => transition.effectiveGap).filter((value): value is number => value != null);
  const count = (difficulty: BpmTransitionDifficulty) => transitionAnalyses.filter((transition) => transition.difficulty === difficulty).length;
  const averageTransitionScore = knownScores.length ? round(knownScores.reduce((sum, value) => sum + value, 0) / knownScores.length, 1) : null;
  const missingRatio = tracks.length ? (tracks.length - knownBpms.length) / tracks.length : 0;
  const bpmFlowScore = averageTransitionScore == null ? null : Math.round(clamp(averageTransitionScore - missingRatio * 10, 0, 100));
  const halfDoubleTimeMatchCount = transitionAnalyses.filter((transition) => transition.relationship !== "direct" && transition.relationship !== "unknown").length;
  const directionConflictCount = transitionAnalyses.filter((transition) => transition.directionConflict).length;
  const preferredGapFailures = transitionAnalyses.filter((transition) => transition.exceedsPreferredGap).length;
  const warnings: string[] = [];

  if (tracks.length > 1 && knownBpms.length < Math.ceil(tracks.length * 0.7)) {
    warnings.push(`${tracks.length - knownBpms.length} tracks were missing BPM metadata, so BPM flow quality may be limited.`);
  }
  if (!config.allowJumps && preferredGapFailures > 0) {
    warnings.push(`The maximum BPM gap could not be maintained for ${preferredGapFailures} transition${preferredGapFailures === 1 ? "" : "s"}.`);
  }
  if (directionConflictCount > 0 && (config.mode === "RAMP_UP" || config.mode === "RAMP_DOWN")) {
    warnings.push(`${directionConflictCount} transition${directionConflictCount === 1 ? "" : "s"} conflicted with the selected BPM ramp direction.`);
  }
  if (halfDoubleTimeMatchCount > 0) {
    warnings.push(`Half-time or double-time matching was used for ${halfDoubleTimeMatchCount} transition${halfDoubleTimeMatchCount === 1 ? "" : "s"}.`);
  }

  return {
    config,
    transitionAnalyses,
    averageTransitionScore,
    medianEffectiveGap: median(effectiveGaps),
    averageEffectiveGap: effectiveGaps.length ? round(effectiveGaps.reduce((sum, value) => sum + value, 0) / effectiveGaps.length, 1) : null,
    largestEffectiveGap: effectiveGaps.length ? Math.max(...effectiveGaps) : null,
    easyTransitionCount: count("Easy"),
    moderateTransitionCount: count("Moderate"),
    difficultTransitionCount: count("Difficult"),
    hardTransitionCount: count("Hard"),
    unknownTransitionCount: count("Unknown"),
    halfDoubleTimeMatchCount,
    directionConflictCount,
    fallbackTransitionCount: transitionAnalyses.filter((transition) => transition.difficulty === "Unknown" || transition.exceedsPreferredGap).length,
    validBpmTrackCount: knownBpms.length,
    missingBpmTrackCount: tracks.length - knownBpms.length,
    startingBpm: knownBpms[0] ?? null,
    endingBpm: knownBpms[knownBpms.length - 1] ?? null,
    lowestBpm: knownBpms.length ? Math.min(...knownBpms) : null,
    highestBpm: knownBpms.length ? Math.max(...knownBpms) : null,
    bpmFlowScore,
    warnings,
    explanation: bpmFlowScore == null
      ? "BPM flow could not be scored because too much BPM metadata is missing."
      : `This playlist used ${config.mode.replace("_", " ").toLowerCase()} mode with a ${config.maxPreferredGap} BPM preferred maximum gap.`,
  };
}

function startingTrackIndex<TTrack extends Record<string, any>>(tracks: TTrack[], config: BpmFlowConfig) {
  if (tracks.length === 0) return -1;
  const withBpm = tracks
    .map((track, index) => ({ track, index, bpm: getTrackBpm(track) }))
    .filter((item): item is { track: TTrack; index: number; bpm: number } => item.bpm != null);
  if (withBpm.length === 0) return 0;

  if (config.startingBpmMode === "LOWEST" || (config.startingBpmMode === "AUTO" && config.mode === "RAMP_UP")) {
    return withBpm.sort((left, right) => left.bpm - right.bpm || left.index - right.index)[0].index;
  }
  if (config.startingBpmMode === "HIGHEST" || (config.startingBpmMode === "AUTO" && config.mode === "RAMP_DOWN")) {
    return withBpm.sort((left, right) => right.bpm - left.bpm || left.index - right.index)[0].index;
  }
  const target = config.startingBpmMode === "CUSTOM" && config.customStartingBpm != null
    ? config.customStartingBpm
    : median(withBpm.map((item) => item.bpm)) ?? withBpm[0].bpm;
  return withBpm.sort((left, right) => Math.abs(left.bpm - target) - Math.abs(right.bpm - target) || left.index - right.index)[0].index;
}

function bpmTransitionBonus(transition: BpmTransitionScore, config: BpmFlowConfig) {
  if (transition.score == null) return config.strength >= 70 ? -2 : 0;
  const strength = tuningWeightFactor(config.strength);
  const scoreOffset = (transition.score - 72) / 7;
  const strictJumpPenalty = !config.allowJumps && transition.exceedsPreferredGap ? -8 * strength : 0;
  return scoreOffset * strength + strictJumpPenalty;
}

function* orderTracksByBpmFlowIterator<TTrack extends Record<string, any>>({
  tracks,
  tuningConfig,
  baseScore,
}: {
  tracks: TTrack[];
  tuningConfig: SmartMixTuningConfig;
  baseScore?: (track: TTrack) => number;
}) {
  const config = normalizeBpmFlowConfig(tuningConfig.bpmFlow);
  if (!config.enabled || config.mode === "DISABLED" || tracks.length < 3) return tracks;

  const remaining = [...tracks];
  const selected: TTrack[] = [];
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  const countSelected = (track: any) => {
    const artist = String(track.artistId || track.artist?.id || track.artist?.title || "").toLowerCase();
    const album = String(track.albumId || track.album?.id || track.album?.title || "").toLowerCase();
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    if (album) albumCounts.set(album, (albumCounts.get(album) || 0) + 1);
  };
  const startIndex = startingTrackIndex(remaining, config);
  selected.push(...remaining.splice(Math.max(0, startIndex), 1));
  countSelected(selected[0]);

  while (remaining.length > 0) {
    const previousTrack = selected[selected.length - 1];
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    const lookahead = Math.min(remaining.length, PLAYLIST_GENERATION_LIMITS.maxSelectionAttempts);
    for (let index = 0; index < lookahead; index += 1) {
      const candidate = remaining[index];
      const transition = scoreBpmTransition({ fromTrack: previousTrack, toTrack: candidate, config });
      const energyPenalty = featurePenalty(getTrackEnergy(previousTrack), getTrackEnergy(candidate), 7);
      const moodPenalty = featurePenalty(getTrackMood(previousTrack), getTrackMood(candidate), 5);
      const candidateScore = (baseScore?.(candidate) ?? 0)
        + bpmTransitionBonus(transition, config)
        - energyPenalty
        - moodPenalty
        - varietyPenaltyFromCounts({ track: candidate, artistCounts, albumCounts, tuningConfig });
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestIndex = index;
      }
    }
    selected.push(...remaining.splice(bestIndex, 1));
    countSelected(selected[selected.length - 1]);
    yield { selectedCount: selected.length, total: tracks.length };
  }

  let optimized = selected;
  for (let pass = 0; pass < PLAYLIST_GENERATION_LIMITS.maxOptimizationPasses; pass += 1) optimized = optimizeLocalBpmSwaps(optimized, config, tuningConfig);
  return optimized;
}

export function orderTracksByBpmFlow<TTrack extends Record<string, any>>(input: {
  tracks: TTrack[];
  tuningConfig: SmartMixTuningConfig;
  baseScore?: (track: TTrack) => number;
}) {
  const iterator = orderTracksByBpmFlowIterator(input);
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value;
}

export async function orderTracksByBpmFlowAsync<TTrack extends Record<string, any>>(input: {
  tracks: TTrack[];
  tuningConfig: SmartMixTuningConfig;
  baseScore?: (track: TTrack) => number;
  control: PlaylistGenerationControl;
}) {
  const { control, ...orderingInput } = input;
  const iterator = orderTracksByBpmFlowIterator(orderingInput);
  let step = iterator.next();
  while (!step.done) {
    await control.yield("Optimizing BPM and mood flow", {
      processedCandidates: step.value.selectedCount,
      selectedTracks: step.value.total,
      optimizationPasses: 1,
    }, true);
    step = iterator.next();
  }
  return step.value;
}

function featurePenalty(left: number | null, right: number | null, weight: number) {
  if (left == null || right == null) return 0;
  const normalizedLeft = left > 1 ? left / 100 : left;
  const normalizedRight = right > 1 ? right / 100 : right;
  return Math.abs(normalizedLeft - normalizedRight) * weight;
}

function varietyPenalty({
  track,
  selectedTracks,
  tuningConfig,
}: {
  track: any;
  selectedTracks: any[];
  tuningConfig: SmartMixTuningConfig;
}) {
  const artistKey = String(track.artistId || track.artist?.id || track.artist?.title || "").toLowerCase();
  const albumKey = String(track.albumId || track.album?.id || track.album?.title || "").toLowerCase();
  const artistRepeats = artistKey
    ? selectedTracks.filter((selected) => String(selected.artistId || selected.artist?.id || selected.artist?.title || "").toLowerCase() === artistKey).length
    : 0;
  const albumRepeats = albumKey
    ? selectedTracks.filter((selected) => String(selected.albumId || selected.album?.id || selected.album?.title || "").toLowerCase() === albumKey).length
    : 0;
  return artistRepeats * tuningWeightFactor(tuningConfig.artistVariety) * 3.5
    + albumRepeats * tuningWeightFactor(tuningConfig.albumVariety) * 2.75;
}

function varietyPenaltyFromCounts({
  track,
  artistCounts,
  albumCounts,
  tuningConfig,
}: {
  track: any;
  artistCounts: Map<string, number>;
  albumCounts: Map<string, number>;
  tuningConfig: SmartMixTuningConfig;
}) {
  const artistKey = String(track.artistId || track.artist?.id || track.artist?.title || "").toLowerCase();
  const albumKey = String(track.albumId || track.album?.id || track.album?.title || "").toLowerCase();
  return (artistCounts.get(artistKey) || 0) * tuningWeightFactor(tuningConfig.artistVariety) * 3.5
    + (albumCounts.get(albumKey) || 0) * tuningWeightFactor(tuningConfig.albumVariety) * 2.75;
}

function totalBpmScore(tracks: any[], config: BpmFlowConfig) {
  return summarizeBpmFlow(tracks, config).bpmFlowScore ?? 50;
}

function optimizeLocalBpmSwaps<TTrack extends Record<string, any>>(
  tracks: TTrack[],
  config: BpmFlowConfig,
  tuningConfig: SmartMixTuningConfig,
) {
  if (tracks.length < 4) return tracks;
  const optimized = [...tracks];
  for (let index = 1; index < optimized.length - 2; index += 1) {
    const currentWindow = optimized.slice(Math.max(0, index - 1), Math.min(optimized.length, index + 3));
    const swappedWindow = [...currentWindow];
    [swappedWindow[1], swappedWindow[2]] = [swappedWindow[2], swappedWindow[1]];
    const bpmImprovement = totalBpmScore(swappedWindow, config) - totalBpmScore(currentWindow, config);
    const moodEnergyCost = Math.abs(featurePenalty(getTrackEnergy(swappedWindow[1]), getTrackEnergy(currentWindow[1]), 6))
      + Math.abs(featurePenalty(getTrackMood(swappedWindow[1]), getTrackMood(currentWindow[1]), 4))
      + varietyPenalty({ track: swappedWindow[1], selectedTracks: optimized.slice(0, index), tuningConfig }) * 0.2;
    if (bpmImprovement > 4 + moodEnergyCost) {
      [optimized[index], optimized[index + 1]] = [optimized[index + 1], optimized[index]];
    }
  }
  return optimized;
}
