import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculatePlaylistOverlap, canonicalTrackKey } from "./playlistCoordination/overlap";
import { scoreCrossPlaylistCandidate } from "./playlistCoordination/scoring";
import { aggregateHistoricalUsage, decayedHistoricalUsageWeight } from "./playlistCoordination/usage";
import type { CoordinationScoringContext, PlaylistTrackFact } from "./playlistCoordination/types";

const workout: PlaylistTrackFact[] = [
  { trackId: "w1", title: "Run", artistId: "a1", albumId: "al1", canonicalRecordingId: "c1" },
  { trackId: "w2", title: "Lift", artistId: "a1", albumId: "al2", canonicalRecordingId: "c2" },
  { trackId: "w3", title: "Finish", artistId: "a2", albumId: "al3", canonicalRecordingId: "c3" },
];
const party: PlaylistTrackFact[] = [
  { trackId: "p-copy", title: "Run (Remastered)", artistId: "a1", albumId: "deluxe", canonicalRecordingId: "c1" },
  { trackId: "p2", title: "Dance", artistId: "a3", albumId: "al4", canonicalRecordingId: "c4" },
];

test("overlap uses canonical recordings and the smaller active playlist denominator", () => {
  const result = calculatePlaylistOverlap(workout, party);
  assert.equal(result.sharedTrackCount, 1);
  assert.equal(result.sharedTrackPercentage, 50);
  assert.equal(result.jaccardSimilarity, 25);
  assert.equal(result.sourceUniqueTrackCount, 2);
  assert.equal(result.targetUniqueTrackCount, 1);
  assert.equal(result.enforcementCalculation, "shared / smaller active playlist");
});

test("deleted and duplicate physical rows do not inflate overlap", () => {
  const source = workout.concat({ ...workout[0], trackId: "duplicate-copy" }, { trackId: "deleted", canonicalRecordingId: "gone", deleted: true });
  const result = calculatePlaylistOverlap(source, party);
  assert.equal(result.sourceTrackCount, 3);
  assert.equal(result.sharedTrackCount, 1);
});

test("artist and album overlap are calculated independently", () => {
  const result = calculatePlaylistOverlap(workout, party);
  assert.equal(result.sharedArtistCount, 1);
  assert.equal(result.sharedArtistPercentage, 50);
  assert.equal(result.sharedAlbumCount, 0);
});

test("shared core counts canonical copies", () => {
  const result = calculatePlaylistOverlap(workout, party, [canonicalTrackKey(workout[0])]);
  assert.equal(result.sharedCoreTrackCount, 1);
});

function context(overrides: Partial<CoordinationScoringContext["settings"]> = {}): CoordinationScoringContext {
  return {
    settings: {
      coordinationEnabled: true,
      maximumSharedTrackPercentage: 20,
      overlapEnforcement: "SOFT_TARGET",
      keepDistinct: true,
      allowSharedCoreTracks: false,
      maximumSharedCoreTracks: null,
      preferGloballyUnusedTracks: true,
      unusedTrackPreferenceStrength: 1,
      maximumCoordinationInfluence: 12,
      crossPlaylistArtistBalancingEnabled: true,
      maximumSharedArtistPercentage: 40,
      maximumTracksPerArtistAcrossGroup: 6,
      warnBeforeExceedingOverlap: true,
      ...overrides,
    },
    targetPlaylistSize: 10,
    relatedPlaylistIds: ["party"],
    excludedTrackKeys: [],
    relatedTrackUsage: { "canonical:c1": 1 },
    globalActiveUsage: { "canonical:c1": 2 },
    globalHistoricalUsage: {},
    artistUsage: { "artist:a1": 4 },
    albumUsage: { "album:al1": 1 },
    sharedCoreTrackKeys: [],
    maximumRelatedPlaylistSize: 10,
  };
}

test("soft coordination applies explainable bounded penalties", () => {
  const score = scoreCrossPlaylistCandidate(workout[0], context());
  assert.ok(score.alreadyUsedInRelatedPlaylistPenalty < 0);
  assert.ok(score.crossPlaylistArtistPenalty < 0);
  assert.equal(score.hardOverlapRejected, false);
  assert.equal(score.totalAdjustment, -12);
  assert.ok(score.reasons.some((reason) => reason.includes("capped")));
});

test("warning-only overlap reports reuse without a track reuse penalty", () => {
  const score = scoreCrossPlaylistCandidate(workout[0], context({ overlapEnforcement: "WARNING_ONLY", keepDistinct: false, preferGloballyUnusedTracks: false, crossPlaylistArtistBalancingEnabled: false }));
  assert.equal(score.alreadyUsedInRelatedPlaylistPenalty, 0);
  assert.ok(score.reasons.some((reason) => reason.includes("warning-only")));
});

