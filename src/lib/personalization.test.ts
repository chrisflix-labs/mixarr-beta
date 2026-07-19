import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { scorePersonalizationAdjustment } from "./personalization/scoring";
import type { PersonalizationScoringContext, RecommendationProfileSnapshot } from "./personalization/types";
import { currentRoadmapRelease, roadmapCycles } from "./roadmap";
import { personalizationSettingsSchema, playlistPreferenceSchema } from "./personalization/service";
import { scoreSmartMixTrack } from "./smartMixEngine/v2/scoring";

const establishedProfile: RecommendationProfileSnapshot = {
  enabled: true,
  learningEnabled: true,
  confidence: 0.8,
  confidenceState: "ESTABLISHED",
  minimumEventsRequired: 10,
  interactionCount: 80,
  preferredEnergyMin: 0.6,
  preferredEnergyMax: 0.9,
  preferredBpmMin: 110,
  preferredBpmMax: 135,
  preferredDiscoveryLevel: 0.8,
  preferredDeepCutWeight: 0.8,
  preferredPopularityWeight: null,
  preferredArtistVariety: 0.8,
  preferredAlbumVariety: null,
  avoidRecentlyPlayed: true,
  avoidRecentlyUsedArtists: true,
  avoidLiveRecordings: true,
  avoidLowConfidenceMetadata: true,
};

function context(overrides: Partial<PersonalizationScoringContext> = {}): PersonalizationScoringContext {
  return { profile: establishedProfile, maxAdjustment: 8, ...overrides };
}

const matchingTrack = {
  id: "track-1",
  artistId: "artist-1",
  isLive: false,
  effectiveBpm: 122,
  bpmConfidence: 0.9,
  audioFeature: { effectiveEnergy: 0.75, audioFeatureConfidence: 0.9 },
  popularity: { score: 30, confidence: 0.9 },
};

describe("personalization scoring", () => {
  it("returns the global score unchanged when personalization is disabled", () => {
    const result = scorePersonalizationAdjustment(78, matchingTrack, context({ profile: { ...establishedProfile, enabled: false } }));
    assert.equal(result.finalScore, 78);
    assert.equal(result.personalizationAdjustment, 0);
    assert.equal(result.playlistContextScore, 0);
  });

  it("preserves the existing Smart Mix score shape when disabled", () => {
    const withoutPersonalization = scoreSmartMixTrack(matchingTrack, { limit: 20, rules: [] });
    const withDisabledPersonalization = scoreSmartMixTrack(matchingTrack, { limit: 20, rules: [], personalization: context({ profile: { ...establishedProfile, enabled: false } }) });
    assert.equal(withDisabledPersonalization.score, withoutPersonalization.score);
    assert.deepEqual(withDisabledPersonalization.scoreBreakdown, withoutPersonalization.scoreBreakdown);
    assert.equal(withDisabledPersonalization.personalizationScore, undefined);
  });

  it("does not apply learned user adjustments before minimum evidence", () => {
    const result = scorePersonalizationAdjustment(78, matchingTrack, context({ profile: { ...establishedProfile, confidence: 0.1, interactionCount: 3, confidenceState: "NOT_ENOUGH_DATA" } }));
    assert.equal(result.finalScore, 78);
    assert.match(result.personalizationReasons.at(-1)?.message || "", /still learning/);
  });

  it("applies explainable energy, BPM, and deep-cut boosts", () => {
    const result = scorePersonalizationAdjustment(78, matchingTrack, context());
    assert.ok(result.finalScore > 78);
    assert.ok(result.personalizationReasons.some((reason) => reason.feature === "energy"));
    assert.ok(result.personalizationReasons.some((reason) => reason.feature === "bpm"));
    assert.ok(result.personalizationReasons.some((reason) => reason.feature === "deep_cut"));
  });

  it("applies live, low-confidence, recent-track, and repeated-artist penalties", () => {
    const result = scorePersonalizationAdjustment(78, { ...matchingTrack, isLive: true, effectiveBpm: 80, bpmConfidence: 0.2, audioFeature: { effectiveEnergy: 0.2, audioFeatureConfidence: 0.2 }, popularity: { score: 80, confidence: 0.2 } }, context({ recentlyUsedTrackIds: ["track-1"], recentlyUsedArtistIds: ["artist-1"] }));
    assert.ok(result.finalScore < 78);
    assert.deepEqual(new Set(result.personalizationReasons.map((reason) => reason.feature)), new Set(["live", "metadata", "recent_track", "recent_artist"]));
  });

  it("bounds user and playlist adjustments so they cannot overwhelm global scoring", () => {
    const result = scorePersonalizationAdjustment(78, { ...matchingTrack, isLive: true }, context({
      recentlyUsedTrackIds: ["track-1"],
      recentlyUsedArtistIds: ["artist-1"],
      maxAdjustment: 2,
      playlistProfile: { enabled: true, mode: "PLAYLIST_SPECIFIC", source: "MANUAL", isLearned: false, confidence: 1, evidenceCount: 0, energyMin: 0.6, energyMax: 0.9, bpmMin: 110, bpmMax: 135, discoveryPreference: 1, deepCutPreference: 1, artistVarietyPreference: null, albumVarietyPreference: null, repetitionTolerance: null, avoidLiveRecordings: true, avoidLowConfidenceMetadata: true, avoidRecentlyPlayedTracks: true },
    }));
    assert.ok(Math.abs(result.finalScore - 78) <= 2);
  });

  it("does not double-count playlist preference overrides at user level", () => {
    const result = scorePersonalizationAdjustment(78, matchingTrack, context({ playlistProfile: { enabled: true, mode: "PLAYLIST_SPECIFIC", source: "MANUAL", isLearned: false, confidence: 1, evidenceCount: 0, energyMin: 0.6, energyMax: 0.9, bpmMin: null, bpmMax: null, discoveryPreference: null, deepCutPreference: null, artistVarietyPreference: null, albumVarietyPreference: null, repetitionTolerance: null, avoidLiveRecordings: null, avoidLowConfidenceMetadata: null, avoidRecentlyPlayedTracks: null } }));
    assert.equal(result.personalizationReasons.filter((reason) => reason.feature === "energy").length, 1);
    assert.equal(result.personalizationReasons.find((reason) => reason.feature === "energy")?.layer, "playlist");
  });
});

