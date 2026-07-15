import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function source(...parts: string[]) {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

describe("Plex conflict inspector contracts", () => {
  it("migrates physical identity and canonical grouping without deleting existing data", () => {
    const migration = source("prisma", "migrations", "20260714030000_duplicate_preservation_conflict_inspector", "migration.sql");
    assert.match(migration, /Track_plexServerId_plexLibraryId_ratingKey_key/);
    assert.match(migration, /CREATE TABLE "CanonicalRecording"/);
    assert.match(migration, /CREATE TABLE "PlexSyncConflict"/);
    assert.match(migration, /v2\.1\.1_backfill/);
    assert.doesNotMatch(migration, /DELETE FROM "Track"/);
  });

  it("backfills required Plex identity before Docker db push without resetting data", () => {
    const dockerfile = source("Dockerfile");
    const preflight = source("prisma", "db-push-preflight.sql");
    const backfill = source("prisma", "db-push-v2.1.1-backfill.sql");
    assert.match(dockerfile, /db execute --schema prisma\/schema\.prisma --file prisma\/db-push-preflight\.sql/);
    assert.match(dockerfile, /db push --skip-generate/);
    assert.match(dockerfile, /db-push-v2\.1\.1-backfill\.sql/);
    assert.match(preflight, /ADD COLUMN IF NOT EXISTS "plexServerId" TEXT/);
    assert.match(preflight, /"plexServerId" = COALESCE/);
    assert.match(preflight, /ALTER COLUMN "plexServerId" SET NOT NULL/);
    assert.match(preflight, /HAVING count\(\*\) > 1/);
    assert.match(preflight, /CREATE UNIQUE INDEX IF NOT EXISTS "Track_plexServerId_plexLibraryId_ratingKey_key"/);
    assert.doesNotMatch(dockerfile, /--accept-data-loss|--force-reset/);
    assert.doesNotMatch(preflight + backfill, /DROP TABLE|TRUNCATE|DELETE FROM "Track"/);
    assert.match(backfill, /ON CONFLICT \("libraryId", "plexRatingKey"\) DO NOTHING/);
  });

  it("requires administrator authorization for repair and duplicate mutations", () => {
    const repair = source("src", "app", "api", "library-health", "plex-conflicts", "repair", "route.ts");
    const conflictAction = source("src", "app", "api", "library-health", "plex-conflicts", "[id]", "route.ts");
    const groupAction = source("src", "app", "api", "duplicate-groups", "[id]", "route.ts");
    assert.match(repair, /requireAdminUser/);
    assert.match(conflictAction, /requireAdminUser/);
    assert.match(groupAction, /requireAdminUser/);
  });

  it("links missing albums and unresolved tracks to detailed inspectors", () => {
    const health = source("src", "app", "settings", "library-health", "page.tsx");
    assert.match(health, /missing\/albums\?libraryId=/);
    assert.match(health, /plex-conflicts\?libraryId=/);
    assert.match(health, /Tracks missing mood/);
    assert.match(health, /Tracks missing energy/);
  });

  it("reports duplicate relationships without counting preserved tracks as skipped", () => {
    const sync = source("src", "lib", "syncEngine.ts");
    assert.match(sync, /skipped: 0/);
    assert.match(sync, /action=created_separate_instance/);
    assert.match(sync, /trackInstancesActive=/);
    assert.doesNotMatch(sync, /one_mixarr_record_matched_multiple_plex_tracks/);
  });
});
