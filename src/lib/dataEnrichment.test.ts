import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dataEnrichmentActionConfigs,
  formatDataEnrichmentModeLabel,
  formatPreflightSummary,
  formatProviderEnabledLabel,
  formatPreferLocalLabel,
} from "./dataEnrichment";

describe("data enrichment cleanup helpers", () => {
  it("uses readable provider labels instead of internal mode keys", () => {
    assert.equal(formatDataEnrichmentModeLabel("Local enabled, API disabled", "BPM mode"), "BPM mode: Local enabled, API disabled");
    assert.equal(formatPreferLocalLabel(true), "Prefer local values: Enabled");
    assert.equal(formatProviderEnabledLabel("API enrichment", false), "API enrichment: Disabled");
  });

  it("explains no-op preflights without queueing silent jobs", () => {
    assert.equal(
      formatPreflightSummary({
        matched: 0,
        eligible: 0,
        skipped: 0,
        skipReasons: {},
        providerMode: "Local enabled, API disabled",
        estimatedAction: "Queue eligible tracks.",
      }),
      "No matching tracks need this enrichment action.",
    );
    assert.equal(
      formatPreflightSummary({
        matched: 70,
        eligible: 0,
        skipped: 70,
        skipReasons: { missing_local_file: 70 },
        providerMode: "Local enabled, API disabled",
        estimatedAction: "Analyze eligible local files.",
      }),
      "Matched 70 tracks, but none are eligible. Skipped: missing_local_file=70.",
    );
  });

  it("aligns retry actions with Library Health filters", () => {
    assert.equal(dataEnrichmentActionConfigs.retry_missing_bpm.filter, "missing_bpm");
    assert.equal(dataEnrichmentActionConfigs.retry_partial_audio_features.filter, "partial_audio_features");
    assert.equal(dataEnrichmentActionConfigs.retry_pending_audio_features.filter, "pending_audio_features");
    assert.equal(dataEnrichmentActionConfigs.retry_missing_mood_energy.filter, "missing_mood_energy");
    assert.equal(dataEnrichmentActionConfigs.retry_partial_mood_energy.filter, "partial_mood_energy");
    assert.equal(dataEnrichmentActionConfigs.retry_missing_genres.filter, "missing_genres");
    assert.equal(dataEnrichmentActionConfigs.retry_missing_popularity.filter, "missing_popularity");
  });

  it("keeps force local actions grouped as advanced actions", () => {
    assert.equal(dataEnrichmentActionConfigs.force_local_bpm_reprocess.advanced, true);
    assert.equal(dataEnrichmentActionConfigs.force_local_audio_reprocess.advanced, true);
    assert.equal(dataEnrichmentActionConfigs.force_local_mood_energy_reprocess.advanced, true);
  });
});
