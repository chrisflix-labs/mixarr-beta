import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { calculateGroupHealth, compactSortOrders, resolveSettingsLayers } from "./playlistGroups/core";
import { createPlaylistGroupSchema, membershipSettingsSchema, playlistGroupSettingsSchema, reorderSchema } from "./playlistGroups/schemas";

test("new collection input preserves backward-compatible empty settings", () => {
  const parsed = createPlaylistGroupSchema.parse({ name: "Workout Collection" });
  assert.equal(parsed.name, "Workout Collection");
  assert.deepEqual(parsed.settings, {});
  assert.equal(parsed.description, "");
});

test("collection validation rejects unsafe ranges and empty names", () => {
  assert.equal(createPlaylistGroupSchema.safeParse({ name: "" }).success, false);
  assert.equal(playlistGroupSettingsSchema.safeParse({ deepCutPercentage: 101 }).success, false);
  assert.equal(playlistGroupSettingsSchema.safeParse({ maximumTracksPerArtist: -1 }).success, false);
});

test("playlist settings remain authoritative when inheritance is disabled", () => {
  const result = resolveSettingsLayers({ groupDefaults: { discoveryLevel: "high" }, playlistSettings: { discoveryLevel: "low" }, inheritByDefault: false, group: { id: "group", name: "Workout" } });
  assert.equal(result.effectiveSettings.discoveryLevel, "low");
  assert.equal(result.sources.discoveryLevel.source, "playlist");
});

test("explicit inheritance resolves group value and source metadata", () => {
  const result = resolveSettingsLayers({ groupDefaults: { discoveryLevel: "high" }, playlistSettings: { discoveryLevel: "low" }, inheritance: { discoveryLevel: "inherit" }, group: { id: "group", name: "Workout" } });
  assert.equal(result.effectiveSettings.discoveryLevel, "high");
  assert.deepEqual(result.sources.discoveryLevel, { value: "high", source: "playlist-group", sourceId: "group", sourceName: "Workout" });
});

test("playlist override and one-time override precedence are deterministic", () => {
  const playlist = resolveSettingsLayers({ groupDefaults: { recommendationStrength: 80 }, playlistSettings: { recommendationStrength: 35 }, inheritance: { recommendationStrength: "override" }, group: { id: "g", name: "Group" } });
  assert.equal(playlist.effectiveSettings.recommendationStrength, 35);
  const oneTime = resolveSettingsLayers({ groupDefaults: { recommendationStrength: 80 }, playlistSettings: { recommendationStrength: 35 }, inheritance: { recommendationStrength: "inherit" }, oneTimeOverrides: { recommendationStrength: 95 }, group: { id: "g", name: "Group" } });
  assert.equal(oneTime.effectiveSettings.recommendationStrength, 95);
  assert.equal(oneTime.sources.recommendationStrength.source, "one-time");
});

test("disabled settings are omitted without silently selecting another group", () => {
  const result = resolveSettingsLayers({ groupDefaults: { maximumTracksPerArtist: 2 }, inheritance: { maximumTracksPerArtist: "disabled" }, inheritByDefault: true, group: { id: "g", name: "Group" } });
  assert.equal("maximumTracksPerArtist" in result.effectiveSettings, false);
  assert.equal(result.sources.maximumTracksPerArtist.source, "disabled");
  const missingPrimary = resolveSettingsLayers({ groupDefaults: {}, inheritByDefault: true, group: null });
  assert.match(missingPrimary.warnings[0], /no primary settings group/i);
});

test("membership state schema supports inherit override and disabled", () => {
  const parsed = membershipSettingsSchema.parse({ inheritsSettings: true, isPrimarySettingsGroup: true, inheritance: { discoveryLevel: "inherit", albumLimit: "override", liveTrackHandling: "disabled" } });
  assert.equal(parsed.inheritance?.liveTrackHandling, "disabled");
});

test("stable ordering spaces rows and validates complete unique input shape", () => {
  assert.deepEqual(compactSortOrders(["a", "b", "c"]), [{ id: "a", sortOrder: 1000 }, { id: "b", sortOrder: 2000 }, { id: "c", sortOrder: 3000 }]);
  assert.equal(reorderSchema.safeParse({ playlistIds: [] }).success, false);
});

test("health score is explainable and identifies affected playlists", () => {
  const health = calculateGroupHealth([{ id: "healthy", qualityScore: 95, metadataCompleteness: 100, automationHealthy: true, configurationWarnings: 0, plexSynchronized: true }, { id: "warning", qualityScore: 45, metadataCompleteness: 70, automationHealthy: false, configurationWarnings: 2, plexSynchronized: false }]);
  assert.ok(health.overallScore > 0 && health.overallScore < 100);
  assert.deepEqual(Object.keys(health.components), ["generation", "metadata", "automation", "configuration", "plexSynchronization"]);
  assert.ok(health.affected.generation.includes("warning"));
  assert.ok(health.affected.plexSynchronization.includes("warning"));
});

test("migration enforces duplicate membership, one primary group, and safe cascades", () => {
  const sql = fs.readFileSync("prisma/migrations/20260717180000_playlist_groups_v221/migration.sql", "utf8");
  assert.match(sql, /PlaylistGroupMembership_playlistGroupId_playlistId_key/);
  assert.match(sql, /one_primary_per_playlist/);
  assert.match(sql, /WHERE "isPrimarySettingsGroup" = true/);
  assert.match(sql, /REFERENCES "GeneratedPlaylist"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /DELETE FROM "GeneratedPlaylist"/);
});