test("hard maximum rejects the next related track when projected overlap exceeds the limit", () => {
  const score = scoreCrossPlaylistCandidate(workout[0], context({ overlapEnforcement: "HARD_MAXIMUM", maximumSharedTrackPercentage: 20 }), 2);
  assert.equal(score.hardOverlapRejected, true);
  assert.match(score.exclusionReason || "", /30\.0%/);
});

test("shared core bypasses overlap penalties but not unrelated hard exclusions", () => {
  const sharedContext = context({ allowSharedCoreTracks: true });
  sharedContext.sharedCoreTrackKeys = ["canonical:c1"];
  const score = scoreCrossPlaylistCandidate(workout[0], sharedContext, 9);
  assert.equal(score.alreadyUsedInRelatedPlaylistPenalty, 0);
  assert.equal(score.hardOverlapRejected, false);
  sharedContext.excludedTrackKeys = ["canonical:c1"];
  assert.equal(scoreCrossPlaylistCandidate(workout[0], { ...sharedContext, settings: { ...sharedContext.settings, allowSharedCoreTracks: false } }).hardOverlapRejected, true);
});

test("unused tracks receive a capped bonus without overpowering compatibility layers", () => {
  const unused = { trackId: "unused", canonicalRecordingId: "new", artistId: "new-artist", albumId: "new-album" };
  const score = scoreCrossPlaylistCandidate(unused, context({ maximumCoordinationInfluence: 5 }));
  assert.equal(score.unusedTrackBonus, 10);
  assert.equal(score.totalAdjustment, 5);
});

test("historical usage decays with a documented 90-day half-life", () => {
  const now = new Date("2026-07-16T00:00:00Z");
  assert.equal(decayedHistoricalUsageWeight(new Date("2026-04-17T00:00:00Z"), now), 0.5);
  const usage = aggregateHistoricalUsage([
    { trackKey: "track:a", occurredAt: now },
    { trackKey: "track:a", occurredAt: new Date("2026-04-17T00:00:00Z") },
  ], now);
  assert.equal(usage["track:a"], 1.5);
});

test("v2.1.7 migration is additive and indexed for relationship, membership, core, and history lookups", () => {
  const migration = readFileSync(join(process.cwd(), "prisma", "migrations", "20260716050000_playlist_coordination", "migration.sql"), "utf8");
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
  assert.match(migration, /PlaylistRelationship_userId_sourcePlaylistId_idx/);
  assert.match(migration, /PlaylistSharedCoreTrack_userId_trackId_idx/);
  assert.match(migration, /PlaylistProgressionMember_playlistId_idx/);
  assert.match(migration, /PlaylistOverlapSummary_sharedTrackPercentage_idx/);
});

test("coordination mutation and comparison routes require the session cookie", () => {
  const routes = [
    ["playlists", "[playlistId]", "relationships", "route.ts"],
    ["playlists", "[playlistId]", "coordination", "route.ts"],
    ["playlists", "[playlistId]", "move-track", "apply", "route.ts"],
    ["playlist-coordination", "rebalance", "apply", "route.ts"],
  ];
  for (const parts of routes) {
    const source = readFileSync(join(process.cwd(), "src", "app", "api", ...parts), "utf8");
    assert.match(source, /mixarr_session/);
    assert.match(source, /Unauthorized/);
  }
});

test("dashboard exposes mobile layout, empty state, presets, progression, move preview, and rebalance preview", () => {
  const page = readFileSync(join(process.cwd(), "src", "app", "playlist-coordination", "page.tsx"), "utf8");
  const css = readFileSync(join(process.cwd(), "src", "app", "playlist-coordination", "playlist-coordination.module.css"), "utf8");
  assert.match(page, /Closely Related/);
  assert.match(page, /No relationships yet/);
  assert.match(page, /Progression chains/);
  assert.match(page, /Preview impact/);
  assert.match(page, /Rebalance related playlists/);
  assert.match(css, /@media\(max-width:760px\)/);
});

test("deterministic coordination fixtures cover the release playlist family", () => {
  const fixtures = ["Workout Mix", "Warm-Up", "High Energy", "Cooldown", "Party Mix", "Late Night Drive"];
  assert.equal(new Set(fixtures).size, 6);
  const scores = fixtures.map((name, index) => scoreCrossPlaylistCandidate({ trackId: name, canonicalRecordingId: `fixture-${index}`, artistId: `artist-${index}` }, context()).totalAdjustment);
  assert.ok(scores.every((score) => score > 0), "unused distinct fixtures should all retain the unused-track bonus");
});
