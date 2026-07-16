import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILT_IN_CONTEXT_PROFILES,
  CONTEXT_PROFILE_VERSION,
  contextInfluenceCap,
  contextProfileSnapshot,
  contextToSmartMixSettings,
  detectContextIdentityConflict,
  profileMatchesDate,
  scoreContextMatch,
  timeRangeContains,
} from "./contextualMixes";
import { DEFAULT_SMART_MIX_TUNING } from "./smartMixEngine/v2/tuning";
import { scoreSmartMixTrack } from "./smartMixEngine/v2/scoring";

describe("Contextual Mixes v2.1.6", () => {
  it("ships the seven stable versioned built-in profiles", () => {
    assert.deepEqual(BUILT_IN_CONTEXT_PROFILES.map((profile) => profile.name), [
      "Monday Morning Focus", "Friday Night Energy", "Late Night Drive", "Weekend Discovery", "Sunday Acoustic", "Summer Party", "Winter Chill",
    ]);
    assert.ok(BUILT_IN_CONTEXT_PROFILES.every((profile) => profile.isBuiltIn && profile.builtInVersion === CONTEXT_PROFILE_VERSION));
    assert.equal(new Set(BUILT_IN_CONTEXT_PROFILES.map((profile) => profile.builtInKey)).size, 7);
  });

  it("resolves a context into existing Smart Mix v2 controls", () => {
    const lateNight = BUILT_IN_CONTEXT_PROFILES.find((profile) => profile.builtInKey === "late_night_drive")!;
    const resolved = contextToSmartMixSettings(lateNight, DEFAULT_SMART_MIX_TUNING);
    assert.equal(resolved.presetName, "Late Night Drive");
    assert.equal(resolved.discovery.level, "medium");
    assert.equal(resolved.discovery.avoidRecentlyUsedPlaylistTracks, true);
    assert.equal(resolved.bpmFlow.mode, "NATURAL");
    assert.equal(resolved.artistVariety, 72);
  });

  it("caps Low, Balanced, and Strong context influence", () => {
    assert.equal(contextInfluenceCap("LOW"), 4);
    assert.equal(contextInfluenceCap("BALANCED"), 8);
    assert.equal(contextInfluenceCap("STRONG"), 12);
    const party = BUILT_IN_CONTEXT_PROFILES.find((profile) => profile.builtInKey === "summer_party")!;
    const track = { audioFeature: { energy: 0.95, moodTags: ["Happy", "Party"] }, moodTags: ["Happy", "Party"], effectiveBpm: 128, popularity: { score: 90 } };
    for (const influence of ["LOW", "BALANCED", "STRONG"] as const) {
      const score = scoreContextMatch(track, contextProfileSnapshot(party, influence));
      assert.ok(Math.abs(score.adjustment) <= contextInfluenceCap(influence));
    }
  });

  it("handles time ranges that cross midnight", () => {
    assert.equal(timeRangeContains("23:30", "21:00", "02:00"), true);
    assert.equal(timeRangeContains("01:30", "21:00", "02:00"), true);
    assert.equal(timeRangeContains("12:00", "21:00", "02:00"), false);
  });

  it("matches day, local time, and descriptive season using a configured timezone", () => {
    const monday = BUILT_IN_CONTEXT_PROFILES.find((profile) => profile.builtInKey === "monday_morning_focus")!;
    assert.equal(profileMatchesDate(monday, new Date("2026-07-20T13:00:00Z"), "America/New_York"), true);
    assert.equal(profileMatchesDate(monday, new Date("2026-07-21T13:00:00Z"), "America/New_York"), false);
  });

  it("falls back softly and lowers confidence when metadata is missing", () => {
    const focus = BUILT_IN_CONTEXT_PROFILES[0];
    const score = scoreContextMatch({ title: "Unknown metadata" }, contextProfileSnapshot(focus, "STRONG"));
    assert.equal(score.confidence, "LOW");
    assert.deepEqual(score.missingMetadata.sort(), ["BPM", "energy", "mood", "popularity"].sort());
    assert.ok(Math.abs(score.adjustment) <= 12);
  });

  it("adds a real context component before personalization without creating exclusions", () => {
    const drive = BUILT_IN_CONTEXT_PROFILES.find((profile) => profile.builtInKey === "late_night_drive")!;
    const scored = scoreSmartMixTrack({ id: "track-1", effectiveBpm: 105, audioFeature: { energy: 0.62, valence: 0.35, moodTags: ["Moody", "Ambient"] }, moodTags: ["Moody", "Ambient"], popularity: { score: 38 } }, { limit: 20, tuningConfig: contextToSmartMixSettings(drive), contextSelection: contextProfileSnapshot(drive, "BALANCED") });
    assert.equal(typeof scored.scoreBreakdown.context, "number");
    assert.ok(scored.contextScore?.reasons.length);
    assert.equal(scored.exclusionReason, undefined);
  });

  it("keeps a versioned immutable snapshot and explicit manual overrides", () => {
    const profile = BUILT_IN_CONTEXT_PROFILES[2];
    const snapshot = contextProfileSnapshot(profile, "BALANCED", ["discovery", "artistVariety"]);
    assert.equal(snapshot.profileVersion, CONTEXT_PROFILE_VERSION);
    assert.deepEqual(snapshot.manualOverrides, ["discovery", "artistVariety"]);
    assert.notEqual(snapshot.behavior, profile.behavior);
  });

  it("detects strong playlist identity conflicts and defaults to balancing both", () => {
    const party = BUILT_IN_CONTEXT_PROFILES.find((profile) => profile.builtInKey === "friday_night_energy")!;
    const conflict = detectContextIdentityConflict(party.behavior, { targetEnergy: 25 });
    assert.equal(conflict?.defaultResolution, "BALANCE");
    assert.ok(conflict?.options.includes("PRESERVE_IDENTITY"));
    assert.equal(detectContextIdentityConflict(party.behavior, { targetEnergy: 75 }), null);
  });
});
