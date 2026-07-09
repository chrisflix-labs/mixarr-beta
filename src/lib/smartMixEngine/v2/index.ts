import { SMART_MIX_ENGINE_V2_PIPELINE } from "./pipeline";
import { scoreSmartMixTrack } from "./scoring";
import { SMART_MIX_ENGINE_V2, type SmartMixEngineV2Config, type SmartMixScoredTrack } from "./types";

export * from "./metadataFallbacks";
export * from "./pipeline";
export * from "./scoring";
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

export function runSmartMixEngineV2<TTrack extends Record<string, any>>({
  config,
  pinnedTracks,
  candidates,
  safetyCandidateLimit,
  applyDuplicatePolicy,
  applyPlaylistSafetyRules,
}: SmartMixEngineV2RunInput<TTrack>): SmartMixEngineV2RunResult<TTrack> {
  const scoredPinnedTracks = pinnedTracks.map((track) => scoreSmartMixTrack(track, config));
  const scoredCandidates = candidates.map((track, index) => ({
    ...scoreSmartMixTrack(track, config),
    smartMixV2OriginalIndex: index,
  }));

  const sortedCandidates = [...scoredCandidates].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.smartMixV2OriginalIndex - right.smartMixV2OriginalIndex;
  });
  const selectedCandidates = applyDuplicatePolicy(sortedCandidates, config, safetyCandidateLimit);
  const safety = applyPlaylistSafetyRules(scoredPinnedTracks.concat(selectedCandidates), config);
  const tracks = safety.tracks.map(removeInternalSortIndex);

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
    },
  };
}
