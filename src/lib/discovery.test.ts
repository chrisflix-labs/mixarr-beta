import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  discoveryPreset,
  discoverySelectionAdjustment,
  normalizeDiscoveryConfig,
  scoreDiscoveryCandidatePool,
  summarizeDiscovery,
} from "./smartMixEngine/v2/discovery";

const candidate = (id: string, popularity: number, viewCount: number, score = 75) => ({
  id, title: id, popularity: { score: popularity }, viewCount, score,
  artist: { id: `artist-${id}`, title: `Artist ${id}` },
  album: { id: `album-${id}`, title: `Album ${id}` },
});

describe("Smart Mix discovery controls", () => {
  it("maps recommended levels to reproducible advanced values", () => {
    assert.equal(discoveryPreset("low").deepCutTarget, 15);
    assert.equal(discoveryPreset("medium").deepCutTarget, 35);
    assert.equal(discoveryPreset("high").deepCutTarget, 65);
    assert.equal(discoveryPreset("high").maxPopularTrackPercent, 25);
    assert.equal(discoveryPreset("medium").recentPlaylistLookback, "playlists_10");
  });

  it("migrates Familiar vs Discovery and clamps imported values", () => {
    assert.equal(normalizeDiscoveryConfig(undefined, 80).level, "low");
    assert.equal(normalizeDiscoveryConfig(undefined, 20).level, "high");
    const normalized = normalizeDiscoveryConfig({ level: "custom", deepCutTarget: 140, maxPopularTrackPercent: -5, recentPlaylistLookback: "invalid" }, 50);
    assert.equal(normalized.level, "custom");
    assert.equal(normalized.deepCutTarget, 100);
    assert.equal(normalized.maxPopularTrackPercent, 0);
    assert.equal(normalized.recentPlaylistLookback, "playlists_10");
  });

  it("classifies relative deep cuts and hidden gems without requiring complete metadata", () => {
    const tracks = [
      candidate("popular", 95, 20, 90),
      candidate("middle", 55, 8, 76),
      candidate("gem", 10, 0, 82),
      { id: "unknown", title: "unknown", score: 70 },
    ];
    const result = scoreDiscoveryCandidatePool({ candidates: tracks, config: discoveryPreset("high"), recentUsage: { popular: 3, middle: 1, gem: 0 } });
    assert.equal(result.tracks.find((track) => track.id === "popular")?.discoveryMetrics.classification, "popular");
    assert.ok(["deep_cut", "hidden_gem"].includes(result.tracks.find((track) => track.id === "gem")!.discoveryMetrics.classification));
    assert.equal(result.tracks.find((track) => track.id === "unknown")?.discoveryMetrics.classification, "unknown");
    assert.ok(result.tracks.find((track) => track.id === "gem")!.score > result.tracks.find((track) => track.id === "popular")!.score);
  });

  it("keeps play-count scoring neutral when every track has zero plays", () => {
    const result = scoreDiscoveryCandidatePool({
      candidates: [candidate("a", 50, 0), candidate("b", 50, 0)],
      config: discoveryPreset("high"),
    });
    assert.equal(result.tracks.every((track) => track.discoveryMetrics.normalizedPlayCount == null), true);
    assert.equal(result.tracks.every((track) => track.discoveryMetrics.underplayedScore === 0), true);
  });

  it("penalizes recent playlist use softly while keeping the track eligible", () => {
    const result = scoreDiscoveryCandidatePool({
      candidates: [candidate("fresh", 40, 2), candidate("recent", 40, 2)],
      config: discoveryPreset("medium"),
      recentUsage: { fresh: 0, recent: 4 },
    });
    const fresh = result.tracks.find((track) => track.id === "fresh")!;
    const recent = result.tracks.find((track) => track.id === "recent")!;
    assert.ok(recent.discoveryMetrics.recentPlaylistPenalty > 0);
    assert.ok(fresh.score > recent.score);
    assert.equal(result.tracks.length, 2);
  });

  it("applies soft deep-cut and popular quota adjustments and explains partial targets", () => {
    const config = discoveryPreset("high");
    const deep = { discoveryMetrics: { classification: "deep_cut" } };
    const popular = { discoveryMetrics: { classification: "popular" } };
    assert.ok(discoverySelectionAdjustment(deep, [], 10, config) > 0);
    assert.ok(discoverySelectionAdjustment(popular, [popular, popular, popular], 10, config) < 0);
    const diagnostics = summarizeDiscovery([deep, popular], [popular], config);
    assert.equal(diagnostics.targetSatisfaction < 100, true);
    assert.equal(diagnostics.warnings.some((warning) => warning.includes("Partially Met")), true);
  });
});
