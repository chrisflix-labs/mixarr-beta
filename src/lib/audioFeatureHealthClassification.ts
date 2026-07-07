import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  apiAudioFeatureTrackWhere,
  audioFeatureAnalyzerFailedTrackWhere,
  audioFeatureExtractionFailedTrackWhere,
  audioFeatureFailedTrackWhere,
  audioFeatureNoDataTrackWhere,
  audioFeatureTooShortTrackWhere,
  completeAudioFeatureTrackWhere,
  enforceAudioFeatureIncompleteInvariant,
  getAudioFeatureHealthStatus,
  heuristicAudioFeatureTrackWhere,
  localAudioFeatureTrackWhere,
  mergeAudioFeatureHealthGapCounts,
  missingAudioFeatureTrackWhere,
  noAudioFeatureRecordTrackWhere,
  pendingAudioFeatureTrackWhere,
  partialAudioFeatureTrackWhere,
  type AudioFeatureHealthGapAudit,
  type EffectiveAudioFeatureSettings,
} from "./audioFeatures";

export type AudioFeatureHealthFilter =
  | "missing_audio_features"
  | "api_audio_features"
  | "local_audio_features"
  | "heuristic_audio_features"
  | "partial_audio_features"
  | "audio_no_data"
  | "audio_failed"
  | "audio_too_short"
  | "audio_feature_no_data"
  | "audio_feature_failed"
  | "extraction_failed"
  | "analyzer_failed"
  | "too_short"
  | "pending_audio_features";

export type AudioFeatureHealthClassification = {
  activeTracks: number;
  complete: number;
  missing: number;
  api: number;
  local: number;
  heuristic: number;
  partial: number;
  pending: number;
  noData: number;
  failed: number;
  extractionFailed: number;
  analyzerFailed: number;
  tooShort: number;
  noAudioFeatureRecord: number;
  gapOnly: number;
  gapTrackIds: string[];
  partialGapTrackIds: string[];
  missingGapTrackIds: string[];
  audit: AudioFeatureHealthGapAudit;
};

function countScope(scopeWhere: Prisma.TrackWhereInput, filterWhere: Prisma.TrackWhereInput): Prisma.TrackWhereInput {
  return { AND: [scopeWhere, filterWhere] };
}

function audioFeatureClassifiedIncompleteTrackWhere(settings?: EffectiveAudioFeatureSettings): Prisma.TrackWhereInput {
  return {
    OR: [
      missingAudioFeatureTrackWhere(settings),
      partialAudioFeatureTrackWhere(settings),
      audioFeatureNoDataTrackWhere(settings),
      audioFeatureFailedTrackWhere(settings),
      audioFeatureTooShortTrackWhere(settings),
    ],
  };
}

function searchWhere(search?: string): Prisma.TrackWhereInput | null {
  if (!search) return null;
  return {
    OR: [
      { title: { contains: search, mode: "insensitive" } },
      { artist: { title: { contains: search, mode: "insensitive" } } },
      { album: { title: { contains: search, mode: "insensitive" } } },
      { mediaPath: { contains: search, mode: "insensitive" } },
    ],
  };
}

export function activeAudioFeatureTrackScope(userId: string, libraryId?: string): Prisma.TrackWhereInput {
  return {
    syncStatus: "active",
    library: {
      ...(libraryId ? { id: libraryId } : {}),
      server: { userId },
    },
  };
}

export function audioFeatureHealthFilterWhere(filter: AudioFeatureHealthFilter, settings?: EffectiveAudioFeatureSettings): Prisma.TrackWhereInput {
  switch (filter) {
    case "missing_audio_features": return missingAudioFeatureTrackWhere(settings);
    case "api_audio_features": return apiAudioFeatureTrackWhere(settings);
    case "local_audio_features": return localAudioFeatureTrackWhere(settings);
    case "heuristic_audio_features": return heuristicAudioFeatureTrackWhere();
    case "partial_audio_features": return partialAudioFeatureTrackWhere(settings);
    case "audio_no_data": return audioFeatureNoDataTrackWhere(settings);
    case "audio_failed": return audioFeatureFailedTrackWhere(settings);
    case "audio_too_short": return audioFeatureTooShortTrackWhere(settings);
    case "audio_feature_no_data": return audioFeatureNoDataTrackWhere(settings);
    case "audio_feature_failed": return audioFeatureFailedTrackWhere(settings);
    case "extraction_failed": return audioFeatureExtractionFailedTrackWhere(settings);
    case "analyzer_failed": return audioFeatureAnalyzerFailedTrackWhere(settings);
    case "too_short": return audioFeatureTooShortTrackWhere(settings);
    case "pending_audio_features": return pendingAudioFeatureTrackWhere(settings);
  }
}

export function audioFeatureGapTrackWhere(scopeWhere: Prisma.TrackWhereInput, settings?: EffectiveAudioFeatureSettings): Prisma.TrackWhereInput {
  return {
    AND: [
      scopeWhere,
      { NOT: completeAudioFeatureTrackWhere(settings) },
      { NOT: audioFeatureClassifiedIncompleteTrackWhere(settings) },
    ],
  };
}

