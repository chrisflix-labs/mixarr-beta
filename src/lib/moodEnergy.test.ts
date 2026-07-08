import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyMoodEnergyHealth,
  classifyMoodEnergyTracks,
  getMoodEnergyDisplayMetadata,
} from "./moodEnergy";

describe("mood and energy health", () => {
  it("classifies a track with energy and mood as complete", () => {
    const health = classifyMoodEnergyHealth({
      audioFeature: {
        localEnergy: 0.82,
        localMood: 0.71,
        tempo: 120,
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "success",
        energySource: "local_essentia",
        valenceSource: "local_essentia",
      },
    }, { api: false, local: true });

    assert.equal(health.status, "complete");
    assert.equal(health.complete, true);
    assert.deepEqual(health.missingFields, []);
  });

  it("separates missing mood, missing energy, and missing both", () => {
    const classified = classifyMoodEnergyTracks([
      { id: "missing-mood", syncStatus: "active", audioFeature: { localEnergy: 0.6, audioFeatureSource: "local_essentia", audioFeatureStatus: "partial" } },
      { id: "missing-energy", syncStatus: "active", audioFeature: { localMood: 0.4, audioFeatureSource: "local_essentia", audioFeatureStatus: "partial" } },
      { id: "missing-both", syncStatus: "active", audioFeature: null },
    ], { api: false, local: true });

    assert.deepEqual(classified.matchingTrackIds.missing_mood, ["missing-mood", "missing-both"]);
    assert.deepEqual(classified.matchingTrackIds.missing_energy, ["missing-energy", "missing-both"]);
    assert.deepEqual(classified.matchingTrackIds.missing_mood_energy, ["missing-both"]);
    assert.equal(classified.counts.partial_mood_energy, 2);
  });

  it("keeps BPM-present mood/energy gaps partial for audio features", () => {
    const health = classifyMoodEnergyHealth({
      bpm: 124,
      bpmSource: "Deezer",
      audioFeature: {
        tempo: 124,
        tempoSource: "api",
        audioFeatureStatus: "partial",
      },
    }, { api: false, local: true });

    assert.equal(health.status, "partial");
    assert.deepEqual(health.missingFields, ["energy", "mood"]);
  });

  it("maps source and confidence labels for local, API/imported, estimated, and missing values", () => {
    const local = getMoodEnergyDisplayMetadata({
      audioFeature: {
        localEnergy: 0.82,
        localMood: 0.71,
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "success",
        audioFeatureConfidence: 0.94,
        energySource: "local_essentia",
        valenceSource: "local_essentia",
      },
    }, { api: false, local: true });
    assert.equal(local.energy.source, "Local Essentia");
    assert.equal(local.energy.confidence, "High");
    assert.equal(local.mood.confidence, "High");

    const api = getMoodEnergyDisplayMetadata({
      audioFeature: {
        apiEnergy: 0.52,
        apiMood: 0.48,
        audioFeatureSource: "api",
        audioFeatureStatus: "success",
        audioFeatureConfidence: 0.75,
        energySource: "api",
        valenceSource: "api",
      },
    }, { api: true, local: false });
    assert.equal(api.energy.source, "API");
    assert.equal(api.energy.confidence, "Medium");

    const estimated = getMoodEnergyDisplayMetadata({
      audioFeature: {
        energy: 0.5,
        valence: 0.5,
        audioFeatureSource: "local_heuristic",
        audioFeatureStatus: "success",
        audioFeatureConfidence: 0.3,
        energySource: "local_heuristic",
        valenceSource: "local_heuristic",
      },
    }, { api: false, local: true, allowEstimated: true });
    assert.equal(estimated.energy.source, "Estimated");
    assert.equal(estimated.energy.confidence, "Low");

    const missing = getMoodEnergyDisplayMetadata({ audioFeature: null });
    assert.equal(missing.energy.value, null);
    assert.equal(missing.energy.confidence, "Unknown");
  });
});
