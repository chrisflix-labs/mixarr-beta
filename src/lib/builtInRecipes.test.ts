import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILT_IN_RECIPES, RECIPE_CATEGORY_IDS, compareRecipeVersions, getBuiltInRecipe, validateBuiltInRecipeCatalog } from "./builtInRecipes/catalog";
import { calculateRecipeCompatibility, type RecipeLibraryStats } from "./builtInRecipes/compatibility";

const fullCoverage: RecipeLibraryStats = {
  libraryId: "library-1", libraryName: "Music", totalTracks: 10_000,
  coverage: { playback_history: .91, ratings: .72, bpm: .84, mood: .8, energy: .86, genre: .97, artist: 1, album: 1, date_added: .99, release_year: .94, popularity: .88, local_analysis: .75 },
};

describe("v2.3.4 built-in recipe catalog", () => {
  it("ships 28 valid, stable, unique, offline definitions with every category covered", () => {
    assert.equal(BUILT_IN_RECIPES.length, 28);
    assert.equal(new Set(BUILT_IN_RECIPES.map((recipe) => recipe.id)).size, 28);
    assert.deepEqual(validateBuiltInRecipeCatalog(), { valid: true, errors: [] });
    for (const category of RECIPE_CATEGORY_IDS) assert.ok(BUILT_IN_RECIPES.some((recipe) => recipe.category === category), category);
    for (const recipe of BUILT_IN_RECIPES) {
      assert.match(recipe.id, /^builtin\.[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.equal(recipe.builtIn, true);
      assert.equal(recipe.engineConfig.generation.engineVersion, "v2");
      assert.ok(recipe.behaviorSummary.length > 0);
      assert.ok(Array.isArray(recipe.metadataRequirements));
      assert.ok(recipe.history.some((entry) => entry.version === recipe.version));
    }
  });

  it("implements Forgotten Favorites with history-aware fallback behavior", () => {
    const recipe = getBuiltInRecipe("builtin.forgotten-favorites");
    assert.ok(recipe);
    assert.equal(recipe.engineConfig.variety.recentlyPlayedExclusionDays, 60);
    assert.equal(recipe.engineConfig.discovery.familiarityBalance, 88);
    assert.ok(recipe.metadataRequirements.some((item) => item.id === "playback_history" && item.importance === "recommended"));
    assert.match(recipe.behaviorSummary.join(" "), /play count, favorites, popularity, and library age/i);
  });

  it("compares installed source versions without overwriting customization", () => {
    assert.equal(compareRecipeVersions(null, 2), "not_installed");
    assert.equal(compareRecipeVersions(1, 2), "update_available");
    assert.equal(compareRecipeVersions(2, 2), "current");
    assert.equal(compareRecipeVersions(3, 2), "newer_than_catalog");
  });
});

describe("recipe compatibility calculation", () => {
  it("uses real aggregate coverage and candidate pool size for an excellent result", () => {
    const recipe = getBuiltInRecipe("builtin.high-energy-workout")!;
    const result = calculateRecipeCompatibility(recipe, fullCoverage, 2_481);
    assert.equal(result.level, "excellent");
    assert.equal(result.eligibleTrackCount, 2_481);
    assert.equal(result.eligibleTrackCountExact, true);
    assert.equal(result.requiredMetadataSatisfied, true);
  });

  it("keeps missing recommended metadata usable with a fallback explanation", () => {
    const recipe = getBuiltInRecipe("builtin.forgotten-favorites")!;
    const stats = { ...fullCoverage, coverage: { ...fullCoverage.coverage, playback_history: 0, ratings: 0 } };
    const result = calculateRecipeCompatibility(recipe, stats);
    assert.notEqual(result.level, "unavailable");
    assert.deepEqual(result.missingRecommendedMetadata.sort(), ["playback_history", "ratings"]);
    assert.match(result.reasons.join(" "), /fallback/i);
  });

  it("marks a recipe unavailable only when required metadata has no coverage", () => {
    const recipe = getBuiltInRecipe("builtin.progressive-intensity")!;
    const stats = { ...fullCoverage, coverage: { ...fullCoverage.coverage, bpm: 0 } };
    const result = calculateRecipeCompatibility(recipe, stats);
    assert.equal(result.level, "unavailable");
    assert.deepEqual(result.missingRequiredMetadata, ["bpm"]);
  });

  it("handles an empty library without inventing compatibility", () => {
    const recipe = getBuiltInRecipe("builtin.open-road")!;
    const result = calculateRecipeCompatibility(recipe, { libraryId: null, libraryName: null, totalTracks: 0, coverage: Object.fromEntries(Object.keys(fullCoverage.coverage).map((key) => [key, 0])) as RecipeLibraryStats["coverage"] });
    assert.equal(result.level, "unavailable");
    assert.equal(result.eligibleTrackCount, 0);
  });
});
