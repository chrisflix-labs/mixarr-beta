import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultMixRecipeDocument, MIX_RECIPE_FORMAT, resolveRecipeGenerationConfig } from "./mixRecipes/schema";
import { migrateRecipeDocument } from "./mixRecipes/migration";
import { validateRecipe } from "./mixRecipes/validation";

function lateNightHighway() {
  const recipe = defaultMixRecipeDocument({
    name: "Late Night Highway",
    description: "Atmospheric and energetic driving music with a gradual BPM rise.",
    category: "Driving",
  }, {
    engineVersion: "v2",
    limit: 60,
    rules: [
      { field: "tempo", operator: "gte", value: "95" },
      { field: "tempo", operator: "lte", value: "122" },
    ],
    allowedMoods: ["Atmospheric", "Energetic", "Moody"],
    selectedMoodPath: ["Atmospheric", "Energetic", "Moody"],
    moodBlendMode: "smooth_transition",
    tuningConfig: { bpmFlow: { enabled: true, mode: "RAMP_UP", maxPreferredGap: 8 }, discovery: { level: "high", deepCutTarget: 55 } },
    safetyRules: { limitTracksPerArtist: true, maxTracksPerArtist: 2 },
  });
  return {
    ...recipe,
    targets: { ...recipe.targets, selectedMoods: ["Atmospheric", "Energetic", "Moody"], primaryMood: "Atmospheric", energyProgression: "rising" as const },
    bpmFlow: { ...recipe.bpmFlow, minimumBpm: 95, maximumBpm: 122, mode: "RAMP_UP" as const },
    variety: { ...recipe.variety, maximumTracksPerArtist: 2 },
    playlistIdentity: { ...recipe.playlistIdentity, personalitySummary: "Moody nighttime driving mix with atmospheric production and steady momentum." },
    refreshPolicy: { ...recipe.refreshPolicy, mode: "scheduled" as const, frequencyDays: 14, strategy: "replace_weak" as const },
  };
}

describe("Mix Recipe schema v1", () => {
  it("represents and validates Late Night Highway", () => {
    const result = validateRecipe(lateNightHighway());
    assert.equal(result.valid, true);
    assert.equal(result.normalizedRecipe?.format, MIX_RECIPE_FORMAT);
    assert.equal(result.normalizedRecipe?.bpmFlow.maximumBpm, 122);
    assert.equal(result.normalizedRecipe?.variety.maximumTracksPerArtist, 2);
    assert.equal(result.normalizedRecipe?.automationPolicy.enabled, false);
  });

  it("requires a name", () => {
    const value = lateNightHighway(); value.metadata.name = "";
    const result = validateRecipe(value);
    assert.equal(result.valid, false);
    assert(result.errors.some((error) => error.path === "metadata.name"));
  });

  it("rejects invalid BPM and energy ranges", () => {
    const value = lateNightHighway(); value.bpmFlow.minimumBpm = 130; value.targets.minimumEnergy = .9; value.targets.maximumEnergy = .2;
    const result = validateRecipe(value);
    assert(result.errors.some((error) => error.code === "invalid_bpm_range"));
    assert(result.errors.some((error) => error.code === "invalid_energy_range"));
  });

  it("rejects invalid discovery percentages and artist limits", () => {
    const discovery = lateNightHighway() as any; discovery.discovery.deepCutPercentage = 101;
    assert.equal(validateRecipe(discovery).valid, false);
    const artist = lateNightHighway() as any; artist.variety.maximumTracksPerArtist = 0;
    assert.equal(validateRecipe(artist).valid, false);
  });

  it("requires a scheduled interval", () => {
    const value = lateNightHighway(); (value.refreshPolicy as any).frequencyDays = null;
    const result = validateRecipe(value);
    assert(result.errors.some((error) => error.code === "interval_required"));
  });

  it("requires moods for strict matching", () => {
    const value = lateNightHighway(); value.targets.strictMoodMatching = true; value.targets.selectedMoods = [];
    assert(validateRecipe(value).errors.some((error) => error.code === "moods_required"));
  });

  it("rejects an unknown scoring model", () => {
    const value = lateNightHighway(); value.scoring.scoringModel = "unknown-model";
    assert(validateRecipe(value).errors.some((error) => error.code === "unsupported_scoring_model"));
  });

  it("returns warning-only optional metadata guidance", () => {
    const value = lateNightHighway(); value.metadata.artworkUrl = null;
    const result = validateRecipe(value);
    assert.equal(result.valid, true);
    assert(result.warnings.some((warning) => warning.code === "artwork_fallback"));
  });
});

describe("Mix Recipe migrations", () => {
  it("runs a no-op current migration", () => {
    const source = lateNightHighway();
    const result = migrateRecipeDocument(source);
    assert.equal(result.migrated, false);
    assert.equal(result.fromVersion, 1);
  });

  it("migrates legacy saved filters to schema v1", () => {
    const legacy = { name: "Legacy Mix", filters: { rules: [], limit: 30 } };
    const result = migrateRecipeDocument(legacy);
    assert.equal(result.migrated, true);
    assert.equal(result.recipe.schemaVersion, 1);
    assert.equal(result.recipe.generation.limit, 30);
  });

  it("is idempotent", () => {
    const once = migrateRecipeDocument({ name: "Legacy Mix", filters: { rules: [], limit: 30 } });
    const twice = migrateRecipeDocument(once.recipe);
    assert.deepEqual(twice.recipe, once.recipe);
  });

  it("rejects future schemas without mutating the input", () => {
    const source: any = { ...lateNightHighway(), schemaVersion: 99 };
    const before = JSON.stringify(source);
    assert.throws(() => migrateRecipeDocument(source), /newer than supported/);
    assert.equal(JSON.stringify(source), before);
  });

  it("rolls back a failed legacy migration without mutating the input", () => {
    const source = { name: "Broken", filters: { limit: -1 } };
    const before = JSON.stringify(source);
    assert.throws(() => migrateRecipeDocument(source));
    assert.equal(JSON.stringify(source), before);
  });
});

describe("recipe generation resolution", () => {
  it("applies permitted playlist-only overrides without changing the recipe", () => {
    const recipe = lateNightHighway();
    const before = JSON.stringify(recipe);
    const config = resolveRecipeGenerationConfig(recipe, { limit: 25, libraryId: "library-2" });
    assert.equal(config.limit, 25);
    assert.equal(config.libraryId, "library-2");
    assert.equal(config.tuningConfig.bpmFlow.mode, "RAMP_UP");
    assert.equal(config.safetyRules.maxTracksPerArtist, 2);
    assert.deepEqual(config.allowedMoods, ["Atmospheric", "Energetic", "Moody"]);
    assert.equal(JSON.stringify(recipe), before);
  });

  it("rejects recipe behavior changes disguised as one-time overrides", () => {
    assert.throws(() => resolveRecipeGenerationConfig(lateNightHighway(), { scoringModel: "other" }), /Unsupported playlist-only override/);
  });
});
