import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getNormalizedTrackMoods,
  getSmartMixMetadataFallbacks,
  getTrackMoodTags,
  normalizeMoodBlendConfig,
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

function moodTrack(id: string, moods: string[], metadata: Record<string, unknown> = {}) {
  return track(id, {
    bpm: 118,
    popularity: { score: 60 },
    audioFeature: { effectiveEnergy: 0.6, effectiveMood: 0.6 },
    tags: moods.map((name) => ({ type: "mood", name })),
    ...metadata,
  });
}

function runV2(candidates: any[], runConfig: any) {
  return runSmartMixEngineV2({
    config: runConfig,
    pinnedTracks: [],
    candidates,
    safetyCandidateLimit: runConfig.limit,
    applyDuplicatePolicy: (tracks, _config, limit) => tracks.slice(0, limit),
    applyPlaylistSafetyRules: (tracks, innerConfig) => ({
      tracks: tracks.slice(0, innerConfig.limit),
      metadata: {
        safetyRulesApplied: false,
        removedBySafetyRules: 0,
        warnings: [],
        infos: [],
        summary: "Safety rules: off",
      },
    }),
  });
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

  it("orders smooth mood paths by the target zone and emits a mood curve", () => {
    const result = runV2([
      moodTrack("party-1", ["Party"]),
      moodTrack("happy-1", ["Happy"]),
      moodTrack("energetic-1", ["Energetic"]),
      moodTrack("party-2", ["Party"]),
      moodTrack("happy-2", ["Happy"]),
      moodTrack("energetic-2", ["Energetic"]),
    ], {
      ...config,
      limit: 6,
      moodBlendMode: "smooth_transition",
      selectedMoodPath: ["Happy", "Energetic", "Party"],
    });

    assert.equal(result.diagnostics.moodBlendMode, "smooth_transition");
    assert.deepEqual(result.diagnostics.selectedMoodPath, ["happy", "energetic", "party"]);
    assert.equal(result.diagnostics.moodCurve.sections.map((section: any) => section.mood).join(","), "happy,energetic,party");
    assert.equal(result.tracks.slice(0, 2).every((item) => item.moodBlend?.targetMood === "happy"), true);
    assert.equal(result.tracks.slice(2, 4).every((item) => item.moodBlend?.targetMood === "energetic"), true);
    assert.equal(result.tracks.slice(4, 6).every((item) => item.moodBlend?.targetMood === "party"), true);
  });

  it("favors bridge tracks around smooth mood transitions", () => {
    const result = runV2([
      moodTrack("happy", ["Happy"]),
      moodTrack("bridge", ["Happy", "Energetic"]),
      moodTrack("energetic", ["Energetic"]),
      moodTrack("party", ["Party"]),
    ], {
      ...config,
      limit: 4,
      moodBlendMode: "smooth_transition",
      selectedMoodPath: ["Happy", "Energetic", "Party"],
    });

    assert.equal(result.tracks.some((item) => item.id === "bridge"), true);
    assert.equal(result.diagnostics.multiMoodBridgeTracks.includes("bridge"), true);
  });

  it("uses strict mood matching without failing when fallback tracks are needed", () => {
    const result = runV2([
      moodTrack("happy", ["Happy"]),
      moodTrack("upbeat", ["Upbeat"]),
      moodTrack("dark", ["Dark"]),
      moodTrack("missing", []),
    ], {
      ...config,
      limit: 4,
      moodBlendMode: "strict_matching",
      selectedMoodPath: ["Happy"],
    });

    assert.equal(result.tracks.length, 4);
    assert.equal(result.tracks[0].id, "happy");
    assert.equal(result.diagnostics.moodFallbackCount >= 1, true);
    assert.equal(result.diagnostics.moodWarnings.some((warning) => warning.includes("Strict Mood Matching")), true);
  });

  it("rewards multiple compatible mood tags in mixed mood mode", () => {
    const mixedConfig = {
      ...config,
      limit: 3,
      moodBlendMode: "mixed_mood" as const,
      allowedMoods: ["Chill", "Focus", "Ambient"],
    };
    const bridge = scoreSmartMixTrack(moodTrack("bridge", ["Chill", "Focus"]), mixedConfig);
    const single = scoreSmartMixTrack(moodTrack("single", ["Chill"]), mixedConfig);
    const conflict = scoreSmartMixTrack(moodTrack("conflict", ["Intense"]), mixedConfig);

    assert.ok((bridge.scoreBreakdown.moodBlend || 0) > (single.scoreBreakdown.moodBlend || 0));
    assert.ok((single.scoreBreakdown.moodBlend || 0) > (conflict.scoreBreakdown.moodBlend || 0));
    assert.equal(bridge.moodBlend?.isMultiMoodBridge, true);
  });

  it("keeps mood blending disabled by default for backward compatibility", () => {
    const result = runV2([
      moodTrack("happy", ["Happy"]),
      moodTrack("dark", ["Dark"]),
    ], {
      ...config,
      limit: 2,
    });

    assert.equal(result.diagnostics.moodBlendMode, "off");
    assert.equal(result.diagnostics.moodCurve, null);
    assert.deepEqual(result.diagnostics.moodWarnings, []);
  });

  it("normalizes beta mood blending controls with defaults", () => {
    const blend = normalizeMoodBlendConfig({
      moodBlendMode: "strict_matching",
      selectedMoodPath: ["Happy", "Party"],
      moodStrength: 150,
      fallbackTolerance: -10,
      selectedMoodPreset: "strict_mood_lock",
    });

    assert.equal(blend.moodBlendMode, "strict_matching");
    assert.deepEqual(blend.selectedMoodPath, ["happy", "party"]);
    assert.equal(blend.moodStrength, 100);
    assert.equal(blend.transitionSmoothness, 70);
    assert.equal(blend.moodStrictness, 85);
    assert.equal(blend.fallbackTolerance, 0);
    assert.equal(blend.bridgeTrackPreference, 60);
    assert.equal(blend.moodVariety, 45);
    assert.equal(blend.conflictSensitivity, 70);
    assert.equal(blend.selectedMoodPreset, "strict_mood_lock");
  });

  it("passes beta mood blending controls into engine diagnostics", () => {
    const result = runV2([
      moodTrack("happy", ["Happy"]),
      moodTrack("party", ["Party"]),
    ], {
      ...config,
      limit: 2,
      moodBlendMode: "smooth_transition",
      selectedMoodPath: ["Happy", "Party"],
      moodStrength: 82,
      transitionSmoothness: 90,
      moodStrictness: 68,
      fallbackTolerance: 22,
      bridgeTrackPreference: 75,
      moodVariety: 35,
      conflictSensitivity: 81,
      selectedMoodPreset: "smooth_journey",
    });

    assert.equal(result.diagnostics.moodStrength, 82);
    assert.equal(result.diagnostics.transitionSmoothness, 90);
    assert.equal(result.diagnostics.moodStrictness, 68);
    assert.equal(result.diagnostics.fallbackTolerance, 22);
    assert.equal(result.diagnostics.bridgeTrackPreference, 75);
    assert.equal(result.diagnostics.moodVariety, 35);
    assert.equal(result.diagnostics.conflictSensitivity, 81);
    assert.equal(result.diagnostics.selectedMoodPreset, "smooth_journey");
  });

  it("uses mood strength and fallback tolerance to tune mood blend scores", () => {
    const weak = scoreSmartMixTrack(moodTrack("happy", ["Happy"]), {
      ...config,
      limit: 1,
      moodBlendMode: "strict_matching",
      selectedMoodPath: ["Happy"],
      moodStrength: 20,
    });
    const strong = scoreSmartMixTrack(moodTrack("happy", ["Happy"]), {
      ...config,
      limit: 1,
      moodBlendMode: "strict_matching",
      selectedMoodPath: ["Happy"],
      moodStrength: 95,
    });
    const lowFallback = scoreSmartMixTrack(moodTrack("missing", []), {
      ...config,
      limit: 1,
      moodBlendMode: "strict_matching",
      selectedMoodPath: ["Happy"],
      fallbackTolerance: 0,
    });
    const highFallback = scoreSmartMixTrack(moodTrack("missing", []), {
      ...config,
      limit: 1,
      moodBlendMode: "strict_matching",
      selectedMoodPath: ["Happy"],
      fallbackTolerance: 100,
    });

    assert.ok((strong.scoreBreakdown.moodBlend || 0) > (weak.scoreBreakdown.moodBlend || 0));
    assert.ok((highFallback.scoreBreakdown.moodBlend || 0) > (lowFallback.scoreBreakdown.moodBlend || 0));
  });

  it("normalizes mood metadata from strings, arrays, separators, casing, aliases, and nested fields", () => {
    assert.deepEqual(getTrackMoodTags(track("single", { mood: "Happy" })), ["happy"]);
    assert.deepEqual(getTrackMoodTags(track("array", { moodTags: ["Chill", "Focus"] })), ["chill", "focus"]);
    assert.deepEqual(getTrackMoodTags(track("comma", { mood: "happy, energetic" })), ["happy", "energetic"]);
    assert.deepEqual(getTrackMoodTags(track("pipe", { metadata: { mood: "chill|focus" } })), ["chill", "focus"]);
    assert.deepEqual(getTrackMoodTags(track("case", { mood: "CHEERFUL" })), ["happy"]);
    assert.deepEqual(getTrackMoodTags(track("nested", { audioFeature: { moodTags: ["spacey"] } })), ["ambient"]);
    assert.equal(getNormalizedTrackMoods(track("alias", { mood: "laid back" }))[0]?.isAlias, true);
  });

  it("uses relaxed mood scoring before generic fallback when strict matching is disabled", () => {
    const result = runV2([
      moodTrack("cheerful", ["Cheerful"]),
      moodTrack("dance", ["Dance"]),
      track("energy-fit", {
        bpm: 126,
        popularity: { score: 50 },
        audioFeature: { effectiveEnergy: 0.86, effectiveMood: 0.75 },
      }),
      moodTrack("dark", ["Dark"]),
    ], {
      ...config,
      limit: 4,
      moodBlendMode: "smooth_transition",
      selectedMoodPath: ["Happy", "Energetic", "Party"],
    });

    assert.equal(result.tracks.some((item) => item.id === "cheerful" && item.moodBlend?.moodMatchLevel === "alias"), true);
    assert.equal(result.tracks.some((item) => item.id === "dance" && ["alias", "adjacent", "family"].includes(item.moodBlend?.moodMatchLevel || "")), true);
    assert.equal(result.tracks.some((item) => item.id === "energy-fit" && item.moodBlend?.moodMatchLevel === "energy_bpm"), true);
    assert.equal(result.diagnostics.moodCoverage.preview.happy.exact, 0);
    assert.ok(result.diagnostics.moodCoverage.preview.happy.alias > 0);
    assert.ok(result.diagnostics.moodWarnings.every((warning: string) => !warning.includes("Only 0 tracks matched")));
  });

  it("keeps strict mood matching limited to exact and alias matches", () => {
    const result = runV2([
      moodTrack("cheerful", ["Cheerful"]),
      moodTrack("party", ["Party"]),
      track("energy-fit", {
        bpm: 124,
        popularity: { score: 50 },
        audioFeature: { effectiveEnergy: 0.62, effectiveMood: 0.9 },
      }),
    ], {
      ...config,
      limit: 3,
      moodBlendMode: "strict_matching",
      selectedMoodPath: ["Happy"],
    });

    assert.equal(result.tracks[0].id, "cheerful");
    assert.equal(result.tracks[0].moodBlend?.moodMatchLevel, "alias");
    assert.equal(result.tracks.some((item) => item.id === "energy-fit" && item.moodBlend?.moodMatchLevel === "energy_bpm"), false);
    assert.equal(result.diagnostics.moodWarnings.some((warning) => warning.includes("Strict Mood Matching")), true);
  });

  it("builds mood coverage for chill focus ambient and dark moody intense paths", () => {
    const chillResult = runV2([
      moodTrack("calm", ["Calm"]),
      moodTrack("study", ["Study"]),
      moodTrack("spacey", ["Spacey"]),
    ], {
      ...config,
      limit: 3,
      moodBlendMode: "smooth_transition",
      selectedMoodPath: ["Chill", "Focus", "Ambient"],
    });
    const darkResult = runV2([
      moodTrack("gloomy", ["Gloomy"]),
      moodTrack("sad", ["Sad"]),
      moodTrack("intense", ["Intense"]),
    ], {
      ...config,
      limit: 3,
      moodBlendMode: "smooth_transition",
      selectedMoodPath: ["Dark", "Moody", "Intense"],
    });

    assert.deepEqual(chillResult.diagnostics.selectedMoodPath, ["chill", "focus", "ambient"]);
    assert.equal(chillResult.diagnostics.moodCoverage.preview.chill.alias, 1);
    assert.equal(chillResult.diagnostics.moodCoverage.preview.focus.alias, 1);
    assert.equal(chillResult.diagnostics.moodCoverage.preview.ambient.alias, 1);
    assert.deepEqual(darkResult.diagnostics.selectedMoodPath, ["dark", "moody", "intense"]);
    assert.equal(darkResult.diagnostics.moodCoverage.preview.dark.alias, 1);
    assert.equal(darkResult.diagnostics.moodCoverage.preview.moody.alias, 1);
    assert.equal(darkResult.diagnostics.moodCoverage.preview.intense.exact, 1);
  });
});
