import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeMoodSelection,
  moodBlendValidationMessage,
  pruneUnavailableMoodSelections,
} from "./moodBlendingUi";

const baseSettings = {
  moodBlendMode: "smooth_transition" as const,
  selectedMoodPath: ["happy", "energetic"],
  allowedMoods: [],
};

describe("mood blending UI state", () => {
  it("preserves selected moods when unrelated slider-like state changes", () => {
    const next = { ...baseSettings, moodStrength: 90 } as typeof baseSettings & { moodStrength: number };

    assert.deepEqual(activeMoodSelection(next), ["happy", "energetic"]);
  });

  it("requires at least two moods for Smooth Transition", () => {
    const message = moodBlendValidationMessage({
      moodBlendMode: "smooth_transition",
      selectedMoodPath: ["happy"],
      allowedMoods: [],
    });

    assert.match(message, /at least two moods/);
  });

  it("allows Strict Matching with one target mood", () => {
    const message = moodBlendValidationMessage({
      moodBlendMode: "strict_matching",
      selectedMoodPath: ["happy"],
      allowedMoods: [],
    });

    assert.equal(message, "");
  });

  it("requires one anchor mood for Mixed Mood", () => {
    const message = moodBlendValidationMessage({
      moodBlendMode: "mixed_mood",
      selectedMoodPath: [],
      allowedMoods: [],
    });

    assert.match(message, /at least one anchor mood/);
  });

  it("preserves selected mood ordering", () => {
    assert.deepEqual(activeMoodSelection(baseSettings), ["happy", "energetic"]);
  });

  it("clear behavior can remove selections", () => {
    const cleared = { ...baseSettings, selectedMoodPath: [] };

    assert.deepEqual(activeMoodSelection(cleared), []);
  });

  it("prunes invalid selections after changing libraries", () => {
    const result = pruneUnavailableMoodSelections({
      moodBlendMode: "smooth_transition",
      selectedMoodPath: ["happy", "dark", "party"],
      allowedMoods: ["focus"],
    }, ["happy", "party"]);

    assert.deepEqual(result.settings.selectedMoodPath, ["happy", "party"]);
    assert.deepEqual(result.settings.allowedMoods, []);
    assert.deepEqual(result.removed, ["dark", "focus"]);
  });

  it("keeps valid selections after changing libraries", () => {
    const result = pruneUnavailableMoodSelections(baseSettings, ["happy", "energetic", "party"]);

    assert.deepEqual(result.settings.selectedMoodPath, ["happy", "energetic"]);
    assert.deepEqual(result.removed, []);
  });
});
