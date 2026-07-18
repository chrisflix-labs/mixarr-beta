import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bulkEligibleActionIds, canTransitionSmartAction, confidenceLevel, detectSmartActionConflicts, isMaintenanceWindow } from "./smartActions/core";
import { SMART_ACTION_TYPES, smartActionPayloadSchema } from "./smartActions/types";

const addition = (id: string, trackId: string, playlistId = "playlist-1") => ({ id, playlistId, actionType: "TRACK_ADDITION", actionPayload: smartActionPayloadSchema.parse({ type: "TRACK_ADDITION", trackId }) });
const removal = (id: string, trackId: string, playlistId = "playlist-1") => ({ id, playlistId, actionType: "TRACK_REMOVAL", actionPayload: smartActionPayloadSchema.parse({ type: "TRACK_REMOVAL", trackId }) });

describe("Smart Action safety core", () => {
  it("uses configurable confidence thresholds without presenting certainty", () => {
    assert.equal(confidenceLevel(92), "HIGH"); assert.equal(confidenceLevel(84), "MEDIUM"); assert.equal(confidenceLevel(64), "LOW");
    assert.equal(confidenceLevel(90, { high: 95, medium: 80 }), "MEDIUM");
  });

  it("allows only explicit lifecycle transitions", () => {
    assert.equal(canTransitionSmartAction("PENDING", "APPROVED"), true);
    assert.equal(canTransitionSmartAction("PENDING", "RUNNING"), false);
    assert.equal(canTransitionSmartAction("REJECTED", "RUNNING"), false);
    assert.equal(canTransitionSmartAction("SNOOZED", "PENDING"), true);
    assert.equal(canTransitionSmartAction("EXPIRED", "APPROVED"), false);
  });

  it("detects add/remove, refresh, transition, and metadata conflicts", () => {
    assert.equal(detectSmartActionConflicts([addition("add", "track-a"), removal("remove", "track-a")]).length, 1);
    const refresh = { id: "refresh", playlistId: "playlist-1", actionType: "PLAYLIST_REFRESH", actionPayload: smartActionPayloadSchema.parse({ type: "PLAYLIST_REFRESH", evaluationId: "evaluation", previewId: "preview", mode: "WEAK_TRACKS" }) };
    assert.equal(detectSmartActionConflicts([addition("add", "track-b"), refresh]).length, 1);
    const firstMetadata = { id: "metadata-a", actionType: "METADATA_CORRECTION", actionPayload: smartActionPayloadSchema.parse({ type: "METADATA_CORRECTION", trackId: "track-c", field: "bpm", currentValue: 90, suggestedValue: 180, source: "local" }) };
    const secondMetadata = { id: "metadata-b", actionType: "METADATA_CORRECTION", actionPayload: smartActionPayloadSchema.parse({ type: "METADATA_CORRECTION", trackId: "track-c", field: "bpm", currentValue: 90, suggestedValue: 92, source: "api" }) };
    assert.equal(detectSmartActionConflicts([firstMetadata, secondMetadata]).length, 1);
  });

  it("never bulk-selects low-confidence, high-risk, or conflicting actions by default", () => {
    const eligible = addition("eligible", "track-a") as any; Object.assign(eligible, { confidenceLevel: "HIGH", riskLevel: "LOW", status: "PENDING" });
    const low = addition("low", "track-b", "playlist-2") as any; Object.assign(low, { confidenceLevel: "LOW", riskLevel: "LOW", status: "PENDING" });
    const risky = removal("risky", "track-c", "playlist-3") as any; Object.assign(risky, { confidenceLevel: "HIGH", riskLevel: "HIGH", status: "PENDING" });
    const conflictAdd = addition("conflict-add", "track-z", "playlist-4") as any; Object.assign(conflictAdd, { confidenceLevel: "HIGH", riskLevel: "LOW", status: "PENDING" });
    const conflictRemove = removal("conflict-remove", "track-z", "playlist-4") as any; Object.assign(conflictRemove, { confidenceLevel: "HIGH", riskLevel: "LOW", status: "PENDING" });
    assert.deepEqual(bulkEligibleActionIds([eligible, low, risky, conflictAdd, conflictRemove]), ["eligible"]);
  });

  it("validates a strict typed payload for every supported action type", () => {
    const payloads = [
      { type: "TRACK_ADDITION", trackId: "one" }, { type: "TRACK_REMOVAL", trackId: "one" },
      { type: "PLAYLIST_OVERLAP_FIX", comparisonPlaylistId: "two", removeTrackIds: [], addTrackIds: [] },
      { type: "METADATA_CORRECTION", trackId: "one", field: "energy", currentValue: .2, suggestedValue: .8, source: "local" },
      { type: "PLAYLIST_REFRESH", evaluationId: "one", previewId: "two", mode: "FULL" },
      { type: "IDENTITY_DRIFT", proposedTrackIds: [], driftScore: 42 },
      { type: "TRANSITION_FIX", orderedTrackIds: ["one"], affectedPositions: [1] },
      { type: "COVERAGE_OPPORTUNITY", trackIds: ["one"] },
    ];
    assert.deepEqual(payloads.map((payload) => smartActionPayloadSchema.parse(payload).type), SMART_ACTION_TYPES);
    assert.equal(smartActionPayloadSchema.safeParse({ type: "TRACK_ADDITION", trackId: "one", arbitrarySql: "DROP" }).success, false);
  });

  it("recognizes only configured maintenance days and bounded start windows", () => {
    const sundayAtThree = new Date(2026, 6, 19, 3, 20, 0);
    assert.equal(isMaintenanceWindow({ now: sundayAtThree, startTime: "03:00", allowedDays: [0] }), true);
    assert.equal(isMaintenanceWindow({ now: sundayAtThree, startTime: "04:00", allowedDays: [0] }), false);
    assert.equal(isMaintenanceWindow({ now: sundayAtThree, startTime: "03:00", allowedDays: [1] }), false);
  });
});

