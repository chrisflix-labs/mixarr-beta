import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (value: string) => readFileSync(path.join(root, value), "utf8");

test("v2.3.2 persistence is additive, indexed, and preserves imported definitions", () => {
  const migration = read("prisma/migrations/20260719230000_adaptive_recipe_mapping_v232/migration.sql");
  assert.match(migration, /CREATE TABLE "RecipeImportAnalysis"/);
  assert.match(migration, /CREATE TABLE "RecipeValueMapping"/);
  assert.match(migration, /CREATE TABLE "SavedRecipeMappingRule"/);
  assert.match(migration, /originalImportedRecipeJson/);
  assert.match(migration, /mappingType[\s\S]*sourceValueNormalized[\s\S]*enabled/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/);
});

test("adaptive routes authenticate and services scope libraries to their owner", () => {
  const analysisRoute = read("src/app/api/playlist-recipes/import/[stageId]/analysis/route.ts");
  const mappingsRoute = read("src/app/api/recipe-mappings/route.ts");
  const mappingRoute = read("src/app/api/recipe-mappings/[id]/route.ts");
  for (const source of [analysisRoute, mappingsRoute, mappingRoute]) assert.match(source, /mixarr_session/);
  const service = read("src/lib/adaptiveRecipeMappingService.ts");
  assert.match(service, /server: \{ userId \}/);
  assert.match(service, /where: \{ id: libraryId, server: \{ userId \} \}/);
  assert.match(service, /buildTrackWhereClause/);
  assert.match(service, /prisma\.track\.count/);
  assert.doesNotMatch(service, /prisma\.track\.findMany/);
});

test("confirmation preserves original and adapted recipes without generating a playlist", () => {
  const transfer = read("src/lib/mixRecipes/transferService.ts");
  assert.match(transfer, /originalImportedRecipeJson/);
  assert.match(transfer, /adaptedFromImport/);
  assert.match(transfer, /IDENTITY_CONFIRMATION_REQUIRED/);
  assert.match(transfer, /LOW_COMPATIBILITY_CONFIRMATION_REQUIRED/);
  assert.doesNotMatch(transfer, /syncGeneratedPlaylistToPlex|generatePlaylistTracks/);
});

test("mapping UI exposes responsive controls, warnings, reset, and cancellable debouncing", () => {
  const page = read("src/app/recipes/page.tsx");
  const css = read("src/app/recipes/recipes.module.css");
  assert.match(page, /Recipe Compatibility &amp; Mapping/);
  assert.match(page, /Accept recommended/);
  assert.match(page, /Reset &amp; recalculate/);
  assert.match(page, /Search local/);
  assert.match(page, /analysisAbortRef\.current\?\.abort/);
  assert.match(page, /setTimeout\(\(\) => recalculateAnalysis/);
  assert.match(page, /Confirm major identity change/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.mappingRow \{ grid-template-columns: 1fr/);
});

test("release metadata retains v2.3.2 after the v2.3.3 release", () => {
  assert.equal(JSON.parse(read("package.json")).version, "2.3.3");
  assert.match(read("src/lib/releaseNotes.ts"), /version: "2\.3\.2"/);
  assert.match(read("src/lib/roadmap.ts"), /version: "2\.3\.2"[\s\S]*status: "completed"/);
  assert.match(read("CHANGELOG.md"), /v2\.3\.2 - Adaptive Recipe Mapping/);
  assert.match(read("docs/ADAPTIVE_RECIPE_MAPPING_V232.md"), /weighted harmonic/);
});
