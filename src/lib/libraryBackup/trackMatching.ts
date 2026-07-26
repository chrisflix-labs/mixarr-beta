/**
 * Library Intelligence Backup — conservative deterministic track matching and
 * conflict-policy resolution (v2.4.11). Pure module (no Prisma / no filesystem).
 *
 * Matching is intentionally strict: a restored record is only auto-applied to a
 * single unambiguous track. Anything ambiguous is left for manual resolution.
 */
import { createHash } from "node:crypto";
import type { BackupTrackRecord } from "./archiveFormat";

export type MatchType =
  | "exact_guid"
  | "exact_source_id"
  | "exact_rating_key"
  | "exact_media_part"
  | "path_hash"
  | "metadata_fingerprint"
  | "high_confidence_metadata"
  | "manual"
  | "ambiguous"
  | "unmatched";

/** Order matching is attempted in (most to least authoritative). */
export const MATCH_PRIORITY: MatchType[] = [
  "exact_guid",
  "exact_source_id",
  "exact_rating_key",
  "exact_media_part",
  "path_hash",
  "metadata_fingerprint",
  "high_confidence_metadata",
];

/** Duration tolerance for the high-confidence metadata fallback (milliseconds). */
export const HIGH_CONFIDENCE_DURATION_TOLERANCE_MS = 3000;
/** Duration tolerance when validating a path-hash match (milliseconds). */
export const PATH_HASH_DURATION_TOLERANCE_MS = 5000;
/** Bucket size used inside the metadata fingerprint (milliseconds). */
export const FINGERPRINT_DURATION_BUCKET_MS = 2000;

export type ConflictPolicy = "fill_missing" | "prefer_backup" | "keep_current";
export type BackupCategory = "audio_features" | "bpm" | "popularity" | "genres" | "no_data";
export type CategoryPolicies = Partial<Record<BackupCategory, ConflictPolicy>>;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize free-text metadata for matching: Unicode NFKC, lowercase, strip
 * diacritics, collapse whitespace, and normalize punctuation. Handles case,
 * unicode, whitespace, and punctuation differences without being so loose that
 * different recordings collide (duration is handled separately).
 */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  // Mirrors the codebase's target-agnostic normalization idiom (NFKD + strip
  // combining marks + collapse non-word chars). Handles case, unicode, whitespace,
  // and punctuation differences without unicode-property regex flags.
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/[^\w\s]/g, " ") // any non-word char -> space
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize a media path (lowercase, forward slashes, collapse slashes). */
export function normalizeMediaPath(path: string | null | undefined): string {
  if (!path) return "";
  return path
    .normalize("NFKC")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase()
    .trim();
}

/** Deterministic SHA-256 hash of the normalized media path (never the raw path). */
export function hashNormalizedPath(path: string | null | undefined): string | null {
  const normalized = normalizeMediaPath(path);
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex");
}

function normalizeMediaPathV1(path: string | null | undefined): string {
  if (!path) return "";
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase().trim();
}

/**
 * Versioned path identities. The full v2 and legacy-v1 hashes preserve patch
 * compatibility; suffix hashes tolerate a changed mount/root prefix without
 * ever serializing the raw path.
 */
export function hashNormalizedPathCandidates(path: string | null | undefined): string[] {
  const normalized = normalizeMediaPath(path);
  if (!normalized) return [];
  const values = new Set<string>();
  values.add(createHash("sha256").update(normalized).digest("hex"));
  const legacy = normalizeMediaPathV1(path);
  if (legacy) values.add(createHash("sha256").update(legacy).digest("hex"));
  const segments = normalized.split("/").filter(Boolean);
  for (const count of [2, 3, 4]) {
    if (segments.length < count) continue;
    const suffix = segments.slice(-count).join("/");
    values.add(`suffix${count}:` + createHash("sha256").update(suffix).digest("hex"));
  }
  return Array.from(values);
}

