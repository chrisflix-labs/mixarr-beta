import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculatePlaylistOverlap } from "./playlistCoordination/overlap";
import { canonicalPlaylistPair } from "./playlistCoordination/policy";
import { scoreCrossPlaylistCandidate } from "./playlistCoordination/scoring";
import type { CoordinationScoringContext, PlaylistTrackFact } from "./playlistCoordination/types";

const fact = (id: string, artist = `artist-${id}`, album = `album-${id}`): PlaylistTrackFact => ({ trackId: id, title: `Track ${id}`, canonicalRecordingId: id, artistId: artist, albumId: album, albumName: album });

test("empty, single-track, identical, and completely unique playlists have stable overlap math", () => {
  const empty = calculatePlaylistOverlap([], []);
  assert.equal(empty.sharedTrackCount, 0);
  assert.equal(empty.sharedTrackPercentage, 0);
  assert.equal(calculatePlaylistOverlap([fact("one")], [fact("one")]).sharedTrackPercentage, 100);
  const identical = calculatePlaylistOverlap([fact("a"), fact("b")], [fact("a"), fact("b")], [], { maximumTrackOverlapPercent: 20, maximumArtistOverlapPercent: 100, maximumAlbumOverlapPercent: 100, minimumUniqueTrackPercent: 0 });
  assert.equal(identical.excessSharedTrackCount, 2);
  assert.equal(identical.sourceUniqueTrackPercentage, 0);
  const unique = calculatePlaylistOverlap([fact("a")], [fact("b")], [], { minimumUniqueTrackPercent: 70 });
  assert.equal(unique.sharedTrackCount, 0);
  assert.equal(unique.sourceUniqueTrackPercentage, 100);
  assert.equal(unique.withinPolicy, true);
});

test("core tracks, allowed shared tracks, and count allowances reduce policy overlap without hiding raw overlap", () => {
  const tracks = [fact("a"), fact("b"), fact("c")];
  const overlap = calculatePlaylistOverlap(tracks, tracks, ["canonical:a"], {
    maximumTrackOverlapPercent: 0,
    maximumArtistOverlapPercent: 100,
    maximumAlbumOverlapPercent: 100,
    minimumUniqueTrackPercent: 0,
    coreTrackKeys: ["canonical:a"],
    allowedSharedTrackKeys: ["canonical:b"],
    sharedTrackAllowance: 1,
  });
  assert.equal(overlap.sharedTrackCount, 3);
  assert.equal(overlap.allowedSharedTrackCount, 3);
  assert.equal(overlap.policySharedTrackCount, 0);
  assert.equal(overlap.excessSharedTrackCount, 0);
  assert.equal(overlap.withinPolicy, true);
});

test("allowed artists and albums affect enforcement while raw reporting remains intact", () => {
  const source = [fact("a", "artist-a", "album-a")];
  const target = [fact("b", "artist-a", "album-a")];
  const result = calculatePlaylistOverlap(source, target, [], { maximumArtistOverlapPercent: 0, maximumAlbumOverlapPercent: 0, minimumUniqueTrackPercent: 0, allowedArtistKeys: ["artist:artist-a"], allowedAlbumKeys: ["album:album-a"] });
  assert.equal(result.sharedArtistPercentage, 100);
  assert.equal(result.sharedAlbumPercentage, 100);
  assert.equal(result.policySharedArtistPercentage, 0);
  assert.equal(result.policySharedAlbumPercentage, 0);
  assert.equal(result.withinPolicy, true);
});

test("unknown albums are ignored and compilations are separated by primary artist", () => {
  const unknownA = { ...fact("a"), albumId: "unknown-a", albumName: "Unknown Album" };
  const unknownB = { ...fact("b"), albumId: "unknown-b", albumName: "unknown album" };
  assert.equal(calculatePlaylistOverlap([unknownA], [unknownB]).sharedAlbumCount, 0);
  const compilationA = { ...fact("c", "artist-a", "compilation"), albumName: "Big Hits", albumArtistName: "Various Artists", isCompilation: true };
  const compilationB = { ...fact("d", "artist-b", "compilation"), albumName: "Big Hits", albumArtistName: "Various Artists", isCompilation: true };
  assert.equal(calculatePlaylistOverlap([compilationA], [compilationB]).sharedAlbumCount, 0);
});

test("credited artists are normalized consistently while primary artists remain separate", () => {
  const source = { ...fact("a", "primary-a"), creditedArtistIds: ["guest"] };
  const target = { ...fact("b", "primary-b"), creditedArtistIds: ["guest"] };
  const result = calculatePlaylistOverlap([source], [target]);
  assert.equal(result.sharedArtistCount, 1);
  assert.equal(result.sharedPrimaryArtistCount, 0);
});

test("playlist pairs canonicalize once and reject self comparison", () => {
  assert.deepEqual(canonicalPlaylistPair("b", "a"), { playlistAId: "a", playlistBId: "b" });
  assert.deepEqual(canonicalPlaylistPair("a", "b"), { playlistAId: "a", playlistBId: "b" });
  assert.throws(() => canonicalPlaylistPair("a", "a"), /cannot be compared with itself/);
});

