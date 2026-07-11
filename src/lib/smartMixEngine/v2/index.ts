import { SMART_MIX_ENGINE_V2_PIPELINE } from "./pipeline";
import { scoreSmartMixTrack } from "./scoring";
import { normalizeMoodBlendConfig, scoreMoodBlendForTrack, summarizeMoodBlend } from "./moodBlending";
import { orderTracksByBpmFlow, summarizeBpmFlow } from "./bpmFlow";
import {
  applyTuningToTransitionScore,
  buildTuningWarnings,
  normalizeSmartMixTuningConfig,
  tuningVarietyPenalty,
} from "./tuning";
import { SMART_MIX_ENGINE_V2, type SmartMixEngineV2Config, type SmartMixScoredTrack } from "./types";

export * from "./metadataFallbacks";
export * from "./bpmFlow";
export * from "./moodBlending";
export * from "./pipeline";
export * from "./scoring";
export * from "./tuning";
export * from "./types";

type SafetyResult<TTrack> = {
  tracks: TTrack[];
  metadata: Record<string, any>;
};

export type SmartMixEngineV2RunInput<TTrack extends Record<string, any>> = {
  config: SmartMixEngineV2Config;
  pinnedTracks: TTrack[];
  candidates: TTrack[];
  safetyCandidateLimit: number;
  applyDuplicatePolicy: (tracks: SmartMixScoredTrack<TTrack>[], config: SmartMixEngineV2Config, limit: number) => SmartMixScoredTrack<TTrack>[];
  applyPlaylistSafetyRules: (tracks: SmartMixScoredTrack<TTrack>[], config: SmartMixEngineV2Config) => SafetyResult<SmartMixScoredTrack<TTrack>>;
};

export type SmartMixEngineV2RunResult<TTrack extends Record<string, any>> = {
  engineVersion: typeof SMART_MIX_ENGINE_V2;
  tracks: SmartMixScoredTrack<TTrack>[];
  safety: SafetyResult<SmartMixScoredTrack<TTrack>>;
  diagnostics: {
    pipeline: typeof SMART_MIX_ENGINE_V2_PIPELINE;
    candidateCount: number;
    scoredCandidateCount: number;
    selectedCandidateCount: number;
    pinnedTrackCount: number;
    fallbackSummary: Record<string, number>;
    tuningPreset?: string;
    tuningWarnings: string[];
    moodBlendMode: string;
    selectedMoodPath: string[];
    allowedMoods: string[];
    moodCurve: any;
    moodCoverage: any;
    moodWarnings: string[];
    moodStrength: number;
    transitionSmoothness: number;
    moodStrictness: number;
    fallbackTolerance: number;
    bridgeTrackPreference: number;
    moodVariety: number;
    conflictSensitivity: number;
    selectedMoodPreset: string;
    moodFallbackCount: number;
    moodConflictCount: number;
    multiMoodBridgeTracks: string[];
    missingMoodCount: number;
    bpmFlow: ReturnType<typeof summarizeBpmFlow>;
  };
};

function fallbackSummary(tracks: SmartMixScoredTrack[]) {
  return tracks.reduce<Record<string, number>>((summary, track) => {
    for (const field of track.metadataStatus.missingFields) {
      summary[field] = (summary[field] || 0) + 1;
    }
    if (track.metadataStatus.missingFields.length > 0) {
      summary.tracksWithFallbacks = (summary.tracksWithFallbacks || 0) + 1;
    }
    return summary;
  }, {});
}

function removeInternalSortIndex<TTrack extends Record<string, any>>(
  track: SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex?: number },
) {
  const { smartMixV2OriginalIndex: _smartMixV2OriginalIndex, ...publicTrack } = track;
  return publicTrack as SmartMixScoredTrack<TTrack>;
}

