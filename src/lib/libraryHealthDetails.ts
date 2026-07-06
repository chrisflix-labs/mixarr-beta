import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  auditAudioFeatureHealthGap,
  audioFeatureAnalyzerFailedTrackWhere,
  audioFeatureExtractionFailedTrackWhere,
  audioFeatureFailedTrackWhere,
  getAudioFeatureHealthStatus,
  audioFeatureNoDataTrackWhere,
  audioFeatureTooShortTrackWhere,
  completeAudioFeatureTrackWhere,
  type EffectiveAudioFeatureSettings,
  getEffectiveAudioFeatures,
  mergeAudioFeatureHealthGapCounts,
  missingAudioFeatureTrackWhere,
  noAudioFeatureRecordTrackWhere,
  pendingAudioFeatureTrackWhere,
  partialAudioFeatureTrackWhere,
  type AudioFeatureHealthGapAudit,
} from "./audioFeatures";
import {
  bpmAnalyzerFailedTrackWhere,
  bpmExtractionFailedTrackWhere,
  bpmFailedTrackWhere,
  bpmNoDataTrackWhere,
  bpmTooShortTrackWhere,
  buildBpmSourceWhereClause,
  effectiveBpmTrackWhere,
  getEffectiveBpm,
  missingEffectiveBpmTrackWhere,
} from "./bpm";

export const libraryHealthDetailCategories = [
  "all_tracks",
  "missing_bpm",
  "api_bpm",
  "local_bpm",
  "missing_audio_features",
  "partial_audio_features",
  "pending_audio_features",
  "complete_audio_features",
  "failed_analysis",
  "failed_bpm_analysis",
  "failed_audio_feature_analysis",
  "missing_local_file",
  "too_short",
  "skipped",
  "healthy_tracks",
] as const;

export type LibraryHealthDetailCategory = typeof libraryHealthDetailCategories[number];
export type LibraryHealthSort = "artist" | "title" | "album" | "duration" | "bpm" | "lastAnalyzed" | "failureStatus";

export const DEFAULT_LIBRARY_HEALTH_CATEGORY: LibraryHealthDetailCategory = "missing_bpm";
export const MAX_LIBRARY_HEALTH_PAGE_SIZE = 100;

export const libraryHealthDetailLabels: Record<LibraryHealthDetailCategory, string> = {
  all_tracks: "All Tracks",
  missing_bpm: "Missing BPM",
  api_bpm: "API BPM Only",
  local_bpm: "Local BPM Available",
  missing_audio_features: "Missing Audio Features",
  partial_audio_features: "Partial Audio Features",
  pending_audio_features: "Pending Audio Features",
  complete_audio_features: "Complete Audio Features",
  failed_analysis: "Failed Analysis",
  failed_bpm_analysis: "Failed BPM Analysis",
  failed_audio_feature_analysis: "Failed Audio Feature Analysis",
  missing_local_file: "Missing Local File",
  too_short: "Too Short To Analyze",
  skipped: "Skipped",
  healthy_tracks: "Healthy Tracks",
};

export const libraryHealthEmptyMessages: Record<LibraryHealthDetailCategory, string> = {
  all_tracks: "No active tracks found.",
  missing_bpm: "No tracks are missing BPM. Nice!",
  api_bpm: "No tracks are relying on API-only BPM.",
  local_bpm: "No tracks have locally analyzed BPM yet.",
  missing_audio_features: "No tracks are missing required audio features for the current provider mode.",
  partial_audio_features: "No tracks have partial audio feature data.",
  pending_audio_features: "No tracks are pending audio feature analysis.",
  complete_audio_features: "No tracks have complete audio features yet.",
  failed_analysis: "No failed analysis jobs found.",
  failed_bpm_analysis: "No failed BPM analysis jobs found.",
  failed_audio_feature_analysis: "No failed audio feature analysis jobs found.",
  missing_local_file: "No tracks are missing local files.",
  too_short: "No tracks are too short to analyze.",
  skipped: "No skipped analysis tracks found.",
  healthy_tracks: "No fully healthy tracks found yet.",
};

