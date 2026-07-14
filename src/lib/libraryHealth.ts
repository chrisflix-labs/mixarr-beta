import { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  getAudioFeatureHealthStatus,
  type EffectiveAudioFeatureSettings,
  getEffectiveAudioFeatures,
  partialAudioFeatureTrackWhere,
  type AudioFeatureHealthGapAudit,
} from "./audioFeatures";
import {
  audioFeatureHealthFilterWhere,
  buildAudioFeatureHealthQuery,
  getAudioFeatureHealthClassification,
  getAudioFeatureHealthClassificationForScope,
  getAudioFeatureGapTrackIds,
} from "./audioFeatureHealthClassification";
import {
  apiBpmTrackWhere,
  bpmAnalyzerFailedTrackWhere,
  bpmExtractionFailedTrackWhere,
  bpmFailedTrackWhere,
  bpmNoDataTrackWhere,
  bpmRetryEligibilityTrackWhere,
  bpmTooShortTrackWhere,
  buildBpmSourceWhereClause,
  effectiveBpmTrackWhere,
  getBpmDisplayMetadata,
  getEffectiveBpm,
  importedBpmTrackWhere,
  localBpmSourceTrackWhere,
  missingEffectiveBpmTrackWhere,
  pendingBpmBackfillTrackWhere,
  type BpmRetryProviderMode,
} from "./bpm";
import { getUserSyncSettings, metadataProviderModeKey, metadataProviderModeLabel, resolveMetadataProviderSettings } from "./syncSettings";

export const DEFAULT_CLEANUP_DAYS = 30;
export const MAX_MISSING_PAGE_SIZE = 100;
export const MAX_BPM_PAGE_SIZE = 100;
export const MAX_AUDIO_FEATURE_PAGE_SIZE = 100;
export const MAX_METADATA_PAGE_SIZE = 100;

const knownPopularityProviders = ["deezer", "lastfm", "spotify"] as const;
const unusableGenreNames = [
  "",
  "unknown",
  "none",
  "n/a",
  "na",
  "not found",
  "no data",
  "undefined",
  "null",
];

const usableGenreTagWhere = {
  type: "genre",
  name: { notIn: unusableGenreNames },
} satisfies Prisma.TagWhereInput;

export const bpmHealthFilters = [
  "tracks_with_bpm",
  "api_bpm",
  "local_bpm",
  "imported_bpm",
  "missing_bpm",
  "bpm_no_data",
  "bpm_failed",
  "low_confidence_bpm",
  "bpm_source_conflict",
  "extraction_failed",
  "analyzer_failed",
  "too_short",
  "pending_backfill",
  "pending_bpm",
] as const;
export type BpmHealthFilter = typeof bpmHealthFilters[number];

export const audioFeatureHealthFilters = [
  "missing_audio_features",
  "api_audio_features",
  "local_audio_features",
  "heuristic_audio_features",
  "partial_audio_features",
  "audio_no_data",
  "audio_failed",
  "audio_too_short",
  "audio_feature_no_data",
  "audio_feature_failed",
  "extraction_failed",
  "analyzer_failed",
  "too_short",
  "pending_audio_features",
] as const;
export type AudioFeatureHealthFilter = typeof audioFeatureHealthFilters[number];

export const genreHealthFilters = [
  "tracks_with_genres",
  "missing_genres",
  "genre_no_data",
  "genre_failed",
  "pending_genre_backfill",
] as const;
export type GenreHealthFilter = typeof genreHealthFilters[number];

export const popularityHealthFilters = [
  "tracks_with_popularity",
  "missing_popularity",
  "popularity_no_data",
  "popularity_failed",
  "pending_popularity_backfill",
] as const;
export type PopularityHealthFilter = typeof popularityHealthFilters[number];

export const metadataHealthSections = ["genres", "popularity"] as const;
export type MetadataHealthSection = typeof metadataHealthSections[number];
export type MetadataHealthFilter = GenreHealthFilter | PopularityHealthFilter;

export type LibraryHealthStatus = "healthy" | "warning" | "error";

export function determineLibraryHealthStatus(input: {
  lastSyncStatus?: string | null;
  snapshotComplete?: boolean | null;
  plexReportedTrackCount?: number | null;
  unresolvedTrackCount?: number | null;
  restoreVerificationFailureCount?: number | null;
  activeTrackCount: number;
  missingTrackCount: number;
  bpmFailureCount: number;
  lastSyncAt?: Date | string | null;
  now?: Date;
  staleAfterHours?: number;
}): LibraryHealthStatus {
  const now = input.now || new Date();
  const staleAfterHours = input.staleAfterHours || Number(process.env.LIBRARY_HEALTH_STALE_HOURS || 24);
  const lastSyncAt = input.lastSyncAt ? new Date(input.lastSyncAt) : null;
  const stale = !lastSyncAt || now.getTime() - lastSyncAt.getTime() > staleAfterHours * 3_600_000;
  const countDifference = input.plexReportedTrackCount !== null
    && input.plexReportedTrackCount !== undefined
    ? Math.abs(input.plexReportedTrackCount - input.activeTrackCount)
    : 0;
  const countMismatch = countDifference > Math.max(0, input.unresolvedTrackCount || 0);

  if (!input.lastSyncStatus || input.lastSyncStatus === "failed") return "error";
  if ((input.restoreVerificationFailureCount || 0) > 0) return "error";
  if (input.lastSyncStatus === "success" && countMismatch) return "error";
  if (input.lastSyncStatus === "success" && input.snapshotComplete !== true) return "error";
  if (input.lastSyncStatus === "in_progress" && stale) return "error";
  if (input.lastSyncStatus !== "success") return "warning";
  if (input.missingTrackCount > 0 || input.bpmFailureCount > 0 || (input.unresolvedTrackCount || 0) > 0 || stale) return "warning";
  return "healthy";
}

export type MissingTrackFilters = {
  libraryId?: string;
  artist?: string;
  album?: string;
  search?: string;
  bpmStatus?: string;
  missingSinceFrom?: Date;
  missingSinceBefore?: Date;
};

export function isBpmHealthFilter(value: unknown): value is BpmHealthFilter {
  return typeof value === "string" && (bpmHealthFilters as readonly string[]).includes(value);
}

export function isAudioFeatureHealthFilter(value: unknown): value is AudioFeatureHealthFilter {
  return typeof value === "string" && (audioFeatureHealthFilters as readonly string[]).includes(value);
}

export function isGenreHealthFilter(value: unknown): value is GenreHealthFilter {
  return typeof value === "string" && (genreHealthFilters as readonly string[]).includes(value);
}

export function isPopularityHealthFilter(value: unknown): value is PopularityHealthFilter {
  return typeof value === "string" && (popularityHealthFilters as readonly string[]).includes(value);
}

export function isMetadataHealthSection(value: unknown): value is MetadataHealthSection {
  return typeof value === "string" && (metadataHealthSections as readonly string[]).includes(value);
}

export function bpmHealthFilterWhere(filter: BpmHealthFilter): Prisma.TrackWhereInput {
  switch (filter) {
    case "tracks_with_bpm": return effectiveBpmTrackWhere();
    case "api_bpm": return buildBpmSourceWhereClause("api_bpm");
    case "local_bpm": return buildBpmSourceWhereClause("local_bpm");
    case "imported_bpm": return buildBpmSourceWhereClause("imported_bpm");
    case "missing_bpm": return missingEffectiveBpmTrackWhere();
    case "bpm_no_data": return bpmNoDataTrackWhere();
    case "bpm_failed": return bpmFailedTrackWhere();
    case "low_confidence_bpm": return effectiveBpmTrackWhere();
    case "bpm_source_conflict": return effectiveBpmTrackWhere();
    case "extraction_failed": return bpmExtractionFailedTrackWhere();
    case "analyzer_failed": return bpmAnalyzerFailedTrackWhere();
    case "too_short": return bpmTooShortTrackWhere();
    case "pending_backfill": return pendingBpmBackfillTrackWhere();
    case "pending_bpm": return pendingBpmBackfillTrackWhere();
  }
}

