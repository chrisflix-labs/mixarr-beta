import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSmartPresetConfig, getSmartPlaylistPreset, SMART_PRESET_VERSION, smartPlaylistPresets } from "./smartPlaylistPresets";
import { playlistConfigSchema } from "./playlistService";

function rulesFor(presetId: string) {
  const preset = getSmartPlaylistPreset(presetId);
  assert.ok(preset);
  return buildSmartPresetConfig(preset).rules;
}

describe("smart playlist presets", () => {
  it("defines every v1 preset required by Smart Playlist Builder", () => {
    assert.deepEqual(
      smartPlaylistPresets.map((preset) => preset.name),
      ["Workout", "Chill", "Party", "Focus", "Driving", "Discovery", "Deep Cuts", "Popular Favorites", "Balanced Mix"],
    );
  });

  it("generates playlist config objects accepted by the existing playlist schema", () => {
    for (const preset of smartPlaylistPresets) {
      const parsed = playlistConfigSchema.parse(buildSmartPresetConfig(preset));

      assert.equal(parsed.smartPresetId, preset.id);
      assert.equal(parsed.smartPresetName, preset.name);
      assert.equal(parsed.smartPresetVersion, SMART_PRESET_VERSION);
      assert.equal(parsed.safetyRules.avoidSameArtistBackToBack, true);
      assert.equal(parsed.limit > 0, true);
    }
  });

  it("applies Workout BPM, energy, and safety defaults", () => {
    const preset = getSmartPlaylistPreset("workout");
    assert.ok(preset);
    const config = playlistConfigSchema.parse(buildSmartPresetConfig(preset));

    assert.deepEqual(rulesFor("workout").filter((rule) => rule.field === "tempo").map((rule) => rule.value), ["115", "160"]);
    assert.deepEqual(rulesFor("workout").filter((rule) => rule.field === "energy").map((rule) => rule.value), ["0.7", "1"]);
    assert.equal(config.safetyRules.limitTracksPerArtist, true);
    assert.equal(config.safetyRules.maxTracksPerArtist, 3);
    assert.equal(config.limit, 50);
  });

  it("applies Chill lower-energy defaults", () => {
    const config = playlistConfigSchema.parse(buildSmartPresetConfig(getSmartPlaylistPreset("chill")!));

    assert.deepEqual(rulesFor("chill").filter((rule) => rule.field === "energy").map((rule) => rule.value), ["0", "0.55"]);
    assert.deepEqual(rulesFor("chill").filter((rule) => rule.field === "tempo").map((rule) => rule.value), ["60", "110"]);
    assert.equal(config.limit, 40);
  });

  it("applies Discovery lower-popularity and stronger variety defaults", () => {
    const config = playlistConfigSchema.parse(buildSmartPresetConfig(getSmartPlaylistPreset("discovery")!));
    const popularityRule = config.rules.find((rule) => rule.field === "popularity");

    assert.equal(popularityRule?.operator, "lte");
    assert.equal(popularityRule?.value, "55");
    assert.equal(config.safetyRules.maxTracksPerArtist, 2);
    assert.equal(config.limit, 50);
  });
});
