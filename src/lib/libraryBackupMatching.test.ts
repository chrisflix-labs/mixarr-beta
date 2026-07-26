import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeText,
  normalizeMediaPath,
  hashNormalizedPath,
  hashNormalizedPathCandidates,
  computeFingerprint,
  bucketDuration,
  durationsCompatible,
  resolveMatch,
  createEmptyIndexes,
  indexTargetTrack,
  isAutoApplicableMatch,
  resolveConflictAction,
  effectivePolicyForCategory,
  type MatchIndexes,
} from "./libraryBackup/trackMatching";
import { sanitizeBackupTrackRecord, type BackupTrackRecord } from "./libraryBackup/archiveFormat";

function rec(overrides: Partial<BackupTrackRecord>): BackupTrackRecord {
  const base = sanitizeBackupTrackRecord({
    id: "b1", plex_guid: null, rating_key: null, plex_id: null, fingerprint: "fp-seed",
    title: "Song", artist: "Artist", album: "Album", duration_ms: 200000, track_number: 3, disc_number: 1,
  })!.record;
  return { ...base, ...overrides };
}

function indexOf(track: Parameters<typeof indexTargetTrack>[1]): MatchIndexes {
  const idx = createEmptyIndexes();
  indexTargetTrack(idx, track);
  return idx;
}

describe("normalization", () => {
  it("normalizes case, unicode, punctuation, and whitespace", () => {
    assert.equal(normalizeText("Björk – Jóga  (Remaster)"), normalizeText("bjork joga remaster"));
    assert.equal(normalizeText("AC/DC"), "ac dc");
    assert.equal(normalizeText("  Hello,   World! "), "hello world");
    assert.equal(normalizeText(null), "");
  });

  it("normalizes and hashes media paths deterministically without the raw path", () => {
    assert.equal(normalizeMediaPath("C:\\Music\\A\\B.flac"), "c:/music/a/b.flac");
    const h1 = hashNormalizedPath("/music/a/b.flac");
    const h2 = hashNormalizedPath("/MUSIC//a/b.flac");
    assert.equal(h1, h2);
    assert.equal(h1!.length, 64);
    assert.notEqual(h1, "/music/a/b.flac");
  });

  it("matches changed mount prefixes, slash direction, case, and Unicode normalization", () => {
    const source = hashNormalizedPathCandidates("D:\\MÃºsica\\Björk\\Debut\\01 Song.flac");
    const target = hashNormalizedPathCandidates("/mnt/media/MÃºsica/BJÖRK/Debut/01 Song.flac");
    assert.ok(source.some((hash) => target.includes(hash)), "portable suffix identity should survive a root-prefix change");
  });
});

describe("fingerprint", () => {
  it("is deterministic and duration-bucketed", () => {
    const a = computeFingerprint({ artist: "Artist", album: "Album", title: "Song", discNumber: 1, trackNumber: 3, durationMs: 200000 });
    const b = computeFingerprint({ artist: "artist", album: "album", title: "song", discNumber: 1, trackNumber: 3, durationMs: 200900 });
    assert.equal(a, b, "small duration differences within a bucket collide");
  });

  it("distinguishes different-length recordings (live vs studio)", () => {
    const studio = computeFingerprint({ artist: "A", album: "Al", title: "T", durationMs: 200000 });
    const live = computeFingerprint({ artist: "A", album: "Al", title: "T", durationMs: 260000 });
    assert.notEqual(studio, live);
  });

  it("buckets durations and checks tolerance", () => {
    assert.equal(bucketDuration(200000), bucketDuration(200500));
    assert.equal(bucketDuration(-1), null);
    assert.equal(durationsCompatible(200000, 202000, 3000), true);
    assert.equal(durationsCompatible(200000, 210000, 3000), false);
    assert.equal(durationsCompatible(null, 200000, 3000), false);
  });
});

