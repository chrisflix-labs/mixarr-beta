import { SMART_MIX_ENGINE_V2_PIPELINE } from "./pipeline";
import { applyAdaptiveScoringToTrack, scoreSmartMixTrack } from "./scoring";
import { FEEDBACK_SCORING, transitionPairKey } from "../../personalization/feedbackRules";
import { normalizeMoodBlendConfig, scoreMoodBlendForTrack, summarizeMoodBlend } from "./moodBlending";
import { orderTracksByBpmFlow, orderTracksByBpmFlowAsync, summarizeBpmFlow } from "./bpmFlow";
import {
  applyTuningToTransitionScore,
  buildTuningWarnings,
  normalizeSmartMixTuningConfig,
} from "./tuning";
import { SMART_MIX_ENGINE_V2, type SmartMixEngineV2Config, type SmartMixScoredTrack } from "./types";
import { scoreDiscoveryCandidatePool, summarizeDiscovery } from "./discovery";
import { getTrackBpm, getTrackMood } from "./metadataFallbacks";
import { canonicalTrackKey } from "../../playlistCoordination/overlap";
import { scoreCrossPlaylistCandidate } from "../../playlistCoordination/scoring";
import { PLAYLIST_GENERATION_LIMITS } from "../../playlistGenerationLimits";
import type { PlaylistGenerationControl } from "../../playlistGenerationControl";
import { orderTracksByIntentCurves } from "../../intentIntelligence/ordering";

export * from "./metadataFallbacks";
export * from "./bpmFlow";
export * from "./moodBlending";
export * from "./pipeline";
export * from "./scoring";
export * from "./tuning";
export * from "./types";
export * from "./discovery";
export * from "./regeneration";

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
  decisionTrace: {
    evaluatedCandidateCount: number;
    eligibleCandidateCount: number;
    hardRejectedCount: number;
    hardRejectionSummary: Record<string, number>;
    rejectedCandidates: Array<{ track: SmartMixScoredTrack<TTrack>; rejectionCode: string; rank: number }>;
  };
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
    discovery: ReturnType<typeof summarizeDiscovery>;
    scoringPasses: number;
    candidateRescoringPasses: number;
    selectionAttempts: number;
    selectionPoolLimit: number;
    optimizationPasses: number;
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

function similarTransitionPenalty(previousTrack: any, candidate: any, config: SmartMixEngineV2Config) {
  const rules = Object.values(config.personalization?.explicitFeedback?.transitionPenalties || {});
  const bpmGap = Math.abs((getTrackBpm(previousTrack) ?? 0) - (getTrackBpm(candidate) ?? 0));
  const moodGap = Math.abs((getTrackMood(previousTrack) ?? 0) - (getTrackMood(candidate) ?? 0));
  for (const rule of rules) {
    const context = rule.context || {};
    if (rule.reason === "BAD_BPM_TRANSITION") {
      const knownGap = Math.abs(Number(context.previousEffectiveBpm ?? context.previousBpm) - Number(context.currentEffectiveBpm ?? context.currentBpm));
      if (Number.isFinite(knownGap) && Math.abs(knownGap - bpmGap) <= 3) return FEEDBACK_SCORING.transition.similar;
    }
    if (rule.reason === "WRONG_MOOD") {
      const knownGap = Math.abs(Number(context.previousMood) - Number(context.currentMood));
      if (Number.isFinite(knownGap) && Math.abs(knownGap - moodGap) <= 0.15) return -2;
    }
  }
  return 0;
}

