import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BPM_PRESET_VERSION,
  bpmPresetLabel,
  bpmPresetRangeLabel,
  buildBpmPresetRules,
  getBpmPreset,
  bpmPresets,
} from "./bpmPresets";
import { playlistConfigSchema } from "./playlistService";

function valuesFor(presetId: string) {
  const preset = getBpmPreset(presetId);
  assert.ok(preset);
  return buildBpmPresetRules(preset).map((rule) => rule.value);
}

describe("BPM range presets", () => {
  it("defines the v1.2.2 BPM preset set", () => {
    assert.deepEqual(
      bpmPresets.map((preset) => preset.name),
      ["Slow", "Medium", "Upbeat", "Dance", "High Energy", "Wide Open"],
    );
  });

  it("applies the expected BPM ranges", () => {
    assert.deepEqual(valuesFor("slow"), ["60", "90"]);
    assert.deepEqual(valuesFor("medium"), ["90", "120"]);
    assert.deepEqual(valuesFor("upbeat"), ["100", "135"]);
    assert.deepEqual(valuesFor("dance"), ["120", "140"]);
    assert.deepEqual(valuesFor("high-energy"), ["140", "180"]);
    assert.deepEqual(valuesFor("wide-open"), []);
  });

  it("formats preset range labels", () => {
    assert.equal(bpmPresetRangeLabel(getBpmPreset("dance")), "120–140 BPM");
    assert.equal(bpmPresetRangeLabel(getBpmPreset("wide-open")), "Any BPM");
  });

  it("formats BPM preset names", () => {
    assert.equal(bpmPresetLabel("Dance"), "Dance");
    assert.equal(bpmPresetLabel("Dance", true), "Dance modified");
    assert.equal(bpmPresetLabel(null), "Custom");
  });

  it("accepts BPM preset metadata in playlist configs", () => {
    const dance = getBpmPreset("dance");
    assert.ok(dance);
    const parsed = playlistConfigSchema.parse({
      rules: buildBpmPresetRules(dance),
      limit: 25,
      duplicateStrategy: "song_artist",
      preferNonLive: true,
      excludeRemasters: false,
      negativeFilters: {},
      safetyRules: {},
      bpmPresetId: "dance",
      bpmPresetName: "Dance",
      bpmPresetVersion: BPM_PRESET_VERSION,
      bpmPresetModified: true,
    });

    assert.equal(parsed.bpmPresetId, "dance");
    assert.equal(parsed.bpmPresetName, "Dance");
    assert.equal(parsed.bpmPresetVersion, BPM_PRESET_VERSION);
    assert.equal(parsed.bpmPresetModified, true);
  });
});
