import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  RECIPE_LAYER_PRIORITY,
  compareEffectiveRecipes,
  deleteRecipeValue,
  detectRecipeInheritanceCycle,
  flattenRecipeValues,
  recipeConfigurationFingerprint,
  resolveRecipeConfiguration,
  setRecipeValue,
  type RecipeResolutionLayer,
} from "./recipeInheritance/resolver";

const layer = (type: RecipeResolutionLayer["type"], name: string, values: Record<string, unknown>, extra: Partial<RecipeResolutionLayer> = {}): RecipeResolutionLayer => ({ type, name, values, priority: RECIPE_LAYER_PRIORITY[type], ...extra });

describe("v2.3.3 recipe inheritance resolver", () => {
  test("resolves every layer deterministically and records provenance", () => {
    const result = resolveRecipeConfiguration({ layers: [
      layer("built_in_defaults", "Built in", { discovery: { deepCutPercentage: 20 }, variety: { maximumTracksPerArtist: 3 } }),
      layer("category_preset", "Workout", { discovery: { deepCutPercentage: 25 } }),
      layer("base_recipe", "Workout Foundation", { variety: { maximumTracksPerArtist: 2 } }),
      layer("recipe_override", "Morning Workout", { discovery: { deepCutPercentage: 40 } }),
      layer("playlist_override", "Gym Playlist", { discovery: { deepCutPercentage: 15 } }),
    ] });
    assert.equal((result.effectiveConfiguration.discovery as any).deepCutPercentage, 15);
    assert.equal(result.fields.find((field) => field.field === "discovery.deepCutPercentage")?.source.name, "Gym Playlist");
    assert.equal(result.inheritanceChain.map((item) => item.name).join(" > "), "Built in > Workout > Workout Foundation > Morning Workout > Gym Playlist");
  });

  test("false, zero, empty arrays, and empty strings are explicit values", () => {
    const result = resolveRecipeConfiguration({ layers: [layer("built_in_defaults", "Defaults", { a: true, b: 5, c: [1], d: "x" }), layer("recipe_override", "Recipe", { a: false, b: 0, c: [], d: "" })] });
    assert.deepEqual(result.effectiveConfiguration, { a: false, b: 0, c: [], d: "" });
  });

  test("nested field reset removes the override instead of copying its inherited value", () => {
    const overrides: Record<string, unknown> = {}; setRecipeValue(overrides, "bpmFlow.maximumBpm", 145); setRecipeValue(overrides, "bpmFlow.minimumBpm", 110); deleteRecipeValue(overrides, "bpmFlow.maximumBpm");
    assert.deepEqual(overrides, { bpmFlow: { minimumBpm: 110 } });
  });

  test("highest-authority lock wins and rejected values remain explainable", () => {
    const result = resolveRecipeConfiguration({ layers: [layer("recipe_override", "Recipe", { discovery: { deepCutPercentage: 50 } })], locks: [
      { fieldPath: "discovery.deepCutPercentage", value: 30, authority: 500, source: { name: "Category lock" } },
      { fieldPath: "discovery.deepCutPercentage", value: 10, authority: 1000, source: { name: "Administrator maximum" }, reason: "Family policy" },
    ] });
    assert.equal((result.effectiveConfiguration.discovery as any).deepCutPercentage, 10);
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].code, "LOCKED_FIELD_OVERRIDE");
    assert.equal(result.fields[0].isLocked, true);
  });

  test("detects direct and indirect cycles with readable chains", () => {
    const nodes = [{ id: "a", name: "A", baseRecipeId: "b" }, { id: "b", name: "B", baseRecipeId: "c" }, { id: "c", name: "C", baseRecipeId: null }];
    const result = detectRecipeInheritanceCycle(nodes, "c", "a");
    assert.equal(result.valid, false); assert.equal(result.code, "CIRCULAR_INHERITANCE"); assert.match(result.message || "", /C → A → B → C/);
  });

  test("enforces maximum inheritance depth", () => {
    const nodes = Array.from({ length: 13 }, (_, index) => ({ id: String(index), name: `R${index}`, baseRecipeId: index < 12 ? String(index + 1) : null }));
    assert.equal(detectRecipeInheritanceCycle(nodes, "0", undefined, 10).code, "MAXIMUM_DEPTH_EXCEEDED");
  });

  test("multiple group values use explicit priority and emit a conflict", () => {
    const result = resolveRecipeConfiguration({ layers: [layer("group_policy", "Family", { variety: { maximumTracksPerArtist: 1 } }, { priority: 70 }), layer("group_policy", "Gym", { variety: { maximumTracksPerArtist: 2 } }, { priority: 71 })] });
    assert.equal((result.effectiveConfiguration.variety as any).maximumTracksPerArtist, 2);
    assert.equal(result.warnings[0].code, "GROUP_POLICY_CONFLICT");
  });

  test("user preferences only apply to administrator-eligible fields", () => {
    const result = resolveRecipeConfiguration({ layers: [layer("built_in_defaults", "Defaults", { discovery: { deepCutPercentage: 20 }, automationPolicy: { enabled: false } }), layer("user_preference", "Alex", { discovery: { deepCutPercentage: 35 }, automationPolicy: { enabled: true } }, { allowedFields: ["discovery.deepCutPercentage"] })] });
    assert.equal((result.effectiveConfiguration.discovery as any).deepCutPercentage, 35);
    assert.equal((result.effectiveConfiguration.automationPolicy as any).enabled, false);
    assert.equal(result.warnings[0].code, "USER_OVERRIDE_NOT_ALLOWED");
  });

  test("fingerprints are stable across object key order and change with output", () => {
    assert.equal(recipeConfigurationFingerprint({ b: 2, a: 1 }), recipeConfigurationFingerprint({ a: 1, b: 2 }));
    assert.notEqual(recipeConfigurationFingerprint({ a: 1 }), recipeConfigurationFingerprint({ a: 2 }));
  });

  test("classifies invalid BPM and energy ranges as blocking conflicts", () => {
    const result = resolveRecipeConfiguration({ layers: [layer("legacy_explicit", "Legacy recipe", { bpmFlow: { minimumBpm: 150, maximumBpm: 120 }, targets: { minimumEnergy: .8, maximumEnergy: .4 } })] });
    assert.deepEqual(result.errors.map((item) => item.code).sort(), ["INVALID_BPM_RANGE", "INVALID_ENERGY_RANGE"]);
    assert.equal(result.fields.find((field) => field.field === "bpmFlow.maximumBpm")?.state, "invalid");
  });

  test("effective comparisons separate output, source, and lock changes", () => {
    const before = resolveRecipeConfiguration({ layers: [layer("built_in_defaults", "Defaults", { x: 1 })] });
    const after = resolveRecipeConfiguration({ layers: [layer("global_defaults", "Global", { x: 1 })] });
    const changes = compareEffectiveRecipes(before, after);
    assert.equal(changes[0].effectiveValueChanged, false); assert.equal(changes[0].sourceChanged, true);
  });

  test("flattening treats lists as typed leaf values", () => {
    assert.deepEqual(Array.from(flattenRecipeValues({ targets: { moods: ["happy", "focused"] } }).entries()), [["targets.moods", ["happy", "focused"]]]);
  });
});
