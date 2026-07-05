import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bpmBackfillCandidateTrackWhere,
  bpmBackfillTrackWhere,
  bpmRetryEligibilityTrackWhere,
  buildBpmSourceWhereClause,
  classifyBpmSource,
  explainBpmBackfillEligibility,
  hasEffectiveBpm,
  hasLocalEssentiaBpmSuccess,
  localEssentiaBpmSuccessTrackWhere,
  normalizeBpmBackfillFilter,
} from "./bpm";

describe("BPM eligibility", () => {
  it("treats local_essentia success as completed effective BPM", () => {
    const track = {
      bpm: 134.85,
      localBpm: 134.85,
      bpmSource: "local_essentia",
      bpmAnalysisStatus: "success",
      audioFeature: {
        tempo: 134.85,
        tempoSource: "Essentia local whole-track analysis",
      },
    };

    assert.equal(hasEffectiveBpm(track), true);
    assert.equal(hasLocalEssentiaBpmSuccess(track), true);
    assert.deepEqual(explainBpmBackfillEligibility(track, {
      reprocessApiWithLocal: true,
      includeAubioReprocess: true,
      retryNoDataFailed: true,
    }).selected, false);
  });

  it("excludes local_essentia success rows from backfill and API reprocess", () => {
    const where = JSON.stringify(bpmBackfillCandidateTrackWhere({ reprocessApiWithLocal: true }));

    assert.match(where, /local_essentia/);
    assert.match(where, /NOT/);
    assert.match(where, /apiBpm/);
  });

  it("selects API BPM for local reprocess only when no local_essentia success exists", () => {
    const apiOnly = explainBpmBackfillEligibility({
      bpm: 120,
      apiBpm: 120,
      bpmSource: "api",
      bpmAnalysisStatus: "success",
      audioFeature: null,
    }, { reprocessApiWithLocal: true });
    const alreadyLocal = explainBpmBackfillEligibility({
      bpm: 120,
      apiBpm: 118,
      localBpm: 120,
      bpmSource: "local_essentia",
      bpmAnalysisStatus: "success",
      audioFeature: { tempo: 120, tempoSource: "Essentia local whole-track analysis" },
    }, { reprocessApiWithLocal: true });

    assert.equal(apiOnly.selected, true);
    assert.equal(apiOnly.reason, "api_or_imported_reprocess_without_local_success");
    assert.equal(alreadyLocal.selected, false);
  });

  it("includes API BPM rows when the api_bpm filter is forced", () => {
    const apiTrack = {
      bpm: 120,
      apiBpm: 120,
      bpmSource: "api",
      bpmAnalysisStatus: "success",
      audioFeature: null,
    };
    const explanation = explainBpmBackfillEligibility(apiTrack, {
      filter: "api_bpm",
      force: true,
    });
    const where = JSON.stringify(bpmBackfillTrackWhere({
      filter: "api_bpm",
      force: true,
    }));

    assert.equal(explanation.selected, true);
    assert.equal(explanation.reason, "api_bpm_force");
    assert.match(where, /apiBpm/);
    assert.doesNotMatch(where, /missingEffectiveBpm/);
  });

  it("includes API BPM rows when the api_bpm filter is selected for local-only retry", () => {
    const apiTrack = {
      bpm: 120,
      apiBpm: 120,
      bpmSource: "api",
      bpmAnalysisStatus: "success",
      audioFeature: null,
    };
    const explanation = explainBpmBackfillEligibility(apiTrack, {
      filter: "api_bpm",
      force: false,
    });

    assert.equal(explanation.selected, true);
    assert.equal(explanation.reason, "api_bpm_local_reprocess");
  });

  it("skips API BPM rows in normal missing-only mode", () => {
    const apiTrack = {
      bpm: 120,
      apiBpm: 120,
      bpmSource: "api",
      bpmAnalysisStatus: "success",
      audioFeature: null,
    };
    const explanation = explainBpmBackfillEligibility(apiTrack);

    assert.equal(explanation.selected, false);
    assert.equal(explanation.reason, "not_eligible");
  });

  it("allows local-only API BPM retry eligibility without requiring missing BPM", () => {
    const localOnly = JSON.stringify(bpmRetryEligibilityTrackWhere({
      providerMode: "local_only",
      filter: "api_bpm",
    }));
    const normal = JSON.stringify(bpmRetryEligibilityTrackWhere({
      providerMode: "configured",
      filter: "api_bpm",
    }));

    assert.equal(localOnly, "{}");
    assert.match(normal, /apiBpm|effectiveBpm|bpm/);
    assert.equal(normal.includes("local_essentia"), true);
  });

  it("classifies API, local, and imported BPM sources with one shared helper", () => {
    assert.equal(classifyBpmSource({ bpm: 120, apiBpm: 120, bpmSource: "api" }), "api_bpm");
    assert.equal(classifyBpmSource({
      bpm: 124,
      apiBpm: 120,
      localBpm: 124,
      bpmSource: "local_essentia",
      bpmAnalysisStatus: "success",
    }), "local_bpm");
    assert.equal(classifyBpmSource({ bpm: 118, bpmSource: "imported" }), "imported_bpm");
    assert.equal(classifyBpmSource({ bpm: null }), "missing_bpm");

    const apiWhere = JSON.stringify(buildBpmSourceWhereClause("api_bpm"));
    const localWhere = JSON.stringify(buildBpmSourceWhereClause("local_bpm"));
    const importedWhere = JSON.stringify(buildBpmSourceWhereClause("imported_bpm"));
    assert.match(apiWhere, /apiBpm/);
    assert.match(apiWhere, /NOT/);
    assert.match(localWhere, /localBpm/);
    assert.match(importedWhere, /NOT/);
  });

  it("moves a successful local replacement out of API BPM and into Local BPM classification", () => {
    const before = {
      bpm: 120,
      apiBpm: 120,
      localBpm: null,
      bpmSource: "api",
      bpmAnalysisStatus: "success",
    };
    const after = {
      bpm: 124,
      apiBpm: 120,
      localBpm: 124,
      bpmSource: "local_essentia",
      bpmAnalysisStatus: "success",
      audioFeature: { tempo: 124, tempoSource: "Essentia local whole-track analysis" },
    };

    assert.equal(classifyBpmSource(before), "api_bpm");
    assert.equal(classifyBpmSource(after), "local_bpm");
  });

  it("retry eligibility skips already-completed tracks after restart unless forced", () => {
    const retry = JSON.stringify(bpmRetryEligibilityTrackWhere({ providerMode: "configured" }));
    const force = JSON.stringify(bpmRetryEligibilityTrackWhere({ providerMode: "force_local" }));

    assert.match(retry, /local_essentia/);
    assert.match(retry, /too_short/);
    assert.match(retry, /NOT/);
    assert.equal(force, "{}");
  });

  it("queue status candidates and found count can use the same candidate query", () => {
    const options = {
      includeAubioReprocess: true,
      retryNoDataFailed: false,
      reprocessApiWithLocal: true,
    };

    const foundWhere = bpmBackfillTrackWhere(options);
    const queueStatusWhere = {
      AND: [
        { syncStatus: "active" },
        bpmBackfillCandidateTrackWhere(options),
      ],
    };

    assert.deepEqual(foundWhere, queueStatusWhere);
  });

  it("normalizes legacy health filters into BPM backfill filters", () => {
    assert.equal(normalizeBpmBackfillFilter("imported_bpm"), "imported_legacy_bpm");
    assert.equal(normalizeBpmBackfillFilter("bpm_failed"), "failed");
    assert.equal(normalizeBpmBackfillFilter(undefined, { force: true }), "all_active");
  });

  it("recognizes local success from canonical local BPM fields", () => {
    assert.equal(hasLocalEssentiaBpmSuccess({ localBpm: 121 }), true);
    assert.equal(hasLocalEssentiaBpmSuccess({
      bpmSource: "local_essentia",
      bpmAnalysisStatus: "success",
    }), true);
    assert.equal(hasLocalEssentiaBpmSuccess({
      audioFeature: { tempo: 121, tempoSource: "Essentia local whole-track analysis" },
    }), true);

    const localSuccessWhere = JSON.stringify(localEssentiaBpmSuccessTrackWhere());
    assert.match(localSuccessWhere, /localBpm/);
    assert.match(localSuccessWhere, /bpmAnalysisStatus/);
    assert.match(localSuccessWhere, /tempoSource/);
  });
});