describe("resolveMatch priority", () => {
  it("prefers an exact GUID match", () => {
    const idx = indexOf({ id: "T1", plexGuid: "plex://track/x", durationMs: 200000 });
    const m = resolveMatch(rec({ plex_guid: "plex://track/x" }), idx);
    assert.equal(m.matchType, "exact_guid");
    assert.equal(m.trackId, "T1");
  });

  it("falls back to source id, then rating key", () => {
    const srcIdx = indexOf({ id: "T2", plexId: "p9", durationMs: 200000 });
    assert.equal(resolveMatch(rec({ plex_id: "p9" }), srcIdx).matchType, "exact_source_id");
    const rkIdx = indexOf({ id: "T3", ratingKey: "rk9", durationMs: 200000 });
    assert.equal(resolveMatch(rec({ rating_key: "rk9" }), rkIdx).matchType, "exact_rating_key");
  });

  it("matches by path hash with compatible duration", () => {
    const ph = hashNormalizedPath("/m/a.flac");
    const idx = indexOf({ id: "T4", pathHash: ph, durationMs: 200000 });
    const m = resolveMatch(rec({ path_hash: ph, duration_ms: 201000 }), idx);
    assert.equal(m.matchType, "path_hash");
  });

  it("matches by metadata fingerprint", () => {
    const fp = computeFingerprint({ artist: "Artist", album: "Album", title: "Song", discNumber: 1, trackNumber: 3, durationMs: 200000 });
    const idx = indexOf({ id: "T5", fingerprint: fp, durationMs: 200000 });
    const m = resolveMatch(rec({ fingerprint: fp }), idx);
    assert.equal(m.matchType, "metadata_fingerprint");
    assert.equal(m.trackId, "T5");
  });

  it("uses the high-confidence metadata fallback only with strict duration", () => {
    const idx = createEmptyIndexes();
    indexTargetTrack(idx, { id: "T6", metadataKey: "artist|song|album", durationMs: 200000 });
    const near = resolveMatch(rec({ fingerprint: "nope", plex_guid: null, plex_id: null, rating_key: null, path_hash: null, duration_ms: 201000 }), idx);
    assert.equal(near.matchType, "high_confidence_metadata");
    const far = resolveMatch(rec({ fingerprint: "nope", plex_guid: null, plex_id: null, rating_key: null, path_hash: null, duration_ms: 230000 }), idx);
    assert.equal(far.matchType, "unmatched");
  });

  it("never auto-applies an ambiguous match", () => {
    const idx = createEmptyIndexes();
    indexTargetTrack(idx, { id: "A", plexGuid: "plex://dup", durationMs: 200000 });
    indexTargetTrack(idx, { id: "B", plexGuid: "plex://dup", durationMs: 200000 });
    const m = resolveMatch(rec({ plex_guid: "plex://dup" }), idx);
    assert.equal(m.matchType, "ambiguous");
    assert.equal(m.trackId, null);
    assert.equal(m.candidates.length, 2);
    assert.equal(isAutoApplicableMatch(m.matchType), false);
  });

  it("uses scoped rating keys to disambiguate tracks sharing one Plex GUID", () => {
    const idx = createEmptyIndexes();
    indexTargetTrack(idx, {
      id: "A", plexGuid: "plex://track/shared", ratingKey: "101",
      plexServerId: "server-A", plexLibraryId: "7", durationMs: 200000,
    });
    indexTargetTrack(idx, {
      id: "B", plexGuid: "plex://track/shared", ratingKey: "102",
      plexServerId: "server-A", plexLibraryId: "7", durationMs: 200000,
    });
    const match = resolveMatch(rec({
      plex_guid: "plex://track/shared", rating_key: "102",
      plex_server_id: "server-A", plex_library_id: "7",
    }), idx);
    assert.equal(match.matchType, "exact_rating_key");
    assert.equal(match.trackId, "B");
  });

  it("matches any one of multiple scoped media parts without selecting an ambiguity", () => {
    const idx = createEmptyIndexes();
    indexTargetTrack(idx, {
      id: "multi", plexServerId: "server-A", plexLibraryId: "7",
      mediaPartIds: ["part-1", "part-2"], durationMs: 200000,
    });
    const match = resolveMatch(rec({
      plex_server_id: "server-A",
      plex_library_id: "7",
      media_parts: [{ part_id: "part-2", path_hashes: [], file_size: null }],
    }), idx);
    assert.equal(match.matchType, "exact_media_part");
    assert.equal(match.trackId, "multi");
  });

  it("keeps duplicate path hashes ambiguous", () => {
    const idx = createEmptyIndexes();
    const pathHash = hashNormalizedPath("/music/shared.flac");
    indexTargetTrack(idx, { id: "A", pathHash, durationMs: 200000 });
    indexTargetTrack(idx, { id: "B", pathHash, durationMs: 200000 });
    const match = resolveMatch(rec({ path_hash: pathHash, duration_ms: 200000, fingerprint: "absent" }), idx);
    assert.equal(match.matchType, "ambiguous");
  });

  it("returns unmatched when nothing hits", () => {
    const idx = createEmptyIndexes();
    const m = resolveMatch(rec({ plex_guid: null, plex_id: null, rating_key: null, path_hash: null, fingerprint: "absent", title: "X", artist: "Y", album: "Z" }), idx);
    assert.equal(m.matchType, "unmatched");
  });
});

describe("conflict policies", () => {
  it("fill_missing writes only when empty", () => {
    assert.equal(resolveConflictAction(false, "fill_missing"), "apply");
    assert.equal(resolveConflictAction(true, "fill_missing"), "skip");
  });

  it("prefer_backup always overwrites", () => {
    assert.equal(resolveConflictAction(true, "prefer_backup"), "apply");
    assert.equal(resolveConflictAction(false, "prefer_backup"), "apply");
  });

  it("keep_current only fills genuinely empty values", () => {
    assert.equal(resolveConflictAction(true, "keep_current"), "skip");
    assert.equal(resolveConflictAction(false, "keep_current"), "apply");
  });

  it("category policies override the global policy", () => {
    assert.equal(effectivePolicyForCategory("bpm", "fill_missing", { bpm: "prefer_backup" }), "prefer_backup");
    assert.equal(effectivePolicyForCategory("genres", "fill_missing", { bpm: "prefer_backup" }), "fill_missing");
    assert.equal(effectivePolicyForCategory("popularity", "keep_current", undefined), "keep_current");
  });
});