function* selectTunedCandidatesIterator<TTrack extends Record<string, any>>(
  sortedCandidates: Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex: number }>,
  config: SmartMixEngineV2Config,
  limit: number,
) {
  const tuning = normalizeSmartMixTuningConfig(config.tuningConfig);
  const moodBlend = normalizeMoodBlendConfig(config);
  const safetyRules = (config.safetyRules || {}) as { limitTracksPerArtist?: boolean; maxTracksPerArtist?: number; limitTracksPerAlbum?: boolean; maxTracksPerAlbum?: number };
  const remaining = [...sortedCandidates];
  const selected: Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex: number }> = [];
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  let selectionAttempts = 0;
  let attemptsForCurrentPosition = 0;
  let selectedDeepCount = 0;
  let selectedPopularCount = 0;

  const keyFor = (track: any, type: "artist" | "album") => String(
    type === "artist"
      ? track.artistId || track.artist?.id || track.artist?.title || ""
      : track.albumId || track.album?.id || track.album?.title || "",
  ).toLowerCase();

  const varietyPenaltyFromCounts = (candidate: any) => {
    const artistRepeats = artistCounts.get(keyFor(candidate, "artist")) || 0;
    const albumRepeats = albumCounts.get(keyFor(candidate, "album")) || 0;
    return artistRepeats * (0.2 + (tuning.artistVariety / 100) * 1.6) * 3.5
      + albumRepeats * (0.2 + (tuning.albumVariety / 100) * 1.6) * 2.75;
  };

  const discoveryAdjustmentFromCounts = (candidate: any) => {
    const metrics = candidate.discoveryMetrics;
    if (!metrics || limit <= 0 || candidate.moodBlend?.isMoodFallback) return 0;
    const desiredDeep = Math.round(limit * tuning.discovery.deepCutTarget / 100);
    const maxPopular = Math.floor(limit * tuning.discovery.maxPopularTrackPercent / 100);
    let adjustment = 0;
    if (["deep_cut", "hidden_gem"].includes(metrics.classification) && selectedDeepCount < desiredDeep) adjustment += 12;
    if (tuning.discovery.limitPopularTracks && metrics.classification === "popular" && selectedPopularCount >= maxPopular) adjustment -= 18;
    return adjustment;
  };

  while (remaining.length > 0 && selected.length < limit) {
    const attemptsRemaining = PLAYLIST_GENERATION_LIMITS.maxSelectionAttempts - attemptsForCurrentPosition;
    if (attemptsRemaining <= 0) break;
    const poolSize = Math.min(remaining.length, attemptsRemaining);
    const pool = remaining.slice(0, poolSize);
    const previousTrack = selected[selected.length - 1];
    let bestTrack: (typeof pool)[number] | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestTrace: NonNullable<SmartMixScoredTrack["smartMixSelectionTrace"]> | null = null;
    const evaluatedScores: Array<{ id: string; title: string | null; score: number }> = [];
    const hardRejectedIndexes: number[] = [];
    const selectedRelatedTrackCount = config.coordination
      ? selected.reduce((count, item) => count + ((config.coordination?.relatedTrackUsage[canonicalTrackKey(item as any)] || 0) > 0 && !config.coordination?.sharedCoreTrackKeys.includes(canonicalTrackKey(item as any)) ? 1 : 0), 0)
      : 0;

    for (const candidate of pool) {
      selectionAttempts += 1;
      attemptsForCurrentPosition += 1;
      const artistKey = keyFor(candidate, "artist");
      const albumKey = keyFor(candidate, "album");
      if (safetyRules.limitTracksPerArtist && artistKey && (artistCounts.get(artistKey) || 0) >= Math.max(1, safetyRules.maxTracksPerArtist || 1)) {
        hardRejectedIndexes.push(candidate.smartMixV2OriginalIndex);
        continue;
      }
      if (safetyRules.limitTracksPerAlbum && albumKey && (albumCounts.get(albumKey) || 0) >= Math.max(1, safetyRules.maxTracksPerAlbum || 1)) {
        hardRejectedIndexes.push(candidate.smartMixV2OriginalIndex);
        continue;
      }
      const coordinationScore = scoreCrossPlaylistCandidate(candidate as any, config.coordination, selectedRelatedTrackCount, selected.length);
      if (coordinationScore.hardOverlapRejected) {
        hardRejectedIndexes.push(candidate.smartMixV2OriginalIndex);
        continue;
      }
      const position = selected.length;
      const moodBlendScore = moodBlend.enabled
        ? scoreMoodBlendForTrack({ track: candidate, config, position, limit, normalizedBlend: moodBlend, normalizedTuning: tuning })
        : null;
      const transitionScore = previousTrack
        ? applyTuningToTransitionScore({ leftTrack: previousTrack, rightTrack: candidate, tuningConfig: tuning })
        : 0;
      const pairFeedback = previousTrack
        ? config.personalization?.explicitFeedback?.transitionPenalties[transitionPairKey(String(previousTrack.id), String(candidate.id))]
        : undefined;
      const reverseFeedback = previousTrack && !pairFeedback
        ? config.personalization?.explicitFeedback?.transitionPenalties[transitionPairKey(String(candidate.id), String(previousTrack.id))]
        : undefined;
      const feedbackTransitionPenalty = pairFeedback?.adjustment ?? (reverseFeedback ? FEEDBACK_SCORING.transition.reversePair : previousTrack ? similarTransitionPenalty(previousTrack, candidate, config) : 0);
      const varietyPenalty = varietyPenaltyFromCounts(candidate);
      const existingMoodBlend = candidate.scoreBreakdown.moodBlend || 0;
      const positionMoodBlend = moodBlendScore?.score || existingMoodBlend;
      const existingCoordination = candidate.scoreBreakdown.coordination || 0;
      const candidateScore = candidate.score - existingMoodBlend - existingCoordination + positionMoodBlend + coordinationScore.totalAdjustment + transitionScore + feedbackTransitionPenalty - varietyPenalty;
      const discoveryQuotaAdjustment = discoveryAdjustmentFromCounts(candidate);
      const adjustedCandidateScore = candidateScore + discoveryQuotaAdjustment;
      evaluatedScores.push({ id: String(candidate.id), title: candidate.title || null, score: adjustedCandidateScore });
      if (
        adjustedCandidateScore > bestScore
        || (adjustedCandidateScore === bestScore && (!bestTrack || candidate.smartMixV2OriginalIndex < bestTrack.smartMixV2OriginalIndex))
      ) {
        bestTrack = (moodBlendScore || feedbackTransitionPenalty || config.coordination)
          ? {
              ...candidate,
              score: Math.round((candidate.score - existingMoodBlend - existingCoordination + positionMoodBlend + coordinationScore.totalAdjustment) * 1000) / 1000,
              scoreBreakdown: {
                ...candidate.scoreBreakdown,
                moodBlend: moodBlendScore?.score ?? existingMoodBlend,
                transitionFeedback: feedbackTransitionPenalty,
                coordination: coordinationScore.totalAdjustment,
              },
              coordinationScore,
              ...(moodBlendScore ? { moodBlend: moodBlendScore.data } : {}),
            }
          : candidate;
        bestScore = adjustedCandidateScore;
        bestTrace = {
          position: selected.length + 1,
          selectionScore: Math.round(adjustedCandidateScore * 1000) / 1000,
          transitionAdjustment: transitionScore,
          transitionFeedbackAdjustment: feedbackTransitionPenalty,
          varietyPenalty,
          discoveryAdjustment: discoveryQuotaAdjustment,
          moodAdjustment: positionMoodBlend - existingMoodBlend,
          coordinationAdjustment: coordinationScore.totalAdjustment - existingCoordination,
          previousTrackId: previousTrack?.id ? String(previousTrack.id) : null,
          previousTrackTitle: previousTrack?.title || null,
        };
      }
    }

    if (!bestTrack) {
      const rejected = new Set(hardRejectedIndexes);
      const nextRemaining = remaining.filter((candidate) => !rejected.has(candidate.smartMixV2OriginalIndex));
      if (nextRemaining.length === remaining.length) break;
      remaining.splice(0, remaining.length, ...nextRemaining);
      yield { selectedCount: selected.length, selectionAttempts };
      continue;
    }

    const chosenTrack = bestTrack;
    let runnerUp: (typeof evaluatedScores)[number] | undefined;
    for (const item of evaluatedScores) {
      if (item.id !== String(chosenTrack.id) && (!runnerUp || item.score > runnerUp.score)) runnerUp = item;
    }
    bestTrack = {
      ...chosenTrack,
      smartMixSelectionTrace: {
        ...(bestTrace as NonNullable<SmartMixScoredTrack["smartMixSelectionTrace"]>),
        comparisonCandidateId: runnerUp?.id || null,
        comparisonCandidateTitle: runnerUp?.title || null,
        scoreMargin: runnerUp ? Math.round((bestScore - runnerUp.score) * 1000) / 1000 : null,
      },
    };

    selected.push(bestTrack);
    attemptsForCurrentPosition = 0;
    const selectedArtistKey = keyFor(bestTrack, "artist");
    const selectedAlbumKey = keyFor(bestTrack, "album");
    if (selectedArtistKey) artistCounts.set(selectedArtistKey, (artistCounts.get(selectedArtistKey) || 0) + 1);
    if (selectedAlbumKey) albumCounts.set(selectedAlbumKey, (albumCounts.get(selectedAlbumKey) || 0) + 1);
    if (["deep_cut", "hidden_gem"].includes(bestTrack.discoveryMetrics?.classification || "")) selectedDeepCount += 1;
    if (bestTrack.discoveryMetrics?.classification === "popular") selectedPopularCount += 1;
    const removeIndex = remaining.findIndex((candidate) => candidate.smartMixV2OriginalIndex === bestTrack.smartMixV2OriginalIndex);
    if (removeIndex >= 0) remaining.splice(removeIndex, 1);
    else remaining.shift();
    yield { selectedCount: selected.length, selectionAttempts };
  }

  return { tracks: selected, selectionAttempts };
}

