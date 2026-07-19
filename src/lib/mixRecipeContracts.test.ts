import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("Mix Recipe v2.3.0 persistence contracts", () => {
  const schema = read("prisma", "schema.prisma");
  const migration = read("prisma", "migrations", "20260719130000_mix_recipe_foundation_v230", "migration.sql");
  const dbPushPreflight = read("prisma", "db-push-preflight.sql");

  it("stores typed recipe sections separately from track membership", () => {
    assert.match(schema, /model PlaylistRecipe \{/);
    for (const field of ["scoringJson", "targetsJson", "bpmFlowJson", "discoveryJson", "varietyJson", "identityDefaultsJson", "refreshPolicyJson", "automationPolicyJson"]) assert.match(schema, new RegExp(field));
    assert.doesNotMatch(schema.slice(schema.indexOf("model PlaylistRecipe {"), schema.indexOf("model PlaylistRecipeRevision")), /tracks\s+/);
  });

  it("keeps generated playlists after recipe deletion and indexes recipe counts", () => {
    assert.match(migration, /GeneratedPlaylist_recipeId_fkey[\s\S]*ON DELETE SET NULL/);
    assert.match(migration, /GeneratedPlaylist_recipeId_createdAt_idx/);
    assert.match(migration, /PlaylistRecipe_userId_category_updatedAt_idx/);
    assert.doesNotMatch(migration, /GeneratedPlaylist_recipeId_fkey[\s\S]{0,160}ON DELETE CASCADE/);
  });

  it("persists recipe and playlist-only snapshots for initial and later generations", () => {
    assert.match(schema, /resolvedRecipeSnapshotJson\s+Json\?/);
    assert.match(schema, /playlistOverridesJson\s+Json\?/);
    const playlistService = read("src", "lib", "playlistService.ts");
    assert.match(playlistService, /resolvedRecipeSnapshotJson: resolvedRecipeSnapshot/);
    assert.match(playlistService, /resolvedRecipeSnapshotJson: generatedPlaylist\.resolvedRecipeSnapshotJson/);
  });

  it("safely prepares recipe slugs before Docker db push", () => {
    assert.match(dbPushPreflight, /ALTER TABLE "PlaylistRecipe" ADD COLUMN IF NOT EXISTS "slug" TEXT/);
    assert.match(dbPushPreflight, /ROW_NUMBER\(\) OVER/);
    assert.match(dbPushPreflight, /duplicate_slug_count/);
    assert.match(dbPushPreflight, /CREATE UNIQUE INDEX IF NOT EXISTS "PlaylistRecipe_userId_slug_key"/);
  });
});

describe("Mix Recipe API and privacy contracts", () => {
  it("requires authentication and owner scope on recipe collections and details", () => {
    const collection = read("src", "app", "api", "playlist-recipes", "route.ts");
    const detail = read("src", "app", "api", "playlist-recipes", "[id]", "route.ts");
    assert.match(collection, /mixarr_session/); assert.match(collection, /userId/); assert.match(collection, /Unauthorized/);
    assert.match(detail, /mixarr_session/); assert.match(detail, /userId/); assert.match(detail, /deletedAt: null/);
  });

  it("converts playlists without loading tracks or copying feedback", () => {
    const service = read("src", "lib", "mixRecipes", "service.ts");
    const conversion = service.slice(service.indexOf("export async function createRecipeFromPlaylist"), service.indexOf("function identityProfileFromRecipe"));
    assert.doesNotMatch(conversion, /tracks:/);
    assert.doesNotMatch(conversion, /playlistFitFeedback|playbackEvents|interactionEvents|accessToken/);
    assert.match(conversion, /sourcePlaylistId: playlist\.id/);
  });

  it("exports canonical recipes without local library and track IDs", () => {
    const portable = read("src", "lib", "playlistRecipeImportExport.ts");
    assert.match(portable, /format: "mixarr-recipes"/);
    assert.match(portable, /serverId: null/);
    assert.match(portable, /libraryId: null/);
    assert.match(portable, /pinnedTrackIds: \[\]/);
    assert.match(portable, /excludedTrackIds: \[\]/);
  });

  it("requires explicit automation confirmation", () => {
    const service = read("src", "lib", "mixRecipes", "service.ts");
    assert.match(service, /confirmAutomation = false/);
    assert.match(service, /automationPolicy\.enabled && confirmAutomation/);
    assert.match(service, /refreshMode: confirmAutomation \? "SCHEDULED" : "MANUAL_ONLY"/);
  });
});

describe("Mix Recipe UI contracts", () => {
  it("ships every editor section and responsive layouts", () => {
    const page = read("src", "app", "recipes", "[id]", "page.tsx");
    const css = read("src", "app", "recipes", "[id]", "recipe-detail.module.css");
    for (const section of ["Overview", "Mood and Energy", "BPM Flow", "Discovery", "Scoring", "Artist and Album Variety", "Playlist Identity", "Refresh and Automation", "Validation", "Generated Playlists"]) assert.match(page, new RegExp(section));
    assert.match(page, /Recipe defaults:/); assert.match(page, /Playlist-only overrides:/);
    assert.match(css, /max-width: 900px/); assert.match(css, /max-width: 600px/);
  });
});
