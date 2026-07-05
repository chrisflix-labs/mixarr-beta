import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { duplicateRecipeName, playlistRecipeSchema } from "./playlistRecipes";

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
});