export function isLibraryHealthDetailCategory(value: unknown): value is LibraryHealthDetailCategory {
  return typeof value === "string" && (libraryHealthDetailCategories as readonly string[]).includes(value);
}

function activeUserTrackWhere(userId: string, libraryId?: string): Prisma.TrackWhereInput {
  return {
    syncStatus: "active",
    library: {
      ...(libraryId ? { id: libraryId } : {}),
      server: { userId },
    },
  };
}

export function missingLocalFileWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { mediaPath: null },
      { mediaPath: "" },
      { bpmSource: "local_not_found" },
      { audioFeature: { is: { OR: [{ source: "local_not_found" }, { tempoSource: "local_not_found" }] } } },
    ],
  };
}

export function skippedAnalysisWhere(settings?: EffectiveAudioFeatureSettings): Prisma.TrackWhereInput {
  return {
    OR: [
      bpmNoDataTrackWhere(),
      audioFeatureNoDataTrackWhere(settings),
    ],
  };
}

export function tooShortAnalysisWhere(settings?: EffectiveAudioFeatureSettings): Prisma.TrackWhereInput {
  return {
    OR: [
      bpmTooShortTrackWhere(),
      audioFeatureTooShortTrackWhere(settings),
    ],
  };
}

export function healthyTrackWhere(settings?: EffectiveAudioFeatureSettings): Prisma.TrackWhereInput {
  return {
    AND: [
      effectiveBpmTrackWhere(),
      completeAudioFeatureTrackWhere(settings),
      { NOT: missingLocalFileWhere() },
      { NOT: bpmFailedTrackWhere() },
      { NOT: audioFeatureFailedTrackWhere(settings) },
      { NOT: tooShortAnalysisWhere(settings) },
      { NOT: skippedAnalysisWhere(settings) },
    ],
  };
}

export function libraryHealthCategoryWhere(category: LibraryHealthDetailCategory, settings?: EffectiveAudioFeatureSettings): Prisma.TrackWhereInput {
  switch (category) {
    case "all_tracks":
      return {};
    case "missing_bpm":
      return missingEffectiveBpmTrackWhere();
    case "api_bpm":
      return buildBpmSourceWhereClause("api_bpm");
    case "local_bpm":
      return buildBpmSourceWhereClause("local_bpm");
    case "missing_audio_features":
      return missingAudioFeatureTrackWhere(settings);
    case "partial_audio_features":
      return partialAudioFeatureTrackWhere(settings);
    case "pending_audio_features":
      return pendingAudioFeatureTrackWhere(settings);
    case "complete_audio_features":
      return completeAudioFeatureTrackWhere(settings);
    case "failed_analysis":
      return { OR: [bpmFailedTrackWhere(), audioFeatureFailedTrackWhere(settings)] };
    case "failed_bpm_analysis":
      return bpmFailedTrackWhere();
    case "failed_audio_feature_analysis":
      return audioFeatureFailedTrackWhere(settings);
    case "missing_local_file":
      return missingLocalFileWhere();
    case "too_short":
      return tooShortAnalysisWhere(settings);
    case "skipped":
      return skippedAnalysisWhere(settings);
    case "healthy_tracks":
      return healthyTrackWhere(settings);
  }
}

