import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  apiAudioFeatureTrackWhere,
  audioFeatureAnalyzerFailedTrackWhere,
  audioFeatureExtractionFailedTrackWhere,
  audioFeatureFailedTrackWhere,
  getAudioFeatureHealthStatus,
  heuristicAudioFeatureTrackWhere,
  localAudioFeatureTrackWhere,
  audioFeatureNoDataTrackWhere,
  audioFeatureTooShortTrackWhere,
  completeAudioFeatureTrackWhere,
  type EffectiveAudioFeatureSettings,
  getEffectiveAudioFeatures,
  missingAudioFeatureTrackWhere,
  pendingAudioFeatureTrackWhere,
  partialAudioFeatureTrackWhere,
  trackHasUsefulBpmMetadata,
} from "./audioFeatures";
import {
  type AudioFeatureHealthClassification,
  getAudioFeatureGapClassificationForScope,
  getAudioFeatureHealthClassification,
} from "./audioFeatureHealthClassification";
import {
  bpmAnalyzerFailedTrackWhere,
  bpmExtractionFailedTrackWhere,
  bpmFailedTrackWhere,
  bpmNoDataTrackWhere,
  bpmTooShortTrackWhere,
  buildBpmSourceWhereClause,
  effectiveBpmTrackWhere,
  getBpmDisplayMetadata,
  getEffectiveBpm,
  missingEffectiveBpmTrackWhere,
  pendingBpmBackfillTrackWhere,
} from "./bpm";
import {
  genreHealthFilterWhere,
  popularityHealthFilterWhere,
  type GenreHealthFilter,
  type PopularityHealthFilter,
} from "./libraryHealth";
import {
  getMoodEnergyDisplayMetadata,
  moodEnergyHealthFilters,
  resolveMoodEnergyTrackIds,
  type MoodEnergyHealthFilter,
} from "./moodEnergy";
import { metadataProviderModeKey } from "./syncSettings";

