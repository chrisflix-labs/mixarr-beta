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
  audit: AudioFeatureHealthGapAudit;
};

function countScope(scopeWhere: Prisma.TrackWhereInput, filterWhere: Prisma.TrackWhereInput): Prisma.TrackWhereInput {
  return { AND: [scopeWhere, filterWhere] };
}

function audioFeatureClassifiedIncompleteTrackWhere(settings?: EffectiveAudioFeatureSettings): Prisma.TrackWhereInput {
  return {
    OR: [
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

export async function getAudioFeatureGapTrackIdsForScope(scopeWhere: Prisma.TrackWhereInput, settings?: EffectiveAudioFeatureSettings) {
  const tracks = await prisma.track.findMany({
    where: audioFeatureGapTrackWhere(scopeWhere, settings),
    select: { id: true },
  });
  return tracks.map((track) => track.id);
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
  const merged = mergeAudioFeatureHealthGapCounts({
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
  const gapTrackIds = merged.gapOnly > 0
    ? await getAudioFeatureGapTrackIdsForScope(scopeWhere, settings)
    : [];

  return {
    activeTracks,
    complete,
    missing: merged.missing,
    api,
    local,
    heuristic,
    partial,
    pending: merged.pending,
    noData,
    failed,
    extractionFailed,
    analyzerFailed,
    tooShort,
    noAudioFeatureRecord,
    gapOnly: merged.gapOnly,
    gapTrackIds,
    audit: merged.audit,
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
  const shouldIncludeGap = options.filter === "missing_audio_features" || options.filter === "pending_audio_features";
  const gapTrackIds = shouldIncludeGap
    ? await getAudioFeatureGapTrackIdsForScope(scopeWhere, options.settings)
    : [];
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

