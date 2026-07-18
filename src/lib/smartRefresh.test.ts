import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateSmartRefresh, isTimeInQuietHours, SENSITIVITY_DEFAULTS } from "./smartRefresh/core";
import type { SmartRefreshSignals } from "./smartRefresh/types";

const baseSignals = (patch: Partial<SmartRefreshSignals> = {}): SmartRefreshSignals => ({ currentScore: 82, previousScore: 81, estimatedScoreAfterRefresh: 83, weakTrackCount: 0, compatibleNewTrackCount: 0, averageCandidateScore: null, repetitivePlaybackScore: 10, playbackObservationCount: 40, identityDriftScore: 5, identityDamageFromProposal: 0, improvedMetadataTrackCount: 0, unavailableTrackCount: 0, libraryChangeCount: 0, fallbackOverdue: false, lockedTrackCount: 0, ...patch });

test("healthy playlist produces no action", () => {
  const result = evaluateSmartRefresh({ playlistId: "playlist", signals: baseSignals(), thresholds: SENSITIVITY_DEFAULTS.BALANCED });
  assert.equal(result.recommendation, "NO_ACTION"); assert.equal(result.shouldRefresh, false); assert.ok(result.blockers.some((item) => item.code === "PLAYLIST_HEALTHY"));
});

test("weak tracks recommend a partial identity-preserving refresh", () => {
  const result = evaluateSmartRefresh({ playlistId: "playlist", signals: baseSignals({ currentScore: 70, estimatedScoreAfterRefresh: 78, weakTrackCount: 4, compatibleNewTrackCount: 8 }), thresholds: SENSITIVITY_DEFAULTS.BALANCED });
  assert.equal(result.recommendation, "REFRESH_WEAK_TRACKS"); assert.equal(result.shouldRefresh, true); assert.equal(result.estimatedImprovement, 8);
});

test("compatible tracks require the configured count and improvement", () => {
  const belowCount = evaluateSmartRefresh({ playlistId: "playlist", signals: baseSignals({ compatibleNewTrackCount: 4, estimatedScoreAfterRefresh: 90 }), thresholds: SENSITIVITY_DEFAULTS.BALANCED });
  assert.equal(belowCount.recommendation, "NO_ACTION");
  const enough = evaluateSmartRefresh({ playlistId: "playlist", signals: baseSignals({ compatibleNewTrackCount: 7, estimatedScoreAfterRefresh: 89 }), thresholds: SENSITIVITY_DEFAULTS.BALANCED });
  assert.equal(enough.recommendation, "ADD_COMPATIBLE_TRACKS"); assert.equal(enough.shouldRefresh, true);
});

test("limited playback evidence cannot aggressively trigger repetition refresh", () => {
  const result = evaluateSmartRefresh({ playlistId: "playlist", signals: baseSignals({ repetitivePlaybackScore: 95, playbackObservationCount: 4, estimatedScoreAfterRefresh: 95 }), thresholds: SENSITIVITY_DEFAULTS.BALANCED });
  assert.equal(result.recommendation, "NO_ACTION");
});

test("sufficient repetitive playback recommends rebalancing", () => {
  const result = evaluateSmartRefresh({ playlistId: "playlist", signals: baseSignals({ repetitivePlaybackScore: 82, playbackObservationCount: 60, currentScore: 78, estimatedScoreAfterRefresh: 85 }), thresholds: SENSITIVITY_DEFAULTS.BALANCED });
  assert.equal(result.recommendation, "REBALANCE_PLAYLIST"); assert.equal(result.shouldRefresh, true);
});

test("relevant metadata improvements select a targeted metadata refresh", () => {
  const result = evaluateSmartRefresh({ playlistId: "playlist", signals: baseSignals({ improvedMetadataTrackCount: 4, currentScore: 76, estimatedScoreAfterRefresh: 83 }), thresholds: SENSITIVITY_DEFAULTS.BALANCED });
  assert.equal(result.recommendation, "REFRESH_METADATA_AFFECTED_TRACKS");
});

test("low estimated improvement skips refresh", () => {
  const result = evaluateSmartRefresh({ playlistId: "playlist", signals: baseSignals({ weakTrackCount: 3, currentScore: 74, estimatedScoreAfterRefresh: 76 }), thresholds: SENSITIVITY_DEFAULTS.BALANCED });
  assert.equal(result.shouldRefresh, false); assert.ok(result.blockers.some((item) => item.code === "IMPROVEMENT_BELOW_THRESHOLD"));
});

