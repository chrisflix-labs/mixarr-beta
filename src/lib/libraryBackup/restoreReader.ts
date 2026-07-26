/**
 * Reads and validates an untrusted Library Intelligence backup archive.
 *
 * Every step runs before any database write: structure, entry allowlist,
 * checksums, manifest schema/version, then strict per-record sanitization with
 * bounded record counts and line sizes. Nothing from the archive is ever
 * executed and no external service is contacted.
 */
import {
  BackupValidationError,
  LIMITS,
  ARCHIVE_ENTRY,
  parseAndValidateManifest,
  sanitizeBackupTrackRecord,
  sha256Hex,
  type BackupManifest,
  type BackupTrackRecord,
} from "./archiveFormat";
import { KNOWN_ARCHIVE_ENTRY_NAMES, readNamedEntry, readZipDirectory, type ZipDirectoryEntry } from "./zipArchive";

export type ValidatedArchive = {
  manifest: BackupManifest;
  tracksBuffer: Buffer;
  entries: ZipDirectoryEntry[];
  compatibility: CompatibilityClass;
};

export type CompatibilityClass =
  | "compatible"
  | "compatible_older"
  | "requires_migration"
  | "unsupported"
  | "unknown";

export function classifyCompatibility(manifest: BackupManifest, currentSchema: number, currentDataVersion: number): CompatibilityClass {
  if (manifest.schema_version > currentSchema) return "unsupported";
  if (manifest.min_restore_schema_version > currentSchema) return "unsupported";
  if (manifest.analysis_data_version === 0) return "unknown";
  if (manifest.analysis_data_version === currentDataVersion) return "compatible";
  if (manifest.analysis_data_version < currentDataVersion) return "compatible_older";
  return "requires_migration";
}

/** Validate the archive structure, entries, checksums, and manifest. No DB writes. */
export function validateArchive(buffer: Buffer, currentSchema: number, currentDataVersion: number): ValidatedArchive {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new BackupValidationError("Uploaded file is empty.");
  }
  const entries = readZipDirectory(buffer);

  // Only the known entries are allowed — reject unexpected/hostile files.
  for (const entry of entries) {
    if (!KNOWN_ARCHIVE_ENTRY_NAMES.has(entry.name)) {
      throw new BackupValidationError(`Backup archive contains an unexpected entry: ${entry.name}`);
    }
  }
  const names = new Set(entries.map((e) => e.name));
  for (const required of [ARCHIVE_ENTRY.manifest, ARCHIVE_ENTRY.tracks, ARCHIVE_ENTRY.checksums]) {
    if (!names.has(required)) throw new BackupValidationError(`Backup archive is missing ${required}.`);
  }
  if (entries.length !== new Set(entries.map((e) => e.name)).size) {
    throw new BackupValidationError("Backup archive contains duplicate entries.");
  }

  const manifestBuf = readNamedEntry(buffer, entries, ARCHIVE_ENTRY.manifest);
  const tracksBuf = readNamedEntry(buffer, entries, ARCHIVE_ENTRY.tracks);
  const checksumsBuf = readNamedEntry(buffer, entries, ARCHIVE_ENTRY.checksums);
  if (!manifestBuf || !tracksBuf || !checksumsBuf) {
    throw new BackupValidationError("Backup archive is missing a required entry.");
  }

  // Verify checksums before trusting any content.
  let checksums: unknown;
  try {
    checksums = JSON.parse(checksumsBuf.toString("utf8"));
  } catch {
    throw new BackupValidationError("Backup checksums file is not valid JSON.");
  }
  const declared = (checksums as { entries?: Record<string, unknown> })?.entries;
  if (!declared || typeof declared !== "object") {
    throw new BackupValidationError("Backup checksums are missing.");
  }
  const declaredTracks = declared[ARCHIVE_ENTRY.tracks];
  const declaredManifest = declared[ARCHIVE_ENTRY.manifest];
  if (typeof declaredTracks !== "string" || sha256Hex(tracksBuf) !== declaredTracks) {
    throw new BackupValidationError("Backup track data failed checksum verification (corrupt or tampered).");
  }
  if (typeof declaredManifest === "string" && sha256Hex(manifestBuf) !== declaredManifest) {
    throw new BackupValidationError("Backup manifest failed checksum verification (corrupt or tampered).");
  }

  const { manifest } = parseAndValidateManifest(manifestBuf.toString("utf8"));
  if (manifest.schema_version >= 2) {
    const trackFile = manifest.files[ARCHIVE_ENTRY.tracks];
    if (!trackFile || trackFile.sha256 !== sha256Hex(tracksBuf) || trackFile.bytes !== tracksBuf.length) {
      throw new BackupValidationError("Backup manifest track-file metadata does not match the archive.");
    }
    if (manifest.diagnostics.records_written !== manifest.total_intelligence_records_exported) {
      throw new BackupValidationError("Backup manifest contains inconsistent written-record totals.");
    }
  }
  const compatibility = classifyCompatibility(manifest, currentSchema, currentDataVersion);
  if (compatibility === "unsupported") {
    throw new BackupValidationError("This backup was created by a newer Mixarr and cannot be restored by this build.");
  }

  return { manifest, tracksBuffer: tracksBuf, entries, compatibility };
}

