/**
 * Library Intelligence Backup — archive format (v2.4.11).
 *
 * Pure module (no Prisma, no filesystem). Defines the versioned archive schema,
 * the explicit field allowlists that keep secrets/unrelated data out, strict
 * value sanitizers for untrusted restore input, and NDJSON/manifest/checksum
 * helpers. Safe to import from tests and client-safe code.
 */
import { createHash } from "node:crypto";

export const BACKUP_TYPE = "mixarr-library-intelligence" as const;
export const BACKUP_SCHEMA_VERSION = 2;
/** Oldest backup schema this build can still read. */
export const MIN_SUPPORTED_SCHEMA_VERSION = 1;
export const BACKUP_FILE_EXTENSION = ".mixarr-library-backup";
export const IDENTITY_STRATEGY_VERSION = 2;
export const PATH_NORMALIZATION_VERSION = 2;

/** Analysis data version. Bump when the intelligence field semantics change. */
export const ANALYSIS_DATA_VERSION = 1;

export const ARCHIVE_ENTRY = {
  manifest: "manifest.json",
  tracks: "tracks.ndjson",
  checksums: "checksums.json",
} as const;

// Hard safety limits applied to untrusted archives during restore.
export const LIMITS = {
  /** Reject archives whose stored file exceeds this many bytes. */
  maxArchiveBytes: 1_500_000_000, // 1.5 GB compressed
  /** Reject if the declared/actual decompressed size exceeds this. */
  maxUncompressedBytes: 8_000_000_000, // 8 GB
  /** Reject archives with an implausible overall compression ratio (zip bomb). */
  maxCompressionRatio: 200,
  /** Maximum number of track records accepted. */
  maxRecords: 5_000_000,
  /** Maximum length of a single NDJSON line. */
  maxRecordBytes: 64 * 1024,
  /** Maximum length of any sanitized string field. */
  maxStringLength: 2_000,
  /** Maximum length of the user notes field. */
  maxNotesLength: 2_000,
  /** Maximum number of genre names per track. */
  maxGenresPerTrack: 128,
  /** Maximum number of entries inside the zip central directory. */
  maxArchiveEntries: 64,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackupCounts = {
  tracks: number;
  audio_features: number;
  bpm: number;
  popularity: number;
  genres: number;
  completed: number;
  incomplete: number;
  no_data: number;
  no_data_popularity: number;
  no_data_genres: number;
  no_data_bpm: number;
  source_local: number;
  source_api: number;
  source_estimated: number;
  popularity_attempted: number;
  genres_attempted: number;
  bpm_attempted: number;
  pending: number;
  failed: number;
};

export type BackupCategoryCounts = {
  expected: number;
  exported: number;
  attempted: number;
  values: number;
  completed: number;
  incomplete: number;
  pending: number;
  failed: number;
  known_no_data: number;
};

export type BackupDiagnostics = {
  eligible_database_records: number;
  records_read: number;
  records_serialized: number;
  records_written: number;
  records_skipped: number;
  skipped_reason_counts: Record<string, number>;
};

export type BackupFileManifest = {
  sha256: string;
  bytes: number;
  records?: number;
};

export type BackupManifest = {
  backup_type: typeof BACKUP_TYPE;
  schema_version: number;
  analysis_data_version: number;
  mixarr_version: string;
  min_restore_schema_version: number;
  created_at: string;
  counts: BackupCounts;
  source_classifications: string[];
  analysis_engine_versions: string[];
  library_identifiers: string[];
  library_hashes: string[];
  source_plex_server_identifier: string | null;
  source_library_identifier: string | null;
  library_fingerprint: string | null;
  total_plex_track_count: number;
  total_intelligence_records_exported: number;
  category_counts: {
    audio_features: BackupCategoryCounts;
    bpm: BackupCategoryCounts;
    popularity: BackupCategoryCounts;
    genres: BackupCategoryCounts;
  };
  diagnostics: BackupDiagnostics;
  files: Record<string, BackupFileManifest>;
  identity_strategy_version: number;
  path_normalization_version: number;
  complete: boolean;
  legacy: boolean;
  archive_sha256?: string | null;
  notes?: string | null;
};

export type AudioFeatureRecord = Record<string, string | number | null>;
export type BpmRecord = Record<string, string | number | null>;
export type PopularityRecord = Record<string, string | number | null>;
export type GenreRecord = {
  names: string[];
  normalized: string[];
  status: string | null;
  attempted_at: string | null;
  synced_at: string | null;
  failure_reason: string | null;
  no_data: boolean;
};

export type BackupMediaPartIdentity = {
  part_id: string | null;
  path_hashes: string[];
  file_size: number | null;
};

export type BackupTrackRecord = {
  id: string;
  plex_guid: string | null;
  plex_guids: string[];
  rating_key: string | null;
  plex_id: string | null;
  plex_library_id: string | null;
  library_id: string | null;
  plex_server_id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
  track_number: number | null;
  disc_number: number | null;
  duration_ms: number | null;
  year: number | null;
  file_size: number | null;
  path_hash: string | null;
  media_parts: BackupMediaPartIdentity[];
  fingerprint: string | null;
  identity_strategy_version: number;
  audio_feature: AudioFeatureRecord | null;
  bpm: BpmRecord | null;
  popularity: PopularityRecord | null;
  genres: GenreRecord | null;
};

// ---------------------------------------------------------------------------
// Field allowlists — the ONLY intelligence fields that may cross the boundary.
// Anything not listed here is dropped on export and on restore.
// ---------------------------------------------------------------------------

export const AUDIO_FEATURE_NUMBER_FIELDS = [
  "energy", "valence", "danceability", "acousticness",
  "apiEnergy", "apiMood", "apiDanceability", "apiAcousticness", "apiLoudness",
  "localEnergy", "localMood", "localDanceability", "localAcousticness", "localLoudness",
  "effectiveEnergy", "effectiveMood", "effectiveDanceability", "effectiveAcousticness",
  "tempo", "loudness", "dynamicComplexity", "spectralCentroid", "spectralContrast",
  "rhythmStability", "onsetRate", "zeroCrossingRate", "replayGain",
  "confidence", "tempoConfidence", "audioFeatureConfidence",
] as const;

export const AUDIO_FEATURE_STRING_FIELDS = [
  "key", "scale", "source", "tempoSource", "audioFeatureSource",
  "audioFeatureStatus", "audioFeatureAnalysisScope",
  "energySource", "valenceSource", "danceabilitySource", "acousticnessSource",
  "audioFeatureFailureReason",
] as const;

export const AUDIO_FEATURE_TIMESTAMP_FIELDS = [
  "audioFeatureAnalyzedAt", "lastUpdated",
] as const;

export const BPM_NUMBER_FIELDS = ["bpm", "apiBpm", "localBpm", "effectiveBpm", "bpmConfidence"] as const;
export const BPM_STRING_FIELDS = ["bpmSource", "bpmAnalysisStatus", "bpmAnalysisScope", "bpmFailureReason"] as const;
export const BPM_TIMESTAMP_FIELDS = ["bpmAnalyzedAt"] as const;

export const POPULARITY_NUMBER_FIELDS = ["score", "confidence"] as const;
export const POPULARITY_STRING_FIELDS = ["provider", "matchedArtist", "matchedTitle", "popularityStatus", "popularityFailureReason"] as const;
export const POPULARITY_TIMESTAMP_FIELDS = ["lastUpdated", "popularityAttemptedAt"] as const;

/** Field names that must NEVER appear in an export or be honored on restore. */
export const FORBIDDEN_FIELD_SUBSTRINGS = [
  "token", "secret", "password", "credential", "apikey", "api_key",
  "accesstoken", "refreshtoken", "session", "cookie", "authorization",
  "webhook", "prompt", "aiprovider", "openai", "anthropic", "ollama",
  "privatekey", "signingkey", "email", "recipe", "playlist",
];

// ---------------------------------------------------------------------------
// Value sanitizers (used on both export and — critically — restore)
// ---------------------------------------------------------------------------

/** Strip control characters and cap length; returns null for non-strings/blank. */
export function sanitizeString(value: unknown, maxLen: number = LIMITS.maxStringLength): string | null {
  if (typeof value !== "string") return null;
  // Replace ASCII control chars (0x00-0x1F, 0x7F) with a space to defuse injected
  // markup/log/terminal tricks, without embedding literal control bytes in source.
  let cleaned = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    cleaned += code < 0x20 || code === 0x7f ? " " : value[i];
  }
  cleaned = cleaned.trim();
  if (!cleaned) return null;
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/** Finite number only — rejects NaN, Infinity, -Infinity, and out-of-range values. */
export function sanitizeFiniteNumber(
  value: unknown,
  opts: { min?: number; max?: number } = {},
): number | null {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(num)) return null;
  if (opts.min !== undefined && num < opts.min) return null;
  if (opts.max !== undefined && num > opts.max) return null;
  return num;
}

