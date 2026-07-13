import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SMART_MIX_TUNING } from "./smartMixEngine/v2";
import { getScoringModel, scoringModelRegistry, STABLE_SCORING_MODEL_ID } from "./scoringModels";

describe("Smart Mix scoring model registry", () => {
  it("keeps Stable v2 as the first and default model", () => {
    assert.equal(STABLE_SCORING_MODEL_ID, "stable-v2");
    assert.equal(scoringModelRegistry[0].id, STABLE_SCORING_MODEL_ID);
    assert.equal(scoringModelRegistry[0].stability, "STABLE");
    assert.equal(getScoringModel(undefined)?.id, STABLE_SCORING_MODEL_ID);
  });

  it("implements Experimental Balanced as a distinct registered model", () => {
    const stable = getScoringModel("stable-v2")!;
    const experimental = getScoringModel("experimental-balanced")!;
    const input = { ...DEFAULT_SMART_MIX_TUNING, moodWeight: 5, artistVariety: 10 };
    const stableOutput = stable.apply(input);
    const experimentalOutput = experimental.apply(input);
    assert.equal(experimental.requiredFeature, "smartMix.experimentalScoring");
    assert.notDeepEqual(experimentalOutput, stableOutput);
    assert.ok(experimentalOutput.moodWeight > stableOutput.moodWeight);
    assert.ok(experimentalOutput.artistVariety > stableOutput.artistVariety);
  });
});