test("identity damage blocks an otherwise beneficial proposal", () => {
  const result = evaluateSmartRefresh({ playlistId: "playlist", signals: baseSignals({ weakTrackCount: 5, currentScore: 70, estimatedScoreAfterRefresh: 78, identityDamageFromProposal: 12 }), thresholds: SENSITIVITY_DEFAULTS.BALANCED });
  assert.equal(result.shouldRefresh, false); assert.ok(result.blockers.some((item) => item.code === "IDENTITY_DAMAGE"));
});

test("cooldown and weekly limits block execution without hiding recommendation", () => {
  const result = evaluateSmartRefresh({ playlistId: "playlist", signals: baseSignals({ weakTrackCount: 3, currentScore: 70, estimatedScoreAfterRefresh: 80 }), thresholds: SENSITIVITY_DEFAULTS.BALANCED, guards: { cooldownUntil: new Date(Date.now() + 60_000), weeklyLimitReached: true } });
  assert.equal(result.recommendation, "REFRESH_WEAK_TRACKS"); assert.equal(result.shouldRefresh, false); assert.deepEqual(result.blockers.map((item) => item.code).slice(0, 2), ["COOLDOWN", "WEEKLY_LIMIT"]);
});

test("quiet hours support overnight windows and named time zones", () => {
  assert.equal(isTimeInQuietHours({ now: new Date("2026-07-18T03:00:00Z"), start: "22:00", end: "07:00", timezone: "America/New_York" }), true);
  assert.equal(isTimeInQuietHours({ now: new Date("2026-07-18T16:00:00Z"), start: "22:00", end: "07:00", timezone: "America/New_York" }), false);
});

test("fallback full regeneration remains approval-gated by default", () => {
  const result = evaluateSmartRefresh({ playlistId: "playlist", signals: baseSignals({ fallbackOverdue: true, currentScore: 75, estimatedScoreAfterRefresh: 84 }), thresholds: SENSITIVITY_DEFAULTS.BALANCED, guards: { automaticFullRegenerationAllowed: false } });
  assert.equal(result.recommendation, "FULL_REGENERATION"); assert.equal(result.shouldRefresh, false); assert.ok(result.blockers.some((item) => item.code === "FULL_REGENERATION_REQUIRES_APPROVAL"));
});

test("v2.2.4 persistence, APIs, scheduling, and UI stay additive and bounded", () => {
  const root = process.cwd();
  const migration = readFileSync(join(root, "prisma", "migrations", "20260718030000_smart_refresh_scheduling", "migration.sql"), "utf8");
  const service = readFileSync(join(root, "src", "lib", "smartRefresh", "service.ts"), "utf8");
  const scheduler = readFileSync(join(root, "src", "lib", "backgroundScheduler.ts"), "utf8");
  const playlistService = readFileSync(join(root, "src", "lib", "playlistService.ts"), "utf8");
  const panel = readFileSync(join(root, "src", "components", "SmartRefreshPanel.tsx"), "utf8");
  const panelCss = readFileSync(join(root, "src", "components", "SmartRefreshPanel.module.css"), "utf8");
  assert.match(migration, /DEFAULT 'MANUAL_ONLY'/); assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
  assert.match(service, /queryInBatches/); assert.match(service, /take: 200/); assert.match(service, /Math\.min\(100, limit\)/); assert.match(service, /applyAdvancedPlaylistRegeneration/);
  assert.match(scheduler, /Step 6\/6: smart_refresh/); assert.ok(scheduler.indexOf("audio_features") < scheduler.indexOf("Step 6/6: smart_refresh"));
  assert.match(playlistService, /refreshMode !== "FIXED_SCHEDULE"/);
  assert.match(panel, /Check for improvements/); assert.match(panel, /Preview changes/); assert.match(panel, /Dismiss recommendation/); assert.match(panelCss, /@media\(max-width:700px\)/);
  for (const path of ["route.ts", "evaluate/route.ts", "preview/route.ts", "execute/route.ts", "dismiss/route.ts"]) {
    const source = readFileSync(join(root, "src", "app", "api", "playlists", "[playlistId]", "smart-refresh", ...path.split("/")), "utf8"); assert.match(source, /mixarr_session/);
  }
});