export const libraryHealthDetailCategories = [
  "all_tracks",
  "missing_bpm",
  "api_bpm",
  "local_bpm",
  "imported_bpm",
  "pending_bpm",
  "low_confidence_bpm",
  "bpm_source_conflict",
  "missing_audio_features",
  "partial_audio_features",
  "pending_audio_features",
  "complete_audio_features",
  "missing_mood",
  "missing_energy",
  "missing_mood_energy",
  "partial_mood_energy",
  "complete_mood_energy",
  "pending_mood_energy",
  "mood_energy_failed",
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
  imported_bpm: "Imported BPM",
  pending_bpm: "Pending BPM",
  low_confidence_bpm: "Low Confidence BPM",
  bpm_source_conflict: "BPM Source Conflicts",
  missing_audio_features: "Missing Audio Features",
  partial_audio_features: "Partial Audio Features",
  pending_audio_features: "Pending Audio Features",
  complete_audio_features: "Complete Audio Features",
  missing_mood: "Missing Mood",
  missing_energy: "Missing Energy",
  missing_mood_energy: "Missing Mood & Energy",
  partial_mood_energy: "Partial Mood/Energy",
  complete_mood_energy: "Complete Mood/Energy",
  pending_mood_energy: "Pending Mood/Energy Analysis",
  mood_energy_failed: "Mood/Energy Failed",
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
  imported_bpm: "No tracks are relying on imported BPM.",
  pending_bpm: "No tracks are pending BPM analysis.",
  low_confidence_bpm: "No low-confidence BPM values found.",
  bpm_source_conflict: "No BPM source conflicts found.",
  missing_audio_features: "No tracks are missing required audio features for the current provider mode.",
  partial_audio_features: "No tracks have partial audio feature data.",
  pending_audio_features: "No tracks are pending audio feature analysis.",
  complete_audio_features: "No tracks have complete audio features yet.",
  missing_mood: "No tracks are missing mood values.",
  missing_energy: "No tracks are missing energy values.",
  missing_mood_energy: "No tracks are missing both mood and energy values.",
  partial_mood_energy: "No tracks have partial mood/energy data.",
  complete_mood_energy: "No tracks have complete mood/energy data yet.",
  pending_mood_energy: "No tracks are pending mood/energy analysis.",
  mood_energy_failed: "No mood/energy analysis failures found.",
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
    case "imported_bpm":
      return buildBpmSourceWhereClause("imported_bpm");
    case "pending_bpm":
      return pendingBpmBackfillTrackWhere();
    case "low_confidence_bpm":
    case "bpm_source_conflict":
      return effectiveBpmTrackWhere();
    case "missing_audio_features":
      return missingAudioFeatureTrackWhere(settings);
    case "partial_audio_features":
      return partialAudioFeatureTrackWhere(settings);
    case "pending_audio_features":
      return pendingAudioFeatureTrackWhere(settings);
    case "complete_audio_features":
      return completeAudioFeatureTrackWhere(settings);
    case "missing_mood":
    case "missing_energy":
    case "missing_mood_energy":
    case "partial_mood_energy":
    case "complete_mood_energy":
    case "pending_mood_energy":
    case "mood_energy_failed":
      return { id: "__mood_energy_requires_resolved_track_ids__" };
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

type ResolvableLibraryHealthCategory =
  | LibraryHealthDetailCategory
  | "api_bpm_only"
  | "tracks_with_bpm"
  | "bpm_no_data"
  | "api_audio_features"
  | "local_audio_features"
  | "estimated_audio_features"
  | "heuristic_audio_features"
  | "audio_no_data"
  | "audio_failed"
  | "audio_feature_no_data"
  | "audio_feature_failed"
  | "audio_too_short"
  | MoodEnergyHealthFilter
  | "extraction_failed"
  | "analyzer_failed"
  | "tracks_with_genres"
  | "missing_genres"
  | "genre_no_data"
  | "genre_failed"
  | "pending_genre_backfill"
  | "tracks_with_popularity"
  | "missing_popularity"
  | "popularity_no_data"
  | "popularity_failed"
  | "pending_popularity"
  | "pending_popularity_backfill"
  | "available_local_files"
  | "missing_local_files";

export type LibraryHealthTrackIdResolution = {
  trackIds: string[];
  count: number;
  reasonByTrackId?: Record<string, string>;
  debug?: {
    filter: string;
    normal: number;
    gap: number;
    total: number;
  };
};

function normalizeResolvableCategory(category: ResolvableLibraryHealthCategory): ResolvableLibraryHealthCategory {
  if (category === "api_bpm_only") return "api_bpm";
  if (category === "missing_local_files") return "missing_local_file";
  if (category === "estimated_audio_features") return "heuristic_audio_features";
  if (category === "audio_feature_no_data") return "audio_no_data";
  if (category === "audio_feature_failed") return "audio_failed";
  if (category === "pending_popularity") return "pending_popularity_backfill";
  return category;
}

function uniqueTrackIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

async function findTrackIds(where: Prisma.TrackWhereInput) {
  const tracks = await prisma.track.findMany({
    where,
    select: { id: true },
  });
  return tracks.map((track) => track.id);
}

async function findBpmMetadataTrackIds(where: Prisma.TrackWhereInput, predicate: (track: any) => boolean) {
  const tracks = await prisma.track.findMany({
    where,
    select: libraryHealthDetailTrackSelect,
  });
  return tracks.filter(predicate).map((track) => track.id);
}

export async function resolveBpmMetadataFilteredTrackIds(userId: string, options: {
  category: LibraryHealthDetailCategory;
  libraryId?: string;
  settings?: EffectiveAudioFeatureSettings;
  bpmSource?: string;
  bpmConfidence?: string;
  bpmConflict?: string;
  apiImportedOnly?: boolean;
  noLocalBpm?: boolean;
  resolvedTrackIds?: string[];
}) {
  const active = activeUserTrackWhere(userId, options.libraryId);
  const baseCategory: Prisma.TrackWhereInput = options.resolvedTrackIds
    ? options.resolvedTrackIds.length
      ? { id: { in: options.resolvedTrackIds } }
      : { id: "__library_health_empty_bpm_metadata_filter__" }
    : libraryHealthCategoryWhere(options.category, options.settings);
  const tracks = await prisma.track.findMany({
    where: { AND: [active, baseCategory] },
    select: libraryHealthDetailTrackSelect,
  });
  return tracks.filter((track) => {
    const metadata = getBpmDisplayMetadata(track);
    const source = options.bpmSource || "all";
    const confidence = options.bpmConfidence || "all";
    if (source !== "all") {
      if (source === "missing" && metadata.effectiveBpm !== null) return false;
      if (source !== "missing" && metadata.source !== source) return false;
    }
    if (confidence !== "all" && metadata.confidence.toLowerCase() !== confidence) return false;
    if (options.bpmConflict === "conflicts" && !metadata.hasConflict) return false;
    if (options.apiImportedOnly && !["api", "deezer", "imported", "plex"].includes(metadata.source)) return false;
    if (options.noLocalBpm && metadata.localBpm !== null) return false;
    return true;
  }).map((track) => track.id);
}

function resolvableCategoryWhere(category: ResolvableLibraryHealthCategory, settings?: EffectiveAudioFeatureSettings): Prisma.TrackWhereInput {
  if (isLibraryHealthDetailCategory(category)) return libraryHealthCategoryWhere(category, settings);

  switch (category) {
    case "tracks_with_bpm": return effectiveBpmTrackWhere();
    case "bpm_no_data": return bpmNoDataTrackWhere();
    case "api_audio_features": return apiAudioFeatureTrackWhere(settings);
    case "local_audio_features": return localAudioFeatureTrackWhere(settings);
    case "heuristic_audio_features": return heuristicAudioFeatureTrackWhere();
    case "audio_no_data": return audioFeatureNoDataTrackWhere(settings);
    case "audio_failed": return audioFeatureFailedTrackWhere(settings);
    case "audio_too_short": return audioFeatureTooShortTrackWhere(settings);
    case "extraction_failed": return { OR: [bpmExtractionFailedTrackWhere(), audioFeatureExtractionFailedTrackWhere(settings)] };
    case "analyzer_failed": return { OR: [bpmAnalyzerFailedTrackWhere(), audioFeatureAnalyzerFailedTrackWhere(settings)] };
    case "tracks_with_genres":
    case "missing_genres":
    case "genre_no_data":
    case "genre_failed":
    case "pending_genre_backfill":
      return genreHealthFilterWhere(category as GenreHealthFilter);
    case "tracks_with_popularity":
    case "missing_popularity":
    case "popularity_no_data":
    case "popularity_failed":
    case "pending_popularity_backfill":
      return popularityHealthFilterWhere(category as PopularityHealthFilter);
    case "available_local_files": return { NOT: missingLocalFileWhere() };
  }
  return { id: "__invalid_library_health_category__" };
}

export async function resolveLibraryHealthTrackIds(userId: string, options: {
  category: ResolvableLibraryHealthCategory;
  libraryId?: string;
  settings?: EffectiveAudioFeatureSettings;
  audioFeatureClassification?: AudioFeatureHealthClassification;
}): Promise<LibraryHealthTrackIdResolution> {
  const category = normalizeResolvableCategory(options.category);
  const active = activeUserTrackWhere(userId, options.libraryId);
  const baseWhere = { AND: [active, resolvableCategoryWhere(category, options.settings)] };

  if ((moodEnergyHealthFilters as readonly string[]).includes(category)) {
    const trackIds = await resolveMoodEnergyTrackIds(userId, {
      filter: category as MoodEnergyHealthFilter,
      libraryId: options.libraryId,
      settings: options.settings,
    });
    return {
      trackIds,
      count: trackIds.length,
      debug: { filter: category, normal: trackIds.length, gap: 0, total: trackIds.length },
    };
  }

  if (category === "low_confidence_bpm" || category === "bpm_source_conflict") {
    const trackIds = await findBpmMetadataTrackIds(baseWhere, (track) => {
      const metadata = getBpmDisplayMetadata(track);
      return category === "low_confidence_bpm"
        ? metadata.confidence === "Low"
        : metadata.hasConflict;
    });
    return {
      trackIds,
      count: trackIds.length,
      debug: { filter: category, normal: trackIds.length, gap: 0, total: trackIds.length },
    };
  }

  if (category !== "missing_audio_features" && category !== "partial_audio_features" && category !== "pending_audio_features") {
    const trackIds = await findTrackIds(baseWhere);
    return {
      trackIds,
      count: trackIds.length,
      debug: { filter: category, normal: trackIds.length, gap: 0, total: trackIds.length },
    };
  }

  const audioFeatureClassification = options.audioFeatureClassification
    || await getAudioFeatureHealthClassification(userId, {
      libraryId: options.libraryId,
      settings: options.settings,
  });
  const normalTrackIds = await findTrackIds(baseWhere);
  const gapTrackIds = category === "missing_audio_features"
    ? audioFeatureClassification.missingGapTrackIds
    : category === "partial_audio_features"
      ? audioFeatureClassification.partialGapTrackIds
      : audioFeatureClassification.gapTrackIds;
  const trackIds = uniqueTrackIds([...normalTrackIds, ...gapTrackIds]);
  const reasonByTrackId = Object.fromEntries(
    gapTrackIds.map((trackId) => [
      trackId,
      category === "partial_audio_features" || audioFeatureClassification.partialGapTrackIds.includes(trackId)
        ? "Track has BPM data but is missing required audio feature fields."
        : "No audio feature record found",
    ]),
  );
  const debug = {
    filter: category,
    normal: normalTrackIds.length,
    gap: gapTrackIds.length,
    total: trackIds.length,
  };

  console.log(
    `[LibraryHealth] resolved filter=${category} trackIds=${trackIds.length} normal=${debug.normal} gap=${debug.gap}`,
  );

  return {
    trackIds,
    count: trackIds.length,
    reasonByTrackId,
    debug,
  };
}

export function buildLibraryHealthTrackWhere(userId: string, options: {
  category: LibraryHealthDetailCategory;
  libraryId?: string;
  search?: string;
  artist?: string;
  album?: string;
  bpmSource?: string;
  bpmConfidence?: string;
  bpmConflict?: string;
  apiImportedOnly?: boolean;
  noLocalBpm?: boolean;
  audioFeatureStatus?: string;
  localFileStatus?: string;
  failedOnly?: boolean;
  missingDataOnly?: boolean;
  settings?: EffectiveAudioFeatureSettings;
  audioFeatureGapTrackIds?: string[];
  resolvedTrackIds?: string[];
}): Prisma.TrackWhereInput {
  const audioFeatureGapWhere: Prisma.TrackWhereInput | null = options.audioFeatureGapTrackIds?.length
    ? { id: { in: options.audioFeatureGapTrackIds } }
    : null;
  const resolvedTrackWhere: Prisma.TrackWhereInput | null = options.resolvedTrackIds
    ? options.resolvedTrackIds.length
      ? { id: { in: options.resolvedTrackIds } }
      : { id: "__library_health_empty_resolved_track_set__" }
    : null;
  const categoryWhere = resolvedTrackWhere || ((
    audioFeatureGapWhere
      && (options.category === "missing_audio_features" || options.category === "pending_audio_features")
  )
    ? { OR: [libraryHealthCategoryWhere(options.category, options.settings), audioFeatureGapWhere] }
    : libraryHealthCategoryWhere(options.category, options.settings));
  const and: Prisma.TrackWhereInput[] = [
    activeUserTrackWhere(userId, options.libraryId),
    categoryWhere,
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
    if (options.bpmSource === "manual") and.push({ bpmSource: { contains: "manual", mode: "insensitive" } });
    if (options.bpmSource === "estimated") and.push({ OR: [
      { bpmSource: { contains: "estimated", mode: "insensitive" } },
      { audioFeature: { is: { tempoSource: { contains: "estimated", mode: "insensitive" } } } },
      { audioFeature: { is: { tempoSource: { contains: "heuristic", mode: "insensitive" } } } },
    ] });
    if (options.bpmSource === "unknown") and.push({ AND: [
      effectiveBpmTrackWhere(),
      { bpmSource: null },
      { OR: [{ audioFeature: null }, { audioFeature: { is: { tempoSource: null } } }] },
    ] });
  }
  if (options.bpmConfidence && options.bpmConfidence !== "all") {
    if (options.bpmConfidence === "unknown") and.push({ AND: [{ bpmConfidence: null }, { OR: [{ audioFeature: null }, { audioFeature: { is: { tempoConfidence: null } } }] }] });
    if (options.bpmConfidence === "high") and.push({ OR: [{ bpmConfidence: { gte: 0.8 } }, { audioFeature: { is: { tempoConfidence: { gte: 0.8 } } } }] });
    if (options.bpmConfidence === "medium") and.push({ OR: [
      { bpmConfidence: { gte: 0.5, lt: 0.8 } },
      { audioFeature: { is: { tempoConfidence: { gte: 0.5, lt: 0.8 } } } },
    ] });
    if (options.bpmConfidence === "low") and.push({ OR: [
      { bpmConfidence: { lt: 0.5 } },
      { audioFeature: { is: { tempoConfidence: { lt: 0.5 } } } },
      { bpmSource: { contains: "estimated", mode: "insensitive" } },
    ] });
  }
  if (options.apiImportedOnly) {
    and.push({ AND: [{ NOT: buildBpmSourceWhereClause("local_bpm") }, { OR: [buildBpmSourceWhereClause("api_bpm"), buildBpmSourceWhereClause("imported_bpm")] }] });
  }
  if (options.noLocalBpm) and.push({ NOT: buildBpmSourceWhereClause("local_bpm") });
  if (options.audioFeatureStatus && options.audioFeatureStatus !== "all") {
    if (options.audioFeatureStatus === "missing") {
      and.push(audioFeatureGapWhere ? { OR: [missingAudioFeatureTrackWhere(options.settings), audioFeatureGapWhere] } : missingAudioFeatureTrackWhere(options.settings));
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
        audioFeatureGapWhere ? { OR: [missingAudioFeatureTrackWhere(options.settings), audioFeatureGapWhere] } : missingAudioFeatureTrackWhere(options.settings),
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
      tempoConfidence: true,
      audioFeatureSource: true,
      audioFeatureStatus: true,
      audioFeatureConfidence: true,
      audioFeatureFailureReason: true,
      audioFeatureAnalyzedAt: true,
      audioFeatureAnalysisScope: true,
      tempoSource: true,
      source: true,
      confidence: true,
      energySource: true,
      valenceSource: true,
      danceabilitySource: true,
      acousticnessSource: true,
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
      return "No BPM value is available for the current provider mode.";
    case "api_bpm":
      return "API/imported BPM only. No local BPM has been calculated yet.";
    case "local_bpm":
      return "Local BPM preferred. Local BPM is used because local analysis is available.";
    case "imported_bpm":
      return "API/imported BPM only. No local BPM has been calculated yet.";
    case "pending_bpm":
      return "This track is pending BPM analysis.";
    case "low_confidence_bpm":
      return getBpmDisplayMetadata(track).reason;
    case "bpm_source_conflict":
      return getBpmDisplayMetadata(track).conflictReason || "BPM source conflict.";
    case "missing_audio_features":
      if (!track.audioFeature) return "No usable audio feature metadata was found for the current provider mode.";
      if (audio.reason === "API data only") return "API data only. The current provider mode requires local or allowed estimated audio features.";
      if (audio.missingFields.length) return `Missing required audio feature fields for the current provider mode: ${audio.missingFields.join(", ")}.`;
      return "No usable audio feature metadata was found for the current provider mode.";
    case "partial_audio_features":
      if (trackHasUsefulBpmMetadata(track)) return "Track has BPM data but is missing required audio feature fields.";
      return audio.missingFields.length
        ? `This track has some audio feature data, but required fields are incomplete for the current provider mode: ${audio.missingFields.join(", ")}.`
        : "This track has some audio feature data, but one or more required fields are missing for the current provider mode.";
    case "pending_audio_features":
      return "This track is pending audio feature analysis because required audio feature fields are incomplete for the current provider mode.";
    case "complete_audio_features":
      return "This track has a complete audio feature set.";
    case "missing_mood":
      return getMoodEnergyDisplayMetadata(track, settings).reason;
    case "missing_energy":
      return getMoodEnergyDisplayMetadata(track, settings).reason;
    case "missing_mood_energy":
      return getMoodEnergyDisplayMetadata(track, settings).reason;
    case "partial_mood_energy":
      return getMoodEnergyDisplayMetadata(track, settings).reason;
    case "complete_mood_energy":
      return "This track has mood and energy values for the current provider mode.";
    case "pending_mood_energy":
      return getMoodEnergyDisplayMetadata(track, settings).reason;
    case "mood_energy_failed":
      return track.audioFeature?.audioFeatureFailureReason || "Mood/energy analysis failed during a previous local audio feature attempt.";
    case "failed_analysis":
      return failureReason(track) || "BPM or audio feature analysis failed during a previous attempt.";
    case "failed_bpm_analysis":
      return track.bpmFailureReason || "Local BPM analysis failed during a previous attempt.";
    case "failed_audio_feature_analysis":
      return track.audioFeature?.audioFeatureFailureReason || "Local audio feature analysis failed during a previous attempt.";
    case "missing_local_file":
      return "Mixarr could not find a local file path for this active track.";
    case "too_short":
      return track.bpmFailureReason || track.audioFeature?.audioFeatureFailureReason || "The track is too short for the selected local analysis window.";
    case "skipped":
      return "Analysis previously completed without usable data, so this track was skipped by the current retry rules.";
    case "healthy_tracks":
      return "Healthy Tracks are active tracks with required metadata complete for the current settings.";
    case "all_tracks":
      return "This active library track is included in the full Library Health view.";
  }
}

export function serializeLibraryHealthDetailTrack(track: any, category: LibraryHealthDetailCategory, settings?: EffectiveAudioFeatureSettings) {
  const effectiveBpm = getEffectiveBpm(track);
  const bpmDisplay = getBpmDisplayMetadata(track);
  const audio = getEffectiveAudioFeatures(track, settings);
  const moodEnergy = getMoodEnergyDisplayMetadata(track, settings);
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
    importedBpm: track.bpm ?? null,
    bpmSource: bpmDisplay.sourceLabel,
    bpmSourceKey: bpmDisplay.source,
    bpmConfidence: bpmDisplay.confidence,
    bpmConfidenceValue: bpmDisplay.confidenceValue,
    bpmConflictStatus: bpmDisplay.conflictStatus,
    bpmConflictReason: bpmDisplay.conflictReason,
    bpmOtherSources: bpmDisplay.otherSources,
    bpmOriginalSource: bpmDisplay.originalSource,
    bpmReason: bpmDisplay.reason,
    energy: audio.energy,
    mood: audio.mood,
    energySource: moodEnergy.energy.source,
    energySourceKey: moodEnergy.energy.sourceKey,
    energyConfidence: moodEnergy.energy.confidence,
    energyConfidenceValue: moodEnergy.energy.confidenceValue,
    moodSource: moodEnergy.mood.source,
    moodSourceKey: moodEnergy.mood.sourceKey,
    moodConfidence: moodEnergy.mood.confidence,
    moodConfidenceValue: moodEnergy.mood.confidenceValue,
    moodEnergyStatus: moodEnergy.status,
    danceability: audio.danceability,
    acousticness: audio.acousticness,
    audioFeatureStatus: audioFeatureStatus(track, settings),
    audioFeatureSource: audio.source || track.audioFeature?.audioFeatureSource || null,
    audioFeatureAnalysisScope: track.audioFeature?.audioFeatureAnalysisScope || null,
    audioFeatureConfidence: track.audioFeature?.audioFeatureConfidence ?? null,
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

export type LibraryHealthInvariantResult = {
  section: "Audio Features" | "Mood/Energy" | "BPM" | "Genres" | "Popularity" | "Local Files";
  ok: boolean;
  message: string;
  counts: Record<string, number>;
};

export type LibraryHealthAccuracyDiagnostics = {
  ok: boolean;
  providerMode: {
    audio: string;
  };
  invariants: LibraryHealthInvariantResult[];
  mismatches: Array<{
    category: string;
    cardCount: number;
    detailCount: number;
  }>;
  lastAudioFeatureRetry?: {
    filter: string | null;
    mode: string | null;
    providerMode: string | null;
    matched: number | null;
    queued: number | null;
    skipped: number | null;
    processed: number | null;
    failed: number | null;
    completedAt: Date | null;
  } | null;
  localAnalysisDiagnostics?: {
    analyzer: string;
    analyzerAvailable: boolean | null;
    localEnabled: boolean;
    scope: string;
    scopeLabel: string;
    lastRunAt: Date | null;
    matched: number | null;
    processed: number | null;
    skipped: number | null;
    failed: number | null;
    skipReasons: Record<string, number>;
  };
};

function invariant(section: LibraryHealthInvariantResult["section"], counts: Record<string, number>, ok: boolean, message: string): LibraryHealthInvariantResult {
  if (!ok) {
    console.warn(`[LibraryHealth][Invariant] ${section.toLowerCase()} ${message} ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(" ")}`);
  }
  return { section, ok, message, counts };
}

function buildHealthAccuracyDiagnostics(input: {
  totalTracks: number;
  categories: Record<LibraryHealthDetailCategory, number>;
  moodEnergy: {
    tracksWithMood: number;
    tracksMissingMood: number;
    tracksWithEnergy: number;
    tracksMissingEnergy: number;
    tracksMissingBoth: number;
  };
  tracksWithBpm: number;
  tracksWithGenres: number;
  missingGenres: number;
  tracksWithPopularity: number;
  missingPopularity: number;
  availableLocalFiles: number;
  missingLocalFiles: number;
  audioFeatureClassification: AudioFeatureHealthClassification;
  audioMode: string;
}): LibraryHealthAccuracyDiagnostics {
  const audio = input.audioFeatureClassification;
  const expectedIncomplete = Math.max(0, input.totalTracks - audio.complete);
  const classifiedIncomplete = audio.audit.classifiedIncomplete;
  const audioOk = expectedIncomplete === classifiedIncomplete;
  const bpmOk = input.totalTracks === input.tracksWithBpm + input.categories.missing_bpm;
  const moodOk = input.totalTracks === input.moodEnergy.tracksWithMood + input.moodEnergy.tracksMissingMood;
  const energyOk = input.totalTracks === input.moodEnergy.tracksWithEnergy + input.moodEnergy.tracksMissingEnergy;
  const missingBothOk = input.moodEnergy.tracksMissingBoth <= input.moodEnergy.tracksMissingMood
    && input.moodEnergy.tracksMissingBoth <= input.moodEnergy.tracksMissingEnergy;
  const moodEnergyOk = moodOk && energyOk && missingBothOk;
  const genresOk = input.totalTracks === input.tracksWithGenres + input.missingGenres;
  const popularityOk = input.totalTracks === input.tracksWithPopularity + input.missingPopularity;
  const localFilesOk = input.totalTracks === input.availableLocalFiles + input.missingLocalFiles;

  const invariants = [
    invariant("Audio Features", {
      active: input.totalTracks,
      complete: audio.complete,
      expectedIncomplete,
      classifiedIncomplete,
      partial: input.categories.partial_audio_features,
      missing: input.categories.missing_audio_features,
      failed: input.categories.failed_audio_feature_analysis,
      tooShort: audio.tooShort,
      noData: audio.noData,
      unclassified: audio.audit.unclassifiedGap,
    }, audioOk, audioOk ? "OK" : "incomplete mismatch"),
    invariant("Mood/Energy", {
      active: input.totalTracks,
      tracksWithMood: input.moodEnergy.tracksWithMood,
      missingMood: input.moodEnergy.tracksMissingMood,
      tracksWithEnergy: input.moodEnergy.tracksWithEnergy,
      missingEnergy: input.moodEnergy.tracksMissingEnergy,
      missingMoodAndEnergy: input.moodEnergy.tracksMissingBoth,
    }, moodEnergyOk, moodEnergyOk ? "OK" : "mood/energy count invariant failed"),
    invariant("BPM", {
      active: input.totalTracks,
      tracksWithBpm: input.tracksWithBpm,
      missingBpm: input.categories.missing_bpm,
    }, bpmOk, bpmOk ? "OK" : "active tracks do not equal tracks with BPM plus missing BPM"),
    invariant("Genres", {
      active: input.totalTracks,
      tracksWithGenres: input.tracksWithGenres,
      missingGenres: input.missingGenres,
    }, genresOk, genresOk ? "OK" : "active tracks do not equal tracks with genres plus missing genres"),
    invariant("Popularity", {
      active: input.totalTracks,
      tracksWithPopularity: input.tracksWithPopularity,
      missingPopularity: input.missingPopularity,
    }, popularityOk, popularityOk ? "OK" : "active tracks do not equal tracks with popularity plus missing popularity"),
    invariant("Local Files", {
      active: input.totalTracks,
      availableLocalFiles: input.availableLocalFiles,
      missingLocalFiles: input.missingLocalFiles,
    }, localFilesOk, localFilesOk ? "OK" : "active tracks do not equal available plus missing local files"),
  ];

  return {
    ok: invariants.every((entry) => entry.ok),
    providerMode: { audio: input.audioMode },
    invariants,
    mismatches: [],
  };
}

export async function getLibraryHealthDetailSummary(userId: string, libraryId?: string, settings?: EffectiveAudioFeatureSettings) {
  const active = activeUserTrackWhere(userId, libraryId);
  const totalTracks = await prisma.track.count({ where: active });
  const audioFeatureClassification = await getAudioFeatureHealthClassification(userId, { libraryId, settings });
  const entries = await Promise.all(libraryHealthDetailCategories.map(async (category) => [
    category,
    (await resolveLibraryHealthTrackIds(userId, { category, libraryId, settings, audioFeatureClassification })).count,
  ] as const));
  const categories = Object.fromEntries(entries) as Record<LibraryHealthDetailCategory, number>;
  const [tracksWithBpm, tracksWithGenres, missingGenres, tracksWithPopularity, missingPopularity, availableLocalFiles, missingLocalFiles] = await Promise.all([
    resolveLibraryHealthTrackIds(userId, { category: "tracks_with_bpm", libraryId, settings }),
    resolveLibraryHealthTrackIds(userId, { category: "tracks_with_genres", libraryId, settings }),
    resolveLibraryHealthTrackIds(userId, { category: "missing_genres", libraryId, settings }),
    resolveLibraryHealthTrackIds(userId, { category: "tracks_with_popularity", libraryId, settings }),
    resolveLibraryHealthTrackIds(userId, { category: "missing_popularity", libraryId, settings }),
    resolveLibraryHealthTrackIds(userId, { category: "available_local_files", libraryId, settings }),
    resolveLibraryHealthTrackIds(userId, { category: "missing_local_files", libraryId, settings }),
  ]);
  const moodEnergy = {
    tracksWithMood: totalTracks - categories.missing_mood,
    tracksMissingMood: categories.missing_mood,
    tracksWithEnergy: totalTracks - categories.missing_energy,
    tracksMissingEnergy: categories.missing_energy,
    tracksMissingBoth: categories.missing_mood_energy,
  };
  const audioMode = metadataProviderModeKey({
    api: settings?.api ?? settings?.enableApiAudioFeatures ?? true,
    local: settings?.local ?? settings?.enableLocalAudioFeatures ?? true,
    preferLocal: settings?.preferLocal ?? settings?.preferLocalAudioFeatures ?? false,
  } as any);
  const diagnostics = buildHealthAccuracyDiagnostics({
    totalTracks,
    categories,
    moodEnergy,
    tracksWithBpm: tracksWithBpm.count,
    tracksWithGenres: tracksWithGenres.count,
    missingGenres: missingGenres.count,
    tracksWithPopularity: tracksWithPopularity.count,
    missingPopularity: missingPopularity.count,
    availableLocalFiles: availableLocalFiles.count,
    missingLocalFiles: missingLocalFiles.count,
    audioFeatureClassification,
    audioMode,
  });
  const lastAudioFeatureRetryJob = await prisma.jobHistory.findFirst({
    where: {
      OR: [{ userId }, { userId: null }],
      type: "audio_features",
      trigger: "retry",
    },
    orderBy: { startedAt: "desc" },
  });
  const retryMetadata = lastAudioFeatureRetryJob?.metadata && typeof lastAudioFeatureRetryJob.metadata === "object" && !Array.isArray(lastAudioFeatureRetryJob.metadata)
    ? lastAudioFeatureRetryJob.metadata as Record<string, any>
    : {};
  diagnostics.lastAudioFeatureRetry = lastAudioFeatureRetryJob ? {
    filter: typeof retryMetadata.filter === "string" ? retryMetadata.filter : null,
    mode: typeof retryMetadata.retryMode === "string" ? retryMetadata.retryMode : typeof retryMetadata.mode === "string" ? retryMetadata.mode : null,
    providerMode: typeof retryMetadata.providerMode === "string" ? retryMetadata.providerMode : null,
    matched: typeof retryMetadata.matched === "number" ? retryMetadata.matched : lastAudioFeatureRetryJob.attempted,
    queued: typeof retryMetadata.queued === "number" ? retryMetadata.queued : lastAudioFeatureRetryJob.processed,
    skipped: typeof retryMetadata.skipped === "number" ? retryMetadata.skipped : lastAudioFeatureRetryJob.skipped,
    processed: typeof retryMetadata.processed === "number" ? retryMetadata.processed : lastAudioFeatureRetryJob.processed,
    failed: typeof retryMetadata.failed === "number" ? retryMetadata.failed : lastAudioFeatureRetryJob.failed,
    completedAt: lastAudioFeatureRetryJob.finishedAt,
  } : null;
  const recentAudioJobs = await prisma.jobHistory.findMany({
    where: {
      OR: [{ userId }, { userId: null }],
      type: "audio_features",
    },
    orderBy: { startedAt: "desc" },
    take: 20,
  });
  const lastLocalAnalysisJob = recentAudioJobs.find((job) => {
    const metadata = job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
      ? job.metadata as Record<string, any>
      : {};
    return job.name.toLowerCase().includes("local audio analysis")
      || metadata.analyzer === "Essentia"
      || (metadata.local && typeof metadata.local === "object");
  }) || null;
  const localMetadata = lastLocalAnalysisJob?.metadata && typeof lastLocalAnalysisJob.metadata === "object" && !Array.isArray(lastLocalAnalysisJob.metadata)
    ? lastLocalAnalysisJob.metadata as Record<string, any>
    : {};
  const localRun = localMetadata.local && typeof localMetadata.local === "object" ? localMetadata.local : localMetadata;
  const scope = typeof localRun.analysisScope === "string"
    ? localRun.analysisScope
    : typeof localRun.scope === "string"
      ? localRun.scope
      : String((settings as any)?.scope || "windows");
  diagnostics.localAnalysisDiagnostics = {
    analyzer: "Essentia",
    analyzerAvailable: null,
    localEnabled: settings?.local ?? settings?.enableLocalAudioFeatures ?? true,
    scope,
    scopeLabel: scope === "whole_track" ? "Whole track" : "Sample window",
    lastRunAt: lastLocalAnalysisJob?.finishedAt || null,
    matched: typeof localRun.matched === "number" ? localRun.matched : typeof localRun.attempted === "number" ? localRun.attempted : lastLocalAnalysisJob?.attempted ?? null,
    processed: typeof localRun.processed === "number" ? localRun.processed : lastLocalAnalysisJob?.processed ?? null,
    skipped: typeof localRun.skipped === "number" ? localRun.skipped : lastLocalAnalysisJob?.skipped ?? null,
    failed: typeof localRun.failed === "number" ? localRun.failed : lastLocalAnalysisJob?.failed ?? null,
    skipReasons: localRun.skipReasons && typeof localRun.skipReasons === "object" && !Array.isArray(localRun.skipReasons) ? localRun.skipReasons : {},
  };
  return {
    totalTracks,
    categories,
    audioFeatureGapAudit: audioFeatureClassification.audit,
    diagnostics,
  };
}

export async function getLibraryHealthAudioFeatureGapTrackIds(userId: string, options: {
  category: LibraryHealthDetailCategory;
  libraryId?: string;
  settings?: EffectiveAudioFeatureSettings;
  audioFeatureStatus?: string;
  missingDataOnly?: boolean;
}) {
  if (
    options.category !== "missing_audio_features"
    && options.category !== "partial_audio_features"
    && options.category !== "pending_audio_features"
    && options.audioFeatureStatus !== "missing"
    && !options.missingDataOnly
  ) {
    return [];
  }
  const gapClassification = await getAudioFeatureGapClassificationForScope(
    activeUserTrackWhere(userId, options.libraryId),
    options.settings,
  );
  if (options.category === "missing_audio_features" || options.audioFeatureStatus === "missing") {
    return gapClassification.missingGapTrackIds;
  }
  if (options.category === "partial_audio_features") {
    return gapClassification.partialGapTrackIds;
  }
  return gapClassification.gapTrackIds;
}
