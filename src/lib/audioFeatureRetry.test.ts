import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  audioFeatureRetryEligibility,
  audioFeatureRetryProviderMode,
  configuredProviderLabel,
  normalizeAudioFeatureRetryMode,
} from "./audioFeatureRetry";

describe("audio feature retry", () => {
  const localSettings = { api: false, local: true, preferLocal: true, allowEstimated: true };

  it("reports the actual provider mode from settings", () => {
    assert.equal(audioFeatureRetryProviderMode(localSettings), "local_enabled_api_disabled");
    assert.equal(configuredProviderLabel(localSettings), "Local Essentia");
  });

  it("normalizes legacy and v1.3.1 retry modes", () => {
    assert.equal(normalizeAudioFeatureRetryMode("configured"), "configured_providers");
    assert.equal(normalizeAudioFeatureRetryMode("configured_providers"), "configured_providers");
    assert.equal(normalizeAudioFeatureRetryMode("force_local"), "force_local_reprocess");
    assert.equal(normalizeAudioFeatureRetryMode("force_local_reprocess"), "force_local_reprocess");
  });

  it("allows partial local retries when a local file exists", () => {
    const reason = audioFeatureRetryEligibility({
      id: "track-1",
      title: "Song",
      mediaPath: "/music/song.flac",
      syncStatus: "active",
      bpm: 120,
      bpmSource: "plex",
      artist: { title: "Artist" },
      audioFeature: {
        localEnergy: 0.7,
        tempo: 120,
        audioFeatureStatus: "partial",
        audioFeatureSource: "local_essentia",
      },
    }, { mode: "local_only", settings: localSettings });

    assert.equal(reason, null);
  });

  it("explains missing local files before queueing local retries", () => {
    const reason = audioFeatureRetryEligibility({
      id: "track-1",
      title: "Song",
      mediaPath: null,
      syncStatus: "active",
      bpm: 120,
      bpmSource: "plex",
      artist: { title: "Artist" },
      audioFeature: {
        localEnergy: 0.7,
        tempo: 120,
        audioFeatureStatus: "partial",
      },
    }, { mode: "local_only", settings: localSettings });

    assert.equal(reason, "missing_local_file");
  });

  it("does not silently queue API-only retries when API features are disabled", () => {
    const reason = audioFeatureRetryEligibility({
      id: "track-1",
      title: "Song",
      mediaPath: "/music/song.flac",
      syncStatus: "active",
      artist: { title: "Artist" },
      audioFeature: null,
    }, { mode: "api_only", settings: localSettings });

    assert.equal(reason, "api_disabled");
  });

  it("allows force local reprocess for complete tracks with local files", () => {
    const reason = audioFeatureRetryEligibility({
      id: "track-1",
      title: "Song",
      mediaPath: "/music/song.flac",
      syncStatus: "active",
      bpm: 120,
      artist: { title: "Artist" },
      audioFeature: {
        localEnergy: 0.7,
        localMood: 0.6,
        localDanceability: 0.5,
        localAcousticness: 0.4,
        tempo: 120,
        audioFeatureStatus: "success",
        audioFeatureSource: "local_essentia",
      },
    }, { mode: "force_local_reprocess", settings: localSettings });

    assert.equal(reason, null);
  });

  it("explains pending audio-feature rows as already processing", () => {
    const reason = audioFeatureRetryEligibility({
      id: "track-1",
      title: "Song",
      mediaPath: "/music/song.flac",
      syncStatus: "active",
      artist: { title: "Artist" },
      audioFeature: {
        audioFeatureStatus: "pending",
      },
    }, { mode: "local_only", settings: localSettings });

    assert.equal(reason, "already_processing");
  });
});
