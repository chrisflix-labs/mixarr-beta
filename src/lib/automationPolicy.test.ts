import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { automationPolicySchema, evaluateAutomationPolicy, policyForPreset, quietHoursState, type AutomationPolicy } from "./automation/policy";

const base: AutomationPolicy = {
  permissionLevel: "FULLY_AUTOMATIC", preset: "CUSTOM", isCustom: true,
  allowAdditions: true, allowRemovals: true, allowReorder: true,
  maximumAdditionsPerUpdate: 3, maximumRemovalsPerUpdate: 1,
  minimumAdditionConfidence: 85, minimumRemovalConfidence: 90,
  maximumChangesPerDay: 10, maximumChangesPerWeek: 50,
  maximumAdditionsPerDay: 8, maximumRemovalsPerDay: 2,
  maximumAdditionsPerWeek: 40, maximumRemovalsPerWeek: 10,
  quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "America/New_York",
  quietHoursDaysJson: null, allowAnalysisDuringQuietHours: true, allowProposalsDuringQuietHours: true,
  requireApprovalForRegeneration: true, paused: false, pauseReason: null,
};

const candidate = (id: string, confidence: number, extra = {}) => ({ id, trackId: `track-${id}`, confidence, metadataComplete: true, ...extra });
const evaluate = (overrides: Partial<AutomationPolicy> = {}, input = {}) => evaluateAutomationPolicy({ policy: { ...base, ...overrides }, source: "RECENTLY_ADDED", additions: [candidate("a", 95)], ...input });