/** Non-negative safe integer. */
export function sanitizeInt(value: unknown, opts: { min?: number; max?: number } = {}): number | null {
  const num = sanitizeFiniteNumber(value, opts);
  if (num === null) return null;
  const rounded = Math.trunc(num);
  return Number.isSafeInteger(rounded) ? rounded : null;
}

/** ISO-8601 timestamp validation; returns a canonical ISO string or null. */
export function sanitizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  // Reject absurd dates (before 2000 / after 2200) that indicate corruption.
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2200) return null;
  return date.toISOString();
}

export function isForbiddenFieldName(name: string): boolean {
  const lower = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return FORBIDDEN_FIELD_SUBSTRINGS.some((bad) => lower.includes(bad.replace(/[^a-z0-9]/g, "")));
}

function pickNumbers(raw: Record<string, unknown>, fields: readonly string[], out: Record<string, string | number | null>) {
  for (const field of fields) {
    if (field in raw) {
      const v = sanitizeFiniteNumber(raw[field]);
      if (v !== null || raw[field] === null) out[field] = v;
    }
  }
}
function pickStrings(raw: Record<string, unknown>, fields: readonly string[], out: Record<string, string | number | null>) {
  for (const field of fields) {
    if (field in raw) {
      const v = sanitizeString(raw[field]);
      if (v !== null || raw[field] === null) out[field] = v;
    }
  }
}
function pickTimestamps(raw: Record<string, unknown>, fields: readonly string[], out: Record<string, string | number | null>) {
  for (const field of fields) {
    if (field in raw) {
      const v = sanitizeTimestamp(raw[field]);
      if (v !== null || raw[field] === null) out[field] = v;
    }
  }
}