describe("Smart Action persistence and API contract", () => {
  const root = process.cwd();
  const migration = readFileSync(join(root, "prisma", "migrations", "20260718220000_smart_actions_v227", "migration.sql"), "utf8");
  const service = readFileSync(join(root, "src", "lib", "smartActions", "service.ts"), "utf8");

  it("uses an additive indexed migration with ownership and scheduling indexes", () => {
    assert.match(migration, /CREATE TABLE "SmartAction"/); assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/);
    assert.match(migration, /SmartAction_userId_status_createdAt_idx/); assert.match(migration, /SmartAction_scheduledFor_status_idx/);
    assert.match(migration, /SmartAction_userId_deduplicationKey_idx/); assert.match(migration, /PlaylistRevision_smartActionId_fkey/);
    assert.match(migration, /CREATE INDEX "PlaylistRevision_smartActionId_idx"/); assert.doesNotMatch(migration, /CREATE UNIQUE INDEX "PlaylistRevision_smartActionId/);
  });

  it("loads the stored payload, revalidates, protects tracks, and snapshots before playlist mutation", () => {
    assert.match(service, /smartActionPayloadSchema\.parse\(action\.actionPayload\)/);
    assert.match(service, /createPlaylistVersion\(/); assert.match(service, /reason: "smart_action"/);
    assert.match(service, /locked \|\| row\?\.automationProtected \|\| row\?\.regenerationExcluded/);
    assert.match(service, /status: "COMPLETED"/); assert.match(service, /status = expired \? "EXPIRED" : "FAILED"/);
  });

  it("keeps preview and list routes read-only and execution behind an approved status", () => {
    assert.match(service, /if \(!allowed\.includes\(action\.status\)\).*Approve this action before applying it/);
    assert.match(service, /status === "PENDING" && item\.riskLevel !== "HIGH"|bulkEligibleActionIds/);
    const listRoute = readFileSync(join(root, "src", "app", "api", "smart-actions", "route.ts"), "utf8");
    const detailRoute = readFileSync(join(root, "src", "app", "api", "smart-actions", "[id]", "route.ts"), "utf8");
    assert.doesNotMatch(listRoute + detailRoute, /export async function (POST|PATCH|DELETE)/);
  });
});