export function bpmHealthFilterClassification(filter: BpmHealthFilter) {
  switch (filter) {
    case "api_bpm": return "source=api_bpm";
    case "local_bpm": return "source=local_bpm";
    case "imported_bpm": return "source=imported_bpm";
    case "tracks_with_bpm": return "source=any_bpm";
    case "missing_bpm": return "source=missing_bpm";
    case "bpm_no_data": return "status=no_data";
    case "bpm_failed": return "status=failed";
    case "low_confidence_bpm": return "confidence=low";
    case "bpm_source_conflict": return "status=source_conflict";
    case "extraction_failed": return "status=extraction_failed";
    case "analyzer_failed": return "status=analyzer_failed";
    case "too_short": return "status=too_short";
    case "pending_backfill":
    case "pending_bpm":
      return "status=pending";
  }
}

export function buildBpmRetryBaseWhere(userId: string, options: {
  filter: BpmHealthFilter;
  libraryId?: string;
  trackIds?: string[];
}): Prisma.TrackWhereInput {
  const targetWhere = options.trackIds?.length
    ? { id: { in: options.trackIds } }
    : bpmHealthFilterWhere(options.filter);

  return {
    AND: [
      {
        syncStatus: "active",
        library: { ...(options.libraryId ? { id: options.libraryId } : {}), server: { userId } },
      },
      targetWhere,
    ],
  };
}

export function buildBpmRetryCandidateWhere(userId: string, options: {
  filter: BpmHealthFilter;
  libraryId?: string;
  trackIds?: string[];
  force?: boolean;
  providerMode?: BpmRetryProviderMode;
}): Prisma.TrackWhereInput {
  return {
    AND: [
      buildBpmRetryBaseWhere(userId, options),
      bpmRetryEligibilityTrackWhere({
        force: options.force,
        providerMode: options.providerMode,
        filter: options.filter,
      }),
    ],
  };
}

export { audioFeatureHealthFilterWhere, buildAudioFeatureHealthQuery, getAudioFeatureGapTrackIds };

export function tracksWithGenresWhere(): Prisma.TrackWhereInput {
  return { tags: { some: usableGenreTagWhere } };
}

export function missingGenresWhere(): Prisma.TrackWhereInput {
  return { tags: { none: usableGenreTagWhere } };
}

export function genreNoDataWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingGenresWhere(),
      {
        OR: [
          { genreStatus: "no_data" },
          { AND: [{ genreStatus: null }, { tagsSyncedAt: { not: null } }] },
        ],
      },
    ],
  };
}

export function genreFailedWhere(): Prisma.TrackWhereInput {
  return { AND: [missingGenresWhere(), { genreStatus: "failed" }] };
}

export function pendingGenreBackfillWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingGenresWhere(),
      {
        OR: [
          { genreStatus: { in: ["pending", "success"] } },
          { AND: [{ genreStatus: null }, { tagsSyncedAt: null }] },
        ],
      },
    ],
  };
}

export function tracksWithPopularityWhere(): Prisma.TrackWhereInput {
  return {
    popularity: {
      is: {
        provider: { in: [...knownPopularityProviders] },
        score: { gte: 0 },
      },
    },
  };
}

export function missingPopularityWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { popularity: null },
      { popularity: { is: { provider: { notIn: [...knownPopularityProviders] } } } },
    ],
  };
}

export function popularityNoDataWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingPopularityWhere(),
      {
        OR: [
          { popularityStatus: "no_data" },
          { popularity: { is: { provider: "not_found" } } },
        ],
      },
    ],
  };
}

export function popularityFailedWhere(): Prisma.TrackWhereInput {
  return { AND: [missingPopularityWhere(), { popularityStatus: "failed" }] };
}

export function pendingPopularityBackfillWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingPopularityWhere(),
      {
        OR: [
          { popularityStatus: { in: ["pending", "success"] } },
          { AND: [{ popularityStatus: null }, { popularity: null }] },
          {
            AND: [
              { popularityStatus: null },
              { popularity: { is: { provider: { notIn: ["not_found", ...knownPopularityProviders] } } } },
            ],
          },
        ],
      },
    ],
  };
}

export function genreHealthFilterWhere(filter: GenreHealthFilter): Prisma.TrackWhereInput {
  switch (filter) {
    case "tracks_with_genres": return tracksWithGenresWhere();
    case "missing_genres": return missingGenresWhere();
    case "genre_no_data": return genreNoDataWhere();
    case "genre_failed": return genreFailedWhere();
    case "pending_genre_backfill": return pendingGenreBackfillWhere();
  }
}

export function popularityHealthFilterWhere(filter: PopularityHealthFilter): Prisma.TrackWhereInput {
  switch (filter) {
    case "tracks_with_popularity": return tracksWithPopularityWhere();
    case "missing_popularity": return missingPopularityWhere();
    case "popularity_no_data": return popularityNoDataWhere();
    case "popularity_failed": return popularityFailedWhere();
    case "pending_popularity_backfill": return pendingPopularityBackfillWhere();
  }
}

export function metadataHealthFilterWhere(section: MetadataHealthSection, filter: MetadataHealthFilter): Prisma.TrackWhereInput {
  if (section === "genres" && isGenreHealthFilter(filter)) return genreHealthFilterWhere(filter);
  if (section === "popularity" && isPopularityHealthFilter(filter)) return popularityHealthFilterWhere(filter);
  return { id: "__invalid__" };
}

export function buildBpmTrackWhere(userId: string, options: {
  filter: BpmHealthFilter;
  libraryId?: string;
  search?: string;
}): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [
    {
      syncStatus: "active",
      library: {
        ...(options.libraryId ? { id: options.libraryId } : {}),
        server: { userId },
      },
    },
    bpmHealthFilterWhere(options.filter),
  ];

  if (options.search) {
    and.push({ OR: [
      { title: { contains: options.search, mode: "insensitive" } },
      { artist: { title: { contains: options.search, mode: "insensitive" } } },
      { album: { title: { contains: options.search, mode: "insensitive" } } },
      { mediaPath: { contains: options.search, mode: "insensitive" } },
    ] });
  }
  return { AND: and };
}

export function buildAudioFeatureTrackWhere(userId: string, options: {
  filter: AudioFeatureHealthFilter;
  libraryId?: string;
  search?: string;
  settings?: EffectiveAudioFeatureSettings;
}): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [
    {
      syncStatus: "active",
      library: {
        ...(options.libraryId ? { id: options.libraryId } : {}),
        server: { userId },
      },
    },
    audioFeatureHealthFilterWhere(options.filter, options.settings),
  ];

  if (options.search) {
    and.push({ OR: [
      { title: { contains: options.search, mode: "insensitive" } },
      { artist: { title: { contains: options.search, mode: "insensitive" } } },
      { album: { title: { contains: options.search, mode: "insensitive" } } },
      { mediaPath: { contains: options.search, mode: "insensitive" } },
    ] });
  }
  return { AND: and };
}

export function buildMetadataTrackWhere(userId: string, options: {
  section: MetadataHealthSection;
  filter: MetadataHealthFilter;
  libraryId?: string;
  search?: string;
}): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [
    {
      syncStatus: "active",
      library: {
        ...(options.libraryId ? { id: options.libraryId } : {}),
        server: { userId },
      },
    },
    metadataHealthFilterWhere(options.section, options.filter),
  ];

  if (options.search) {
    and.push({ OR: [
      { title: { contains: options.search, mode: "insensitive" } },
      { artist: { title: { contains: options.search, mode: "insensitive" } } },
      { album: { title: { contains: options.search, mode: "insensitive" } } },
      { mediaPath: { contains: options.search, mode: "insensitive" } },
      { ratingKey: { contains: options.search, mode: "insensitive" } },
    ] });
  }
  return { AND: and };
}

async function countBpmDisplayMetadata(active: Prisma.TrackWhereInput) {
  const tracks = await prisma.track.findMany({
    where: { AND: [active, effectiveBpmTrackWhere()] },
    select: bpmHealthTrackSelect,
  });
  return tracks.reduce((counts, track) => {
    const metadata = getBpmDisplayMetadata(track);
    if (metadata.confidence === "Low") counts.lowConfidenceBpm += 1;
    if (metadata.hasConflict) counts.bpmSourceConflicts += 1;
    return counts;
  }, { lowConfidenceBpm: 0, bpmSourceConflicts: 0 });
}

