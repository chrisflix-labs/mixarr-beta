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
  const compatibility = classifyCompatibility(manifest, currentSchema, currentDataVersion);
  if (compatibility === "unsupported") {
    throw new BackupValidationError("This backup was created by a newer Mixarr and cannot be restored by this build.");
  }

  return { manifest, tracksBuffer: tracksBuf, entries, compatibility };
}

export type ParsedRecords = {
  records: BackupTrackRecord[];
  invalidCount: number;
  duplicateCount: number;
  warnings: string[];
};

/**
 * Parse and sanitize all track records. Enforces max record count, max line
 * size, drops structurally invalid records, and de-duplicates by identity.
 */
export function parseTrackRecords(tracksBuffer: Buffer): ParsedRecords {
  const records: BackupTrackRecord[] = [];
  const warnings = new Set<string>();
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
      continue;
    }
    const sanitized = sanitizeBackupTrackRecord(parsed);
    if (!sanitized) {
      invalidCount += 1;
      warnings.add("record_without_identity_skipped");
      continue;
    }
    for (const w of sanitized.warnings) warnings.add(w);

    const dedupeKey = sanitized.record.plex_guid || sanitized.record.rating_key || sanitized.record.plex_id
      || sanitized.record.fingerprint || sanitized.record.id;
    if (seen.has(dedupeKey)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(dedupeKey);
    records.push(sanitized.record);
  }

  return { records, invalidCount, duplicateCount, warnings: Array.from(warnings) };
}