export function buildLibraryHealthTrackWhere(userId: string, options: {
  category: LibraryHealthDetailCategory;
  libraryId?: string;
  search?: string;
  artist?: string;
  album?: string;
  bpmSource?: string;
  audioFeatureStatus?: string;
  localFileStatus?: string;
  failedOnly?: boolean;
  missingDataOnly?: boolean;
  settings?: EffectiveAudioFeatureSettings;
}): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [
    activeUserTrackWhere(userId, options.libraryId),
    libraryHealthCategoryWhere(options.category, options.settings),
  ];

  if (options.search) {
    and.push({
      OR: [
        { title: { contains: options.search, mode: "insensitive" } },
        { artist: { title: { contains: options.search, mode: "insensitive" } } },
        { album: { title: { contains: options.search, mode: "insensitive" } } },
        { mediaPath: { contains: options.search, mode: "insensitive" } },
        { ratingKey: { contains: options.search, mode: "insensitive" } },
      ],
    });
  }
  if (options.artist) and.push({ artist: { title: { contains: options.artist, mode: "insensitive" } } });
  if (options.album) and.push({ album: { title: { contains: options.album, mode: "insensitive" } } });
  if (options.bpmSource && options.bpmSource !== "all") {
    if (options.bpmSource === "missing") and.push(missingEffectiveBpmTrackWhere());
    if (options.bpmSource === "api") and.push(buildBpmSourceWhereClause("api_bpm"));
    if (options.bpmSource === "local") and.push(buildBpmSourceWhereClause("local_bpm"));
    if (options.bpmSource === "imported") and.push(buildBpmSourceWhereClause("imported_bpm"));
  }
  if (options.audioFeatureStatus && options.audioFeatureStatus !== "all") {
    if (options.audioFeatureStatus === "missing") {
      and.push(missingAudioFeatureTrackWhere(options.settings));
    } else {
      and.push({ audioFeature: { is: { audioFeatureStatus: options.audioFeatureStatus } } });
    }
  }
  if (options.localFileStatus === "missing") and.push(missingLocalFileWhere());
  if (options.localFileStatus === "available") and.push({ NOT: missingLocalFileWhere() });
  if (options.failedOnly) {
    and.push({
      OR: [
        bpmFailedTrackWhere(),
        bpmExtractionFailedTrackWhere(),
        bpmAnalyzerFailedTrackWhere(),
        audioFeatureFailedTrackWhere(options.settings),
        audioFeatureExtractionFailedTrackWhere(options.settings),
        audioFeatureAnalyzerFailedTrackWhere(options.settings),
      ],
    });
  }
  if (options.missingDataOnly) {
    and.push({
      OR: [
        missingEffectiveBpmTrackWhere(),
        missingAudioFeatureTrackWhere(options.settings),
        missingLocalFileWhere(),
      ],
    });
  }

  return { AND: and };
}

export const libraryHealthDetailTrackSelect = {
  id: true,
  title: true,
  ratingKey: true,
  duration: true,
  mediaPath: true,
  bpm: true,
  apiBpm: true,
  localBpm: true,
  effectiveBpm: true,
  bpmSource: true,
  bpmConfidence: true,
  bpmAnalysisStatus: true,
  bpmAnalysisScope: true,
  bpmFailureReason: true,
  bpmAnalyzedAt: true,
  lastSeenAt: true,
  syncStatus: true,
  library: { select: { id: true, name: true } },
  artist: { select: { title: true } },
  album: { select: { title: true } },
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
      localEnergy: true,
      localMood: true,
      localDanceability: true,
      localAcousticness: true,
      effectiveEnergy: true,
      effectiveMood: true,
      effectiveDanceability: true,
      effectiveAcousticness: true,
      tempo: true,
      audioFeatureSource: true,
      audioFeatureStatus: true,
      audioFeatureConfidence: true,
      audioFeatureFailureReason: true,
      audioFeatureAnalyzedAt: true,
      audioFeatureAnalysisScope: true,
      tempoSource: true,
      source: true,
    },
  },
} satisfies Prisma.TrackSelect;

function localFileStatus(track: any) {
  const source = String(track.audioFeature?.source || "").toLowerCase();
  const tempoSource = String(track.audioFeature?.tempoSource || "").toLowerCase();
  const bpmSource = String(track.bpmSource || "").toLowerCase();
  if (!track.mediaPath || source === "local_not_found" || tempoSource === "local_not_found" || bpmSource === "local_not_found") {
    return "missing";
  }
  return "available";
}

function audioFeatureStatus(track: any, settings?: EffectiveAudioFeatureSettings) {
  const classification = getAudioFeatureHealthStatus(track, settings);
  if (classification.status === "complete") return "complete";
  return classification.status;
}