const audioFeatureGapTrackSelect = {
  id: true,
  syncStatus: true,
  bpm: true,
  apiBpm: true,
  localBpm: true,
  effectiveBpm: true,
  bpmSource: true,
  audioFeature: {
    select: {
      energy: true,
      valence: true,
      danceability: true,
      acousticness: true,
      apiEnergy: true,
      apiMood: true,
      apiDanceability: true,
      apiAcousticness: true,
      apiLoudness: true,
      localEnergy: true,
      localMood: true,
      localDanceability: true,
      localAcousticness: true,
      localLoudness: true,
      effectiveEnergy: true,
      effectiveMood: true,
      effectiveDanceability: true,
      effectiveAcousticness: true,
      tempo: true,
      loudness: true,
      dynamicComplexity: true,
      rhythmStability: true,
      onsetRate: true,
      replayGain: true,
      source: true,
      tempoSource: true,
      audioFeatureSource: true,
      audioFeatureStatus: true,
      audioFeatureConfidence: true,
      confidence: true,
      energySource: true,
      valenceSource: true,
      danceabilitySource: true,
      acousticnessSource: true,
    },
  },
} satisfies Prisma.TrackSelect;

export type AudioFeatureGapClassification = {
  gapTrackIds: string[];
  partialGapTrackIds: string[];
  missingGapTrackIds: string[];
};

export async function getAudioFeatureGapClassificationForScope(scopeWhere: Prisma.TrackWhereInput, settings?: EffectiveAudioFeatureSettings): Promise<AudioFeatureGapClassification> {
  const tracks = await prisma.track.findMany({
    where: audioFeatureGapTrackWhere(scopeWhere, settings),
    select: audioFeatureGapTrackSelect,
  });
  const partialGapTrackIds: string[] = [];
  const missingGapTrackIds: string[] = [];

  for (const track of tracks) {
    const classification = getAudioFeatureHealthStatus(track, settings);
    if (classification.status === "partial") partialGapTrackIds.push(track.id);
    if (classification.status === "missing") missingGapTrackIds.push(track.id);
  }

  return {
    gapTrackIds: tracks.map((track) => track.id),
    partialGapTrackIds,
    missingGapTrackIds,
  };
}

export async function getAudioFeatureGapTrackIdsForScope(scopeWhere: Prisma.TrackWhereInput, settings?: EffectiveAudioFeatureSettings) {
  return (await getAudioFeatureGapClassificationForScope(scopeWhere, settings)).gapTrackIds;
}

export async function getAudioFeatureGapTrackIds(userId: string, options: {
  libraryId?: string;
  settings?: EffectiveAudioFeatureSettings;
} = {}) {
  return getAudioFeatureGapTrackIdsForScope(activeAudioFeatureTrackScope(userId, options.libraryId), options.settings);
}

