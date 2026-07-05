import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRetryExplanation, formatRetrySkipReasons } from "./retryExplanations";

describe("retry explanations", () => {
  it("summarizes retry results with queued tracks", () => {
    const result = buildRetryExplanation({
      retryType: "BPM",
      filter: "api_bpm",
      matched: 50,
      queued: 42,
      skipped: 8,
      skipReasons: { not_missing_bpm: 8 },
      mode: "configured",
    });

    assert.match(result.message, /Queued BPM retry for filter api_bpm: 42 tracks/);
    assert.match(result.message, /matched=50, queued=42, skipped=8/);
    assert.match(result.message, /not_missing_bpm=8/);
  });

  it("explains matched zero-queue BPM retry results", () => {
    const result = buildRetryExplanation({
      retryType: "BPM",
      filter: "api_bpm",
      matched: 968,
      queued: 0,
      skipped: 968,
      skipReasons: { not_missing_bpm: 968 },
      mode: "configured",
    });

    assert.match(result.message, /No BPM retry jobs were queued for filter api_bpm/);
    assert.match(result.message, /matched=968, queued=0, skipped=968/);
    assert.match(result.message, /already have BPM data/);
    assert.match(result.message, /Try force local reprocess/);
  });

  it("explains audio-feature zero-queue retry results", () => {
    const result = buildRetryExplanation({
      retryType: "audio-feature",
      filter: "partial_audio_features",
      matched: 12,
      queued: 0,
      skipped: 12,
      skipReasons: { already_has_complete_audio_features: 12 },
      mode: "local_only",
    });

    assert.match(result.message, /No audio-feature retry jobs were queued for filter partial_audio_features/);
    assert.match(result.message, /already have complete audio features/);
    assert.match(result.message, /mode=local_only/);
  });

  it("explains when no tracks matched the selected filter", () => {
    const result = buildRetryExplanation({
      retryType: "BPM",
      filter: "missing_bpm",
      matched: 0,
      queued: 0,
      skipped: 0,
    });

    assert.match(result.message, /matched=0, queued=0, skipped=0/);
    assert.match(result.message, /No tracks matched the selected filter/);
  });

  it("formats skip reason counts compactly", () => {
    assert.equal(formatRetrySkipReasons({ unknown: 0, already_has_local_bpm: 3, missing_file: 2 }), "already_has_local_bpm=3, missing_file=2");
  });
});