/** Round a duration to the fingerprint bucket; null-safe. */
export function bucketDuration(durationMs: number | null | undefined): number | null {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs)) return null;
  if (durationMs < 0) return null;
  return Math.round(durationMs / FINGERPRINT_DURATION_BUCKET_MS);
}

/**
 * Deterministic metadata fingerprint. Encodes artist, album, title, disc, track
 * number, and a bucketed duration so different-length recordings (live, remaster,
 * re-release) produce different fingerprints. For matching only — not a
 * cryptographic media fingerprint.
 */
export function computeFingerprint(input: {
  artist?: string | null;
  album?: string | null;
  title?: string | null;
  discNumber?: number | null;
  trackNumber?: number | null;
  durationMs?: number | null;
}): string {
  const parts = [
    normalizeText(input.artist),
    normalizeText(input.album),
    normalizeText(input.title),
    input.discNumber ?? "",
    input.trackNumber ?? "",
    bucketDuration(input.durationMs) ?? "",
  ].join("|");
  return "fp1:" + createHash("sha256").update(parts).digest("hex").slice(0, 32);
}

/** Loose metadata key (artist + title + album) used only for the strict fallback. */
export function computeMetadataKey(input: {
  artist?: string | null;
  album?: string | null;
  title?: string | null;
}): string {
  return [normalizeText(input.artist), normalizeText(input.title), normalizeText(input.album)].join("|");
}

export function durationsCompatible(a: number | null | undefined, b: number | null | undefined, toleranceMs: number): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= toleranceMs;
}

// ---------------------------------------------------------------------------
// Match resolution
// ---------------------------------------------------------------------------

/** Lookup indexes over the target (current) library, all keyed by string. */
export type MatchIndexes = {
  byGuid: Map<string, string[]>;
  bySourceId: Map<string, string[]>;
  byRatingKey: Map<string, string[]>;
  byScopedSourceId: Map<string, string[]>;
  byScopedRatingKey: Map<string, string[]>;
  byScopedMediaPart: Map<string, string[]>;
  byPathHash: Map<string, string[]>;
  byFingerprint: Map<string, string[]>;
  byMetadataKey: Map<string, string[]>;
  durationByTrackId: Map<string, number | null>;
};

export function createEmptyIndexes(): MatchIndexes {
  return {
    byGuid: new Map(),
    bySourceId: new Map(),
    byRatingKey: new Map(),
    byScopedSourceId: new Map(),
    byScopedRatingKey: new Map(),
    byScopedMediaPart: new Map(),
    byPathHash: new Map(),
    byFingerprint: new Map(),
    byMetadataKey: new Map(),
    durationByTrackId: new Map(),
  };
}

export type MatchResult = {
  matchType: MatchType;
  trackId: string | null;
  candidates: string[];
  confidence: number;
};

function addToIndex(index: Map<string, string[]>, key: string | null | undefined, trackId: string) {
  if (!key) return;
  const existing = index.get(key);
  if (existing) {
    if (!existing.includes(trackId)) existing.push(trackId);
  } else {
    index.set(key, [trackId]);
  }
}

/** Register one current-library track's identity keys into the indexes. */
export function indexTargetTrack(
  indexes: MatchIndexes,
  track: {
    id: string;
    plexGuid?: string | null;
    plexGuids?: string[] | null;
    plexId?: string | null;
    ratingKey?: string | null;
    plexServerId?: string | null;
    plexLibraryId?: string | null;
    mediaPartIds?: string[] | null;
    pathHash?: string | null;
    pathHashes?: string[] | null;
    fingerprint?: string | null;
    metadataKey?: string | null;
    durationMs?: number | null;
  },
) {
  addToIndex(indexes.byGuid, track.plexGuid, track.id);
  if (Array.isArray(track.plexGuids)) {
    for (const g of track.plexGuids) addToIndex(indexes.byGuid, g, track.id);
  }
  addToIndex(indexes.bySourceId, track.plexId, track.id);
  addToIndex(indexes.byRatingKey, track.ratingKey, track.id);
  addToIndex(indexes.byScopedSourceId, scopedIdentityKey(track.plexServerId, track.plexLibraryId, track.plexId), track.id);
  addToIndex(indexes.byScopedRatingKey, scopedIdentityKey(track.plexServerId, track.plexLibraryId, track.ratingKey), track.id);
  for (const partId of track.mediaPartIds ?? []) {
    addToIndex(indexes.byScopedMediaPart, scopedIdentityKey(track.plexServerId, track.plexLibraryId, partId), track.id);
  }
  addToIndex(indexes.byPathHash, track.pathHash, track.id);
  for (const hash of track.pathHashes ?? []) addToIndex(indexes.byPathHash, hash, track.id);
  addToIndex(indexes.byFingerprint, track.fingerprint, track.id);
  addToIndex(indexes.byMetadataKey, track.metadataKey, track.id);
  indexes.durationByTrackId.set(track.id, track.durationMs ?? null);
}