export async function getAudioFeatureHealthClassificationForScope(scopeWhere: Prisma.TrackWhereInput, settings?: EffectiveAudioFeatureSettings): Promise<AudioFeatureHealthClassification> {
  const [activeTracks, complete, missing, api, local, heuristic, partial, pending, noData, failed, extractionFailed, analyzerFailed, tooShort, noAudioFeatureRecord] = await Promise.all([
    prisma.track.count({ where: scopeWhere }),
    prisma.track.count({ where: countScope(scopeWhere, completeAudioFeatureTrackWhere(settings)) }),
    prisma.track.count({ where: countScope(scopeWhere, missingAudioFeatureTrackWhere(settings)) }),
    prisma.track.count({ where: countScope(scopeWhere, apiAudioFeatureTrackWhere(settings)) }),
    prisma.track.count({ where: countScope(scopeWhere, localAudioFeatureTrackWhere(settings)) }),
    prisma.track.count({ where: countScope(scopeWhere, heuristicAudioFeatureTrackWhere()) }),
    prisma.track.count({ where: countScope(scopeWhere, partialAudioFeatureTrackWhere(settings)) }),
    prisma.track.count({ where: countScope(scopeWhere, pendingAudioFeatureTrackWhere(settings)) }),
    prisma.track.count({ where: countScope(scopeWhere, audioFeatureNoDataTrackWhere(settings)) }),
    prisma.track.count({ where: countScope(scopeWhere, audioFeatureFailedTrackWhere(settings)) }),
    prisma.track.count({ where: countScope(scopeWhere, audioFeatureExtractionFailedTrackWhere(settings)) }),
    prisma.track.count({ where: countScope(scopeWhere, audioFeatureAnalyzerFailedTrackWhere(settings)) }),
    prisma.track.count({ where: countScope(scopeWhere, audioFeatureTooShortTrackWhere(settings)) }),
    prisma.track.count({ where: countScope(scopeWhere, noAudioFeatureRecordTrackWhere()) }),
  ]);
  const rawMerged = mergeAudioFeatureHealthGapCounts({
    activeTracks,
    completeAudioFeatures: complete,
    missing,
    partial,
    pending,
    noData,
    failed,
    tooShort,
    noAudioFeatureRecord,
  });
  const gapClassification = rawMerged.gapOnly > 0
    ? await getAudioFeatureGapClassificationForScope(scopeWhere, settings)
    : { gapTrackIds: [], partialGapTrackIds: [], missingGapTrackIds: [] };
  const partialGapCount = gapClassification.partialGapTrackIds.length;
  const missingGapCount = gapClassification.missingGapTrackIds.length;
  const pendingGapCount = gapClassification.gapTrackIds.length
    ? await prisma.track.count({
      where: {
        AND: [
          scopeWhere,
          { id: { in: gapClassification.gapTrackIds } },
          { NOT: pendingAudioFeatureTrackWhere(settings) },
          { NOT: audioFeatureTooShortTrackWhere(settings) },
        ],
      },
    })
    : 0;
  const merged = {
    ...rawMerged,
    missing: missing + missingGapCount,
    partial: partial + partialGapCount,
    pending: pending + pendingGapCount,
    gapOnly: gapClassification.gapTrackIds.length,
    audit: {
      ...rawMerged.audit,
      classifiedAsMissing: missingGapCount,
    },
  };

  // Hard invariant: the dashboard's incomplete count (activeTracks - complete)
  // must always be reflected in the Audio Feature Health categories. If the
  // classified predicates still leave tracks unaccounted for, assign the
  // remainder to partial (BPM-present incomplete tracks are partial by policy)
  // and make sure pending covers every non-too-short incomplete track. This is a
  // safety net on top of the null-safe complete predicate so the two views can
  // never disagree, even for unusual audio feature row shapes.
  const invariant = enforceAudioFeatureIncompleteInvariant({
    activeTracks,
    complete,
    partial: merged.partial,
    missing: merged.missing,
    pending: merged.pending,
    noData,
    failed,
    tooShort,
  });

  return {
    activeTracks,
    complete,
    missing: merged.missing,
    api,
    local,
    heuristic,
    partial: invariant.partial,
    pending: invariant.pending,
    noData,
    failed,
    extractionFailed,
    analyzerFailed,
    tooShort,
    noAudioFeatureRecord,
    gapOnly: merged.gapOnly,
    gapTrackIds: gapClassification.gapTrackIds,
    partialGapTrackIds: gapClassification.partialGapTrackIds,
    missingGapTrackIds: gapClassification.missingGapTrackIds,
    audit: {
      ...merged.audit,
      classifiedIncomplete: invariant.classifiedIncomplete,
      unclassifiedGap: invariant.unclassifiedIncomplete,
      gapDetected: merged.audit.gapDetected || invariant.unclassifiedIncomplete > 0,
    },
  };
}

export async function getAudioFeatureHealthClassification(userId: string, options: {
  libraryId?: string;
  settings?: EffectiveAudioFeatureSettings;
} = {}) {
  return getAudioFeatureHealthClassificationForScope(activeAudioFeatureTrackScope(userId, options.libraryId), options.settings);
}

export async function buildAudioFeatureHealthQuery(userId: string, options: {
  filter: AudioFeatureHealthFilter;
  libraryId?: string;
  search?: string;
  settings?: EffectiveAudioFeatureSettings;
}) {
  const scopeWhere = activeAudioFeatureTrackScope(userId, options.libraryId);
  const baseFilterWhere = audioFeatureHealthFilterWhere(options.filter, options.settings);
  const shouldIncludeGap = options.filter === "missing_audio_features"
    || options.filter === "partial_audio_features"
    || options.filter === "pending_audio_features";
  const gapClassification = shouldIncludeGap
    ? await getAudioFeatureGapClassificationForScope(scopeWhere, options.settings)
    : { gapTrackIds: [], partialGapTrackIds: [], missingGapTrackIds: [] };
  const gapTrackIds = options.filter === "missing_audio_features"
    ? gapClassification.missingGapTrackIds
    : options.filter === "partial_audio_features"
      ? gapClassification.partialGapTrackIds
      : gapClassification.gapTrackIds;
  const searchable = searchWhere(options.search);
  const filterWhere = gapTrackIds.length
    ? { OR: [baseFilterWhere, { id: { in: gapTrackIds } }] }
    : baseFilterWhere;
  const parts: Prisma.TrackWhereInput[] = [scopeWhere, filterWhere];
  const baseParts: Prisma.TrackWhereInput[] = [scopeWhere, baseFilterWhere];
  const gapParts: Prisma.TrackWhereInput[] = [scopeWhere, gapTrackIds.length ? { id: { in: gapTrackIds } } : { id: "__no_audio_feature_gap__" }];
  if (searchable) {
    parts.push(searchable);
    baseParts.push(searchable);
    gapParts.push(searchable);
  }

  return {
    where: { AND: parts },
    baseWhere: { AND: baseParts },
    gapWhere: { AND: gapParts },
    gapTrackIds,
  };
}
