import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveAudioFeatureProviders,
  runAudioFeatureOrchestration,
  type EffectiveProviderSettings,
  type ProviderCapability,
} from "./audioFeatureOrchestrationCore";

const settings = (audio: Partial<EffectiveProviderSettings["audioFeatures"]> = {}): EffectiveProviderSettings => ({
  audioFeatures: { api: false, local: true, preferLocal: true, ...audio },
  bpm: { api: false, local: true, preferLocal: true },
});

const apiCapability: ProviderCapability = {
  providerKey: "audiodb",
  use: "audioFeatures",
  enabled: true,
  usable: true,
};

const emptyBatch = async () => ({ attempted: 0, processed: 0, skipped: 0, failed: 0, eligible: 0, remainingEligible: 0 });

describe("audio feature provider resolution", () => {
  it("selects local Essentia in local-only mode", () => {
    const decision = resolveAudioFeatureProviders({ settings: settings(), capabilities: [] });
    assert.deepEqual(decision.order, ["local"]);
    assert.equal(decision.provider, "local");
  });

  it("falls back to local when API is preferred but unavailable", () => {
    const decision = resolveAudioFeatureProviders({
      settings: settings({ api: true, local: true, preferLocal: false }),
      capabilities: [{ ...apiCapability, usable: false, reason: "missing credentials" }],
    });
    assert.deepEqual(decision.order, ["local"]);
    assert.equal(decision.fallbackUsed, true);
    assert.equal(decision.localAvailable, true);
  });

  it("treats API preference as ordering rather than disabling local", () => {
    const decision = resolveAudioFeatureProviders({
      settings: settings({ api: true, local: true, preferLocal: false }),
      capabilities: [apiCapability],
    });
    assert.deepEqual(decision.order, ["api", "local"]);
  });
});

describe("shared audio feature orchestration", () => {
  it("returns an intentional skipped state when all providers are disabled", async () => {
    const result = await runAudioFeatureOrchestration({
      source: "nightly",
      settingsSource: "database",
      settings: {
        audioFeatures: { api: false, local: false, preferLocal: false },
        bpm: { api: false, local: false, preferLocal: false },
      },
      capabilities: [],
      runApiBatch: emptyBatch,
      runLocalBatch: emptyBatch,
    });
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "audio_features_disabled");
  });

  it("returns a warning rather than zero-work success when enabled providers are unusable", async () => {
    const unusableSettings = settings({ api: true, local: false, preferLocal: false });
    unusableSettings.bpm = { api: false, local: false, preferLocal: false };
    const result = await runAudioFeatureOrchestration({
      source: "nightly",
      settingsSource: "database",
      settings: unusableSettings,
      capabilities: [{ ...apiCapability, usable: false, reason: "missing credentials" }],
      runApiBatch: emptyBatch,
      runLocalBatch: emptyBatch,
    });
    assert.equal(result.status, "warning");
    assert.equal(result.reason, "no_usable_provider");
  });

  it("returns a valid no-eligible-track completion", async () => {
    const result = await runAudioFeatureOrchestration({
      source: "nightly",
      settingsSource: "database",
      settings: settings(),
      capabilities: [],
      runApiBatch: emptyBatch,
      runLocalBatch: emptyBatch,
    });
    assert.equal(result.status, "completed");
    assert.equal(result.reason, "no_tracks_require_processing");
    assert.equal(result.attempted, 0);
  });

  it("drains multiple pending batches before completing", async () => {
    const batches = [
      { attempted: 2, processed: 2, skipped: 0, failed: 0, eligible: 3, remainingEligible: 1 },
      { attempted: 1, processed: 1, skipped: 0, failed: 0, eligible: 1, remainingEligible: 0 },
      { attempted: 0, processed: 0, skipped: 0, failed: 0, eligible: 0, remainingEligible: 0 },
    ];
    const result = await runAudioFeatureOrchestration({
      source: "nightly",
      settingsSource: "database",
      settings: settings(),
      capabilities: [],
      runApiBatch: emptyBatch,
      runLocalBatch: async () => batches.shift()!,
    });
    assert.equal(result.status, "completed");
    assert.equal(result.processed, 3);
    assert.equal(result.batches, 3);
  });

  it("fails safely when a batch reports no progress with eligible tracks remaining", async () => {
    const result = await runAudioFeatureOrchestration({
      source: "nightly",
      settingsSource: "database",
      settings: settings(),
      capabilities: [],
      runApiBatch: emptyBatch,
      runLocalBatch: async () => ({ attempted: 0, processed: 0, skipped: 0, failed: 0, eligible: 4, remainingEligible: 4 }),
    });
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "audio_feature_processing_failed");
    assert.match(result.message, /no progress/i);
  });

  it("uses the same orchestration behavior for manual and nightly sources", async () => {
    const execute = (source: string) => runAudioFeatureOrchestration({
      source,
      settingsSource: "database",
      settings: settings(),
      capabilities: [],
      runApiBatch: emptyBatch,
      runLocalBatch: emptyBatch,
    });
    const [manual, nightly] = await Promise.all([execute("manual"), execute("nightly")]);
    assert.equal(manual.reason, nightly.reason);
    assert.deepEqual(manual.providers, nightly.providers);
  });
});
