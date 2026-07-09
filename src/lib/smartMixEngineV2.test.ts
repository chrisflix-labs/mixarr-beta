import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getSmartMixMetadataFallbacks,
  normalizeSmartMixTuningConfig,
  runSmartMixEngineV2,
  scoreSmartMixTrack,
  smartMixEngineLabel,
} from "./smartMixEngine/v2";

const config = {
  limit: 3,
  rules: [
    { field: "tempo", operator: "gte", value: "100" },
    { field: "tempo", operator: "lte", value: "130" },
    { field: "energy", operator: "gte", value: "0.6" },
    { field: "valence", operator: "gte", value: "0.4" },
    { field: "popularity", operator: "gte", value: "40" },
  ],
};

function track(id: string, metadata: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    artistId: `artist-${id}`,
    albumId: `album-${id}`,
    artist: { id: `artist-${id}`, title: `Artist ${id}` },
    album: { id: `album-${id}`, title: `Album ${id}` },
    ...metadata,
  };
}

describe("Smart Mix Engine v2 foundation", () => {
  it("records missing metadata without converting it to zero", () => {
    const fallback = getSmartMixMetadataFallbacks(track("missing"));

    assert.deepEqual(fallback.metadataStatus.missingFields, ["bpm", "mood", "energy", "popularity"]);
    assert.equal(fallback.fallbackValues.bpm, null);
    assert.equal(fallback.fallbackValues.mood, null);
    assert.equal(fallback.fallbackValues.energy, null);
    assert.equal(fallback.fallbackValues.popularity, 50);
    assert.equal(fallback.fallbacksApplied.includes("popularity: used neutral popularity score"), true);
  });

  it("scores complete metadata above missing metadata while keeping both eligible", () => {
    const complete = scoreSmartMixTrack(track("complete", {
      bpm: 118,
      popularity: { score: 82 },
      audioFeature: { effectiveEnergy: 0.8, effectiveMood: 0.7 },
    }), config);
    const missing = scoreSmartMixTrack(track("missing"), config);

    assert.equal(complete.engineVersion, "v2");
    assert.equal(missing.engineVersion, "v2");
    assert.equal(missing.metadataStatus.hasBpm, false);
    assert.ok(complete.score > missing.score);
    assert.ok((missing.scoreBreakdown.fallbackPenalty || 0) < 0);
  });

  it("runs an ordered v2 pipeline without dropping tracks for missing metadata", () => {
    const result = runSmartMixEngineV2({
      config,
      pinnedTracks: [],
      candidates: [
        track("complete", {
          bpm: 120,
          popularity: { score: 80 },
          audioFeature: { effectiveEnergy: 0.75, effectiveMood: 0.6 },
        }),
        track("missing-bpm", {
          popularity: { score: 70 },
          audioFeature: { effectiveEnergy: 0.75, effectiveMood: 0.6 },
        }),
        track("missing-audio", {
          bpm: 118,
          popularity: { score: 65 },
        }),
      ],
      safetyCandidateLimit: 3,
      applyDuplicatePolicy: (tracks, _config, limit) => tracks.slice(0, limit),
      applyPlaylistSafetyRules: (tracks, runConfig) => ({
        tracks: tracks.slice(0, runConfig.limit),
        metadata: {
          safetyRulesApplied: false,
          removedBySafetyRules: 0,
          warnings: [],
          infos: [],
          summary: "Safety rules: off",
        },
      }),
    });

    assert.equal(result.engineVersion, "v2");
    assert.equal(result.tracks.length, 3);
    assert.equal(result.diagnostics.pipeline.map((stage) => stage.order).join(","), "1,2,3,4,5,6,7");
    assert.equal(result.tracks.some((item) => item.id === "missing-bpm"), true);
    assert.equal(result.diagnostics.fallbackSummary.bpm, 1);
    assert.equal(smartMixEngineLabel(result.engineVersion), "Smart Mix Engine: v2 Foundation");
  });

  it("normalizes tuning configs with backward-compatible defaults", () => {
    const tuning = normalizeSmartMixTuningConfig({ bpmWeight: 90, recommendationStrength: 200 });

    assert.equal(tuning.bpmWeight, 90);
    assert.equal(tuning.recommendationStrength, 100);
    assert.equal(tuning.artistVariety, 50);
    assert.equal(tuning.tuningVersion, "2.0.2");
  });

  it("lets discovery tuning favor lower popularity candidates without filtering popular tracks", () => {
    const discoveryConfig = {
      ...config,
      tuningConfig: {
        recommendationStrength: 65,
        familiarityDiscoveryBalance: 0,
        popularityWeight: 100,
        moodWeight: 50,
        energyWeight: 50,
        bpmWeight: 50,
        artistVariety: 50,
        albumVariety: 50,
        avoidRecentlyUsedTracks: false,
        presetName: "Deep Cuts",
        tuningVersion: "2.0.2",
      },
    };
    const popular = scoreSmartMixTrack(track("popular", {
      bpm: 120,
      popularity: { score: 95 },
      audioFeature: { effectiveEnergy: 0.75, effectiveMood: 0.6 },
    }), discoveryConfig);
    const deepCut = scoreSmartMixTrack(track("deep", {
      bpm: 120,
      popularity: { score: 18 },
      audioFeature: { effectiveEnergy: 0.75, effectiveMood: 0.6 },
    }), discoveryConfig);

    assert.ok(deepCut.score > popular.score);
    assert.equal(popular.metadataStatus.hasPopularity, true);
  });

  it("softly penalizes recently used tracks instead of removing them", () => {
    const result = runSmartMixEngineV2({
      config: {
        ...config,
        tuningConfig: normalizeSmartMixTuningConfig({ avoidRecentlyUsedTracks: true }),
        recentlyUsedTrackIds: ["recent"],
      },
      pinnedTracks: [],
      candidates: [
        track("recent", {
          bpm: 120,
          popularity: { score: 90 },
          audioFeature: { effectiveEnergy: 0.75, effectiveMood: 0.6 },
        }),
        track("fresh", {
          bpm: 120,
          popularity: { score: 70 },
          audioFeature: { effectiveEnergy: 0.75, effectiveMood: 0.6 },
        }),
      ],
      safetyCandidateLimit: 2,
      applyDuplicatePolicy: (tracks, _config, limit) => tracks.slice(0, limit),
      applyPlaylistSafetyRules: (tracks, runConfig) => ({
        tracks: tracks.slice(0, runConfig.limit),
        metadata: {
          safetyRulesApplied: false,
          removedBySafetyRules: 0,
          warnings: [],
          infos: [],
          summary: "Safety rules: off",
        },
      }),
    });

    assert.equal(result.tracks.length, 2);
    assert.equal(result.tracks.some((item) => item.id === "recent"), true);
    assert.equal(result.tracks[0].id, "fresh");
  });
});