/**
 * Resolve the single best match for a backup record against the indexes.
 * Returns `unmatched` when nothing hits, and `ambiguous` (with candidates) when
 * a tier matches more than one track — never silently picks the first result.
 */
export function resolveMatch(record: BackupTrackRecord, indexes: MatchIndexes): MatchResult {
  const recordFingerprint = record.fingerprint
    || computeFingerprint({
      artist: record.artist,
      album: record.album,
      title: record.title,
      discNumber: record.disc_number,
      trackNumber: record.track_number,
      durationMs: record.duration_ms,
    });
  const recordDuration = record.duration_ms;

  let ambiguousCandidates: string[] = [];

  // 1. Exact Plex GUID. A non-unique GUID is evidence, not a terminal result:
  // different copies/editions commonly share a Plex GUID.
  const guidHits = uniqueHits(indexes.byGuid, record.plex_guid);
  if (record.plex_guids.length) {
    for (const g of record.plex_guids) guidHits.push(...uniqueHits(indexes.byGuid, g));
  }
  const guidUnique = unique(guidHits);
  if (guidUnique.length === 1) return { matchType: "exact_guid", trackId: guidUnique[0], candidates: guidUnique, confidence: 1 };
  if (guidUnique.length > 1) ambiguousCandidates = guidUnique;

  // 2. Exact stable source identifier, scoped to server + library.
  const scopedSourceKey = scopedIdentityKey(record.plex_server_id, record.plex_library_id, record.plex_id);
  const sourceHits = unique(scopedSourceKey
    ? uniqueHits(indexes.byScopedSourceId, scopedSourceKey)
    : uniqueHits(indexes.bySourceId, record.plex_id));
  if (sourceHits.length === 1) return { matchType: "exact_source_id", trackId: sourceHits[0], candidates: sourceHits, confidence: 1 };
  if (sourceHits.length > 1 && !ambiguousCandidates.length) ambiguousCandidates = sourceHits;

  // 3. Rating key is mutable and therefore only authoritative when scoped.
  const scopedRatingKey = scopedIdentityKey(record.plex_server_id, record.plex_library_id, record.rating_key);
  const ratingHits = unique(scopedRatingKey
    ? uniqueHits(indexes.byScopedRatingKey, scopedRatingKey)
    : uniqueHits(indexes.byRatingKey, record.rating_key));
  if (ratingHits.length === 1) return { matchType: "exact_rating_key", trackId: ratingHits[0], candidates: ratingHits, confidence: 1 };
  if (ratingHits.length > 1 && !ambiguousCandidates.length) ambiguousCandidates = ratingHits;

  // 4. Scoped media-part identity (supports multiple parts in schema v2).
  const partHits = unique(record.media_parts.flatMap((part) =>
    uniqueHits(indexes.byScopedMediaPart, scopedIdentityKey(record.plex_server_id, record.plex_library_id, part.part_id)),
  ));
  if (partHits.length === 1) return { matchType: "exact_media_part", trackId: partHits[0], candidates: partHits, confidence: 0.99 };
  if (partHits.length > 1 && !ambiguousCandidates.length) ambiguousCandidates = partHits;

  // 5. Versioned normalized path hashes + compatible duration.
  const recordPathHashes = unique([
    ...(record.path_hash ? [record.path_hash] : []),
    ...record.media_parts.flatMap((part) => part.path_hashes),
  ]);
  const pathHits = unique(recordPathHashes.flatMap((hash) => uniqueHits(indexes.byPathHash, hash)));
  const pathCompatible = pathHits.filter((id) =>
    durationsCompatible(recordDuration, indexes.durationByTrackId.get(id) ?? null, PATH_HASH_DURATION_TOLERANCE_MS)
    || indexes.durationByTrackId.get(id) === null
    || recordDuration === null,
  );
  if (pathCompatible.length === 1) return { matchType: "path_hash", trackId: pathCompatible[0], candidates: pathHits, confidence: 0.95 };
  if (pathHits.length > 1 && !ambiguousCandidates.length) ambiguousCandidates = pathHits;

  // 6. Metadata fingerprint (already encodes bucketed duration).
  const fpHits = unique(uniqueHits(indexes.byFingerprint, recordFingerprint));
  if (fpHits.length === 1) return { matchType: "metadata_fingerprint", trackId: fpHits[0], candidates: fpHits, confidence: 0.9 };
  if (fpHits.length > 1 && !ambiguousCandidates.length) ambiguousCandidates = fpHits;

  // 7. High-confidence metadata fallback: unique artist/title/album AND strict duration.
  const metaKey = computeMetadataKey({ artist: record.artist, album: record.album, title: record.title });
  const metaHits = unique(uniqueHits(indexes.byMetadataKey, metaKey));
  const strict = metaHits.filter((id) =>
    durationsCompatible(recordDuration, indexes.durationByTrackId.get(id) ?? null, HIGH_CONFIDENCE_DURATION_TOLERANCE_MS),
  );
  if (strict.length === 1) return { matchType: "high_confidence_metadata", trackId: strict[0], candidates: metaHits, confidence: 0.8 };
  if ((metaHits.length > 1 || strict.length > 1) && !ambiguousCandidates.length) ambiguousCandidates = metaHits;

  if (ambiguousCandidates.length) {
    return { matchType: "ambiguous", trackId: null, candidates: ambiguousCandidates, confidence: 0 };
  }
  return { matchType: "unmatched", trackId: null, candidates: [], confidence: 0 };
}

