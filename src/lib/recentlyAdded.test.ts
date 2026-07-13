import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { chunkRecentlyAddedItems } from "./recentlyAdded/detection";
import { quarantineDecision, scoreNewMusic } from "./recentlyAdded/scoring";
import { effectivePlaylistAutomationMode, recentlyAddedSettingsInputSchema } from "./recentlyAdded/settings";
import { recentlyAddedCron } from "./recentlyAdded/scheduler";

const defaults = () => recentlyAddedSettingsInputSchema.parse({});
const completeTrack = {
  firstSeenAt: new Date(), effectiveBpm: 124, bpmConfidence: 0.9,
  audioFeature: { effectiveMood: 0.75, effectiveEnergy: 0.8, audioFeatureConfidence: 0.88 },
  metadataCorrections: [], metadataVerifications: [], metadataSourceOverrides: [],
};

describe("Recently Added Automation settings", () => {
  it("defaults the master switch and playlist-changing actions to disabled", () => {
    const settings = defaults();
    assert.equal(settings.enabled, false);
    assert.equal(settings.autoAddStrongMatches, false);
    assert.equal(settings.createRecentlyAddedPlaylists, false);
    assert.equal(settings.scheduledRegenerationEnabled, false);
    assert.equal(settings.suggestExistingPlaylistMatches, true);
    assert.equal(settings.quarantineUntilAnalyzed, true);
  });

  it("does not infer destructive toggles when the master switch is enabled", () => {
    const settings = recentlyAddedSettingsInputSchema.parse({ enabled: true });
    assert.equal(settings.autoAddStrongMatches, false);
    assert.equal(settings.createRecentlyAddedPlaylists, false);
    assert.equal(settings.scheduledRegenerationEnabled, false);
  });

  it("lets playlist-level Suggestions Only override global automatic additions", () => {
    const global = { enabled: true, suggestExistingPlaylistMatches: true, autoAddStrongMatches: true };
    assert.equal(effectivePlaylistAutomationMode(global, "suggestions"), "suggestions");
    assert.equal(effectivePlaylistAutomationMode(global, "automatic"), "automatic");
    assert.equal(effectivePlaylistAutomationMode(global, "off"), "off");
    assert.equal(effectivePlaylistAutomationMode({ ...global, enabled: false }, "automatic"), "off");
  });
});

describe("new music scoring and quarantine", () => {
  it("produces an explainable readiness score without treating it as taste prediction", () => {
    const result = scoreNewMusic(completeTrack, 95);
    assert.ok(result.score >= 75);
    assert.deepEqual(Object.keys(result.breakdown), ["metadataCompleteness", "moodConfidence", "bpmConfidence", "energyConfidence", "playlistCompatibility"]);
  });

  it("keeps unanalyzed tracks quarantined and supports manual override", () => {
    const settings = { ...defaults(), quarantineUntilAnalyzed: true, quarantineRule: "all_core" };
    assert.equal(quarantineDecision({ track: { firstSeenAt: new Date(), recentlyAddedState: {}, metadataCorrections: [], metadataVerifications: [], metadataSourceOverrides: [] }, settings }).quarantined, true);
    assert.equal(quarantineDecision({ track: { firstSeenAt: new Date(), recentlyAddedState: { manualOverride: true } }, settings }).quarantined, false);
  });

  it("raises confidence for verified manual metadata", () => {
    const track = {
      ...completeTrack,
      effectiveBpm: null,
      audioFeature: null,
      metadataCorrections: [
        { field: "bpm", valueJson: 120, isActive: true, isVerified: true },
        { field: "mood", valueJson: ["energetic"], isActive: true, isVerified: true },
        { field: "energy", valueJson: 0.8, isActive: true, isVerified: true },
      ],
    };
    assert.equal(scoreNewMusic(track, 90).confidenceScore, 100);
  });
});

describe("scale, idempotency, and scheduling guardrails", () => {
  it("chunks more than 1,000 tracks below bind-variable-safe write sizes", () => {
    const chunks = chunkRecentlyAddedItems(Array.from({ length: 1_205 }, (_, index) => index));
    assert.equal(chunks.length, 7);
    assert.ok(chunks.every((chunk) => chunk.length <= 200));
    assert.equal(chunks.flat().length, 1_205);
  });

  it("stores uniqueness constraints for detection, matching, notifications, and retry idempotency", () => {
    const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    assert.match(schema, /trackId\s+String\s+@unique/);
    assert.match(schema, /@@unique\(\[trackId, generatedPlaylistId\]\)/);
    assert.match(schema, /@@unique\(\[runId, trackId, generatedPlaylistId, action\]\)/);
    assert.match(schema, /@@unique\(\[userId, batchKey, triggerType\]\)/);
  });

  it("builds disabled, hourly, daily, weekly, and custom schedules predictably", () => {
    assert.equal(recentlyAddedCron({ scheduleType: "manual", scheduleTime: "02:00", scheduleDayOfWeek: 0 }), "");
    assert.equal(recentlyAddedCron({ scheduleType: "hourly", scheduleTime: "02:00", scheduleDayOfWeek: 0 }), "0 * * * *");
    assert.equal(recentlyAddedCron({ scheduleType: "daily", scheduleTime: "02:30", scheduleDayOfWeek: 0 }), "30 2 * * *");
    assert.equal(recentlyAddedCron({ scheduleType: "weekly", scheduleTime: "02:00", scheduleDayOfWeek: 3 }), "0 2 * * 3");
    assert.equal(recentlyAddedCron({ scheduleType: "custom", scheduleExpression: "15 4 * * 1", scheduleTime: "02:00", scheduleDayOfWeek: 0 }), "15 4 * * 1");
  });

  it("rechecks experimental flags when a scheduled job executes and stores its requirements", () => {
    const source = readFileSync(join(process.cwd(), "src", "lib", "recentlyAdded", "automation.ts"), "utf8");
    assert.match(source, /getFeatureState\("smartMix\.experimentalScheduledRegeneration"|requestedFeatureFlags/);
    assert.match(source, /requiredFeatureFlags/);
    assert.match(source, /permanent: true/);
    assert.match(source, /smartMix\.recentlyAddedAutoAdd/);
  });
});