function failureReason(track: any) {
  return track.bpmFailureReason || track.audioFeature?.audioFeatureFailureReason || null;
}

export function reasonForLibraryHealthTrack(category: LibraryHealthDetailCategory, track: any, settings?: EffectiveAudioFeatureSettings) {
  const audio = getAudioFeatureHealthStatus(track, settings);
  switch (category) {
    case "missing_bpm":
      return "No BPM value is currently available for this track.";
    case "api_bpm":
      return "This track has BPM from an API provider but does not have locally analyzed BPM yet.";
    case "local_bpm":
      return "This track has BPM from local analysis.";
    case "missing_audio_features":
      if (!track.audioFeature) return "No audio feature record found.";
      if (audio.reason === "API data only") return "API data only. The current provider mode requires local or allowed estimated audio features.";
      if (audio.missingFields.length) return `Missing required audio feature fields for the current provider mode: ${audio.missingFields.join(", ")}.`;
      return "Missing required audio features for the current provider mode.";
    case "partial_audio_features":
      return audio.missingFields.length
        ? `This track has some audio feature data, but required fields are incomplete for the current provider mode: ${audio.missingFields.join(", ")}.`
        : "This track has some audio feature data, but one or more required fields are missing for the current provider mode.";
    case "pending_audio_features":
      return "This track is pending audio feature analysis because required audio feature fields are incomplete for the current provider mode.";
    case "complete_audio_features":
      return "This track has a complete audio feature set.";
    case "failed_analysis":
      return failureReason(track) || "BPM or audio feature analysis failed during a previous attempt.";
    case "failed_bpm_analysis":
      return track.bpmFailureReason || "Local BPM analysis failed during a previous attempt.";
    case "failed_audio_feature_analysis":
      return track.audioFeature?.audioFeatureFailureReason || "Local audio feature analysis failed during a previous attempt.";
    case "missing_local_file":
      return "Mixarr could not find a matching local file for analysis.";
    case "too_short":
      return track.bpmFailureReason || track.audioFeature?.audioFeatureFailureReason || "The track is too short for the selected local analysis window.";
    case "skipped":
      return "Analysis previously completed without usable data, so this track was skipped by the current retry rules.";
    case "healthy_tracks":
      return "This track has BPM, complete audio features, and an available local file reference.";
    case "all_tracks":
      return "This active library track is included in the full Library Health view.";
  }
}

export function serializeLibraryHealthDetailTrack(track: any, category: LibraryHealthDetailCategory, settings?: EffectiveAudioFeatureSettings) {
  const effectiveBpm = getEffectiveBpm(track);
  const audio = getEffectiveAudioFeatures(track, settings);
  const lastAnalyzed = [track.bpmAnalyzedAt, track.audioFeature?.audioFeatureAnalyzedAt]
    .filter(Boolean)
    .map((value) => new Date(value))
    .sort((left, right) => right.getTime() - left.getTime())[0] || null;

  return {
    id: track.id,
    title: track.title,
    artist: track.artist?.title || "Unknown artist",
    album: track.album?.title || "Unknown album",
    library: track.library,
    ratingKey: track.ratingKey,
    duration: track.duration,
    mediaPath: track.mediaPath,
    bpm: effectiveBpm,
    apiBpm: track.apiBpm ?? null,
    localBpm: track.localBpm ?? null,
    bpmSource: track.bpmSource || track.audioFeature?.tempoSource || (effectiveBpm === null ? "missing" : null),
    energy: audio.energy,
    mood: audio.mood,
    danceability: audio.danceability,
    acousticness: audio.acousticness,
    audioFeatureStatus: audioFeatureStatus(track, settings),
    audioFeatureSource: audio.source || track.audioFeature?.audioFeatureSource || null,
    localFileStatus: localFileStatus(track),
    lastAnalyzed,
    bpmAnalysisStatus: track.bpmAnalysisStatus || null,
    audioFeatureAnalysisStatus: track.audioFeature?.audioFeatureStatus || null,
    failureReason: failureReason(track),
    reason: reasonForLibraryHealthTrack(category, track, settings),
    syncStatus: track.syncStatus,
  };
}

