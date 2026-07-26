import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("v2.3.4 migration is additive, normalized, and avoids upgrade data-loss warnings", () => {
  const sql = read("prisma/migrations/20260720040000_curated_recipe_library_v234/migration.sql");
  assert.match(sql, /ADD COLUMN "sourceRecipeId" TEXT/);
  assert.match(sql, /ADD COLUMN "sourceRecipeVersion" INTEGER/);
  assert.match(sql, /CREATE TABLE "BuiltInRecipePreference"/);
  assert.match(sql, /PlaylistRecipe_userId_sourceRecipeId_idx/);
  assert.doesNotMatch(sql, /CREATE UNIQUE INDEX "PlaylistRecipe_userId_sourceRecipeId/);
  assert.match(sql, /BuiltInRecipePreference_userId_recipeId_key/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|force-reset/i);
});

test("library API validates sessions and stable catalog IDs server-side", () => {
  const list = read("src/app/api/recipes/library/route.ts");
  const install = read("src/app/api/recipes/library/[recipeId]/install/route.ts");
  const service = read("src/lib/builtInRecipes/service.ts");
  assert.match(list, /mixarr_session/);
  assert.match(install, /mixarr_session/);
  assert.match(service, /getBuiltInRecipe\(recipeId\)/);
  assert.match(service, /sourceRecipeId: definition\.id/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /P2034/);
  assert.match(service, /isArchived: false, deletedAt: null/);
  assert.match(service, /BUILTIN_RESTORED/);
});

test("recipe library UI covers filters, favorites, hidden management, installation, preview, and mobile layout", () => {
  const page = read("src/app/recipes/library/page.tsx");
  const css = read("src/app/recipes/library/recipe-library.module.css");
  assert.match(page, /Curated Recipe Library/);
  assert.match(page, /Favorites only/);
  assert.match(page, /Restore all hidden/);
  assert.match(page, /Calculating exact compatibility/);
  assert.match(page, /Customize/);
  assert.match(page, /Update history/);
  assert.match(page, /Advanced engine settings/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /:focus-visible/);
});

test("v2.3.4 documentation confirms offline operation and compatibility estimates", () => {
  assert.equal(JSON.parse(read("package.json")).version, "2.4.19");
  const docs = read("docs/CURATED_RECIPE_LIBRARY_V234.md");
  assert.match(docs, /works offline/i);
  assert.match(docs, /Compatibility is an estimate, not a guarantee/i);
  assert.match(docs, /never overwritten automatically/i);
  assert.match(read("CHANGELOG.md"), /v2\.3\.4 - Curated Recipe Library/);
});