describe("adaptive automation policies", () => {
  it("fails safely when policy data is missing or invalid", () => {
    assert.equal(evaluateAutomationPolicy({ policy: null, source: "RECENTLY_ADDED" }).reasonCode, "policy_invalid");
    assert.equal(evaluateAutomationPolicy({ policy: { ...base, timezone: "Not/AZone" }, source: "RECENTLY_ADDED" }).allowed, false);
  });

  it("enforces all four permission levels", () => {
    assert.equal(evaluate({ permissionLevel: "DISABLED" }).reasonCode, "automation_disabled");
    assert.equal(evaluate({ permissionLevel: "SUGGEST_ONLY" }).reasonCode, "suggest_only_mode");
    assert.equal(evaluate({ permissionLevel: "REQUIRE_APPROVAL" }).requiresApproval, true);
    assert.equal(evaluate({ permissionLevel: "REQUIRE_APPROVAL" }, { approvalGranted: true }).allowed, true);
    assert.equal(evaluate({ permissionLevel: "FULLY_AUTOMATIC" }).allowed, true);
  });

  it("populates conservative, balanced, and aggressive presets without hidden settings", () => {
    const conservative = policyForPreset("CONSERVATIVE", base);
    const balanced = policyForPreset("BALANCED", base);
    const aggressive = policyForPreset("AGGRESSIVE", base);
    assert.equal(conservative.permissionLevel, "SUGGEST_ONLY");
    assert.equal(conservative.allowRemovals, false);
    assert.equal(balanced.allowAdditions, true);
    assert.equal(balanced.allowRemovals, false);
    assert.equal(aggressive.allowRemovals, true);
    assert.ok(aggressive.maximumChangesPerWeek > balanced.maximumChangesPerWeek);
  });

  it("selects highest-confidence additions after filtering and applies per-update limits", () => {
    const decision = evaluateAutomationPolicy({ policy: base, source: "RECENTLY_ADDED", additions: [candidate("low", 84), candidate("second", 91), candidate("best", 99), candidate("third", 90), candidate("fourth", 89)] });
    assert.deepEqual(decision.eligibleAdditionIds, ["best", "second", "third"]);
    assert.equal(decision.skipped.find((item) => item.candidateId === "low")?.reasonCode, "below_confidence_threshold");
    assert.equal(decision.skipped.find((item) => item.candidateId === "fourth")?.reasonCode, "maximum_additions_reached");
  });

  it("uses stricter removal confidence and never removes protected, locked, or important tracks", () => {
    const decision = evaluateAutomationPolicy({ policy: { ...base, maximumRemovalsPerUpdate: 5 }, source: "PLAYLIST_IMPROVEMENT", removals: [candidate("protected", 99, { protected: true }), candidate("locked", 99, { locked: true }), candidate("important", 99, { important: true }), candidate("low", 89), candidate("safe", 96)] });
    assert.deepEqual(decision.eligibleRemovalIds, ["safe"]);
    assert.deepEqual(new Set(decision.blockedTrackIds), new Set(["track-protected", "track-locked", "track-important"]));
    assert.equal(decision.skipped.find((item) => item.candidateId === "low")?.reasonCode, "below_confidence_threshold");
  });

  it("lets zero disable additions and removals", () => {
    const addition = evaluate({ maximumAdditionsPerUpdate: 0 });
    const removal = evaluateAutomationPolicy({ policy: { ...base, maximumRemovalsPerUpdate: 0 }, source: "PLAYLIST_IMPROVEMENT", removals: [candidate("r", 99)] });
    assert.equal(addition.allowedAdditions, 0);
    assert.equal(removal.allowedRemovals, 0);
  });

  it("enforces daily and weekly aggregate limits without counting suggestions", () => {
    const daily = evaluate({}, { usedToday: { additions: 8, removals: 2 }, usedThisWeek: { additions: 8, removals: 2 } });
    const weekly = evaluate({ maximumChangesPerDay: 100 }, { usedToday: { additions: 0, removals: 0 }, usedThisWeek: { additions: 40, removals: 10 } });
    assert.equal(daily.reasonCode, "daily_limit_reached");
    assert.equal(weekly.reasonCode, "weekly_limit_reached");
  });

  it("global pause and playlist protection override full automation", () => {
    assert.equal(evaluate({ paused: true, pauseReason: "Maintenance" }).reasonCode, "automation_paused");
    assert.equal(evaluate({}, { protectedPlaylist: true }).reasonCode, "protected_playlist");
    assert.equal(evaluate({}, { playlistPaused: true }).reasonCode, "automation_paused");
  });

  it("blocks missing recommendation metadata rather than inventing confidence", () => {
    const decision = evaluateAutomationPolicy({ policy: base, source: "RECENTLY_ADDED", additions: [{ id: "missing", trackId: "track", confidence: null, metadataComplete: false }] });
    assert.equal(decision.reasonCode, "missing_required_metadata");
  });

  it("handles quiet hours that cross midnight in the stored server timezone", () => {
    const policy = { ...base, quietHoursEnabled: true };
    assert.equal(quietHoursState(policy, new Date("2026-07-17T03:00:00.000Z")).active, true); // 11 PM EDT
    assert.equal(quietHoursState(policy, new Date("2026-07-17T11:30:00.000Z")).active, false); // 7:30 AM EDT
    const decision = evaluateAutomationPolicy({ policy, source: "RECENTLY_ADDED", now: new Date("2026-07-17T03:00:00.000Z"), additions: [candidate("a", 99)] });
    assert.equal(decision.reasonCode, "quiet_hours_active");
    assert.ok(decision.eligibleAfter);
  });

  it("requires approval for scheduled regeneration even in full automatic mode", () => {
    const decision = evaluateAutomationPolicy({ policy: base, source: "SCHEDULED_REGENERATION", additions: [candidate("a", 99)], removals: [candidate("r", 99)] });
    assert.equal(decision.requiresApproval, true);
    assert.equal(decision.reasonCode, "approval_required");
  });

  it("keeps policy snapshots structured and normalized", () => {
    const decision = evaluate();
    assert.equal(decision.policySnapshot.permissionLevel, "FULLY_AUTOMATIC");
    assert.equal(decision.policySnapshot.source, "RECENTLY_ADDED");
    assert.doesNotThrow(() => automationPolicySchema.parse(decision.policySnapshot));
  });
});

describe("automation integration guards", () => {
  it("routes Recently Added and scheduled regeneration writes through the evaluator", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/recentlyAdded/automation.ts"), "utf8");
    assert.match(source, /source: "RECENTLY_ADDED"/);
    assert.match(source, /source: "SCHEDULED_REGENERATION"/);
    assert.match(source, /evaluatePlaylistAutomation/);
    assert.match(source, /createPlaylistVersionInTransaction/);
  });

  it("ships conservative migration, policy APIs, protection, approval, activity, and rollback UI", () => {
    const migration = readFileSync(join(process.cwd(), "prisma/migrations/20260716130000_adaptive_automation_policies/migration.sql"), "utf8");
    const ui = readFileSync(join(process.cwd(), "src/components/AutomationPoliciesWorkspace.tsx"), "utf8");
    assert.match(migration, /'SUGGEST_ONLY'/);
    assert.match(migration, /"allowRemovals" BOOLEAN NOT NULL DEFAULT false/);
    assert.match(ui, /Approve all/);
    assert.match(ui, /Reset to global/);
    assert.match(ui, /Roll back/);
    assert.match(ui, /Minimum removal confidence/);
  });
});