describe("personalization roadmap", () => {
  it("marks prior cycles complete and keeps v2.3.x current", () => {
    assert.equal(roadmapCycles.find((cycle) => cycle.id === "2.0.x")?.status, "completed");
    assert.equal(roadmapCycles.find((cycle) => cycle.id === "2.1.x")?.status, "completed");
    assert.equal(roadmapCycles.find((cycle) => cycle.id === "2.2.x")?.status, "completed");
    assert.equal(roadmapCycles.find((cycle) => cycle.id === "2.3.x")?.status, "current");
    assert.equal(currentRoadmapRelease()?.version, "2.3.5");
  });
});

describe("personalization validation", () => {
  it("requires personalization before behavior learning", () => {
    assert.equal(personalizationSettingsSchema.safeParse({ enabled: false, learningEnabled: true }).success, false);
    assert.equal(personalizationSettingsSchema.safeParse({ enabled: true, learningEnabled: false }).success, true);
  });

  it("rejects invalid playlist ranges and accepts the supported modes", () => {
    assert.equal(playlistPreferenceSchema.safeParse({ mode: "PLAYLIST_SPECIFIC", energyMin: 0.9, energyMax: 0.2 }).success, false);
    assert.equal(playlistPreferenceSchema.safeParse({ mode: "GLOBAL_ONLY" }).success, true);
  });
});

describe("personalization persistence and API contracts", () => {
  it("defines user cleanup, uniqueness, idempotency, and indexed history in the migration", () => {
    const migration = readFileSync(join(process.cwd(), "prisma", "migrations", "20260714010000_personalization_foundation", "migration.sql"), "utf8");
    assert.match(migration, /UserRecommendationProfile_userId_key/);
    assert.match(migration, /TrackInteractionEvent_idempotencyKey_key/);
    assert.match(migration, /TrackInteractionEvent_userId_occurredAt_idx/);
    assert.match(migration, /UserRecommendationProfile_userId_fkey[\s\S]*ON DELETE CASCADE/);
  });

  it("requires cookie authentication on every personalization route", () => {
    const routes = ["profile", "history", "recalculate", "reset"].map((name) => readFileSync(join(process.cwd(), "src", "app", "api", "personalization", name, "route.ts"), "utf8"));
    routes.push(readFileSync(join(process.cwd(), "src", "app", "api", "personalization", "playlists", "[playlistId]", "route.ts"), "utf8"));
    for (const route of routes) {
      assert.match(route, /mixarr_session/);
      assert.match(route, /Unauthorized/);
    }
  });

  it("keeps reset explicit and the profile layout mobile-safe", () => {
    const resetRoute = readFileSync(join(process.cwd(), "src", "app", "api", "personalization", "reset", "route.ts"), "utf8");
    const panel = readFileSync(join(process.cwd(), "src", "components", "PersonalizationProfilePanel.tsx"), "utf8");
    const css = readFileSync(join(process.cwd(), "src", "components", "PersonalizationProfilePanel.module.css"), "utf8");
    assert.match(resetRoute, /RESET PERSONALIZATION/);
    assert.match(panel, /Smart Mix is currently using global scoring only/);
    assert.match(panel, /No personalization data is sent to an external service/);
    assert.match(css, /@media \(max-width: 760px\)/);
  });
});