export function sanitizeAudioFeatureRecord(raw: unknown): AudioFeatureRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const out: AudioFeatureRecord = {};
  pickNumbers(src, AUDIO_FEATURE_NUMBER_FIELDS, out);
  pickStrings(src, AUDIO_FEATURE_STRING_FIELDS, out);
  pickTimestamps(src, AUDIO_FEATURE_TIMESTAMP_FIELDS, out);
  return Object.keys(out).length ? out : null;
}

export function sanitizeBpmRecord(raw: unknown): BpmRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const out: BpmRecord = {};
  pickNumbers(src, BPM_NUMBER_FIELDS, out);
  pickStrings(src, BPM_STRING_FIELDS, out);
  pickTimestamps(src, BPM_TIMESTAMP_FIELDS, out);
  return Object.keys(out).length ? out : null;
}

export function sanitizePopularityRecord(raw: unknown): PopularityRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const out: PopularityRecord = {};
  pickNumbers(src, POPULARITY_NUMBER_FIELDS, out);
  pickStrings(src, POPULARITY_STRING_FIELDS, out);
  pickTimestamps(src, POPULARITY_TIMESTAMP_FIELDS, out);
  return Object.keys(out).length ? out : null;
}

export function sanitizeGenreRecord(raw: unknown): GenreRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const names: string[] = [];
  if (Array.isArray(src.names)) {
    for (const n of src.names) {
      const s = sanitizeString(n, 200);
      if (s && names.length < LIMITS.maxGenresPerTrack) names.push(s);
    }
  }
  const normalized: string[] = [];
  if (Array.isArray(src.normalized)) {
    for (const n of src.normalized) {
      const s = sanitizeString(n, 200);
      if (s && normalized.length < LIMITS.maxGenresPerTrack) normalized.push(s);
    }
  }
  const status = sanitizeString(src.status, 64);
  const noData = src.no_data === true || status === "no_data";
  if (!names.length && !status && !src.attempted_at && !src.synced_at) return null;
  return {
    names,
    normalized: normalized.length ? normalized : names.map(normalizeGenreName).filter(Boolean),
    status,
    attempted_at: sanitizeTimestamp(src.attempted_at),
    synced_at: sanitizeTimestamp(src.synced_at),
    failure_reason: sanitizeString(src.failure_reason, 200),
    no_data: noData,
  };
}

