import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyMoodPresetToRules, buildMoodPresetRules, getMoodPreset, MOOD_PRESET_VERSION, moodPresets } from "./moodPresets";
import { playlistConfigSchema, type PlaylistRuleInput } from "./playlistService";

function valuesFor(presetId: string, field: PlaylistRuleInput["field"]) {
  const preset = getMoodPreset(presetId);
  assert.ok(preset);
  return buildMoodPresetRules(preset).filter((rule) => rule.field === field).map((rule) => rule.value);
}

describe("mood presets", () => {
  it("defines the v1.2.1 mood preset set", () => {
    assert.deepEqual(
      moodPresets.map((preset) => preset.name),
      ["Happy", "Chill", "Hype", "Dark", "Emotional", "Sad / Mellow", "Relaxed", "Focus", "Upbeat", "Balanced"],
    );
  });

  it("applies Happy mood, energy, and BPM ranges", () => {
    assert.deepEqual(valuesFor("happy", "valence"), ["0.7", "1"]);
    assert.deepEqual(valuesFor("happy", "energy"), ["0.4", "0.9"]);
    assert.deepEqual(valuesFor("happy", "tempo"), ["85", "140"]);
  });

  it("applies Chill lower-energy ranges", () => {
    assert.deepEqual(valuesFor("chill", "valence"), ["0.35", "0.75"]);
    assert.deepEqual(valuesFor("chill", "energy"), ["0", "0.45"]);
    assert.deepEqual(valuesFor("chill", "tempo"), ["60", "110"]);
  });

  it("applies Hype high-energy and fast-BPM ranges", () => {
    assert.deepEqual(valuesFor("hype", "valence"), ["0.65", "1"]);
    assert.deepEqual(valuesFor("hype", "energy"), ["0.75", "1"]);
    assert.deepEqual(valuesFor("hype", "tempo"), ["120", "170"]);
  });

  it("clears mood-specific rules for Balanced while preserving unrelated filters", () => {
    const balanced = getMoodPreset("balanced");
    assert.ok(balanced);
    const rules = applyMoodPresetToRules([
      { field: "genre", operator: "contains", value: "rock" },
      { field: "energy", operator: "gte", value: "0.7" },
      { field: "valence", operator: "lte", value: "0.4" },
      { field: "tempo", operator: "gte", value: "120" },
    ], balanced);

    assert.deepEqual(rules, [{ field: "genre", operator: "contains", value: "rock" }]);
  });

  it("accepts mood preset metadata in playlist configs", () => {
    const parsed = playlistConfigSchema.parse({
      rules: buildMoodPresetRules(getMoodPreset("happy")!),
      limit: 25,
      duplicateStrategy: "song_artist",
      preferNonLive: true,
      excludeRemasters: false,
      negativeFilters: {},
      safetyRules: {},
      moodPresetId: "happy",
      moodPresetName: "Happy",
      moodPresetVersion: MOOD_PRESET_VERSION,
      moodPresetModified: true,
    });

    assert.equal(parsed.moodPresetId, "happy");
    assert.equal(parsed.moodPresetName, "Happy");
    assert.equal(parsed.moodPresetVersion, MOOD_PRESET_VERSION);
    assert.equal(parsed.moodPresetModified, true);
  });
});
