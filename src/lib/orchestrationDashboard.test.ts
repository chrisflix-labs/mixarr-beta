import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { coveragePercentage, healthStateFor, overlapPercentage, redactSecrets, relationshipStrength, successRate, validateBackupManifest } from "./orchestration/dashboardCore";
import { ORCHESTRATION_EXPORT_SCHEMA_VERSION, parseOrchestrationImport } from "./orchestration/configuration";

test("playlist ecosystem health does not punish missing optional data", () => {
  assert.equal(healthStateFor({ automationState: "ACTIVE", plexAvailable: true }), "NOT_ENOUGH_DATA");
  assert.equal(healthStateFor({ automationState: "PAUSED", plexAvailable: true, score: 10 }), "PAUSED");
  assert.equal(healthStateFor({ automationState: "ACTIVE", plexAvailable: false, score: 100 }), "CRITICAL");
  assert.equal(healthStateFor({ automationState: "ACTIVE", plexAvailable: true, score: 88, warningCount: 1 }), "WARNING");
  assert.equal(healthStateFor({ automationState: "ACTIVE", plexAvailable: true, score: 95 }), "HEALTHY");
});

test("overlap, coverage, relationship, and success calculations use explicit denominators", () => {
  assert.equal(overlapPercentage(10, 40, 20), 50);
  assert.equal(overlapPercentage(10, 0, 20), 0);
  assert.equal(coveragePercentage(250, 1_000), 25);
  assert.equal(coveragePercentage(0, 0), null);
  assert.equal(relationshipStrength({ track: 50, artist: 20, identity: 10 }), 36.5);
  assert.equal(successRate(9, 1), 90);
  assert.equal(successRate(0, 0), null);
});

test("configuration redaction recursively removes secret material", () => {
  const value = redactSecrets({ enabled: true, nested: { accessToken: "plex", apiKey: "provider", safe: 3 }, rows: [{ password: "nope", name: "keep" }] }) as any;
  assert.deepEqual(value, { enabled: true, nested: { safe: 3 }, rows: [{ name: "keep" }] });
});

test("backup validation requires real orchestration sections rather than file existence", () => {
  const invalid = validateBackupManifest({ schemaVersion: "1", sections: { playlistGroups: [] } });
  assert.equal(invalid.restoreCompatible, false);
  assert.ok(invalid.missingSections.includes("auditLogs"));
  const sections = Object.fromEntries(["playlistGroups", "playlistRelationships", "automationConfiguration", "smartActions", "experiments", "healthHistory", "auditLogs", "playlistVersions", "orchestrationPreferences"].map((key) => [key, []]));
  const valid = validateBackupManifest({ schemaVersion: "1", sections });
  assert.equal(valid.status, "VALID");
  assert.equal(valid.restoreCompatible, true);
});

test("import schema rejects unknown versions and accepts a secret-free v1 envelope", () => {
  const document = { format: "mixarr-orchestration", schemaVersion: ORCHESTRATION_EXPORT_SCHEMA_VERSION, metadata: { exportedAt: "2026-07-18T12:00:00.000Z", mixarrVersion: "2.2.9", includedSections: [] }, sections: { runtime: {}, preference: null, managedPlaylists: [], playlistGroups: [], relationships: [], overlapPolicies: [], crossPlaylistVariety: null, smartActionPreferences: null, smartActionPolicies: [], experimentDefaults: null, healthThresholds: null } };
  assert.equal(parseOrchestrationImport(document).schemaVersion, 1);
  assert.throws(() => parseOrchestrationImport({ ...document, schemaVersion: 99 }));
});

test("v2.2.9 migration and APIs are additive, indexed, bounded, and permission checked", () => {
  const migration = readFileSync(join(process.cwd(), "prisma", "migrations", "20260719010000_orchestration_dashboard_v229", "migration.sql"), "utf8");
  assert.match(migration, /CREATE TABLE "OrchestrationTrendSnapshot"/);
  assert.match(migration, /SmartAction_userId_status_priority_createdAt_idx/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/);
  const ecosystem = readFileSync(join(process.cwd(), "src", "lib", "orchestration", "ecosystem.ts"), "utf8");
  assert.match(ecosystem, /take: 60/);
  assert.match(ecosystem, /take: 2_000/);
  const maintenance = readFileSync(join(process.cwd(), "src", "app", "api", "orchestration", "jobs", "maintenance", "route.ts"), "utf8");
  assert.match(maintenance, /orchestrationAdmin/);
  assert.match(maintenance, /confirm: z.literal\(true\)/);
});

test("large-library regression keeps dashboard code off unbounded Track reads", () => {
  const dashboard = readFileSync(join(process.cwd(), "src", "lib", "orchestration", "dashboard.ts"), "utf8");
  assert.doesNotMatch(dashboard, /prisma\.track\.findMany/);
  assert.match(dashboard, /take: 500/);
  const ids = Array.from({ length: 50_000 }, (_, index) => `track-${index}`);
  const selected = new Set(ids.filter((_, index) => index % 4 === 0));
  assert.equal(coveragePercentage(selected.size, ids.length), 25);
});