export function normalizeGenreName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Sanitize a single untrusted backup track record read from an archive.
 * Returns the allowlisted record plus any non-fatal warnings, or null when the
 * record lacks the minimum identity needed to ever match a track.
 */
export function sanitizeBackupTrackRecord(raw: unknown): { record: BackupTrackRecord; warnings: string[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const warnings: string[] = [];

  const id = sanitizeString(src.id, 128);
  const title = sanitizeString(src.title, 500);
  const artist = sanitizeString(src.artist, 500);
  const plexGuid = sanitizeString(src.plex_guid, 300);
  const ratingKey = sanitizeString(src.rating_key, 128);
  const plexId = sanitizeString(src.plex_id, 128);
  const fingerprint = sanitizeString(src.fingerprint, 200);
  const pathHash = sanitizeString(src.path_hash, 128);

  const guids: string[] = [];
  if (Array.isArray(src.plex_guids)) {
    for (const g of src.plex_guids) {
      const s = sanitizeString(g, 300);
      if (s && guids.length < 32) guids.push(s);
    }
  }

  const mediaParts: BackupMediaPartIdentity[] = [];
  if (Array.isArray(src.media_parts)) {
    for (const part of src.media_parts) {
      if (!part || typeof part !== "object" || mediaParts.length >= 64) continue;
      const p = part as Record<string, unknown>;
      const pathHashes = sanitizeStringArray(p.path_hashes, 16)
        .filter((hash) => /^(?:full:|suffix\d+:)?[a-f0-9]{64}$/i.test(hash));
      const partId = sanitizeString(p.part_id, 256);
      const fileSize = sanitizeInt(p.file_size, { min: 0 });
      if (partId || pathHashes.length || fileSize !== null) {
        mediaParts.push({ part_id: partId, path_hashes: pathHashes, file_size: fileSize });
      }
    }
  }
  if (!mediaParts.length && pathHash) {
    mediaParts.push({ part_id: null, path_hashes: [pathHash], file_size: sanitizeInt(src.file_size, { min: 0 }) });
  }

  // Minimum identity: accept any versioned deterministic identity, including a
  // secondary GUID or one of multiple media parts.
  if (!plexGuid && !guids.length && !ratingKey && !plexId && !fingerprint && !pathHash
    && !mediaParts.some((part) => part.part_id || part.path_hashes.length)) {
    return null;
  }

  const record: BackupTrackRecord = {
    id: id || fingerprint || plexGuid || ratingKey || cryptoRandomId(),
    plex_guid: plexGuid,
    plex_guids: guids,
    rating_key: ratingKey,
    plex_id: plexId,
    plex_library_id: sanitizeString(src.plex_library_id, 128),
    library_id: sanitizeString(src.library_id, 128),
    plex_server_id: sanitizeString(src.plex_server_id, 128),
    title,
    artist,
    album: sanitizeString(src.album, 500),
    album_artist: sanitizeString(src.album_artist, 500),
    track_number: sanitizeInt(src.track_number, { min: 0, max: 100000 }),
    disc_number: sanitizeInt(src.disc_number, { min: 0, max: 1000 }),
    duration_ms: sanitizeInt(src.duration_ms, { min: 0, max: 100 * 60 * 60 * 1000 }),
    year: sanitizeInt(src.year, { min: 1000, max: 3000 }),
    file_size: sanitizeInt(src.file_size, { min: 0 }),
    path_hash: pathHash,
    media_parts: mediaParts,
    fingerprint,
    identity_strategy_version: sanitizeInt(src.identity_strategy_version, { min: 1, max: 1000 }) ?? 1,
    audio_feature: sanitizeAudioFeatureRecord(src.audio_feature),
    bpm: sanitizeBpmRecord(src.bpm),
    popularity: sanitizePopularityRecord(src.popularity),
    genres: sanitizeGenreRecord(src.genres),
  };

  if (typeof src.duration === "number" && record.duration_ms === null) {
    record.duration_ms = sanitizeInt(src.duration, { min: 0, max: 100 * 60 * 60 * 1000 });
  }
  if (!title || !artist) warnings.push("missing_title_or_artist");
  return { record, warnings };
}

function cryptoRandomId(): string {
  return "rec_" + createHash("sha256").update(String(Math.random()) + Date.now()).digest("hex").slice(0, 24);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeManifest(manifest: BackupManifest): string {
  return JSON.stringify(manifest, null, 2);
}

export function parseAndValidateManifest(text: string): { manifest: BackupManifest } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupValidationError("Manifest is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new BackupValidationError("Manifest is not an object.");
  const m = parsed as Record<string, unknown>;
  if (m.backup_type !== BACKUP_TYPE) {
    throw new BackupValidationError("This is not a Mixarr Library Intelligence backup. Full database dumps and other archives are not accepted.");
  }
  const schemaVersion = sanitizeInt(m.schema_version, { min: 1, max: 1000 });
  if (schemaVersion === null) throw new BackupValidationError("Manifest schema_version is missing or invalid.");
  const minRestore = sanitizeInt(m.min_restore_schema_version, { min: 1, max: 1000 }) ?? schemaVersion;
  if (minRestore > BACKUP_SCHEMA_VERSION) {
    throw new BackupValidationError(`This backup requires a newer Mixarr (schema ${minRestore}). Current build supports up to schema ${BACKUP_SCHEMA_VERSION}.`);
  }
  const counts = sanitizeCounts(m.counts);
  const legacy = schemaVersion < 2;
  const diagnostics = sanitizeDiagnostics(m.diagnostics, counts.tracks);
  const categoryCounts = sanitizeCategoryCounts(m.category_counts, counts);
  const files = sanitizeFiles(m.files);
  const manifest: BackupManifest = {
    backup_type: BACKUP_TYPE,
    schema_version: schemaVersion,
    analysis_data_version: sanitizeInt(m.analysis_data_version, { min: 0, max: 100000 }) ?? 0,
    mixarr_version: sanitizeString(m.mixarr_version, 64) ?? "unknown",
    min_restore_schema_version: minRestore,
    created_at: sanitizeTimestamp(m.created_at) ?? new Date(0).toISOString(),
    counts,
    source_classifications: sanitizeStringArray(m.source_classifications, 32),
    analysis_engine_versions: sanitizeStringArray(m.analysis_engine_versions, 32),
    library_identifiers: sanitizeStringArray(m.library_identifiers, 64),
    library_hashes: sanitizeStringArray(m.library_hashes, 64),
    source_plex_server_identifier: sanitizeString(m.source_plex_server_identifier, 256),
    source_library_identifier: sanitizeString(m.source_library_identifier, 256),
    library_fingerprint: sanitizeString(m.library_fingerprint, 128),
    total_plex_track_count: sanitizeInt(m.total_plex_track_count, { min: 0 }) ?? counts.tracks,
    total_intelligence_records_exported: sanitizeInt(m.total_intelligence_records_exported, { min: 0 }) ?? counts.tracks,
    category_counts: categoryCounts,
    diagnostics,
    files,
    identity_strategy_version: sanitizeInt(m.identity_strategy_version, { min: 1, max: 1000 }) ?? 1,
    path_normalization_version: sanitizeInt(m.path_normalization_version, { min: 1, max: 1000 }) ?? 1,
    complete: legacy ? false : m.complete === true,
    legacy,
    archive_sha256: sanitizeString(m.archive_sha256, 128),
    notes: sanitizeString(m.notes, LIMITS.maxNotesLength),
  };
  return { manifest };
}

function sanitizeStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    const s = sanitizeString(v, 200);
    if (s && out.length < maxItems) out.push(s);
  }
  return out;
}

