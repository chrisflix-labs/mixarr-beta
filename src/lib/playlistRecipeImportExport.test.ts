import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildImportPreview,
  buildRecipesExport,
  buildSingleRecipeExport,
  importedRecipeName,
  INVALID_RECIPE_EXPORT_MESSAGE,
  prepareImportedRecipes,
  sanitizeRecipeFilename,
  UNSUPPORTED_RECIPE_EXPORT_VERSION_MESSAGE,
} from "./playlistRecipeImportExport";

const sampleFilters = {
  rules: [
    { field: "tempo", operator: "gte", value: "120" },
    { field: "energy", operator: "gte", value: "0.75" },
  ],
  limit: 50,
  duplicateStrategy: "song_artist",
  preferNonLive: true,
  excludeRemasters: false,
  negativeFilters: { excludeExplicit: true },
  safetyRules: {
    avoidSameArtistBackToBack: true,
    limitTracksPerArtist: true,
    maxTracksPerArtist: 3,
    limitTracksPerAlbum: false,
    maxTracksPerAlbum: 2,
    warnIfFewerThan: true,
    minimumTrackCount: 10,
  },
  serverId: "local-server-id",
  libraryId: "local-library-id",
  pinnedTrackIds: ["local-track-id"],
  excludedTrackIds: ["local-excluded-track-id"],
  smartPresetId: "workout",
  smartPresetName: "Workout",
  smartPresetVersion: "v1",
  moodPresetId: "hype",
  moodPresetName: "Hype",
  moodPresetVersion: "v1",
  bpmPresetId: "dance",
  bpmPresetName: "Dance",
  bpmPresetVersion: "v1",
};

const storedRecipe = {
  id: "source-database-id",
  name: "Workout Mix",
  description: "High energy workout playlist",
  filtersJson: {
    ...sampleFilters,
    plexToken: "secret-token",
    accessToken: "secret-access-token",
  },
  useCount: 7,
  lastUsedAt: new Date("2026-01-02T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  createdFromVersion: "v1.2.5",
};

describe("playlist recipe import/export", () => {
  it("exports one recipe as stable mixarr.recipe JSON without local IDs or secrets", () => {
    const exported = buildSingleRecipeExport(storedRecipe, new Date("2026-01-04T00:00:00.000Z"));

    assert.equal(exported.format, "mixarr.recipe");
    assert.equal(exported.formatVersion, 1);
    assert.equal(exported.mixarrVersion, "v2.0.1");
    assert.equal(exported.exportedAt, "2026-01-04T00:00:00.000Z");
    assert.equal(exported.recipe.name, "Workout Mix");
    assert.equal(exported.recipe.smartPreset?.name, "Workout");
    assert.equal(exported.recipe.moodPreset?.name, "Hype");
    assert.equal(exported.recipe.bpmPreset?.name, "Dance");
    assert.equal(exported.recipe.safetyRules.limitTracksPerArtist, true);
    assert.equal(exported.recipe.filters.serverId, null);
    assert.equal(exported.recipe.filters.libraryId, null);
    assert.deepEqual(exported.recipe.filters.pinnedTrackIds, []);
    assert.deepEqual(exported.recipe.filters.excludedTrackIds, []);
    assert.deepEqual(exported.recipe.exportMetadata?.omittedLocalFields, ["serverId", "libraryId", "pinnedTrackIds", "excludedTrackIds"]);

    const json = JSON.stringify(exported);
    assert.equal(json.includes("secret-token"), false);
    assert.equal(json.includes("secret-access-token"), false);
  });

  it("exports all recipes as mixarr.recipes JSON", () => {
    const exported = buildRecipesExport([storedRecipe], new Date("2026-01-04T00:00:00.000Z"));

    assert.equal(exported.format, "mixarr.recipes");
    assert.equal(exported.formatVersion, 1);
    assert.equal(exported.recipes.length, 1);
    assert.equal(exported.recipes[0].name, "Workout Mix");
  });

  it("sanitizes recipe export filenames", () => {
    assert.equal(sanitizeRecipeFilename("Workout Mix! 2026"), "workout-mix-2026");
    assert.equal(sanitizeRecipeFilename("!!!"), "recipe");
  });

  it("previews valid imports with preset metadata, summaries, and duplicate rename proposals", () => {
    const exported = buildSingleRecipeExport(storedRecipe);
    const preview = buildImportPreview(JSON.stringify(exported), ["Workout Mix"]);

    assert.equal(preview.recipeCount, 1);
    assert.equal(preview.validCount, 1);
    assert.equal(preview.recipes[0].hasConflict, true);
    assert.equal(preview.recipes[0].proposedName, "Workout Mix Imported");
    assert.equal(preview.recipes[0].smartPresetName, "Workout");
    assert.equal(preview.recipes[0].moodPresetName, "Hype");
    assert.equal(preview.recipes[0].bpmPresetName, "Dance");
    assert.match(preview.recipes[0].filterSummary, /Safety rules:/);
  });

  it("rejects invalid JSON with the Mixarr export error", () => {
    assert.throws(
      () => buildImportPreview("{not-json"),
      new RegExp(INVALID_RECIPE_EXPORT_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("rejects newer unsupported export format versions", () => {
    assert.throws(
      () => buildImportPreview(JSON.stringify({ format: "mixarr.recipe", formatVersion: 999, recipe: {} })),
      new RegExp(UNSUPPORTED_RECIPE_EXPORT_VERSION_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("auto-renames duplicate imported recipes", () => {
    const exported = buildSingleRecipeExport(storedRecipe);
    const prepared = prepareImportedRecipes(JSON.stringify(exported), ["Workout Mix"], "rename");

    assert.equal(prepared.imported, 1);
    assert.equal(prepared.renamed, 1);
    assert.equal(prepared.recipes[0].name, "Workout Mix Imported");
    assert.equal("id" in prepared.recipes[0], false);
    assert.equal("useCount" in prepared.recipes[0], false);
    assert.equal("lastUsedAt" in prepared.recipes[0], false);
  });

  it("skips duplicate imported recipes when requested", () => {
    const exported = buildSingleRecipeExport(storedRecipe);
    const prepared = prepareImportedRecipes(JSON.stringify(exported), ["Workout Mix"], "skip");

    assert.equal(prepared.imported, 0);
    assert.equal(prepared.skipped, 1);
    assert.equal(prepared.failures[0].reason, "Duplicate skipped");
  });

  it("increments imported duplicate names", () => {
    assert.equal(
      importedRecipeName("Workout Mix", ["Workout Mix", "Workout Mix Imported", "Workout Mix Imported 2"]),
      "Workout Mix Imported 3",
    );
  });
});