export type ParsedRecords = {
  records: BackupTrackRecord[];
  parsedLineCount: number;
  invalidCount: number;
  duplicateCount: number;
  warnings: string[];
  reasonCounts: Record<string, number>;
};

/**
 * Parse and sanitize all track records. Enforces max record count, max line
 * size, drops structurally invalid records, and de-duplicates by identity.
 */
export function parseTrackRecords(tracksBuffer: Buffer, schemaVersion = 1): ParsedRecords {
  const records: BackupTrackRecord[] = [];
  const warnings = new Set<string>();
  const reasonCounts: Record<string, number> = {};
  let invalidCount = 0;
  let duplicateCount = 0;
  const seen = new Set<string>();

  const text = tracksBuffer.toString("utf8");
  let lineStart = 0;
  let count = 0;
  for (let i = 0; i <= text.length; i++) {
    const isEnd = i === text.length;
    if (!isEnd && text[i] !== "\n") continue;
    const line = text.slice(lineStart, i).trim();
    lineStart = i + 1;
    if (!line) continue;

    if (Buffer.byteLength(line, "utf8") > LIMITS.maxRecordBytes) {
      invalidCount += 1;
      warnings.add("oversized_record_skipped");
      reasonCounts.oversized_record = (reasonCounts.oversized_record ?? 0) + 1;
      continue;
    }
    count += 1;
    if (count > LIMITS.maxRecords) {
      throw new BackupValidationError("Backup contains more records than the maximum allowed.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      invalidCount += 1;
      warnings.add("malformed_record_skipped");
      reasonCounts.malformed_json = (reasonCounts.malformed_json ?? 0) + 1;
      continue;
    }
    const migrated = schemaVersion === 1 ? migrateLegacyV1Record(parsed) : parsed;
    const sanitized = sanitizeBackupTrackRecord(migrated);
    if (!sanitized) {
      invalidCount += 1;
      warnings.add("record_without_identity_skipped");
      reasonCounts.missing_identity = (reasonCounts.missing_identity ?? 0) + 1;
      continue;
    }
    for (const w of sanitized.warnings) warnings.add(w);

    // A Plex GUID identifies a recording, not a unique library track. v2.4.15
    // incorrectly deduplicated on GUID and lost every additional copy/edition.
    // The archive record id is unique within the source DB and is safe to use
    // only for detecting a literally repeated archive record. Some early or
    // hand-built legacy archives omitted it; hash that complete serialized
    // line instead of falling back to a shared Plex GUID.
    const explicitRecordId =
      migrated && typeof migrated === "object" && typeof (migrated as Record<string, unknown>).id === "string"
        ? String((migrated as Record<string, unknown>).id).trim()
        : "";
    const dedupeKey = explicitRecordId
      ? [
          sanitized.record.plex_server_id ?? "",
          sanitized.record.plex_library_id ?? sanitized.record.library_id ?? "",
          explicitRecordId,
        ].join("\u0000")
      : `legacy-line:${sha256Hex(line)}`;
    if (seen.has(dedupeKey)) {
      duplicateCount += 1;
      reasonCounts.repeated_archive_record = (reasonCounts.repeated_archive_record ?? 0) + 1;
      continue;
    }
    seen.add(dedupeKey);
    records.push(sanitized.record);
  }

  if (schemaVersion === 1) warnings.add("legacy_schema_v1_migrated");
  return { records, parsedLineCount: count, invalidCount, duplicateCount, warnings: Array.from(warnings), reasonCounts };
}

/** Explicit adapter for v2.4.11-v2.4.20/schema-v1 artifacts, including field aliases. */
export function migrateLegacyV1Record(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const src = raw as Record<string, unknown>;
  const value = (snake: string, ...aliases: string[]) => {
    if (snake in src) return src[snake];
    for (const alias of aliases) if (alias in src) return src[alias];
    return undefined;
  };
  return {
    ...src,
    id: value("id", "track_id", "trackId"),
    plex_guid: value("plex_guid", "plexGuid", "guid"),
    plex_guids: value("plex_guids", "plexGuids", "guids"),
    rating_key: value("rating_key", "ratingKey"),
    plex_id: value("plex_id", "plexId"),
    plex_library_id: value("plex_library_id", "plexLibraryId"),
    library_id: value("library_id", "libraryId"),
    plex_server_id: value("plex_server_id", "plexServerId"),
    track_number: value("track_number", "trackIndex", "trackNumber"),
    disc_number: value("disc_number", "discNumber"),
    duration_ms: value("duration_ms", "durationMs", "duration"),
    file_size: value("file_size", "fileSize"),
    path_hash: value("path_hash", "pathHash"),
    fingerprint: value("fingerprint", "metadataFingerprint"),
    audio_feature: value("audio_feature", "audioFeature", "audio_features"),
    bpm: value("bpm", "tempo"),
    popularity: value("popularity", "popularityData"),
    genres: value("genres", "genreData"),
    identity_strategy_version: 1,
  };
}
