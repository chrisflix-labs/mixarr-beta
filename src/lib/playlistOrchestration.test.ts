import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertAutomationStateTransition, effectiveJobPriority, evaluatePlaylistEligibility, findDependencyCycle,
  isOrchestrationLockStale, operationMayWritePlex, orchestrationConflictKeys, orchestrationIdempotencyKey,
  sortEligibleJobs, topologicalPlaylistOrder,
} from "./orchestration/core";

test("dependency resolution is deterministic and dependencies precede dependents", () => {
  const edges = [
    { sourceId: "workout", targetId: "daily", type: "DEPENDS_ON" as const },
    { sourceId: "daily", targetId: "recent", type: "RUNS_AFTER" as const },
  ];
  assert.deepEqual(topologicalPlaylistOrder(["workout", "daily", "recent"], edges), ["recent", "daily", "workout"]);
});

test("cycle detection returns the full closed dependency cycle", () => {
  const cycle = findDependencyCycle([
    { sourceId: "a", targetId: "b", type: "DEPENDS_ON" },
    { sourceId: "b", targetId: "c", type: "RUNS_AFTER" },
    { sourceId: "c", targetId: "a", type: "DEPENDS_ON" },
  ]);
  assert.deepEqual(cycle, ["a", "b", "c", "a"]);
});

test("priority ordering respects playlist priority then explicit priority", () => {
  const now = new Date("2026-07-17T12:00:00Z").getTime();
  const jobs = sortEligibleJobs([
    { id: "low", playlistPriority: "LOW" as const, priority: 0, requestedAt: "2026-07-17T11:00:00Z", scheduledFor: "2026-07-17T11:00:00Z" },
    { id: "high", playlistPriority: "HIGH" as const, priority: -5, requestedAt: "2026-07-17T11:30:00Z", scheduledFor: "2026-07-17T11:30:00Z" },
    { id: "normal", playlistPriority: "NORMAL" as const, priority: 20, requestedAt: "2026-07-17T11:15:00Z", scheduledFor: "2026-07-17T11:15:00Z" },
  ], now);
  assert.deepEqual(jobs.map((job) => job.id), ["high", "normal", "low"]);
});

test("aging prevents permanent starvation without bypassing high priority immediately", () => {
  const now = new Date("2026-07-17T12:00:00Z").getTime();
  assert.ok(effectiveJobPriority("LOW", 0, "2026-07-01T00:00:00Z", now) > effectiveJobPriority("NORMAL", 0, "2026-07-17T11:00:00Z", now));
});

test("conflict keys cover playlist, Plex, identity, and library writes", () => {
  assert.deepEqual(orchestrationConflictKeys({ managedPlaylistId: "m1", plexPlaylistId: "99", playlistIdentityId: "i1", libraryId: "l1" }), ["library:l1:playlist-write", "playlist-identity:i1", "playlist:m1", "plex-playlist:99"]);
});

test("idempotency is stable across object key order and one scheduled window", () => {
  const first = orchestrationIdempotencyKey({ managedPlaylistId: "m1", jobType: "SYNC", trigger: "SCHEDULED", scheduledFor: "2026-07-17T12:00:10Z", configuration: { b: 2, a: 1 } });
  const second = orchestrationIdempotencyKey({ managedPlaylistId: "m1", jobType: "SYNC", trigger: "SCHEDULED", scheduledFor: "2026-07-17T12:00:55Z", configuration: { a: 1, b: 2 } });
  assert.equal(first, second);
});

test("invalid automation transitions are rejected", () => {
  assert.throws(() => assertAutomationStateTransition("DISABLED", "RUNNING"), /cannot transition/);
  assert.throws(() => assertAutomationStateTransition("RUNNING", "RUNNING"), /cannot transition/);
  assert.doesNotThrow(() => assertAutomationStateTransition("PAUSED", "ACTIVE"));
});

