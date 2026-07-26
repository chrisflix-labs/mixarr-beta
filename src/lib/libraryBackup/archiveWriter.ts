/**
 * Pure archive-writing logic for Library Intelligence backups (no Prisma /
 * filesystem). Maps track rows to allowlisted records, accumulates manifest
 * counts, and packages the versioned archive. Safe to import from tests.
 */
import {
  ANALYSIS_DATA_VERSION,
  ARCHIVE_ENTRY,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TYPE,
  IDENTITY_STRATEGY_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  PATH_NORMALIZATION_VERSION,
  emptyCounts,
  normalizeGenreName,
  sanitizeAudioFeatureRecord,
  sanitizeBpmRecord,
  sanitizeGenreRecord,
  sanitizePopularityRecord,
  serializeManifest,
  serializeTrackRecordLine,
  sha256Hex,
  type BackupCounts,
  type BackupCategoryCounts,
  type BackupManifest,
  type BackupMediaPartIdentity,
  type BackupTrackRecord,
} from "./archiveFormat";
import { computeFingerprint, hashNormalizedPath, hashNormalizedPathCandidates } from "./trackMatching";
import { buildZip } from "./zipArchive";
import { APP_VERSION_NUMBER } from "../appVersion";

/** Prisma select for one exportable track and all its intelligence relations. */
export const trackExportSelect = {
  id: true,
  plexGuid: true,
  plexGuids: true,
  ratingKey: true,
  plexId: true,
  plexLibraryId: true,
  libraryId: true,
  plexServerId: true,
  title: true,
  duration: true,
  trackIndex: true,
  mediaPath: true,
  plexMediaPartId: true,
  fileSize: true,
  plexMetadata: true,
  popularityStatus: true,
  popularityAttemptedAt: true,
  popularityFailureReason: true,
  bpm: true,
  apiBpm: true,
  localBpm: true,
  effectiveBpm: true,
  bpmSource: true,
  bpmConfidence: true,
  bpmAnalyzedAt: true,
  bpmAnalysisStatus: true,
  bpmAnalysisScope: true,
  bpmFailureReason: true,
  genreStatus: true,
  genreAttemptedAt: true,
  genreFailureReason: true,
  tagsSyncedAt: true,
  artist: { select: { title: true } },
  album: { select: { title: true, year: true, artist: { select: { title: true } } } },
  audioFeature: true,
  popularity: true,
  tags: { where: { type: "genre" }, select: { name: true } },
} as const;

export type TrackExportRow = {
  id: string;
  plexGuid: string | null;
  plexGuids: unknown;
  ratingKey: string | null;
  plexId: string | null;
  plexLibraryId: string | null;
  libraryId: string | null;
  plexServerId: string | null;
  title: string | null;
  duration: number | null;
  trackIndex: number | null;
  mediaPath: string | null;
  plexMediaPartId: string | null;
  fileSize: bigint | null;
  plexMetadata: unknown;
  popularityStatus: string | null;
  popularityAttemptedAt: Date | null;
  popularityFailureReason: string | null;
  bpm: number | null;
  apiBpm: number | null;
  localBpm: number | null;
  effectiveBpm: number | null;
  bpmSource: string | null;
  bpmConfidence: number | null;
  bpmAnalyzedAt: Date | null;
  bpmAnalysisStatus: string | null;
  bpmAnalysisScope: string | null;
  bpmFailureReason: string | null;
  genreStatus: string | null;
  genreAttemptedAt: Date | null;
  genreFailureReason: string | null;
  tagsSyncedAt: Date | null;
  artist: { title: string | null } | null;
  album: { title: string | null; year: number | null; artist: { title: string | null } | null } | null;
  audioFeature: Record<string, unknown> | null;
  popularity: Record<string, unknown> | null;
  tags: { name: string }[];
};