export function orderByForLibraryHealth(sort: LibraryHealthSort, direction: "asc" | "desc", category: LibraryHealthDetailCategory): Prisma.TrackOrderByWithRelationInput[] {
  switch (sort) {
    case "artist":
      return [{ artist: { title: direction } }, { title: "asc" }];
    case "title":
      return [{ title: direction }];
    case "album":
      return [{ album: { title: direction } }, { trackIndex: "asc" }, { title: "asc" }];
    case "duration":
      return [{ duration: direction }, { artist: { title: "asc" } }, { title: "asc" }];
    case "bpm":
      return [{ effectiveBpm: direction }, { bpm: direction }, { title: "asc" }];
    case "lastAnalyzed":
      return category.includes("audio")
        ? [{ audioFeature: { audioFeatureAnalyzedAt: direction } }, { title: "asc" }]
        : [{ bpmAnalyzedAt: direction }, { title: "asc" }];
    case "failureStatus":
      return category.includes("audio")
        ? [{ audioFeature: { audioFeatureStatus: direction } }, { title: "asc" }]
        : [{ bpmAnalysisStatus: direction }, { title: "asc" }];
  }
}

export function defaultOrderForLibraryHealth(category: LibraryHealthDetailCategory): Prisma.TrackOrderByWithRelationInput[] {
  if (category.startsWith("failed") || category === "too_short" || category === "skipped") {
    return orderByForLibraryHealth("lastAnalyzed", "desc", category);
  }
  return [{ artist: { title: "asc" } }, { album: { title: "asc" } }, { trackIndex: "asc" }, { title: "asc" }];
}

export async function getLibraryHealthDetailSummary(userId: string, libraryId?: string, settings?: EffectiveAudioFeatureSettings) {
  const active = activeUserTrackWhere(userId, libraryId);
  const entries = await Promise.all(libraryHealthDetailCategories.map(async (category) => [
    category,
    await prisma.track.count({ where: { AND: [active, libraryHealthCategoryWhere(category, settings)] } }),
  ] as const));
  const totalTracks = await prisma.track.count({ where: active });
  const categories = Object.fromEntries(entries) as Record<LibraryHealthDetailCategory, number>;
  const [noAudioFeatureRecord, noData, failed, tooShort] = await Promise.all([
    prisma.track.count({ where: { AND: [active, noAudioFeatureRecordTrackWhere()] } }),
    prisma.track.count({ where: { AND: [active, audioFeatureNoDataTrackWhere(settings)] } }),
    prisma.track.count({ where: { AND: [active, audioFeatureFailedTrackWhere(settings)] } }),
    prisma.track.count({ where: { AND: [active, audioFeatureTooShortTrackWhere(settings)] } }),
  ]);
  const audioFeatureGapAudit: AudioFeatureHealthGapAudit = auditAudioFeatureHealthGap({
    activeTracks: totalTracks,
    completeAudioFeatures: categories.complete_audio_features,
    missing: categories.missing_audio_features,
    partial: categories.partial_audio_features,
    pending: categories.pending_audio_features,
    noData,
    failed,
    tooShort,
    noAudioFeatureRecord,
  });
  const mergedAudioFeatureCounts = mergeAudioFeatureHealthGapCounts({
    activeTracks: totalTracks,
    completeAudioFeatures: categories.complete_audio_features,
    missing: categories.missing_audio_features,
    partial: categories.partial_audio_features,
    pending: categories.pending_audio_features,
    noData,
    failed,
    tooShort,
    noAudioFeatureRecord,
  });
  categories.missing_audio_features = mergedAudioFeatureCounts.missing;
  categories.pending_audio_features = mergedAudioFeatureCounts.pending;
  return {
    totalTracks,
    categories,
    audioFeatureGapAudit: {
      ...audioFeatureGapAudit,
      classifiedAsMissing: mergedAudioFeatureCounts.gapOnly,
    },
  };
}