test("playlist eligibility respects global and per-playlist safety state", () => {
  assert.equal(evaluatePlaylistEligibility({ globalEnabled: false, enabled: true, automationEnabled: true, automationState: "ACTIVE", plexAvailable: true }).code, "GLOBAL_ORCHESTRATION_DISABLED");
  assert.equal(evaluatePlaylistEligibility({ globalEnabled: true, enabled: true, automationEnabled: true, automationState: "PAUSED", plexAvailable: true }).code, "PLAYLIST_PAUSED");
  assert.equal(evaluatePlaylistEligibility({ globalEnabled: true, enabled: true, automationEnabled: true, automationState: "ACTIVE", plexAvailable: true }).eligible, true);
});

test("expired lock leases are stale and active leases are not", () => {
  const now = new Date("2026-07-17T12:00:00Z").getTime();
  assert.equal(isOrchestrationLockStale({ heartbeatAt: "2026-07-17T11:50:00Z", leaseExpiresAt: "2026-07-17T11:59:59Z" }, now), true);
  assert.equal(isOrchestrationLockStale({ heartbeatAt: "2026-07-17T11:59:00Z", leaseExpiresAt: "2026-07-17T12:10:00Z" }, now), false);
});

test("dry-run and preview safeguards never authorize Plex writes", () => {
  assert.equal(operationMayWritePlex("REGENERATE", true), false);
  assert.equal(operationMayWritePlex("DRY_RUN", false), false);
  assert.equal(operationMayWritePlex("PREVIEW", false), false);
  assert.equal(operationMayWritePlex("REGENERATE", false), true);
});

test("v2.2.0 migration is additive, indexed, and conservatively disabled", () => {
  const migration = readFileSync(join(process.cwd(), "prisma", "migrations", "20260717020000_playlist_orchestration_foundation", "migration.sql"), "utf8");
  assert.match(migration, /CREATE TABLE "ManagedPlaylist"/);
  assert.match(migration, /CREATE TABLE "PlaylistOrchestrationJob"/);
  assert.match(migration, /CREATE UNIQUE INDEX "PlaylistOrchestrationLock_conflictKey_key"/);
  assert.match(migration, /"enabled":false/);
  assert.match(migration, /"globalMaxConcurrentJobs":1/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|DELETE FROM "GeneratedPlaylist"/);
});

test("orchestration API routes enforce sessions and central service boundaries", () => {
  const routePaths = [
    "status/route.ts", "playlists/route.ts", "playlists/[id]/route.ts", "relationships/route.ts",
    "relationships/[id]/route.ts", "jobs/route.ts", "jobs/[id]/route.ts", "jobs/[id]/cancel/route.ts",
    "jobs/[id]/retry/route.ts", "dry-run/route.ts", "audit/route.ts",
  ];
  for (const routePath of routePaths) {
    const source = readFileSync(join(process.cwd(), "src", "app", "api", "orchestration", ...routePath.split("/")), "utf8");
    assert.match(source, /orchestrationSession\(\)/);
    assert.match(source, /orchestrationUnauthorized/);
  }
  const worker = readFileSync(join(process.cwd(), "src", "lib", "orchestration", "worker.ts"), "utf8");
  assert.match(worker, /claimNextOrchestrationJob/);
  assert.match(worker, /recoverStaleOrchestrationJobs/);
  assert.match(worker, /job\.dryRun/);
});

test("orchestration UI exposes the v2.2.9 ecosystem console and accessible alternatives", () => {
  const page = readFileSync(join(process.cwd(), "src", "components", "OrchestrationDashboard.tsx"), "utf8");
  assert.match(page, /Playlist Ecosystem/);
  assert.match(page, /Group health overview/);
  assert.match(page, /Playlist relationship graph/);
  assert.match(page, /RelationshipTable/);
  assert.match(page, /Cross-playlist overlap heatmap/);
  assert.match(page, /Pending Smart Actions/);
  assert.match(page, /Orchestration onboarding and configuration review/);
  assert.match(page, /audit history will be preserved/i);
});