function selectTunedCandidates<TTrack extends Record<string, any>>(
  sortedCandidates: Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex: number }>,
  config: SmartMixEngineV2Config,
  limit: number,
) {
  const iterator = selectTunedCandidatesIterator(sortedCandidates, config, limit);
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value;
}

async function selectTunedCandidatesAsync<TTrack extends Record<string, any>>(
  sortedCandidates: Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex: number }>,
  config: SmartMixEngineV2Config,
  limit: number,
  control: PlaylistGenerationControl,
) {
  const iterator = selectTunedCandidatesIterator(sortedCandidates, config, limit);
  let step = iterator.next();
  while (!step.done) {
    await control.yield("Selecting tracks", {
      eligibleCandidates: sortedCandidates.length,
      processedCandidates: step.value.selectionAttempts,
      selectedTracks: step.value.selectedCount,
      scoringPasses: 1,
    }, true);
    step = iterator.next();
  }
  return step.value;
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
  const baseConfig = config.adaptiveScoring || config.playbackScoring || config.coordination || config.coverageRotation
    ? { ...config, personalization: undefined, playlistIdentity: undefined, adaptiveScoring: undefined, playbackScoring: undefined, coordination: undefined, coverageRotation: undefined }
    : config;
  const initiallyScoredPinnedTracks = pinnedTracks.map((track) => scoreSmartMixTrack(track, baseConfig));
  const initiallyScoredCandidates = candidates.map((track, index) => ({
    ...scoreSmartMixTrack(track, baseConfig),
    smartMixV2OriginalIndex: index,
  }));
  const discoveryScoring = scoreDiscoveryCandidatePool({
    candidates: [...initiallyScoredPinnedTracks, ...initiallyScoredCandidates],
    config: tuning.discovery,
    recentUsage: config.recentPlaylistUsage,
  });
  const fullyScoredTracks = config.adaptiveScoring || config.playbackScoring || config.coordination || config.coverageRotation
    ? discoveryScoring.tracks.map((track) => applyAdaptiveScoringToTrack(track as SmartMixScoredTrack<TTrack>, config))
    : discoveryScoring.tracks;
  const scoredPinnedTracks = fullyScoredTracks.slice(0, initiallyScoredPinnedTracks.length) as SmartMixScoredTrack<TTrack>[];
  const scoredCandidates = fullyScoredTracks
    .slice(initiallyScoredPinnedTracks.length)
    .filter((track) => !["PLAYBACK_RECENT", "COORDINATION_HARD_MAXIMUM"].includes(String(track.exclusionReason || ""))) as Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex: number }>;
  const hardRejectedCandidates = fullyScoredTracks
    .slice(initiallyScoredPinnedTracks.length)
    .filter((track) => ["PLAYBACK_RECENT", "COORDINATION_HARD_MAXIMUM"].includes(String(track.exclusionReason || ""))) as Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex: number }>;

  const sortedCandidates = [...scoredCandidates].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.smartMixV2OriginalIndex - right.smartMixV2OriginalIndex;
  });
  const targetCandidateCount = Math.min(
    scoredCandidates.length,
    safetyCandidateLimit,
    Math.max(0, config.limit - scoredPinnedTracks.length),
  );
  const duplicateCandidates = applyDuplicatePolicy(sortedCandidates, config, sortedCandidates.length) as Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex: number }>;
  const tunedSelection = selectTunedCandidates(duplicateCandidates, config, targetCandidateCount);
  const tunedCandidates = tunedSelection.tracks;
  const bpmOrderedCandidates = orderTracksByBpmFlow({
    tracks: tunedCandidates,
    tuningConfig: tuning,
    baseScore: (track) => track.score,
  });
  const intentOrderedCandidates = orderTracksByIntentCurves(bpmOrderedCandidates, config.intentOrdering as any);
  const selectedCandidates = applyDuplicatePolicy(intentOrderedCandidates, config, targetCandidateCount);
  const safety = applyPlaylistSafetyRules(scoredPinnedTracks.concat(selectedCandidates), config);
  const bpmFlow = summarizeBpmFlow(safety.tracks, tuning.bpmFlow);
  const tracks = attachBpmTransitionMetadata(safety.tracks.map(removeInternalSortIndex), bpmFlow);
  const selectedIds = new Set(tracks.map((track) => String(track.id)));
  const rejectedCandidates = [...hardRejectedCandidates, ...scoredCandidates.filter((track) => !selectedIds.has(String(track.id)))]
    .sort((left, right) => right.score - left.score)
    .slice(0, PLAYLIST_GENERATION_LIMITS.explanationRejectedSampleLimit)
    .map((track, index) => ({ track: removeInternalSortIndex(track), rejectionCode: String(track.exclusionReason || "RANKED_BELOW_CUTOFF"), rank: index + 1 }));
  const hardRejectionSummary = hardRejectedCandidates.reduce<Record<string, number>>((summary, track) => {
    const code = String(track.exclusionReason || "HARD_FILTER");
    summary[code] = (summary[code] || 0) + 1;
    return summary;
  }, {});
  const discovery = summarizeDiscovery(scoredCandidates, tracks, tuning.discovery, discoveryScoring.executionTimeMs);
  const coordinationSharedCount = config.coordination
    ? tracks.filter((track) => (config.coordination?.relatedTrackUsage[canonicalTrackKey(track as any)] || 0) > 0 && !config.coordination?.sharedCoreTrackKeys.includes(canonicalTrackKey(track as any))).length
    : 0;
  const coordinationProjectedPercentage = config.coordination
    ? Math.round((coordinationSharedCount / Math.max(1, Math.min(config.coordination.targetPlaylistSize, config.coordination.maximumRelatedPlaylistSize))) * 10_000) / 100
    : 0;
  const coordinationWarnings = config.coordination && coordinationProjectedPercentage > config.coordination.settings.maximumSharedTrackPercentage
    ? [`Projected related-playlist overlap is ${coordinationProjectedPercentage}%, above the configured ${config.coordination.settings.maximumSharedTrackPercentage}% ${config.coordination.settings.overlapEnforcement === "HARD_MAXIMUM" ? "hard maximum; protected pinned tracks prevent satisfying it" : "target"}.`]
    : [];
  const tuningWarnings = [...buildTuningWarnings({ tracks, tuningConfig: tuning }), ...coordinationWarnings];
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
    decisionTrace: {
      evaluatedCandidateCount: initiallyScoredCandidates.length,
      eligibleCandidateCount: scoredCandidates.length,
      hardRejectedCount: hardRejectedCandidates.length,
      hardRejectionSummary,
      rejectedCandidates,
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
      discovery,
      scoringPasses: 1,
      candidateRescoringPasses: 0,
      selectionAttempts: tunedSelection.selectionAttempts,
      selectionPoolLimit: PLAYLIST_GENERATION_LIMITS.maxSelectionAttempts,
      optimizationPasses: tuning.bpmFlow.enabled && tuning.bpmFlow.mode !== "DISABLED" ? Math.min(1, PLAYLIST_GENERATION_LIMITS.maxOptimizationPasses) : 0,
    },
  };
}