function extractDiscNumber(plexMetadata: unknown): number | null {
  if (plexMetadata && typeof plexMetadata === "object") {
    const meta = plexMetadata as Record<string, unknown>;
    const raw = meta.parentIndex ?? meta.discNumber ?? meta.disc;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

function collectPlexParts(value: unknown, out: { id: string | null; path: string | null; size: number | null }[]) {
  if (!value || typeof value !== "object" || out.length >= 64) return;
  if (Array.isArray(value)) {
    for (const item of value) collectPlexParts(item, out);
    return;
  }
  const raw = value as Record<string, unknown>;
  const path = typeof raw.file === "string" ? raw.file : typeof raw.path === "string" ? raw.path : null;
  if (path) {
    const id = typeof raw.id === "string" || typeof raw.id === "number"
      ? String(raw.id)
      : typeof raw.key === "string" ? raw.key : null;
    const sizeValue = typeof raw.size === "number" ? raw.size : typeof raw.size === "string" ? Number(raw.size) : null;
    out.push({ id, path, size: sizeValue !== null && Number.isSafeInteger(sizeValue) && sizeValue >= 0 ? sizeValue : null });
  }
  for (const key of ["Media", "media", "Part", "part", "parts"]) {
    if (key in raw) collectPlexParts(raw[key], out);
  }
}

export function extractMediaPartIdentities(row: Pick<TrackExportRow, "mediaPath" | "plexMediaPartId" | "fileSize" | "plexMetadata">): BackupMediaPartIdentity[] {
  const rawParts: { id: string | null; path: string | null; size: number | null }[] = [];
  collectPlexParts(row.plexMetadata, rawParts);
  if (row.mediaPath) {
    rawParts.unshift({
      id: row.plexMediaPartId,
      path: row.mediaPath,
      size: row.fileSize !== null && row.fileSize !== undefined ? Number(row.fileSize) : null,
    });
  }
  const seen = new Set<string>();
  const parts: BackupMediaPartIdentity[] = [];
  for (const part of rawParts) {
    const pathHashes = hashNormalizedPathCandidates(part.path);
    const key = `${part.id ?? ""}|${pathHashes[0] ?? ""}|${part.size ?? ""}`;
    if ((!part.id && !pathHashes.length) || seen.has(key)) continue;
    seen.add(key);
    parts.push({ part_id: part.id, path_hashes: pathHashes, file_size: part.size });
  }
  return parts;
}

/** Map a Prisma track row to an allowlisted export record. */
export function mapTrackRowToRecord(row: TrackExportRow): BackupTrackRecord {
  const guids: string[] = [];
  if (Array.isArray(row.plexGuids)) {
    for (const g of row.plexGuids) if (typeof g === "string") guids.push(g);
  }
  const discNumber = extractDiscNumber(row.plexMetadata);
  const trackNumber = typeof row.trackIndex === "number" ? row.trackIndex : null;
  const durationMs = typeof row.duration === "number" ? row.duration : null;
  const mediaParts = extractMediaPartIdentities(row);

  const bpmRaw: Record<string, unknown> = {
    bpm: row.bpm, apiBpm: row.apiBpm, localBpm: row.localBpm, effectiveBpm: row.effectiveBpm,
    bpmConfidence: row.bpmConfidence, bpmSource: row.bpmSource,
    bpmAnalysisStatus: row.bpmAnalysisStatus, bpmAnalysisScope: row.bpmAnalysisScope,
    bpmFailureReason: row.bpmFailureReason, bpmAnalyzedAt: row.bpmAnalyzedAt,
  };
  const popularityRaw: Record<string, unknown> = {
    ...(row.popularity || {}),
    popularityStatus: row.popularityStatus,
    popularityAttemptedAt: row.popularityAttemptedAt,
    popularityFailureReason: row.popularityFailureReason,
  };
  const genreNames = row.tags.map((t) => t.name).filter((n): n is string => typeof n === "string" && n.length > 0);
  const genresRaw = {
    names: genreNames,
    normalized: genreNames.map(normalizeGenreName),
    status: row.genreStatus,
    attempted_at: row.genreAttemptedAt,
    synced_at: row.tagsSyncedAt,
    failure_reason: row.genreFailureReason,
    no_data: row.genreStatus === "no_data",
  };

  return {
    id: row.id,
    plex_guid: row.plexGuid,
    plex_guids: guids,
    rating_key: row.ratingKey,
    plex_id: row.plexId,
    plex_library_id: row.plexLibraryId,
    library_id: row.libraryId,
    plex_server_id: row.plexServerId,
    title: row.title,
    artist: row.artist?.title ?? null,
    album: row.album?.title ?? null,
    album_artist: row.album?.artist?.title ?? null,
    track_number: trackNumber,
    disc_number: discNumber,
    duration_ms: durationMs,
    year: typeof row.album?.year === "number" ? row.album.year : null,
    file_size: row.fileSize !== null && row.fileSize !== undefined ? Number(row.fileSize) : null,
    path_hash: hashNormalizedPath(row.mediaPath),
    media_parts: mediaParts,
    fingerprint: computeFingerprint({
      artist: row.artist?.title, album: row.album?.title, title: row.title,
      discNumber, trackNumber, durationMs,
    }),
    identity_strategy_version: IDENTITY_STRATEGY_VERSION,
    audio_feature: sanitizeAudioFeatureRecord(row.audioFeature),
    bpm: sanitizeBpmRecord(bpmRaw),
    popularity: sanitizePopularityRecord(popularityRaw),
    genres: sanitizeGenreRecord(genresRaw),
  };
}

function classifySource(source: string | number | null | undefined): "local" | "api" | "estimated" | null {
  if (typeof source !== "string") return null;
  const s = source.toLowerCase();
  if (s.includes("local") || s.includes("essentia")) return "local";
  if (s.includes("estimat")) return "estimated";
  if (s.includes("api") || s.includes("deezer") || s.includes("spotify") || s.includes("lastfm")) return "api";
  return null;
}

/** Accumulate manifest counts from a single record. */
export function accumulateCounts(counts: BackupCounts, record: BackupTrackRecord, sources: Set<string>, engines: Set<string>) {
  counts.tracks += 1;
  if (record.audio_feature) {
    const status = String(record.audio_feature.audioFeatureStatus ?? "").toLowerCase();
    if (status === "complete") {
      counts.audio_features += 1;
      counts.completed += 1;
    } else {
      counts.incomplete += 1;
    }
    const source = classifySource(record.audio_feature.audioFeatureSource ?? record.audio_feature.source);
    if (source === "local") counts.source_local += 1;
    else if (source === "api") counts.source_api += 1;
    else if (source === "estimated") counts.source_estimated += 1;
    const src = record.audio_feature.audioFeatureSource ?? record.audio_feature.source;
    if (typeof src === "string") sources.add(src);
  } else {
    counts.incomplete += 1;
  }
  if (record.bpm) {
    const hasValue = ["bpm", "apiBpm", "localBpm", "effectiveBpm"].some((k) => typeof record.bpm![k] === "number");
    if (hasValue) counts.bpm += 1;
    const status = record.bpm.bpmAnalysisStatus;
    if (hasValue || (status && status !== "pending")) counts.bpm_attempted += 1;
    if (status === "no_data" || status === "local_not_found") counts.no_data_bpm += 1;
  }
  if (record.popularity) {
    const provider = record.popularity.provider;
    const status = record.popularity.popularityStatus;
    if (typeof record.popularity.score === "number" && provider && provider !== "not_found") counts.popularity += 1;
    if ((typeof record.popularity.score === "number" && provider && provider !== "not_found") || (status && status !== "pending")) counts.popularity_attempted += 1;
    if (status === "no_data" || provider === "not_found") counts.no_data_popularity += 1;
  }
  if (record.genres) {
    if (record.genres.names.length) counts.genres += 1;
    if (record.genres.no_data) counts.no_data_genres += 1;
    if (record.genres.names.length || (record.genres.status && record.genres.status !== "pending")) counts.genres_attempted += 1;
  }
  for (const status of [
    record.audio_feature?.audioFeatureStatus,
    record.bpm?.bpmAnalysisStatus,
    record.popularity?.popularityStatus,
    record.genres?.status,
  ]) {
    if (status === "pending") counts.pending += 1;
    if (status === "failed") counts.failed += 1;
  }
  engines.add(`essentia@analysis-v${ANALYSIS_DATA_VERSION}`);
}

function emptyDetailedCategory(): BackupCategoryCounts {
  return {
    expected: 0, exported: 0, attempted: 0, values: 0, completed: 0,
    incomplete: 0, pending: 0, failed: 0, known_no_data: 0,
  };
}

function emptyDetailedCategories(): BackupManifest["category_counts"] {
  return {
    audio_features: emptyDetailedCategory(),
    bpm: emptyDetailedCategory(),
    popularity: emptyDetailedCategory(),
    genres: emptyDetailedCategory(),
  };
}

function accumulateDetailedCategories(categories: BackupManifest["category_counts"], record: BackupTrackRecord) {
  for (const category of Object.values(categories)) category.exported += 1;

  const audioStatus = String(record.audio_feature?.audioFeatureStatus ?? "").toLowerCase();
  if (audioStatus === "complete") {
    categories.audio_features.completed += 1;
    categories.audio_features.values += 1;
    categories.audio_features.attempted += 1;
  } else {
    categories.audio_features.incomplete += 1;
    if (record.audio_feature && audioStatus !== "pending") categories.audio_features.attempted += 1;
  }
  if (audioStatus === "pending") categories.audio_features.pending += 1;
  if (audioStatus === "failed") categories.audio_features.failed += 1;
  if (audioStatus === "no_data") categories.audio_features.known_no_data += 1;

  const bpmStatus = String(record.bpm?.bpmAnalysisStatus ?? "").toLowerCase();
  const bpmValue = recordHasBpm(record);
  if (bpmValue || (bpmStatus && bpmStatus !== "pending")) categories.bpm.attempted += 1;
  if (bpmValue) categories.bpm.values += 1;
  if (bpmStatus === "complete") categories.bpm.completed += 1;
  if (bpmStatus === "pending") categories.bpm.pending += 1;
  if (bpmStatus === "failed") categories.bpm.failed += 1;
  if (bpmStatus === "no_data" || bpmStatus === "local_not_found") categories.bpm.known_no_data += 1;

  const popularityStatus = String(record.popularity?.popularityStatus ?? "").toLowerCase();
  const popularityValue = typeof record.popularity?.score === "number" && record.popularity.provider !== "not_found";
  if (popularityValue || (popularityStatus && popularityStatus !== "pending")) categories.popularity.attempted += 1;
  if (popularityValue) categories.popularity.values += 1;
  if (popularityStatus === "success") categories.popularity.completed += 1;
  if (popularityStatus === "pending") categories.popularity.pending += 1;
  if (popularityStatus === "failed") categories.popularity.failed += 1;
  if (popularityStatus === "no_data" || record.popularity?.provider === "not_found") categories.popularity.known_no_data += 1;

  const genreStatus = String(record.genres?.status ?? "").toLowerCase();
  const genreValue = !!record.genres?.names.length;
  if (genreValue || (genreStatus && genreStatus !== "pending")) categories.genres.attempted += 1;
  if (genreValue) categories.genres.values += 1;
  if (genreStatus === "success") categories.genres.completed += 1;
  if (genreStatus === "pending") categories.genres.pending += 1;
  if (genreStatus === "failed") categories.genres.failed += 1;
  if (record.genres?.no_data) categories.genres.known_no_data += 1;
}

function recordHasBpm(record: BackupTrackRecord): boolean {
  return !!record.bpm && ["bpm", "apiBpm", "localBpm", "effectiveBpm"].some((key) => typeof record.bpm![key] === "number");
}

export type BuiltArchive = {
  archive: Buffer;
  manifest: BackupManifest;
  counts: BackupCounts;
  archiveSha256: string;
  tracksSha256: string;
};

/**
 * Build the archive buffer from an (async) iterable of records. Pure with
 * respect to the database — used directly by large-library performance tests.
 */
export async function writeArchiveFromRecords(
  records: AsyncIterable<BackupTrackRecord> | Iterable<BackupTrackRecord>,
  options: {
    mixarrVersion?: string;
    notes?: string | null;
    libraryIdentifiers?: string[];
    libraryHashes?: string[];
    sourcePlexServerIdentifier?: string | null;
    sourceLibraryIdentifier?: string | null;
    libraryFingerprint?: string | null;
    expectedRecords?: number;
    expectedCategoryCounts?: Partial<BackupManifest["category_counts"]>;
    onProgress?: (processed: number) => void;
  } = {},
): Promise<BuiltArchive> {
  const counts = emptyCounts();
  const sources = new Set<string>();
  const engines = new Set<string>();
  const categoryCounts = emptyDetailedCategories();
  const chunks: Buffer[] = [];
  let processed = 0;

  for await (const record of records as AsyncIterable<BackupTrackRecord>) {
    accumulateCounts(counts, record, sources, engines);
    accumulateDetailedCategories(categoryCounts, record);
    chunks.push(Buffer.from(serializeTrackRecordLine(record) + "\n", "utf8"));
    processed += 1;
    if (options.onProgress && processed % 1000 === 0) options.onProgress(processed);
  }
  counts.no_data = counts.no_data_popularity + counts.no_data_genres + counts.no_data_bpm;

  const tracksBuf = Buffer.concat(chunks);
  const tracksSha256 = sha256Hex(tracksBuf);
  const expectedRecords = options.expectedRecords ?? processed;
  for (const category of Object.keys(categoryCounts) as (keyof typeof categoryCounts)[]) {
    categoryCounts[category].expected = expectedRecords;
    const expected = options.expectedCategoryCounts?.[category];
    if (expected) categoryCounts[category].expected = expected.expected;
  }
  const recordsSkipped = Math.max(0, expectedRecords - processed);
  const complete = expectedRecords === processed
    && Object.values(categoryCounts).every((category) => category.expected === category.exported);

  const manifest: BackupManifest = {
    backup_type: BACKUP_TYPE,
    schema_version: BACKUP_SCHEMA_VERSION,
    analysis_data_version: ANALYSIS_DATA_VERSION,
    mixarr_version: options.mixarrVersion ?? APP_VERSION_NUMBER,
    min_restore_schema_version: MIN_SUPPORTED_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    counts,
    source_classifications: Array.from(sources).slice(0, 32),
    analysis_engine_versions: Array.from(engines).slice(0, 32),
    library_identifiers: (options.libraryIdentifiers ?? []).slice(0, 64),
    library_hashes: (options.libraryHashes ?? []).slice(0, 64),
    source_plex_server_identifier: options.sourcePlexServerIdentifier ?? null,
    source_library_identifier: options.sourceLibraryIdentifier ?? null,
    library_fingerprint: options.libraryFingerprint ?? null,
    total_plex_track_count: expectedRecords,
    total_intelligence_records_exported: processed,
    category_counts: categoryCounts,
    diagnostics: {
      eligible_database_records: expectedRecords,
      records_read: processed,
      records_serialized: processed,
      records_written: processed,
      records_skipped: recordsSkipped,
      skipped_reason_counts: recordsSkipped ? { not_read_from_database_snapshot: recordsSkipped } : {},
    },
    files: {
      [ARCHIVE_ENTRY.tracks]: { sha256: tracksSha256, bytes: tracksBuf.length, records: processed },
    },
    identity_strategy_version: IDENTITY_STRATEGY_VERSION,
    path_normalization_version: PATH_NORMALIZATION_VERSION,
    complete,
    legacy: false,
    archive_sha256: null,
    notes: options.notes ?? null,
  };
  const manifestText = serializeManifest(manifest);
  const manifestBuf = Buffer.from(manifestText, "utf8");
  const manifestSha256 = sha256Hex(manifestBuf);

  const checksums = {
    algorithm: "sha256",
    entries: {
      [ARCHIVE_ENTRY.tracks]: tracksSha256,
      [ARCHIVE_ENTRY.manifest]: manifestSha256,
    },
  };
  const checksumsBuf = Buffer.from(JSON.stringify(checksums, null, 2), "utf8");

  const archive = buildZip([
    { name: ARCHIVE_ENTRY.manifest, data: manifestBuf },
    { name: ARCHIVE_ENTRY.tracks, data: tracksBuf },
    { name: ARCHIVE_ENTRY.checksums, data: checksumsBuf },
  ]);
  const archiveSha256 = sha256Hex(archive);

  return { archive, manifest, counts, archiveSha256, tracksSha256 };
}
