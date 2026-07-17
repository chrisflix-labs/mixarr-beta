import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { chunkValues, queryInBatches } from "./databaseBatching";
import { createPlaylistGenerationControl } from "./playlistGenerationControl";
import { PLAYLIST_GENERATION_LIMITS } from "./playlistGenerationLimits";
import { normalizeSmartMixTuningConfig, runSmartMixEngineV2, runSmartMixEngineV2Async } from "./smartMixEngine/v2";

function track(index: number, artistModulo = 100) {
  return {
    id: `track-${index}`,
    title: `Track ${index}`,
    artistId: `artist-${index % artistModulo}`,
    albumId: `album-${index % 250}`,
    artist: { id: `artist-${index % artistModulo}`, title: `Artist ${index % artistModulo}` },
    album: { id: `album-${index % 250}`, title: `Album ${index % 250}` },
    bpm: 80 + (index % 90),
    popularity: { score: index % 100 },
    audioFeature: { effectiveEnergy: (index % 100) / 100, effectiveMood: ((index * 7) % 100) / 100 },
  };
}

function input(candidates: any[], limit: number, configPatch: Record<string, any> = {}) {
  const config = {
    limit,
    rules: [],
    tuningConfig: normalizeSmartMixTuningConfig({ bpmFlow: { enabled: true, mode: "NATURAL" } }),
    safetyRules: { avoidSameArtistBackToBack: true, limitTracksPerArtist: false, maxTracksPerArtist: 3, limitTracksPerAlbum: false, maxTracksPerAlbum: 2, warnIfFewerThan: true, minimumTrackCount: 10 },
    ...configPatch,
  };
  return {
    config,
    pinnedTracks: [],
    candidates,
    safetyCandidateLimit: limit * 5,
    applyDuplicatePolicy: (tracks: any[], _config: any, requested: number) => tracks.slice(0, requested),
    applyPlaylistSafetyRules: (tracks: any[], innerConfig: any) => ({ tracks: tracks.slice(0, innerConfig.limit), metadata: { safetyRulesApplied: true, removedBySafetyRules: 0, warnings: [], infos: [], summary: "test" } }),
  };
}

describe("Playlist generation safety", () => {
  it("chunks database identifiers and preserves query order", async () => {
    assert.deepEqual(chunkValues([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    const batches: number[][] = [];
    const result = await queryInBatches([1, 2, 2, 3, 4, 5], async (batch) => { batches.push(batch); return batch.map((value) => value * 10); }, 2);
    assert.deepEqual(batches, [[1, 2], [3, 4], [5]]);
    assert.deepEqual(result, [10, 20, 30, 40, 50]);
  });

  it("returns a partial result when the eligible pool is smaller than requested", () => {
    const result = runSmartMixEngineV2(input(Array.from({ length: 27 }, (_, index) => track(index)), 100));
    assert.equal(result.tracks.length, 27);
    assert.ok(result.diagnostics.selectionAttempts <= 27 * PLAYLIST_GENERATION_LIMITS.maxSelectionAttempts);
  });

  it("stops when variety limits exhaust every remaining candidate", () => {
    const result = runSmartMixEngineV2(input(Array.from({ length: 80 }, (_, index) => track(index, 1)), 50, {
      safetyRules: { avoidSameArtistBackToBack: true, limitTracksPerArtist: true, maxTracksPerArtist: 2, limitTracksPerAlbum: false, maxTracksPerAlbum: 2, warnIfFewerThan: true, minimumTrackCount: 10 },
    }));
    assert.equal(result.tracks.length, 2);
    assert.ok(result.diagnostics.selectionAttempts < 500);
  });

  it("keeps recommendation tuning structurally bounded", () => {
    const requested = 500;
    const result = runSmartMixEngineV2(input(Array.from({ length: 2_000 }, (_, index) => track(index)), requested));
    assert.equal(result.diagnostics.scoringPasses, 1);
    assert.equal(result.diagnostics.candidateRescoringPasses, 0);
    assert.ok(result.diagnostics.selectionAttempts <= requested * PLAYLIST_GENERATION_LIMITS.maxSelectionAttempts);
    assert.ok(result.diagnostics.optimizationPasses <= PLAYLIST_GENERATION_LIMITS.maxOptimizationPasses);
    assert.ok(result.decisionTrace.rejectedCandidates.length <= PLAYLIST_GENERATION_LIMITS.explanationRejectedSampleLimit);
  });

  it("yields to the event loop during async selection and ordering", async () => {
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 0);
    const control = createPlaylistGenerationControl({ requestedTracks: 120 });
    try {
      const result = await runSmartMixEngineV2Async({ ...input(Array.from({ length: 600 }, (_, index) => track(index)), 120), control });
      assert.equal(result.tracks.length, 120);
      assert.ok(ticks > 0);
    } finally { clearInterval(timer); control.finish(); }
  });

  it("honors cancellation and total runtime deadlines", async () => {
    const controller = new AbortController();
    controller.abort("test cancellation");
    const cancelled = createPlaylistGenerationControl({ requestedTracks: 10, signal: controller.signal });
    await assert.rejects(() => cancelled.yield("Selecting", {}, true), (error: any) => error?.name === "PlaylistGenerationCancelledError");
    cancelled.finish();

    const timedOut = createPlaylistGenerationControl({ requestedTracks: 10, maxRuntimeMs: 1, stageTimeoutMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(() => timedOut.yield("Selecting", {}, true), (error: any) => error?.name === "PlaylistGenerationTimeoutError");
    timedOut.finish();
  });

  it("uses a background job API with cancellation, SSE progress, and no empty Plex create", () => {
    const root = process.cwd();
    const jobs = fs.readFileSync(path.join(root, "src/lib/playlistGenerationJobs.ts"), "utf8");
    const events = fs.readFileSync(path.join(root, "src/app/api/playlists/generation-jobs/[id]/events/route.ts"), "utf8");
    const create = fs.readFileSync(path.join(root, "src/app/api/playlists/create-from-preview/route.ts"), "utf8");
    const service = fs.readFileSync(path.join(root, "src/lib/playlistService.ts"), "utf8");
    assert.match(jobs, /finally\(\(\) => \{ runtime\.active\.delete/);
    assert.match(jobs, /controller\.abort/);
    assert.match(events, /text\/event-stream/);
    assert.match(create, /trackIds\.length === 0/);
    assert.match(create, /rollbackCreatedPlexPlaylist/);
    assert.match(service, /if \(uniqueRatingKeys\.length === 0\) throw new Error\("Mixarr will not create an empty Plex playlist/);
  });
});