export function emptyCounts(): BackupCounts {
  return {
    tracks: 0, audio_features: 0, bpm: 0, popularity: 0, genres: 0,
    completed: 0, incomplete: 0, no_data: 0,
    no_data_popularity: 0, no_data_genres: 0, no_data_bpm: 0,
    source_local: 0, source_api: 0, source_estimated: 0,
    popularity_attempted: 0, genres_attempted: 0, bpm_attempted: 0,
    pending: 0, failed: 0,
  };
}

function sanitizeCounts(value: unknown): BackupCounts {
  const out = emptyCounts();
  if (value && typeof value === "object") {
    for (const key of Object.keys(out) as (keyof BackupCounts)[]) {
      const n = sanitizeInt((value as Record<string, unknown>)[key], { min: 0 });
      if (n !== null) out[key] = n;
    }
  }
  return out;
}

function emptyCategoryCounts(): BackupCategoryCounts {
  return {
    expected: 0, exported: 0, attempted: 0, values: 0, completed: 0,
    incomplete: 0, pending: 0, failed: 0, known_no_data: 0,
  };
}

function sanitizeCategoryCounts(value: unknown, counts: BackupCounts): BackupManifest["category_counts"] {
  const legacyDefaults: BackupManifest["category_counts"] = {
    audio_features: {
      ...emptyCategoryCounts(), expected: counts.tracks, exported: counts.tracks,
      values: counts.audio_features, completed: counts.completed, incomplete: counts.incomplete,
    },
    bpm: {
      ...emptyCategoryCounts(), expected: counts.tracks, exported: counts.tracks,
      attempted: counts.bpm_attempted || counts.bpm + counts.no_data_bpm,
      values: counts.bpm, known_no_data: counts.no_data_bpm,
    },
    popularity: {
      ...emptyCategoryCounts(), expected: counts.tracks, exported: counts.tracks,
      attempted: counts.popularity_attempted || counts.popularity + counts.no_data_popularity,
      values: counts.popularity, known_no_data: counts.no_data_popularity,
    },
    genres: {
      ...emptyCategoryCounts(), expected: counts.tracks, exported: counts.tracks,
      attempted: counts.genres_attempted || counts.genres + counts.no_data_genres,
      values: counts.genres, known_no_data: counts.no_data_genres,
    },
  };
  if (!value || typeof value !== "object") return legacyDefaults;
  const src = value as Record<string, unknown>;
  for (const category of Object.keys(legacyDefaults) as (keyof typeof legacyDefaults)[]) {
    const raw = src[category];
    if (!raw || typeof raw !== "object") continue;
    for (const key of Object.keys(legacyDefaults[category]) as (keyof BackupCategoryCounts)[]) {
      const n = sanitizeInt((raw as Record<string, unknown>)[key], { min: 0 });
      if (n !== null) legacyDefaults[category][key] = n;
    }
  }
  return legacyDefaults;
}