export async function runSmartMixEngineV2Async<TTrack extends Record<string, any>>({
  control,
  ...input
}: SmartMixEngineV2RunInput<TTrack> & { control: PlaylistGenerationControl }): Promise<SmartMixEngineV2RunResult<TTrack>> {
  const { config, pinnedTracks, candidates, safetyCandidateLimit, applyDuplicatePolicy, applyPlaylistSafetyRules } = input;
  const tuning = normalizeSmartMixTuningConfig(config.tuningConfig);
  const baseConfig = config.adaptiveScoring || config.playbackScoring || config.coordination || config.coverageRotation
    ? { ...config, personalization: undefined, playlistIdentity: undefined, adaptiveScoring: undefined, playbackScoring: undefined, coordination: undefined, coverageRotation: undefined }
    : config;

  await control.setStage("scoring", `Scoring ${candidates.length.toLocaleString()} candidates`, { initialCandidates: candidates.length, processedCandidates: 0, scoringPasses: 1 });
  const initiallyScoredPinnedTracks = pinnedTracks.map((track) => scoreSmartMixTrack(track, baseConfig));
  const initiallyScoredCandidates: Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex: number }> = [];
  for (let index = 0; index < candidates.length; index += 1) {
    initiallyScoredCandidates.push({ ...scoreSmartMixTrack(candidates[index], baseConfig), smartMixV2OriginalIndex: index });
    await control.yield(`Scoring ${candidates.length.toLocaleString()} candidates`, { initialCandidates: candidates.length, processedCandidates: index + 1, scoringPasses: 1 });
  }
  const discoveryScoring = scoreDiscoveryCandidatePool({ candidates: [...initiallyScoredPinnedTracks, ...initiallyScoredCandidates], config: tuning.discovery, recentUsage: config.recentPlaylistUsage });
  const fullyScoredTracks: Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex?: number }> = [];
  for (let index = 0; index < discoveryScoring.tracks.length; index += 1) {
    const track = discoveryScoring.tracks[index] as SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex?: number };
    fullyScoredTracks.push(config.adaptiveScoring || config.playbackScoring || config.coordination || config.coverageRotation ? applyAdaptiveScoringToTrack(track, config) : track);
    await control.yield(`Scoring ${candidates.length.toLocaleString()} candidates`, { initialCandidates: candidates.length, processedCandidates: Math.min(candidates.length, index + 1), scoringPasses: 1 });
  }
  const scoredPinnedTracks = fullyScoredTracks.slice(0, initiallyScoredPinnedTracks.length) as SmartMixScoredTrack<TTrack>[];
  const candidateSlice = fullyScoredTracks.slice(initiallyScoredPinnedTracks.length) as Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex: number }>;
  const scoredCandidates = candidateSlice.filter((track) => !["PLAYBACK_RECENT", "COORDINATION_HARD_MAXIMUM"].includes(String(track.exclusionReason || "")));
  const hardRejectedCandidates = candidateSlice.filter((track) => ["PLAYBACK_RECENT", "COORDINATION_HARD_MAXIMUM"].includes(String(track.exclusionReason || "")));
  const sortedCandidates = [...scoredCandidates].sort((left, right) => right.score - left.score || left.smartMixV2OriginalIndex - right.smartMixV2OriginalIndex);
  const targetCandidateCount = Math.min(scoredCandidates.length, safetyCandidateLimit, Math.max(0, config.limit - scoredPinnedTracks.length));
  const duplicateCandidates = applyDuplicatePolicy(sortedCandidates, config, sortedCandidates.length) as Array<SmartMixScoredTrack<TTrack> & { smartMixV2OriginalIndex: number }>;

  await control.setStage("selecting", "Selecting tracks", { eligibleCandidates: duplicateCandidates.length, selectedTracks: 0, scoringPasses: 1 });
  const tunedSelection = await selectTunedCandidatesAsync(duplicateCandidates, config, targetCandidateCount, control);
  await control.setStage("optimizing", "Optimizing BPM and mood flow", { eligibleCandidates: duplicateCandidates.length, selectedTracks: tunedSelection.tracks.length, optimizationPasses: 0 });
  const bpmOrderedCandidates = await orderTracksByBpmFlowAsync({ tracks: tunedSelection.tracks, tuningConfig: tuning, baseScore: (track) => track.score, control });
  const intentOrderedCandidates = orderTracksByIntentCurves(bpmOrderedCandidates, config.intentOrdering as any);
  const selectedCandidates = applyDuplicatePolicy(intentOrderedCandidates, config, targetCandidateCount);
  const safety = applyPlaylistSafetyRules(scoredPinnedTracks.concat(selectedCandidates), config);
  const bpmFlow = summarizeBpmFlow(safety.tracks, tuning.bpmFlow);
  const tracks = attachBpmTransitionMetadata(safety.tracks.map(removeInternalSortIndex), bpmFlow);
  const selectedIds = new Set(tracks.map((track) => String(track.id)));
  const rejectedCandidates = [...hardRejectedCandidates, ...scoredCandidates.filter((track) => !selectedIds.has(String(track.id)))]
    .sort((left, right) => right.score - left.score)
    .slice(0, PLAYLIST_GENERATION_LIMITS.explanationRejectedSampleLimit)
    .map((track, index) => ({ track: removeInternalSortIndex(track), rejectionCode: String(track.exclusionReason || "RANKED_BELOW_CUTOFF"), rank: index + 1 }));
  const hardRejectionSummary = hardRejectedCandidates.reduce<Record<string, number>>((summary, track) => {
    const code = String(track.exclusionReason || "HARD_FILTER"); summary[code] = (summary[code] || 0) + 1; return summary;
  }, {});
  const discovery = summarizeDiscovery(scoredCandidates, tracks, tuning.discovery, discoveryScoring.executionTimeMs);
  const coordinationSharedCount = config.coordination ? tracks.filter((track) => (config.coordination?.relatedTrackUsage[canonicalTrackKey(track as any)] || 0) > 0 && !config.coordination?.sharedCoreTrackKeys.includes(canonicalTrackKey(track as any))).length : 0;
  const coordinationProjectedPercentage = config.coordination ? Math.round((coordinationSharedCount / Math.max(1, Math.min(config.coordination.targetPlaylistSize, config.coordination.maximumRelatedPlaylistSize))) * 10_000) / 100 : 0;
  const coordinationWarnings = config.coordination && coordinationProjectedPercentage > config.coordination.settings.maximumSharedTrackPercentage
    ? [`Projected related-playlist overlap is ${coordinationProjectedPercentage}%, above the configured ${config.coordination.settings.maximumSharedTrackPercentage}% ${config.coordination.settings.overlapEnforcement === "HARD_MAXIMUM" ? "hard maximum; protected pinned tracks prevent satisfying it" : "target"}.`]
    : [];
  const tuningWarnings = [...buildTuningWarnings({ tracks, tuningConfig: tuning }), ...coordinationWarnings];
  const moodBlendSummary = summarizeMoodBlend({ tracks, candidates: scoredCandidates as any[], config });

  await control.progress("Optimizing BPM and mood flow", { eligibleCandidates: duplicateCandidates.length, selectedTracks: tracks.length, optimizationPasses: tuning.bpmFlow.enabled && tuning.bpmFlow.mode !== "DISABLED" ? Math.min(1, PLAYLIST_GENERATION_LIMITS.maxOptimizationPasses) : 0 }, true);
  return {
    engineVersion: SMART_MIX_ENGINE_V2,
    tracks,
    safety: { ...safety, tracks },
    decisionTrace: { evaluatedCandidateCount: initiallyScoredCandidates.length, eligibleCandidateCount: scoredCandidates.length, hardRejectedCount: hardRejectedCandidates.length, hardRejectionSummary, rejectedCandidates },
    diagnostics: {
      pipeline: SMART_MIX_ENGINE_V2_PIPELINE, candidateCount: candidates.length, scoredCandidateCount: scoredCandidates.length, selectedCandidateCount: selectedCandidates.length, pinnedTrackCount: pinnedTracks.length,
      fallbackSummary: fallbackSummary(tracks), tuningPreset: tuning.presetName, tuningWarnings,
      moodBlendMode: moodBlendSummary.moodBlendMode, selectedMoodPath: moodBlendSummary.selectedMoodPath, allowedMoods: moodBlendSummary.allowedMoods, moodCurve: moodBlendSummary.moodCurve, moodCoverage: moodBlendSummary.moodCoverage, moodWarnings: moodBlendSummary.moodWarnings,
      moodStrength: moodBlendSummary.moodStrength, transitionSmoothness: moodBlendSummary.transitionSmoothness, moodStrictness: moodBlendSummary.moodStrictness, fallbackTolerance: moodBlendSummary.fallbackTolerance, bridgeTrackPreference: moodBlendSummary.bridgeTrackPreference, moodVariety: moodBlendSummary.moodVariety, conflictSensitivity: moodBlendSummary.conflictSensitivity, selectedMoodPreset: moodBlendSummary.selectedMoodPreset,
      moodFallbackCount: moodBlendSummary.moodFallbackCount, moodConflictCount: moodBlendSummary.moodConflictCount, multiMoodBridgeTracks: moodBlendSummary.multiMoodBridgeTracks, missingMoodCount: moodBlendSummary.missingMoodCount,
      bpmFlow, discovery, scoringPasses: 1, candidateRescoringPasses: 0, selectionAttempts: tunedSelection.selectionAttempts, selectionPoolLimit: PLAYLIST_GENERATION_LIMITS.maxSelectionAttempts,
      optimizationPasses: tuning.bpmFlow.enabled && tuning.bpmFlow.mode !== "DISABLED" ? Math.min(1, PLAYLIST_GENERATION_LIMITS.maxOptimizationPasses) : 0,
    },
  };
}