export async function getBpmHealthSummary(userId: string, libraryId?: string) {
  const active: Prisma.TrackWhereInput = {
    syncStatus: "active",
    library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
  };
  const [tracksWithBpm, apiBpm, localBpm, importedBpm, missingBpm, bpmNoData, bpmFailed, extractionFailed, analyzerFailed, tooShort, pendingBackfill, displayCounts] = await Promise.all([
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("tracks_with_bpm")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("api_bpm")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("local_bpm")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("imported_bpm")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("missing_bpm")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("bpm_no_data")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("bpm_failed")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("extraction_failed")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("analyzer_failed")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("too_short")] } }),
    prisma.track.count({ where: { AND: [active, bpmHealthFilterWhere("pending_bpm")] } }),
    countBpmDisplayMetadata(active),
  ]);
  return { tracksWithBpm, apiBpm, localBpm, importedBpm, missingBpm, bpmNoData, bpmFailed, extractionFailed, analyzerFailed, tooShort, pendingBackfill, ...displayCounts };
}

export async function getGenreHealthSummary(userId: string, libraryId?: string) {
  const active: Prisma.TrackWhereInput = {
    syncStatus: "active",
    library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
  };
  const [tracksWithGenres, missingGenres, genreNoData, genreFailed, pendingGenreBackfill] = await Promise.all([
    prisma.track.count({ where: { AND: [active, tracksWithGenresWhere()] } }),
    prisma.track.count({ where: { AND: [active, missingGenresWhere()] } }),
    prisma.track.count({ where: { AND: [active, genreNoDataWhere()] } }),
    prisma.track.count({ where: { AND: [active, genreFailedWhere()] } }),
    prisma.track.count({ where: { AND: [active, pendingGenreBackfillWhere()] } }),
  ]);
  return { tracksWithGenres, missingGenres, genreNoData, genreFailed, pendingGenreBackfill };
}

export async function getPopularityHealthSummary(userId: string, libraryId?: string) {
  const active: Prisma.TrackWhereInput = {
    syncStatus: "active",
    library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
  };
  const [tracksWithPopularity, missingPopularity, popularityNoData, popularityFailed, pendingPopularityBackfill] = await Promise.all([
    prisma.track.count({ where: { AND: [active, tracksWithPopularityWhere()] } }),
    prisma.track.count({ where: { AND: [active, missingPopularityWhere()] } }),
    prisma.track.count({ where: { AND: [active, popularityNoDataWhere()] } }),
    prisma.track.count({ where: { AND: [active, popularityFailedWhere()] } }),
    prisma.track.count({ where: { AND: [active, pendingPopularityBackfillWhere()] } }),
  ]);
  return { tracksWithPopularity, missingPopularity, popularityNoData, popularityFailed, pendingPopularityBackfill };
}

export async function getMetadataHealthSummary(userId: string, section: MetadataHealthSection, libraryId?: string) {
  return section === "genres"
    ? getGenreHealthSummary(userId, libraryId)
    : getPopularityHealthSummary(userId, libraryId);
}

export async function getAudioFeatureHealthSummary(userId: string, libraryId?: string, settings?: EffectiveAudioFeatureSettings) {
  const classification = await getAudioFeatureHealthClassification(userId, { libraryId, settings });
  const mode = metadataProviderModeKey({
    api: settings?.api ?? settings?.enableApiAudioFeatures ?? true,
    local: settings?.local ?? settings?.enableLocalAudioFeatures ?? true,
    preferLocal: settings?.preferLocal ?? settings?.preferLocalAudioFeatures ?? false,
  } as any);
  console.log(`[LibraryHealth] audio gap audit active=${classification.audit.activeTracks} complete=${classification.audit.completeAudioFeatures} expectedIncomplete=${classification.audit.incompleteExpected} classifiedIncomplete=${classification.audit.classifiedIncomplete} unclassifiedGap=${classification.audit.unclassifiedGap} mode=${mode}`);
  if (classification.gapOnly > 0) {
    console.log(`[LibraryHealth] audio gap split count=${classification.gapOnly} partial=${classification.partialGapTrackIds.length} missing=${classification.missingGapTrackIds.length}`);
  }
  console.log(`[LibraryHealth] audio feature counts active=${classification.activeTracks} complete=${classification.complete} incomplete=${Math.max(0, classification.activeTracks - classification.complete)} partial=${classification.partial} missing=${classification.missing} pending=${classification.pending} noData=${classification.noData} failed=${classification.failed} tooShort=${classification.tooShort} gap=${classification.gapOnly} mode=${mode}`);
  return classification;
}

export function buildMissingTrackWhere(userId: string, filters: MissingTrackFilters = {}): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [{
    syncStatus: "missing",
    library: {
      ...(filters.libraryId ? { id: filters.libraryId } : {}),
      server: { userId },
    },
  }];

  if (filters.artist) and.push({ artist: { title: { contains: filters.artist, mode: "insensitive" } } });
  if (filters.album) and.push({ album: { title: { contains: filters.album, mode: "insensitive" } } });
  if (filters.search) {
    and.push({ OR: [
      { title: { contains: filters.search, mode: "insensitive" } },
      { mediaPath: { contains: filters.search, mode: "insensitive" } },
      { ratingKey: { contains: filters.search, mode: "insensitive" } },
    ] });
  }
  if (filters.missingSinceFrom || filters.missingSinceBefore) {
    and.push({ missingSince: {
      ...(filters.missingSinceFrom ? { gte: filters.missingSinceFrom } : {}),
      ...(filters.missingSinceBefore ? { lte: filters.missingSinceBefore } : {}),
    } });
  }

  if (filters.bpmStatus === "with_bpm") and.push(effectiveBpmTrackWhere());
  if (filters.bpmStatus === "no_data") and.push(bpmNoDataTrackWhere());
  if (filters.bpmStatus === "failed") and.push(bpmFailedTrackWhere());
  if (filters.bpmStatus === "extraction_failed") and.push(bpmExtractionFailedTrackWhere());
  if (filters.bpmStatus === "analyzer_failed") and.push(bpmAnalyzerFailedTrackWhere());
  if (filters.bpmStatus === "too_short") and.push(bpmTooShortTrackWhere());
  if (filters.bpmStatus === "pending") and.push(pendingBpmBackfillTrackWhere());

  return { AND: and };
}

export function missingTrackBpmStatus(track: any) {
  if (getEffectiveBpm(track) !== null) return "with_bpm";
  const marker = track.bpmAnalysisStatus || track.audioFeature?.tempoSource;
  if (marker === "no_data" || marker === "local_not_found") return "no_data";
  if (marker === "extraction_failed" || marker === "local_extraction_failed") return "extraction_failed";
  if (marker === "analyzer_failed" || marker === "local_analyzer_failed") return "analyzer_failed";
  if (marker === "too_short" || marker === "local_too_short") return "too_short";
  if (marker === "failed" || marker === "local_failed") return "failed";
  return "pending";
}

type CountRow = Record<string, bigint | number | null>;

type LibraryForHealth = {
  id: string;
  name: string;
  plexId: string;
  server: { id: string; name: string };
  syncLogs: Array<{
    id: string;
    status: string;
    startedAt: Date;
    endedAt: Date | null;
    snapshotComplete: boolean;
    error: string | null;
    unresolvedTrackCount: number;
    restoreVerificationFailureCount: number;
  }>;
};

