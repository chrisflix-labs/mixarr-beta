import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { duplicateRecipeName, playlistRecipeSchema, summarizePlaylistRecipeFilters } from "./playlistRecipes";

describe("playlist recipes", () => {
  it("creates the first copy name when duplicating a recipe", () => {
    assert.equal(duplicateRecipeName("Workout Mix", ["Workout Mix"]), "Workout Mix Copy");
  });

  it("increments copy names when duplicates already exist", () => {
    assert.equal(
      duplicateRecipeName("Workout Mix", ["Workout Mix", "Workout Mix Copy", "Workout Mix Copy 2"]),
      "Workout Mix Copy 3",
    );
  });

  it("rejects blank recipe names with the required message", () => {
    const result = playlistRecipeSchema.safeParse({
      name: " ",
      description: "",
      filters: {
        rules: [{ field: "popularity", operator: "gt", value: "50" }],
        limit: 50,
        duplicateStrategy: "song_artist",
        preferNonLive: true,
        excludeRemasters: false,
        negativeFilters: {},
      },
    });

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.issues[0]?.message, "Recipe name is required.");
    }
  });

  it("summarizes BPM preset metadata before raw BPM ranges", () => {
    const parsed = playlistRecipeSchema.parse({
      name: "Dance Mix",
      description: "",
      filters: {
        rules: [
          { field: "tempo", operator: "gte", value: "120" },
          { field: "tempo", operator: "lte", value: "140" },
        ],
        limit: 50,
        duplicateStrategy: "song_artist",
        preferNonLive: true,
        excludeRemasters: false,
        negativeFilters: {},
        safetyRules: {},
        bpmPresetId: "dance",
        bpmPresetName: "Dance",
        bpmPresetVersion: "v1",
      },
    });

    const summary = summarizePlaylistRecipeFilters(parsed.filters);

    assert.match(summary, /BPM: Dance/);
    assert.doesNotMatch(summary, /BPM: 120–140/);
  });

  it("keeps existing recipes without BPM preset metadata valid", () => {
    const parsed = playlistRecipeSchema.parse({
      name: "Manual Mix",
      description: "",
      filters: {
        rules: [
          { field: "tempo", operator: "gte", value: "90" },
          { field: "tempo", operator: "lte", value: "120" },
        ],
        limit: 50,
        duplicateStrategy: "song_artist",
        preferNonLive: true,
        excludeRemasters: false,
        negativeFilters: {},
        safetyRules: {},
      },
    });

    assert.equal(parsed.filters.bpmPresetName, undefined);
    assert.match(summarizePlaylistRecipeFilters(parsed.filters), /BPM: 90–120/);
  });
});