function selectTunedCandidates<TTrack extends Record<string, any>>(
  sortedCandidates: Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex: number }>,
  config: SmartMixEngineV2Config,
  limit: number,
) {
  const tuning = normalizeSmartMixTuningConfig(config.tuningConfig);
  const moodBlend = normalizeMoodBlendConfig(config);
  const remaining = [...sortedCandidates];
  const selected: Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex: number }> = [];

  while (remaining.length > 0 && selected.length < limit) {
    const poolSize = moodBlend.enabled
      ? Math.min(remaining.length, Math.max(50, limit * 8))
      : Math.min(remaining.length, Math.max(12, limit * 3));
    const pool = remaining.slice(0, poolSize);
    const previousTrack = selected[selected.length - 1];
    let bestTrack = pool[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of pool) {
      const position = selected.length;
      const moodBlendScore = moodBlend.enabled
        ? scoreMoodBlendForTrack({ track: candidate, config, position, limit })
        : null;
      const transitionScore = previousTrack
        ? applyTuningToTransitionScore({ leftTrack: previousTrack, rightTrack: candidate, tuningConfig: tuning })
        : 0;
      const varietyPenalty = tuningVarietyPenalty({ track: candidate, selectedTracks: selected, tuningConfig: tuning });
      const existingMoodBlend = candidate.scoreBreakdown.moodBlend || 0;
      const positionMoodBlend = moodBlendScore?.score || existingMoodBlend;
      const candidateScore = candidate.score - existingMoodBlend + positionMoodBlend + transitionScore - varietyPenalty;
      if (
        candidateScore > bestScore
        || (candidateScore === bestScore && candidate.smartMixV2OriginalIndex < bestTrack.smartMixV2OriginalIndex)
      ) {
        bestTrack = moodBlendScore
          ? {
              ...candidate,
              score: Math.round((candidate.score - existingMoodBlend + positionMoodBlend) * 1000) / 1000,
              scoreBreakdown: {
                ...candidate.scoreBreakdown,
                moodBlend: moodBlendScore.score,
              },
              moodBlend: moodBlendScore.data,
            }
          : candidate;
        bestScore = candidateScore;
      }
    }

    selected.push(bestTrack);
    const removeIndex = remaining.findIndex((candidate) => candidate.smartMixV2OriginalIndex === bestTrack.smartMixV2OriginalIndex);
    if (removeIndex >= 0) remaining.splice(removeIndex, 1);
    else remaining.shift();
  }

  return selected;
}

function attachBpmTransitionMetadata<TTrack extends Record<string, any>>(
  tracks: Array<SmartMixScoredTrack<TTrack>>,
  bpmFlow: ReturnType<typeof summarizeBpmFlow>,
) {
  return tracks.map((track, index) => ({
    ...track,
    bpmTransitionFromPrevious: index === 0 ? null : bpmFlow.transitionAnalyses[index - 1] || null,
  }));
}