type LibraryHealthSnapshotPayload = {
  id: string;
  name: string;
  plexLibraryId: string;
  server: { id: string; name: string };
  status: LibraryHealthStatus;
  activeTracks: number;
  missingTracks: number;
  missingAlbums: number;
  missingArtists: number;
  tracksWithBpm: number;
  bpmApi: number;
  bpmLocal: number;
  bpmImported: number;
  missingBpm: number;
  bpmNoData: number;
  bpmFailed: number;
  bpmExtractionFailed: number;
  bpmAnalyzerFailed: number;
  bpmTooShort: number;
  bpmPendingBackfill: number;
  bpmLowConfidence: number;
  bpmSourceConflicts: number;
  audioFeaturesComplete: number;
  audioFeaturesMissing: number;
  audioFeaturesApi: number;
  audioFeaturesLocal: number;
  audioFeaturesHeuristic: number;
  audioFeaturesPartial: number;
  audioFeaturesPending: number;
  audioFeaturesNoData: number;
  audioFeaturesFailed: number;
  audioFeaturesExtractionFailed: number;
  audioFeaturesAnalyzerFailed: number;
  audioFeaturesTooShort: number;
  audioFeaturesNoRecord: number;
  audioFeaturesGap: number;
  audioFeatureGapAudit: AudioFeatureHealthGapAudit;
  bpmProviderMode: string;
  audioFeatureProviderMode: string;
  tracksWithGenres: number;
  missingGenres: number;
  genreNoData: number;
  genreFailed: number;
  pendingGenreBackfill: number;
  tracksWithPopularity: number;
  missingPopularity: number;
  popularityNoData: number;
  popularityFailed: number;
  pendingPopularityBackfill: number;
  healthAccuracyDiagnostics?: {
    ok: boolean;
    invariants: Array<{
      section: string;
      ok: boolean;
      message: string;
      counts: Record<string, number>;
    }>;
  };
  lastFullSyncAt: Date | string | null;
  lastReconciliationAt: Date | string | null;
  lastSyncStatus: string;
  lastSyncRunId: string | null;
  lastSyncError: string | null;
  plexReportedTrackCount: number | null;
  mixarrActiveTrackCount: number;
  difference: number | null;
  unresolvedTrackCount: number;
  restoreVerificationFailureCount: number;
};

function snapshotInvariant(section: string, counts: Record<string, number>, ok: boolean, message: string) {
  if (!ok) {
    console.warn(`[LibraryHealth][Invariant] ${section.toLowerCase()} ${message} ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(" ")}`);
  }
  return { section, ok, message, counts };
}

function buildSnapshotDiagnostics(input: {
  activeTracks: number;
  bpm: Awaited<ReturnType<typeof getBpmHealthCounts>>;
  audioFeatures: Awaited<ReturnType<typeof getAudioFeatureHealthCounts>>;
  genres: Awaited<ReturnType<typeof getGenreHealthCounts>>;
  popularity: Awaited<ReturnType<typeof getPopularityHealthCounts>>;
}) {
  const expectedAudioIncomplete = Math.max(0, input.activeTracks - input.audioFeatures.complete);
  const audioClassifiedIncomplete = input.audioFeatures.audit.classifiedIncomplete;
  const invariants = [
    snapshotInvariant("Audio Features", {
      active: input.activeTracks,
      complete: input.audioFeatures.complete,
      expectedIncomplete: expectedAudioIncomplete,
      classifiedIncomplete: audioClassifiedIncomplete,
      unclassified: input.audioFeatures.audit.unclassifiedGap,
    }, expectedAudioIncomplete === audioClassifiedIncomplete, expectedAudioIncomplete === audioClassifiedIncomplete ? "OK" : "incomplete mismatch"),
    snapshotInvariant("BPM", {
      active: input.activeTracks,
      tracksWithBpm: input.bpm.tracksWithBpm,
      missingBpm: input.bpm.missingBpm,
    }, input.activeTracks === input.bpm.tracksWithBpm + input.bpm.missingBpm, "active tracks = tracksWithBpm + missingBpm"),
    snapshotInvariant("Genres", {
      active: input.activeTracks,
      tracksWithGenres: input.genres.tracksWithGenres,
      missingGenres: input.genres.missingGenres,
    }, input.activeTracks === input.genres.tracksWithGenres + input.genres.missingGenres, "active tracks = tracksWithGenres + missingGenres"),
    snapshotInvariant("Popularity", {
      active: input.activeTracks,
      tracksWithPopularity: input.popularity.tracksWithPopularity,
      missingPopularity: input.popularity.missingPopularity,
    }, input.activeTracks === input.popularity.tracksWithPopularity + input.popularity.missingPopularity, "active tracks = tracksWithPopularity + missingPopularity"),
  ];
  return { ok: invariants.every((entry) => entry.ok), invariants };
}

function countValue(row: CountRow | undefined, key: string) {
  return Number(row?.[key] ?? 0);
}

async function timedHealthGroup<T>(library: LibraryForHealth, group: string, task: () => Promise<T>) {
  const started = Date.now();
  const result = await task();
  const durationMs = Date.now() - started;
  if (durationMs > 1_000) {
    console.log(`[LibraryHealth] slow group library=${library.id} name=${JSON.stringify(library.name)} group=${group} durationMs=${durationMs}`);
  }
  return result;
}

function jsonSnapshotPayload(payload: LibraryHealthSnapshotPayload): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(payload));
}