function sanitizeDiagnostics(value: unknown, fallbackRecords: number): BackupDiagnostics {
  const src = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const reasons: Record<string, number> = {};
  if (src.skipped_reason_counts && typeof src.skipped_reason_counts === "object") {
    for (const [rawKey, rawValue] of Object.entries(src.skipped_reason_counts as Record<string, unknown>).slice(0, 128)) {
      const key = sanitizeString(rawKey, 128);
      const count = sanitizeInt(rawValue, { min: 0 });
      if (key && count !== null) reasons[key] = count;
    }
  }
  return {
    eligible_database_records: sanitizeInt(src.eligible_database_records, { min: 0 }) ?? fallbackRecords,
    records_read: sanitizeInt(src.records_read, { min: 0 }) ?? fallbackRecords,
    records_serialized: sanitizeInt(src.records_serialized, { min: 0 }) ?? fallbackRecords,
    records_written: sanitizeInt(src.records_written, { min: 0 }) ?? fallbackRecords,
    records_skipped: sanitizeInt(src.records_skipped, { min: 0 }) ?? 0,
    skipped_reason_counts: reasons,
  };
}

function sanitizeFiles(value: unknown): Record<string, BackupFileManifest> {
  const out: Record<string, BackupFileManifest> = {};
  if (!value || typeof value !== "object") return out;
  for (const [name, raw] of Object.entries(value as Record<string, unknown>).slice(0, LIMITS.maxArchiveEntries)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const sha256 = sanitizeString(entry.sha256, 128);
    const bytes = sanitizeInt(entry.bytes, { min: 0 });
    const records = sanitizeInt(entry.records, { min: 0 });
    if (sha256 && bytes !== null) out[name] = { sha256, bytes, ...(records !== null ? { records } : {}) };
  }
  return out;
}

/** Serialize one track record as a single NDJSON line (no embedded newlines). */
export function serializeTrackRecordLine(record: BackupTrackRecord): string {
  return JSON.stringify(record);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export class BackupValidationError extends Error {
  readonly code = "BACKUP_VALIDATION_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}