export function runSmartMixEngineV2<TTrack extends Record<string, any>>({
  config,
  pinnedTracks,
  candidates,
  safetyCandidateLimit,
  applyDuplicatePolicy,
  applyPlaylistSafetyRules,
}: SmartMixEngineV2RunInput<TTrack>): SmartMixEngineV2RunResult<TTrack> {
  const tuning = normalizeSmartMixTuningConfig(config.tuningConfig);
  const scoredPinnedTracks = pinnedTracks.map((track) => scoreSmartMixTrack(track, config));
  const scoredCandidates = candidates.map((track, index) => ({
    ...scoreSmartMixTrack(track, config),
    smartMixV2OriginalIndex: index,
  }));

  const sortedCandidates = [...scoredCandidates].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.smartMixV2OriginalIndex - right.smartMixV2OriginalIndex;
  });
  const tunedCandidates = selectTunedCandidates(sortedCandidates, config, safetyCandidateLimit);
  const bpmOrderedCandidates = orderTracksByBpmFlow({
    tracks: tunedCandidates,
    tuningConfig: tuning,
    baseScore: (track) => track.score,
  });
  const selectedCandidates = applyDuplicatePolicy(bpmOrderedCandidates, config, safetyCandidateLimit);
  const safety = applyPlaylistSafetyRules(scoredPinnedTracks.concat(selectedCandidates), config);
  const bpmFlow = summarizeBpmFlow(safety.tracks, tuning.bpmFlow);
  const tracks = attachBpmTransitionMetadata(safety.tracks.map(removeInternalSortIndex), bpmFlow);
  const tuningWarnings = buildTuningWarnings({ tracks, tuningConfig: tuning });
  const moodBlendSummary = summarizeMoodBlend({
    tracks,
    candidates: scoredCandidates as any[],
    config,
  });
  if (moodBlendSummary.moodBlendMode !== "off") {
    console.info("[SmartMixV2:MoodBlend]", {
      selectedMoodPath: moodBlendSummary.selectedMoodPath,
      allowedMoods: moodBlendSummary.allowedMoods,
      normalizedTargetMoods: moodBlendSummary.activeMoods,
      moodCoverage: moodBlendSummary.moodCoverage?.preview || moodBlendSummary.moodCoverage,
      missingMoodCount: moodBlendSummary.missingMoodCount,
      moodFallbackCount: moodBlendSummary.moodFallbackCount,
      moodConflictCount: moodBlendSummary.moodConflictCount,
    });
  }
  if (bpmFlow.config.enabled && bpmFlow.config.mode !== "DISABLED") {
    console.info("[SmartMixV2:BpmFlow]", {
      candidateCount: candidates.length,
      validBpmTrackCount: bpmFlow.validBpmTrackCount,
      missingBpmTrackCount: bpmFlow.missingBpmTrackCount,
      selectedStartingBpm: bpmFlow.startingBpm,
      requestedMode: bpmFlow.config.mode,
      effectiveMode: bpmFlow.config.mode,
      totalTransitionScore: bpmFlow.averageTransitionScore,
      largestEffectiveGap: bpmFlow.largestEffectiveGap,
      rejectedCandidates: 0,
      directionConflicts: bpmFlow.directionConflictCount,
      hardGapRelaxations: bpmFlow.hardTransitionCount,
      halfDoubleTimeMatches: bpmFlow.halfDoubleTimeMatchCount,
    });
  }

  return {
    engineVersion: SMART_MIX_ENGINE_V2,
    tracks,
    safety: {
      ...safety,
      tracks,
    },
    diagnostics: {
      pipeline: SMART_MIX_ENGINE_V2_PIPELINE,
      candidateCount: candidates.length,
      scoredCandidateCount: scoredCandidates.length,
      selectedCandidateCount: selectedCandidates.length,
      pinnedTrackCount: pinnedTracks.length,
      fallbackSummary: fallbackSummary(tracks),
      tuningPreset: tuning.presetName,
      tuningWarnings,
      moodBlendMode: moodBlendSummary.moodBlendMode,
      selectedMoodPath: moodBlendSummary.selectedMoodPath,
      allowedMoods: moodBlendSummary.allowedMoods,
      moodCurve: moodBlendSummary.moodCurve,
      moodCoverage: moodBlendSummary.moodCoverage,
      moodWarnings: moodBlendSummary.moodWarnings,
      moodStrength: moodBlendSummary.moodStrength,
      transitionSmoothness: moodBlendSummary.transitionSmoothness,
      moodStrictness: moodBlendSummary.moodStrictness,
      fallbackTolerance: moodBlendSummary.fallbackTolerance,
      bridgeTrackPreference: moodBlendSummary.bridgeTrackPreference,
      moodVariety: moodBlendSummary.moodVariety,
      conflictSensitivity: moodBlendSummary.conflictSensitivity,
      selectedMoodPreset: moodBlendSummary.selectedMoodPreset,
      moodFallbackCount: moodBlendSummary.moodFallbackCount,
      moodConflictCount: moodBlendSummary.moodConflictCount,
      multiMoodBridgeTracks: moodBlendSummary.multiMoodBridgeTracks,
      missingMoodCount: moodBlendSummary.missingMoodCount,
      bpmFlow,
    },
  };
}