async function getBaseHealthCounts(libraryId: string) {
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT
      (SELECT COUNT(*) FROM "Track" WHERE "libraryId" = ${libraryId} AND "syncStatus" = 'active') AS active_tracks,
      (SELECT COUNT(*) FROM "Track" WHERE "libraryId" = ${libraryId} AND "syncStatus" = 'missing') AS missing_tracks,
      (SELECT COUNT(*) FROM "Album" WHERE "libraryId" = ${libraryId} AND "syncStatus" = 'missing') AS missing_albums,
      (SELECT COUNT(*) FROM "Artist" WHERE "libraryId" = ${libraryId} AND "syncStatus" = 'missing') AS missing_artists
  `;
  const row = rows[0];
  return {
    activeTracks: countValue(row, "active_tracks"),
    missingTracks: countValue(row, "missing_tracks"),
    missingAlbums: countValue(row, "missing_albums"),
    missingArtists: countValue(row, "missing_artists"),
  };
}

async function getBpmHealthCounts(libraryId: string) {
  const rows = await prisma.$queryRaw<CountRow[]>`
    WITH active_tracks AS (
      SELECT
        t."bpm",
        t."apiBpm",
        t."localBpm",
        t."effectiveBpm",
        t."bpmSource",
        t."bpmConfidence",
        t."bpmAnalysisStatus",
        af."tempo" AS af_tempo,
        af."tempoSource" AS af_tempo_source,
        af."tempoConfidence" AS af_tempo_confidence
      FROM "Track" t
      LEFT JOIN "AudioFeature" af ON af."trackId" = t."id"
      WHERE t."libraryId" = ${libraryId}
        AND t."syncStatus" = 'active'
    ),
    classified AS (
      SELECT
        *,
        COALESCE((
          COALESCE("bpm", 0) > 0
          OR COALESCE("effectiveBpm", 0) > 0
          OR COALESCE("apiBpm", 0) > 0
          OR COALESCE("localBpm", 0) > 0
          OR (COALESCE("bpm", 0) <= 0 AND COALESCE(af_tempo, 0) > 0)
        ), false) AS has_effective_bpm,
        COALESCE((
          COALESCE("localBpm", 0) > 0
          OR "bpmSource" IN ('local_essentia', 'essentia', 'aubio')
          OR ("bpmAnalysisStatus" = 'success' AND "bpmSource" IN ('local_essentia', 'essentia', 'aubio'))
          OR (COALESCE(af_tempo, 0) > 0 AND (af_tempo_source LIKE 'Essentia%' OR af_tempo_source LIKE 'Aubio%'))
        ), false) AS has_local_bpm,
        COALESCE((
          COALESCE("apiBpm", 0) > 0
          OR "bpmSource" IN ('api', 'deezer')
        ), false) AS has_api_bpm_marker,
        COALESCE(NOT (
          COALESCE("bpm", 0) > 0
          OR COALESCE("effectiveBpm", 0) > 0
          OR COALESCE("apiBpm", 0) > 0
          OR COALESCE("localBpm", 0) > 0
          OR (COALESCE("bpm", 0) <= 0 AND COALESCE(af_tempo, 0) > 0)
        ), false) AS missing_effective_bpm,
        COALESCE(("bpmAnalysisStatus" = 'no_data' OR af_tempo_source = 'local_not_found'), false) AS no_data_marker,
        COALESCE(("bpmAnalysisStatus" = 'failed' OR af_tempo_source = 'local_failed'), false) AS failed_marker,
        COALESCE(("bpmAnalysisStatus" = 'extraction_failed' OR af_tempo_source = 'local_extraction_failed'), false) AS extraction_failed_marker,
        COALESCE(("bpmAnalysisStatus" = 'analyzer_failed' OR af_tempo_source = 'local_analyzer_failed'), false) AS analyzer_failed_marker,
        COALESCE(("bpmAnalysisStatus" = 'too_short' OR af_tempo_source = 'local_too_short'), false) AS too_short_marker
      FROM active_tracks
    )
    SELECT
      COUNT(*) FILTER (WHERE has_effective_bpm) AS tracks_with_bpm,
      COUNT(*) FILTER (WHERE has_effective_bpm AND has_local_bpm) AS bpm_local,
      COUNT(*) FILTER (WHERE has_effective_bpm AND NOT has_local_bpm AND has_api_bpm_marker) AS bpm_api,
      COUNT(*) FILTER (WHERE has_effective_bpm AND NOT has_local_bpm AND NOT has_api_bpm_marker) AS bpm_imported,
      COUNT(*) FILTER (WHERE missing_effective_bpm) AS missing_bpm,
      COUNT(*) FILTER (WHERE missing_effective_bpm AND no_data_marker) AS bpm_no_data,
      COUNT(*) FILTER (WHERE missing_effective_bpm AND (failed_marker OR extraction_failed_marker OR analyzer_failed_marker)) AS bpm_failed,
      COUNT(*) FILTER (WHERE missing_effective_bpm AND extraction_failed_marker) AS bpm_extraction_failed,
      COUNT(*) FILTER (WHERE missing_effective_bpm AND analyzer_failed_marker) AS bpm_analyzer_failed,
      COUNT(*) FILTER (WHERE missing_effective_bpm AND too_short_marker) AS bpm_too_short,
      COUNT(*) FILTER (
        WHERE has_effective_bpm
          AND (
            COALESCE("bpmConfidence", af_tempo_confidence) < 0.5
            OR "bpmSource" ILIKE '%estimated%'
            OR "bpmSource" ILIKE '%heuristic%'
            OR (
              COALESCE("localBpm", 0) > 0
              AND COALESCE("apiBpm", 0) > 0
              AND ABS("localBpm" - "apiBpm") > 10
            )
          )
      ) AS bpm_low_confidence,
      COUNT(*) FILTER (
        WHERE has_effective_bpm
          AND COALESCE("localBpm", 0) > 0
          AND COALESCE("apiBpm", 0) > 0
          AND ABS("localBpm" - "apiBpm") > 10
      ) AS bpm_source_conflicts,
      COUNT(*) FILTER (
        WHERE missing_effective_bpm
          AND ("bpmAnalysisStatus" IS NULL OR "bpmAnalysisStatus" NOT IN ('success', 'no_data', 'failed', 'extraction_failed', 'analyzer_failed', 'too_short'))
          AND NOT no_data_marker
          AND NOT failed_marker
          AND NOT extraction_failed_marker
          AND NOT analyzer_failed_marker
          AND NOT too_short_marker
      ) AS bpm_pending_backfill
    FROM classified
  `;
  const row = rows[0];
  return {
    tracksWithBpm: countValue(row, "tracks_with_bpm"),
    bpmApi: countValue(row, "bpm_api"),
    bpmLocal: countValue(row, "bpm_local"),
    bpmImported: countValue(row, "bpm_imported"),
    missingBpm: countValue(row, "missing_bpm"),
    bpmNoData: countValue(row, "bpm_no_data"),
    bpmFailed: countValue(row, "bpm_failed"),
    bpmExtractionFailed: countValue(row, "bpm_extraction_failed"),
    bpmAnalyzerFailed: countValue(row, "bpm_analyzer_failed"),
    bpmTooShort: countValue(row, "bpm_too_short"),
    bpmLowConfidence: countValue(row, "bpm_low_confidence"),
    bpmSourceConflicts: countValue(row, "bpm_source_conflicts"),
    bpmPendingBackfill: countValue(row, "bpm_pending_backfill"),
  };
}

async function getAudioFeatureHealthCounts(libraryId: string, settings?: EffectiveAudioFeatureSettings) {
  return getAudioFeatureHealthClassificationForScope({ syncStatus: "active", libraryId }, settings);
}

async function getGenreHealthCounts(libraryId: string) {
  const rows = await prisma.$queryRaw<CountRow[]>`
    WITH active_tracks AS (
      SELECT
        t."id",
        t."genreStatus",
        t."tagsSyncedAt",
        EXISTS (
          SELECT 1
          FROM "_TrackTags" tt
          JOIN "Tag" tag ON tag."id" = tt."A"
          WHERE tt."B" = t."id"
            AND tag."type" = 'genre'
            AND tag."name" NOT IN (${Prisma.join([...unusableGenreNames])})
        ) AS has_genre
      FROM "Track" t
      WHERE t."libraryId" = ${libraryId}
        AND t."syncStatus" = 'active'
    )
    SELECT
      COUNT(*) FILTER (WHERE has_genre) AS tracks_with_genres,
      COUNT(*) FILTER (WHERE NOT has_genre) AS missing_genres,
      COUNT(*) FILTER (
        WHERE NOT has_genre
          AND ("genreStatus" = 'no_data' OR ("genreStatus" IS NULL AND "tagsSyncedAt" IS NOT NULL))
      ) AS genre_no_data,
      COUNT(*) FILTER (WHERE NOT has_genre AND "genreStatus" = 'failed') AS genre_failed,
      COUNT(*) FILTER (
        WHERE NOT has_genre
          AND (
            "genreStatus" IN ('pending', 'success')
            OR ("genreStatus" IS NULL AND "tagsSyncedAt" IS NULL)
          )
      ) AS pending_genre_backfill
    FROM active_tracks
  `;
  const row = rows[0];
  return {
    tracksWithGenres: countValue(row, "tracks_with_genres"),
    missingGenres: countValue(row, "missing_genres"),
    genreNoData: countValue(row, "genre_no_data"),
    genreFailed: countValue(row, "genre_failed"),
    pendingGenreBackfill: countValue(row, "pending_genre_backfill"),
  };
}

async function getPopularityHealthCounts(libraryId: string) {
  const rows = await prisma.$queryRaw<CountRow[]>`
    WITH active_tracks AS (
      SELECT
        t."id",
        t."popularityStatus",
        p."id" AS popularity_id,
        p."provider",
        p."score",
        COALESCE((
          p."id" IS NOT NULL
          AND p."provider" IN (${Prisma.join([...knownPopularityProviders])})
          AND p."score" >= 0
        ), false) AS has_popularity
      FROM "Track" t
      LEFT JOIN "Popularity" p ON p."trackId" = t."id"
      WHERE t."libraryId" = ${libraryId}
        AND t."syncStatus" = 'active'
    ),
    classified AS (
      SELECT
        *,
        NOT has_popularity AS missing_popularity
      FROM active_tracks
    )
    SELECT
      COUNT(*) FILTER (WHERE has_popularity) AS tracks_with_popularity,
      COUNT(*) FILTER (WHERE missing_popularity) AS missing_popularity,
      COUNT(*) FILTER (
        WHERE missing_popularity
          AND ("popularityStatus" = 'no_data' OR "provider" = 'not_found')
      ) AS popularity_no_data,
      COUNT(*) FILTER (WHERE missing_popularity AND "popularityStatus" = 'failed') AS popularity_failed,
      COUNT(*) FILTER (
        WHERE missing_popularity
          AND (
            "popularityStatus" IN ('pending', 'success')
            OR ("popularityStatus" IS NULL AND popularity_id IS NULL)
            OR (
              "popularityStatus" IS NULL
              AND "provider" IS NOT NULL
              AND "provider" NOT IN (${Prisma.join(["not_found", ...knownPopularityProviders])})
            )
          )
      ) AS pending_popularity_backfill
    FROM classified
  `;
  const row = rows[0];
  return {
    tracksWithPopularity: countValue(row, "tracks_with_popularity"),
    missingPopularity: countValue(row, "missing_popularity"),
    popularityNoData: countValue(row, "popularity_no_data"),
    popularityFailed: countValue(row, "popularity_failed"),
    pendingPopularityBackfill: countValue(row, "pending_popularity_backfill"),
  };
}

async function calculateLibraryHealthSnapshot(library: LibraryForHealth, modes: {
  bpmProviderMode: string;
  bpmProviderModeKey: string;
  audioFeatureProviderMode: string;
  audioFeatureSettings: EffectiveAudioFeatureSettings;
}): Promise<LibraryHealthSnapshotPayload> {
  const started = Date.now();
  const base = await timedHealthGroup(library, "base", () => getBaseHealthCounts(library.id));
  const bpm = await timedHealthGroup(library, "bpm", () => getBpmHealthCounts(library.id));
  const audioFeatures = await timedHealthGroup(library, "audio_features", () => getAudioFeatureHealthCounts(library.id, modes.audioFeatureSettings));
  const genres = await timedHealthGroup(library, "genres", () => getGenreHealthCounts(library.id));
  const popularity = await timedHealthGroup(library, "popularity", () => getPopularityHealthCounts(library.id));
  const lastReconciliation = await timedHealthGroup(library, "reconciliation", () => prisma.syncLog.findFirst({
    where: { libraryId: library.id, status: { in: ["success", "warning"] }, snapshotComplete: true, reconciliationAt: { not: null } },
    orderBy: { reconciliationAt: "desc" },
  }));
  const latest = library.syncLogs[0] || null;
  const plexReportedTrackCount = lastReconciliation?.plexReportedTrackCount ?? null;
  const difference = plexReportedTrackCount === null ? null : base.activeTracks - plexReportedTrackCount;
  const status = determineLibraryHealthStatus({
    lastSyncStatus: latest?.status,
    snapshotComplete: latest?.snapshotComplete,
    plexReportedTrackCount,
    unresolvedTrackCount: lastReconciliation?.unresolvedTrackCount || 0,
    restoreVerificationFailureCount: lastReconciliation?.restoreVerificationFailureCount || 0,
    activeTrackCount: base.activeTracks,
    missingTrackCount: base.missingTracks,
    bpmFailureCount: bpm.bpmFailed,
    lastSyncAt: latest?.endedAt || latest?.startedAt,
  });
  const healthAccuracyDiagnostics = buildSnapshotDiagnostics({
    activeTracks: base.activeTracks,
    bpm,
    audioFeatures,
    genres,
    popularity,
  });
  const result = {
    id: library.id,
    name: library.name,
    plexLibraryId: library.plexId,
    server: library.server,
    status,
    activeTracks: base.activeTracks,
    missingTracks: base.missingTracks,
    missingAlbums: base.missingAlbums,
    missingArtists: base.missingArtists,
    tracksWithBpm: bpm.tracksWithBpm,
    bpmApi: bpm.bpmApi,
    bpmLocal: bpm.bpmLocal,
    bpmImported: bpm.bpmImported,
    missingBpm: bpm.missingBpm,
    bpmNoData: bpm.bpmNoData,
    bpmFailed: bpm.bpmFailed,
    bpmExtractionFailed: bpm.bpmExtractionFailed,
    bpmAnalyzerFailed: bpm.bpmAnalyzerFailed,
    bpmTooShort: bpm.bpmTooShort,
    bpmPendingBackfill: bpm.bpmPendingBackfill,
    bpmLowConfidence: bpm.bpmLowConfidence,
    bpmSourceConflicts: bpm.bpmSourceConflicts,
    audioFeaturesComplete: audioFeatures.complete,
    audioFeaturesMissing: audioFeatures.missing,
    audioFeaturesApi: audioFeatures.api,
    audioFeaturesLocal: audioFeatures.local,
    audioFeaturesHeuristic: audioFeatures.heuristic,
    audioFeaturesPartial: audioFeatures.partial,
    audioFeaturesPending: audioFeatures.pending,
    audioFeaturesNoData: audioFeatures.noData,
    audioFeaturesFailed: audioFeatures.failed,
    audioFeaturesExtractionFailed: audioFeatures.extractionFailed,
    audioFeaturesAnalyzerFailed: audioFeatures.analyzerFailed,
    audioFeaturesTooShort: audioFeatures.tooShort,
    audioFeaturesNoRecord: audioFeatures.noAudioFeatureRecord,
    audioFeaturesGap: audioFeatures.gapOnly,
    audioFeatureGapAudit: audioFeatures.audit,
    bpmProviderMode: modes.bpmProviderMode,
    audioFeatureProviderMode: modes.audioFeatureProviderMode,
    tracksWithGenres: genres.tracksWithGenres,
    missingGenres: genres.missingGenres,
    genreNoData: genres.genreNoData,
    genreFailed: genres.genreFailed,
    pendingGenreBackfill: genres.pendingGenreBackfill,
    tracksWithPopularity: popularity.tracksWithPopularity,
    missingPopularity: popularity.missingPopularity,
    popularityNoData: popularity.popularityNoData,
    popularityFailed: popularity.popularityFailed,
    pendingPopularityBackfill: popularity.pendingPopularityBackfill,
    healthAccuracyDiagnostics,
    lastFullSyncAt: latest?.endedAt || latest?.startedAt || null,
    lastReconciliationAt: lastReconciliation?.reconciliationAt || null,
    lastSyncStatus: latest?.status || "never",
    lastSyncRunId: latest?.id || null,
    lastSyncError: latest?.error || null,
    plexReportedTrackCount,
    mixarrActiveTrackCount: base.activeTracks,
    difference,
    unresolvedTrackCount: lastReconciliation?.unresolvedTrackCount || 0,
    restoreVerificationFailureCount: lastReconciliation?.restoreVerificationFailureCount || 0,
  };
  const durationMs = Date.now() - started;
  console.log(`[LibraryHealth] calculated library=${library.id} name=${JSON.stringify(library.name)} activeTracks=${base.activeTracks} durationMs=${durationMs} source=fresh`);
  const mode = metadataProviderModeKey(modes.audioFeatureSettings as any);
  console.log(`[LibraryHealth] mode audio=${mode} bpm=${modes.bpmProviderModeKey}`);
  console.log(`[LibraryHealth] audio gap audit active=${audioFeatures.audit.activeTracks} complete=${audioFeatures.audit.completeAudioFeatures} expectedIncomplete=${audioFeatures.audit.incompleteExpected} classifiedIncomplete=${audioFeatures.audit.classifiedIncomplete} unclassifiedGap=${audioFeatures.audit.unclassifiedGap} mode=${mode}`);
  if (audioFeatures.gapOnly > 0) {
    console.log(`[LibraryHealth] audio gap split count=${audioFeatures.gapOnly} partial=${audioFeatures.partialGapTrackIds.length} missing=${audioFeatures.missingGapTrackIds.length}`);
  }
  console.log(`[LibraryHealth] audio feature counts active=${audioFeatures.activeTracks} complete=${audioFeatures.complete} incomplete=${Math.max(0, audioFeatures.activeTracks - audioFeatures.complete)} partial=${audioFeatures.partial} missing=${audioFeatures.missing} pending=${audioFeatures.pending} noData=${audioFeatures.noData} failed=${audioFeatures.failed} tooShort=${audioFeatures.tooShort} gap=${audioFeatures.gapOnly} mode=${mode}`);
  return result;
}

async function saveLibraryHealthSnapshot(libraryId: string, payload: LibraryHealthSnapshotPayload) {
  await prisma.libraryHealthSnapshot.upsert({
    where: { libraryId },
    create: { libraryId, payload: jsonSnapshotPayload(payload) },
    update: { payload: jsonSnapshotPayload(payload) },
  });
}

function parseLibraryHealthSnapshot(payload: Prisma.JsonValue): LibraryHealthSnapshotPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const entry = payload as any;
  if (typeof entry.id !== "string" || typeof entry.name !== "string") return null;
  return entry as LibraryHealthSnapshotPayload;
}

export async function getCachedLibraryHealth(userId: string) {
  const started = Date.now();
  const metadataSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId));
  const libraries = await prisma.library.findMany({
    where: { type: "artist", server: { userId } },
    select: {
      id: true,
      name: true,
      plexId: true,
      server: { select: { id: true, name: true } },
      syncLogs: { orderBy: { startedAt: "desc" }, take: 1 },
      healthSnapshot: { select: { payload: true, updatedAt: true } },
    },
    orderBy: [{ server: { name: "asc" } }, { name: "asc" }],
  });
  const snapshots: Array<LibraryHealthSnapshotPayload & { healthUpdatedAt: Date }> = [];
  for (const library of libraries) {
    const payload = library.healthSnapshot ? parseLibraryHealthSnapshot(library.healthSnapshot.payload) : null;
    if (!payload) continue;
    snapshots.push(await refreshStaleAudioFeatureSnapshot(userId, library, payload, library.healthSnapshot!.updatedAt, metadataSettings.audioFeatures));
  }
  console.log(`[LibraryHealth] homepage cache read libraries=${libraries.length} snapshots=${snapshots.length} durationMs=${Date.now() - started} source=cache`);
  return snapshots;
}

async function refreshStaleAudioFeatureSnapshot(
  userId: string,
  library: LibraryForHealth,
  cached: LibraryHealthSnapshotPayload,
  cachedUpdatedAt: Date,
  audioFeatureSettings: EffectiveAudioFeatureSettings,
): Promise<LibraryHealthSnapshotPayload & { healthUpdatedAt: Date }> {
  const freshAudio = await getAudioFeatureHealthCounts(library.id, audioFeatureSettings);
  const cachedIncomplete = Math.max(0, cached.activeTracks - cached.audioFeaturesComplete);
  const freshIncomplete = Math.max(0, freshAudio.activeTracks - freshAudio.complete);
  const stale = cached.activeTracks !== freshAudio.activeTracks
    || cached.audioFeaturesComplete !== freshAudio.complete
    || cached.audioFeaturesMissing !== freshAudio.missing
    || cached.audioFeaturesPartial !== freshAudio.partial
    || cached.audioFeaturesPending !== freshAudio.pending
    || cached.audioFeaturesNoData !== freshAudio.noData
    || cached.audioFeaturesFailed !== freshAudio.failed
    || cached.audioFeaturesTooShort !== freshAudio.tooShort;

  if (!stale) return { ...cached, healthUpdatedAt: cachedUpdatedAt };

  console.warn(
    `[LibraryHealth][StaleSummary] cached audio summary complete=${cached.audioFeaturesComplete} incomplete=${cachedIncomplete} but fresh resolver complete=${freshAudio.complete} incomplete=${freshIncomplete}. Refreshing summary.`,
  );
  const metadataSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId));
  const refreshed = await calculateLibraryHealthSnapshot(library, {
    bpmProviderMode: metadataProviderModeLabel(metadataSettings.bpm),
    bpmProviderModeKey: metadataProviderModeKey(metadataSettings.bpm as any),
    audioFeatureProviderMode: metadataProviderModeLabel(metadataSettings.audioFeatures),
    audioFeatureSettings: metadataSettings.audioFeatures,
  });
  await saveLibraryHealthSnapshot(library.id, refreshed);
  return { ...refreshed, healthUpdatedAt: new Date() };
}

export async function invalidateLibraryHealthCache(userId: string, options: {
  libraryId?: string | null;
  reason?: string;
} = {}) {
  const where: Prisma.LibraryHealthSnapshotWhereInput = {
    library: {
      ...(options.libraryId ? { id: options.libraryId } : {}),
      server: { userId },
    },
  };
  const result = await prisma.libraryHealthSnapshot.deleteMany({ where });
  const remaining = await prisma.libraryHealthSnapshot.count({ where });
  console.log(`[LibraryHealth] invalidated health snapshot cache count=${result.count} remaining=${remaining} reason=${options.reason || "manual"}${options.libraryId ? ` library=${options.libraryId}` : ""}`);
  if (remaining > 0) {
    console.warn("[LibraryHealth] health snapshot cache invalidation incomplete", {
      userId,
      libraryId: options.libraryId || null,
      remaining,
    });
  }
  return result.count;
}

export async function getLibraryHealth(userId: string) {
  const started = Date.now();
  const metadataSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId));
  const bpmProviderMode = metadataProviderModeLabel(metadataSettings.bpm);
  const bpmProviderModeKey = metadataProviderModeKey(metadataSettings.bpm as any);
  const audioFeatureProviderMode = metadataProviderModeLabel(metadataSettings.audioFeatures);
  const libraries = await prisma.library.findMany({
    where: { type: "artist", server: { userId } },
    select: {
      id: true,
      name: true,
      plexId: true,
      server: { select: { id: true, name: true } },
      syncLogs: { orderBy: { startedAt: "desc" }, take: 1 },
    },
    orderBy: [{ server: { name: "asc" } }, { name: "asc" }],
  });

  const results: LibraryHealthSnapshotPayload[] = [];
  for (const library of libraries) {
    const result = await calculateLibraryHealthSnapshot(library, {
      bpmProviderMode,
      bpmProviderModeKey,
      audioFeatureProviderMode,
      audioFeatureSettings: metadataSettings.audioFeatures,
    });
    results.push(result);
    await saveLibraryHealthSnapshot(library.id, result);
  }
  console.log(`[LibraryHealth] calculated user=${userId} libraries=${libraries.length} durationMs=${Date.now() - started} source=fresh`);
  return results;
}

export const missingTrackSelect = {
  id: true,
  title: true,
  ratingKey: true,
  mediaPath: true,
  lastSeenAt: true,
  missingSince: true,
  lastSeenSyncId: true,
  bpm: true,
  bpmAnalysisStatus: true,
  library: { select: { id: true, name: true } },
  artist: { select: { title: true } },
  album: { select: { title: true } },
  audioFeature: { select: { tempo: true, tempoSource: true } },
} satisfies Prisma.TrackSelect;

export const bpmHealthTrackSelect = {
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
  audioFeature: { select: { tempo: true, tempoSource: true, tempoConfidence: true } },
} satisfies Prisma.TrackSelect;

export const audioFeatureHealthTrackSelect = {
  id: true,
  title: true,
  ratingKey: true,
  duration: true,
  mediaPath: true,
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
      audioFeatureSource: true,
      audioFeatureStatus: true,
      audioFeatureConfidence: true,
      audioFeatureFailureReason: true,
      audioFeatureAnalyzedAt: true,
      audioFeatureAnalysisScope: true,
      energySource: true,
      valenceSource: true,
      danceabilitySource: true,
      acousticnessSource: true,
    },
  },
} satisfies Prisma.TrackSelect;

export const metadataHealthTrackSelect = {
  id: true,
  title: true,
  ratingKey: true,
  duration: true,
  mediaPath: true,
  tagsSyncedAt: true,
  genreStatus: true,
  genreFailureReason: true,
  genreAttemptedAt: true,
  popularityStatus: true,
  popularityAttemptedAt: true,
  popularityFailureReason: true,
  lastSeenAt: true,
  syncStatus: true,
  library: { select: { id: true, name: true } },
  artist: { select: { title: true } },
  album: { select: { title: true } },
  tags: { where: usableGenreTagWhere, select: { name: true }, orderBy: { name: "asc" } },
  popularity: { select: { provider: true, score: true, confidence: true, lastUpdated: true } },
} satisfies Prisma.TrackSelect;

export function serializeBpmHealthTrack(track: any) {
  const effectiveBpm = getEffectiveBpm(track);
  const bpmDisplay = getBpmDisplayMetadata(track);
  return {
    id: track.id,
    title: track.title,
    artist: track.artist?.title || "Unknown artist",
    album: track.album?.title || "Unknown album",
    library: track.library,
    duration: track.duration,
    mediaPath: track.mediaPath,
    ratingKey: track.ratingKey,
    effectiveBpm,
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
    bpmReason: bpmDisplay.reason,
    bpmAnalysisScope: track.bpmAnalysisScope || null,
    bpmAnalysisStatus: effectiveBpm !== null ? "success" : missingTrackBpmStatus(track),
    bpmFailureReason: track.bpmFailureReason,
    bpmAnalyzedAt: track.bpmAnalyzedAt,
    lastSeenAt: track.lastSeenAt,
    syncStatus: track.syncStatus,
  };
}

export function trackHasUsableGenres(track: any) {
  return Array.isArray(track.tags) && track.tags.some((tag: any) => {
    const name = typeof tag?.name === "string" ? tag.name.trim().toLowerCase() : "";
    return name.length > 0 && !unusableGenreNames.includes(name);
  });
}

export function trackHasValidPopularity(track: any) {
  const provider = track.popularity?.provider;
  return knownPopularityProviders.includes(provider)
    && typeof track.popularity?.score === "number"
    && Number.isFinite(track.popularity.score)
    && track.popularity.score >= 0;
}

export function metadataTrackStatus(section: MetadataHealthSection, track: any) {
  if (section === "genres") {
    if (trackHasUsableGenres(track)) return "success";
    if (track.genreStatus === "failed") return "failed";
    if (track.genreStatus === "no_data" || (!track.genreStatus && track.tagsSyncedAt)) return "no_data";
    return "pending";
  }

  if (trackHasValidPopularity(track)) return "success";
  if (track.popularityStatus === "failed") return "failed";
  if (track.popularityStatus === "no_data" || track.popularity?.provider === "not_found") return "no_data";
  return "pending";
}

export function serializeMetadataHealthTrack(track: any) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist?.title || "Unknown artist",
    album: track.album?.title || "Unknown album",
    library: track.library,
    duration: track.duration,
    mediaPath: track.mediaPath,
    ratingKey: track.ratingKey,
    genres: Array.isArray(track.tags) ? track.tags.map((tag: any) => tag.name).filter(Boolean) : [],
    genreStatus: metadataTrackStatus("genres", track),
    genreFailureReason: track.genreFailureReason || null,
    genreAttemptedAt: track.genreAttemptedAt || track.tagsSyncedAt || null,
    popularityScore: trackHasValidPopularity(track) ? track.popularity.score : null,
    popularitySource: trackHasValidPopularity(track) ? track.popularity.provider : null,
    popularityStatus: metadataTrackStatus("popularity", track),
    popularityFailureReason: track.popularityFailureReason || null,
    popularityAttemptedAt: track.popularityAttemptedAt || track.popularity?.lastUpdated || null,
    lastSeenAt: track.lastSeenAt,
    syncStatus: track.syncStatus,
  };
}

function audioFeatureReasonDescription(classification: ReturnType<typeof getAudioFeatureHealthStatus>) {
  if (classification.status === "complete") return "This track has complete audio features for the current provider mode.";
  if (classification.reason === "Track has BPM data but is missing required audio feature fields.") return "BPM exists, but energy, mood, danceability, or local Essentia values are incomplete.";
  if (classification.reason === "API data only") return "API audio feature fields exist, but the current provider mode requires local or allowed estimated audio features.";
  if (classification.reason === "Partial local features" || classification.reason === "Partial audio features") {
    return classification.missingFields.length
      ? `This track has some audio feature data, but required fields are missing for the current provider mode: ${classification.missingFields.join(", ")}.`
      : "This track has some audio feature data, but one or more required fields are missing for the current provider mode.";
  }
  if (classification.status === "pending") {
    return "This track is pending audio feature analysis because required audio feature fields are incomplete for the current provider mode.";
  }
  if (classification.reason === "No audio feature record found") return "Active track is not represented in the audio feature table.";
  if (classification.status === "missing") return "This track is missing required audio features for the current provider mode.";
  if (classification.status === "failed") return "Audio feature analysis failed during a previous attempt.";
  if (classification.status === "too_short") return "This track is too short for audio feature analysis.";
  if (classification.status === "no_data") return "Audio feature analysis completed without usable feature data.";
  return "This track has an unknown incomplete audio feature state.";
}

export function serializeAudioFeatureHealthTrack(track: any, settings: EffectiveAudioFeatureSettings = {}) {
  const feature = track.audioFeature;
  const effective = getEffectiveAudioFeatures(track, settings);
  const classification = getAudioFeatureHealthStatus(track, settings);
  return {
    id: track.id,
    title: track.title,
    artist: track.artist?.title || "Unknown artist",
    album: track.album?.title || "Unknown album",
    library: track.library,
    duration: track.duration,
    mediaPath: track.mediaPath,
    ratingKey: track.ratingKey,
    energy: effective.energy,
    mood: effective.mood,
    bpm: effective.tempo,
    danceability: effective.danceability,
    acousticness: effective.acousticness,
    api: {
      energy: feature?.apiEnergy ?? null,
      mood: feature?.apiMood ?? null,
      danceability: feature?.apiDanceability ?? null,
      acousticness: feature?.apiAcousticness ?? null,
      loudness: feature?.apiLoudness ?? null,
    },
    local: {
      energy: feature?.localEnergy ?? null,
      mood: feature?.localMood ?? null,
      danceability: feature?.localDanceability ?? null,
      acousticness: feature?.localAcousticness ?? null,
      loudness: feature?.localLoudness ?? null,
    },
    source: effective.source || feature?.source || null,
    analysisScope: feature?.audioFeatureAnalysisScope || null,
    confidence: feature?.audioFeatureConfidence ?? feature?.confidence ?? null,
    status: classification.status === "complete" ? "success" : classification.status,
    reason: classification.reason,
    reasonDescription: audioFeatureReasonDescription(classification),
    missingFields: classification.missingFields,
    failureReason: feature?.audioFeatureFailureReason || null,
    analyzedAt: feature?.audioFeatureAnalyzedAt || null,
    fieldSources: {
      energy: feature?.energySource || null,
      mood: feature?.valenceSource || null,
      danceability: feature?.danceabilitySource || null,
      acousticness: feature?.acousticnessSource || null,
    },
    lastSeenAt: track.lastSeenAt,
    syncStatus: track.syncStatus,
  };
}

export function audioFeatureMissingFields(track: any) {
  return getEffectiveAudioFeatures(track, {
    preferLocalAudioFeatures: true,
    allowEstimated: true,
  }).missingFields;
}

export async function logPartialAudioFeatureRetryResult(options: {
  userId: string;
  libraryId?: string;
  before: number;
  processed: number;
  failed: number;
}) {
  const active: Prisma.TrackWhereInput = {
    syncStatus: "active",
    library: {
      ...(options.libraryId ? { id: options.libraryId } : {}),
      server: { userId: options.userId },
    },
  };
  const where: Prisma.TrackWhereInput = {
    AND: [active, partialAudioFeatureTrackWhere()],
  };
  const [remaining, tracks] = await Promise.all([
    prisma.track.count({ where }),
    prisma.track.findMany({
      where,
      select: audioFeatureHealthTrackSelect,
      orderBy: [{ artist: { title: "asc" } }, { album: { title: "asc" } }, { title: "asc" }],
      take: 10,
    }),
  ]);

  console.log(
    `[LibraryHealth] partial_audio_features after retry: before=${options.before} processed=${options.processed} failed=${options.failed} remaining=${remaining}`,
  );
  for (const track of tracks) {
    console.log(
      `[LibraryHealth] Remaining partial: ratingKey=${track.ratingKey} artist=${JSON.stringify(track.artist?.title || "Unknown artist")} title=${JSON.stringify(track.title)} missing=${JSON.stringify(audioFeatureMissingFields(track))}`,
    );
  }
}

export function serializeMissingTrack(track: any) {
  return { ...track, bpmStatus: missingTrackBpmStatus(track) };
}

export function toCsv(rows: any[]) {
  const columns = [
    "Library", "Track title", "Artist", "Album", "Plex rating key", "Media path",
    "Last seen at", "Missing since", "Last sync run ID", "BPM status",
  ];
  const safeCell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [columns, ...rows.map((row) => [
    row.library.name, row.title, row.artist.title, row.album.title, row.ratingKey, row.mediaPath,
    row.lastSeenAt?.toISOString?.() || row.lastSeenAt, row.missingSince?.toISOString?.() || row.missingSince,
    row.lastSeenSyncId, missingTrackBpmStatus(row),
  ])].map((row) => row.map(safeCell).join(",")).join("\r\n");
}

export function metadataTracksToCsv(rows: any[]) {
  const columns = [
    "Library", "Track title", "Artist", "Album", "Plex rating key", "Media path",
    "Genres", "Genre status", "Genre failure reason", "Genre attempted at",
    "Popularity score", "Popularity source", "Popularity status", "Popularity failure reason",
    "Popularity attempted at", "Last seen at", "Sync status",
  ];
  const safeCell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("; ") : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [columns, ...rows.map((row) => [
    row.library?.name,
    row.title,
    row.artist,
    row.album,
    row.ratingKey,
    row.mediaPath,
    row.genres,
    row.genreStatus,
    row.genreFailureReason,
    row.genreAttemptedAt,
    row.popularityScore,
    row.popularitySource,
    row.popularityStatus,
    row.popularityFailureReason,
    row.popularityAttemptedAt,
    row.lastSeenAt,
    row.syncStatus,
  ])].map((row) => row.map(safeCell).join(",")).join("\r\n");
}
