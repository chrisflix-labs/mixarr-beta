import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { analyzePlaylistHealth } from "./playlistHealth/core";
import { DEFAULT_PLAYLIST_HEALTH_THRESHOLDS } from "./playlistHealth/types";

const now = new Date("2026-07-18T12:00:00.000Z");
const baseTrack = (index: number, overrides: Record<string, unknown> = {}) => ({
  id: `row-${index}`, trackId: `track-${index}`, ratingKey: `rating-${index}`, title: `Track ${index}`,
  artistId: `artist-${index}`, artist: `Artist ${index}`, albumId: `album-${index}`, album: `Album ${index}`,
  bpm: 100 + index * 3, mood: .45 + index * .02, energy: .5, metadataConfidence: .9,
  syncStatus: "active", localFileStatus: "available", present: true, position: index, ...overrides,
});
const input = (tracks: any[], overrides: Record<string, any> = {}) => ({
  playlist: { id: "playlist-1", name: "Late Night Drive", plexPlaylistRatingKey: "123", serverId: "server-1", expectedTrackCount: tracks.length, lastChangedAt: now, ...(overrides.playlist || {}) },
  tracks, thresholds: { ...DEFAULT_PLAYLIST_HEALTH_THRESHOLDS, ...(overrides.thresholds || {}) }, now, ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !["playlist", "thresholds"].includes(key))),
});

describe("Playlist Health scoring", () => {
  it("keeps a diverse, available, recently changed playlist healthy", () => {
    const result = analyzePlaylistHealth(input(Array.from({ length: 8 }, (_, index) => baseTrack(index))));
    assert.equal(result.overallScore, 100); assert.equal(result.status, "EXCELLENT"); assert.deepEqual(result.checks, []);
  });

  it("detects broken Plex state, missing tracks, unavailable media, and repetition independently", () => {
    const tracks = [baseTrack(0), baseTrack(1, { trackId: null, present: false }), baseTrack(2, { syncStatus: "missing" }), baseTrack(3, { trackId: "track-0" })];
    const result = analyzePlaylistHealth(input(tracks, { playlist: { plexPlaylistRatingKey: null, serverId: null, expectedTrackCount: 99 } }));
    const types = result.checks.map((item) => item.type);
    for (const type of ["BROKEN_PLEX_PLAYLIST", "MISSING_TRACKS", "UNAVAILABLE_MEDIA", "TRACK_REPETITION"]) assert.ok(types.includes(type as any), `missing ${type}`);
    assert.equal(result.metrics.missingTracks, 1); assert.equal(result.metrics.unavailableTracks, 1); assert.equal(result.metrics.duplicateOccurrences, 1);
  });

  it("warns when one artist and album dominate", () => {
    const tracks = Array.from({ length: 10 }, (_, index) => baseTrack(index, index < 5 ? { artistId: "dominant", artist: "Dominant", albumId: "same", album: "Same" } : {}));
    const result = analyzePlaylistHealth(input(tracks));
    assert.ok(result.checks.some((item) => item.type === "ARTIST_CONCENTRATION"));
    assert.ok(result.checks.some((item) => item.type === "ALBUM_CONCENTRATION"));
  });

  it("finds metadata decline, identity drift, BPM jumps, mood conflicts, staleness, and automation failures", () => {
    const tracks = [baseTrack(0, { bpm: 70, mood: .1, energy: .1, metadataConfidence: .55 }), baseTrack(1, { bpm: 150, mood: .9, energy: .1, metadataConfidence: .55 }), baseTrack(2, { bpm: 75, mood: .1, energy: .1, metadataConfidence: .55 })];
    const result = analyzePlaylistHealth(input(tracks, {
      playlist: { lastChangedAt: new Date("2026-05-01T12:00:00.000Z") }, previousMetadataConfidence: 90,
      identityProfile: { confidence: .8, averageBpm: 180, bpmRange: [170, 190], averageEnergy: .9, energyRange: [.8, 1] },
      failedAutomation: { count: 2, latestMessage: "Scheduled regeneration failed." },
    }));
    const types = new Set(result.checks.map((item) => item.type));
    for (const type of ["METADATA_CONFIDENCE_DECLINE", "IDENTITY_DRIFT", "EXCESSIVE_BPM_JUMPS", "MOOD_CONFLICTS", "STALE_PLAYLIST", "FAILED_AUTOMATION"]) assert.ok(types.has(type as any), `missing ${type}`);
    assert.ok(result.overallScore < 50); assert.equal(result.status, "CRITICAL");
  });

  it("does not invent BPM or mood conflicts where adjacent metadata is absent", () => {
    const tracks = [baseTrack(0, { bpm: null, mood: null }), baseTrack(1, { bpm: 200, mood: 1 }), baseTrack(2, { bpm: null, mood: null })];
    const result = analyzePlaylistHealth(input(tracks));
    assert.equal(result.metrics.excessiveBpmJumps, 0); assert.equal(result.metrics.moodConflicts, 0);
  });

  it("detects mood identity drift even when tempo and energy still match", () => {
    const tracks = Array.from({ length: 6 }, (_, index) => baseTrack(index, { moodTags: ["aggressive"], bpm: 105, energy: .5 }));
    const result = analyzePlaylistHealth(input(tracks, { identityProfile: { confidence: .9, averageBpm: 105, bpmRange: [100, 110], averageEnergy: .5, energyRange: [.4, .6], moodDistribution: { chill: .8, dreamy: .2 } } }));
    const drift = result.checks.find((item) => item.type === "IDENTITY_DRIFT");
    assert.ok(drift); assert.equal(drift?.details?.moodIdentityScore, 0);
  });
});

describe("Playlist Health persistence and security contract", () => {
  const root = process.cwd();
  const migration = readFileSync(join(root, "prisma", "migrations", "20260718233000_playlist_health_v228", "migration.sql"), "utf8");
  const service = readFileSync(join(root, "src", "lib", "playlistHealth", "service.ts"), "utf8");

  it("uses an additive indexed migration with snapshot, alert, event, and delivery history", () => {
    for (const table of ["PlaylistHealthSetting", "PlaylistHealthSnapshot", "PlaylistHealthAlert", "PlaylistHealthAlertEvent", "PlaylistHealthNotificationDelivery"]) assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
    assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/);
    assert.match(migration, /PlaylistHealthAlert_userId_status_severity_lastDetectedAt_idx/);
  });

  it("encrypts saved endpoints, validates HTTPS destinations, and records delivery status without returning secrets", () => {
    assert.match(service, /encryptSecret\(safeHttpsUrl/); assert.match(service, /decryptSecret/); assert.match(service, /url\.protocol !== "https:"/);
    assert.match(service, /discordWebhookEncrypted: undefined/); assert.match(service, /playlistHealthNotificationDelivery\.create/);
  });

  it("records detection, acknowledgment, resolution, auto-resolution, and reopening", () => {
    for (const event of ["DETECTED", "REOPENED", "ACKNOWLEDGED", "RESOLVED", "AUTO_RESOLVED"]) assert.ok(service.includes(`"${event}"`), `missing ${event}`);
  });
});