function scopedIdentityKey(serverId: string | null | undefined, libraryId: string | null | undefined, value: string | null | undefined): string | null {
  if (!serverId || !libraryId || !value) return null;
  return `${serverId}\u0000${libraryId}\u0000${value}`;
}

function uniqueHits(index: Map<string, string[]>, key: string | null | undefined): string[] {
  if (!key) return [];
  return index.get(key) ? [...(index.get(key) as string[])] : [];
}
function unique(list: string[]): string[] {
  return Array.from(new Set(list));
}

export function isAutoApplicableMatch(matchType: MatchType): boolean {
  return matchType !== "ambiguous" && matchType !== "unmatched" && matchType !== "manual";
}

// ---------------------------------------------------------------------------
// Conflict policy
// ---------------------------------------------------------------------------

/**
 * Decide whether a category's backup value should be written, given whether the
 * current DB already has a value and the effective policy.
 *
 * - fill_missing: write only when current is empty (preserve current values).
 * - prefer_backup: write regardless (overwrite current with backup).
 * - keep_current: write only when current is empty (skip categories with data).
 *
 * fill_missing and keep_current behave the same at the per-value level; they
 * differ in how the UI presents intent and how whole categories are gated.
 */
export function resolveConflictAction(hasCurrentValue: boolean, policy: ConflictPolicy): "apply" | "skip" {
  if (policy === "prefer_backup") return "apply";
  return hasCurrentValue ? "skip" : "apply";
}

export function effectivePolicyForCategory(
  category: BackupCategory,
  globalPolicy: ConflictPolicy,
  categoryPolicies?: CategoryPolicies,
): ConflictPolicy {
  return categoryPolicies?.[category] ?? globalPolicy;
}
