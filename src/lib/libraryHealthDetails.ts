import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  audioFeatureAnalyzerFailedTrackWhere,
  audioFeatureExtractionFailedTrackWhere,
  audioFeatureFailedTrackWhere,
  audioFeatureNoDataTrackWhere,
  audioFeatureTooShortTrackWhere,
  completeAudioFeatureTrackWhere,
  getEffectiveAudioFeatures,
  missingAudioFeatureTrackWhere,
  partialAudioFeatureTrackWhere,
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
  missing_audio_features: "No tracks are missing audio features.",
  partial_audio_features: "No tracks have partial audio features.",
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

export function skippedAnalysisWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      bpmNoDataTrackWhere(),
      audioFeatureNoDataTrackWhere(),
    ],
  };
}

export function tooShortAnalysisWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      bpmTooShortTrackWhere(),
      audioFeatureTooShortTrackWhere(),
    ],
  };
}

export function healthyTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      effectiveBpmTrackWhere(),
      completeAudioFeatureTrackWhere(),
      { NOT: missingLocalFileWhere() },
      { NOT: bpmFailedTrackWhere() },
      { NOT: audioFeatureFailedTrackWhere() },
      { NOT: tooShortAnalysisWhere() },
      { NOT: skippedAnalysisWhere() },
    ],
  };
}

export function libraryHealthCategoryWhere(category: LibraryHealthDetailCategory): Prisma.TrackWhereInput {
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
      return missingAudioFeatureTrackWhere();
    case "partial_audio_features":
      return partialAudioFeatureTrackWhere();
    case "complete_audio_features":
      return completeAudioFeatureTrackWhere();
    case "failed_analysis":
      return { OR: [bpmFailedTrackWhere(), audioFeatureFailedTrackWhere()] };
    case "failed_bpm_analysis":
      return bpmFailedTrackWhere();
    case "failed_audio_feature_analysis":
      return audioFeatureFailedTrackWhere();
    case "missing_local_file":
      return missingLocalFileWhere();
    case "too_short":
      return tooShortAnalysisWhere();
    case "skipped":
      return skippedAnalysisWhere();
    case "healthy_tracks":
      return healthyTrackWhere();
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
}): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [
    activeUserTrackWhere(userId, options.libraryId),
    libraryHealthCategoryWhere(options.category),
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
      and.push(missingAudioFeatureTrackWhere());
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
        audioFeatureFailedTrackWhere(),
        audioFeatureExtractionFailedTrackWhere(),
        audioFeatureAnalyzerFailedTrackWhere(),
      ],
    });
  }
  if (options.missingDataOnly) {
    and.push({
      OR: [
        missingEffectiveBpmTrackWhere(),
        missingAudioFeatureTrackWhere(),
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

function audioFeatureStatus(track: any) {
  const effective = getEffectiveAudioFeatures(track, { preferLocalAudioFeatures: true, allowEstimated: true });
  if (effective.complete) return "complete";
  if (effective.partial) return "partial";
  return track.audioFeature?.audioFeatureStatus || "missing";
}

function failureReason(track: any) {
  return track.bpmFailureReason || track.audioFeature?.audioFeatureFailureReason || null;
}

export function reasonForLibraryHealthTrack(category: LibraryHealthDetailCategory, track: any) {
  const audio = getEffectiveAudioFeatures(track, { preferLocalAudioFeatures: true, allowEstimated: true });
  switch (category) {
    case "missing_bpm":
      return "No BPM value is currently available for this track.";
    case "api_bpm":
      return "This track has BPM from an API provider but does not have locally analyzed BPM yet.";
    case "local_bpm":
      return "This track has BPM from local analysis.";
    case "missing_audio_features":
      return "Complete audio feature fields are not currently available for this track.";
    case "partial_audio_features":
      return audio.missingFields.length
        ? `Some audio feature fields are missing or incomplete: ${audio.missingFields.join(", ")}.`
        : "Some audio feature fields are missing or incomplete.";
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

export function serializeLibraryHealthDetailTrack(track: any, category: LibraryHealthDetailCategory) {
  const effectiveBpm = getEffectiveBpm(track);
  const audio = getEffectiveAudioFeatures(track, { preferLocalAudioFeatures: true, allowEstimated: true });
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
    audioFeatureStatus: audioFeatureStatus(track),
    audioFeatureSource: audio.source || track.audioFeature?.audioFeatureSource || null,
    localFileStatus: localFileStatus(track),
    lastAnalyzed,
    bpmAnalysisStatus: track.bpmAnalysisStatus || null,
    audioFeatureAnalysisStatus: track.audioFeature?.audioFeatureStatus || null,
    failureReason: failureReason(track),
    reason: reasonForLibraryHealthTrack(category, track),
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

export async function getLibraryHealthDetailSummary(userId: string, libraryId?: string) {
  const active = activeUserTrackWhere(userId, libraryId);
  const entries = await Promise.all(libraryHealthDetailCategories.map(async (category) => [
    category,
    await prisma.track.count({ where: { AND: [active, libraryHealthCategoryWhere(category)] } }),
  ] as const));
  const totalTracks = await prisma.track.count({ where: active });
  return {
    totalTracks,
    categories: Object.fromEntries(entries) as Record<LibraryHealthDetailCategory, number>,
  };
}