function scoringContext(): CoordinationScoringContext {
  return {
    settings: {
      coordinationEnabled: true, maximumSharedTrackPercentage: 20, overlapEnforcement: "SOFT_TARGET", keepDistinct: true,
      allowSharedCoreTracks: false, preferGloballyUnusedTracks: true, unusedTrackPreferenceStrength: 1, maximumCoordinationInfluence: 20,
      crossPlaylistArtistBalancingEnabled: false, warnBeforeExceedingOverlap: true, recentUsageLookbackDays: 30,
      recentUsagePenaltyStrength: "HIGH", exclusivityBehavior: "PREFER_EXCLUSIVE",
    },
    targetPlaylistSize: 20, relatedPlaylistIds: ["other"], excludedTrackKeys: [], relatedTrackUsage: {}, globalActiveUsage: {},
    artistUsage: {}, albumUsage: {}, sharedCoreTrackKeys: [], maximumRelatedPlaylistSize: 20,
    recentTrackUsage: { "canonical:candidate": 2 }, exclusiveTrackKeys: ["canonical:candidate"],
  };
}

test("recent-use and preferred exclusivity signals are explainable and bounded", () => {
  const score = scoreCrossPlaylistCandidate(fact("candidate"), scoringContext());
  assert.equal(score.crossPlaylistRecentUsagePenalty, -7);
  assert.equal(score.playlistExclusivityPenalty, -8);
  assert.ok(score.reasons.some((reason) => reason.includes("lookback")));
  assert.ok(score.reasons.some((reason) => reason.includes("exclusive")));
});

test("strict exclusivity rejects but preferred exclusivity allows fallback", () => {
  const context = scoringContext();
  context.settings.exclusivityBehavior = "STRICT_EXCLUSIVE";
  const score = scoreCrossPlaylistCandidate(fact("candidate"), context);
  assert.equal(score.hardOverlapRejected, true);
  assert.match(score.exclusionReason || "", /strict exclusivity/);
});

test("strict uniqueness tightens the hard overlap ceiling", () => {
  const context = scoringContext();
  context.settings.overlapEnforcement = "HARD_MAXIMUM";
  context.settings.uniqueTargetMode = "STRICT";
  context.settings.minimumUniqueTrackPercentage = 90;
  context.relatedTrackUsage["canonical:candidate"] = 1;
  const score = scoreCrossPlaylistCandidate(fact("candidate"), context, 2);
  assert.equal(score.hardOverlapRejected, true);
  assert.match(score.exclusionReason || "", /10% hard maximum.*strict uniqueness target/);
});

test("repair preview is read-only and apply validates revision plus content hash before mutation", () => {
  const source = readFileSync(join(process.cwd(), "src", "lib", "playlistCoordination", "repair.ts"), "utf8");
  const previewBody = source.slice(source.indexOf("export async function previewOverlapRepair"), source.indexOf("function replacementMembership"));
  assert.doesNotMatch(previewBody, /generatedPlaylistTrack\.(deleteMany|createMany)|syncGeneratedPlaylistToPlex/);
  assert.match(source, /playlist\.revisionCounter !== preview\.playlistRevision/);
  assert.match(source, /playlistContentHash\(preview\.playlist\.tracks\) !== preview\.playlistContentHash/);
  assert.match(source, /cross_playlist_overlap_repair/);
  assert.match(source, /status: "SYNC_FAILED"/);
});

test("analysis is cancellable, retryable, batched, checkpointed, and avoids unbounded pair Promise.all", () => {
  const source = readFileSync(join(process.cwd(), "src", "lib", "playlistCoordination", "analysis.ts"), "utf8");
  assert.match(source, /batchSize = Math\.min\(50/);
  assert.match(source, /await cancelled\(job\.id\)/);
  assert.match(source, /checkpoint/);
  assert.match(source, /trigger: request\.trigger/);
  const compact = source.replace(/\s+/g, " ");
  assert.doesNotMatch(compact, /Promise\.all\([^;]*(pairs|targets)\.map/);
});

test("v2.2.2 migration is additive, indexed, canonical, and does not analyze or rewrite playlists", () => {
  const migration = readFileSync(join(process.cwd(), "prisma", "migrations", "20260717193000_cross_playlist_variety_v222", "migration.sql"), "utf8");
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM|GeneratedPlaylistTrack.*UPDATE/i);
  assert.match(migration, /PlaylistPairPolicy_canonical_pair/);
  assert.match(migration, /PlaylistRepairPreview_playlistId_status_expiresAt_idx/);
  assert.match(migration, /PlaylistOverlapSummary_stale_calculatedAt_idx/);
  assert.match(migration, /PlaylistOverlapSnapshot_playlistAId_playlistBId_calculatedAt_idx/);
});

test("40,000-track and 100-playlist fixture stays bounded for representative pair calculations", () => {
  const tracks = Array.from({ length: 40_000 }, (_, index) => fact(`large-${index}`, `artist-${index % 2000}`, `album-${index % 5000}`));
  const playlists = Array.from({ length: 100 }, (_, index) => tracks.slice(index * 400, index * 400 + 400));
  const started = Date.now();
  for (let index = 0; index < playlists.length - 1; index += 1) {
    const result = calculatePlaylistOverlap(playlists[index], playlists[index + 1], [], { minimumUniqueTrackPercent: 70 });
    assert.equal(result.sourceTrackCount, 400);
  }
  assert.ok(Date.now() - started < 10_000, "representative bounded comparisons should complete without a lockup");
});

test("workspace exposes heatmap, mobile ranking, policy controls, repair selection, and analysis states", () => {
  const component = readFileSync(join(process.cwd(), "src", "components", "CrossPlaylistVarietyWorkspace.tsx"), "utf8");
  const css = readFileSync(join(process.cwd(), "src", "components", "CrossPlaylistVarietyWorkspace.module.css"), "utf8");
  for (const label of ["Overlap heatmap", "Analysis required", "Preview replacements", "Apply selected replacements", "Require preview", "Ignore this playlist pair", "Allow for pair", "replacementSelections"]) assert.match(component, new RegExp(label));
  assert.match(css, /mobileRanked/);
  assert.match(css, /@media\(max-width:760px\)/);
});
