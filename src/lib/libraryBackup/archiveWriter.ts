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
  MIN_SUPPORTED_SCHEMA_VERSION,
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
  type BackupManifest,
  type BackupTrackRecord,
} from "./archiveFormat";
import { computeFingerprint, hashNormalizedPath } from "./trackMatching";
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

/** Map a Prisma track row to an allowlisted export record. */
export function mapTrackRowToRecord(row: TrackExportRow): BackupTrackRecord {
  const guids: string[] = [];
  if (Array.isArray(row.plexGuids)) {
    for (const g of row.plexGuids) if (typeof g === "string") guids.push(g);
  }
  const discNumber = extractDiscNumber(row.plexMetadata);
  const trackNumber = typeof row.trackIndex === "number" ? row.trackIndex : null;
  const durationMs = typeof row.duration === "number" ? row.duration : null;

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
    fingerprint: computeFingerprint({
      artist: row.artist?.title, album: row.album?.title, title: row.title,
      discNumber, trackNumber, durationMs,
    }),
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
    counts.audio_features += 1;
    counts.completed += 1;
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
    if (status === "no_data" || status === "local_not_found") counts.no_data_bpm += 1;
  }
  if (record.popularity) {
    const provider = record.popularity.provider;
    const status = record.popularity.popularityStatus;
    if (typeof record.popularity.score === "number" && provider && provider !== "not_found") counts.popularity += 1;
    if (status === "no_data" || provider === "not_found") counts.no_data_popularity += 1;
  }
  if (record.genres) {
    if (record.genres.names.length) counts.genres += 1;
    if (record.genres.no_data) counts.no_data_genres += 1;
  }
  engines.add(`essentia@analysis-v${ANALYSIS_DATA_VERSION}`);
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
    onProgress?: (processed: number) => void;
  } = {},
): Promise<BuiltArchive> {
  const counts = emptyCounts();
  const sources = new Set<string>();
  const engines = new Set<string>();
  const chunks: Buffer[] = [];
  let processed = 0;

  for await (const record of records as AsyncIterable<BackupTrackRecord>) {
    accumulateCounts(counts, record, sources, engines);
    chunks.push(Buffer.from(serializeTrackRecordLine(record) + "\n", "utf8"));
    processed += 1;
    if (options.onProgress && processed % 1000 === 0) options.onProgress(processed);
  }
  counts.no_data = counts.no_data_popularity + counts.no_data_genres + counts.no_data_bpm;

  const tracksBuf = Buffer.concat(chunks);
  const tracksSha256 = sha256Hex(tracksBuf);

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
