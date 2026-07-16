import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_ADAPTIVE_SCORING_SETTINGS } from "./adaptiveScoring/service";
import { scoreAdaptiveSmartMixTrack } from "./adaptiveScoring/scoring";
import type { AdaptiveScoringContext } from "./adaptiveScoring/types";

const profile = {
  enabled: true,
  learningEnabled: true,
  confidence: 0.8,
  confidenceState: "ESTABLISHED" as const,
  minimumEventsRequired: 10,
  interactionCount: 60,
  preferredEnergyMin: 0.6,
  preferredEnergyMax: 0.9,
  preferredBpmMin: 110,
  preferredBpmMax: 130,
  preferredDiscoveryLevel: 0.8,
  preferredDeepCutWeight: 0.8,
  preferredPopularityWeight: null,
  preferredArtistVariety: 0.8,
  preferredAlbumVariety: 0.8,
  avoidRecentlyPlayed: true,
  avoidRecentlyUsedArtists: true,
  avoidLiveRecordings: true,
  avoidLowConfidenceMetadata: true,
};

function context(overrides: Partial<AdaptiveScoringContext> = {}): AdaptiveScoringContext {
  return {
    settings: { ...DEFAULT_ADAPTIVE_SCORING_SETTINGS },
    personalization: {
      profile,
      recentlyUsedTrackIds: [],
      recentlyUsedArtistIds: [],
      explicitFeedback: { trackPreferences: {}, artistPreferences: {}, playlistFits: {}, transitionPenalties: {}, hardExcludedTrackIds: [] },
    },
    statistics: {},
    modelVersion: "1",
    ...overrides,
  };
}

const track = {
  id: "track-1",
  artistId: "artist-1",
  effectiveBpm: 122,
  bpmConfidence: 0.9,
  isLive: false,
  audioFeature: { effectiveEnergy: 0.75, confidence: 0.9 },
  popularity: { score: 30, confidence: 0.9 },
  tags: [{ type: "mood", name: "Atmospheric" }],
  artist: { tags: [] },
};

describe("adaptive Smart Mix scoring", () => {
  it("preserves the base score when adaptive scoring is disabled", () => {
    const result = scoreAdaptiveSmartMixTrack(72, track, context({ settings: { ...DEFAULT_ADAPTIVE_SCORING_SETTINGS, enabled: false } }));
    assert.equal(result.baseScore, 72);
    assert.equal(result.personalizedScore, 72);
    assert.equal(result.cappedAdjustment, 0);
  });

  it("calculates a separate personalized score with visible components", () => {
    const result = scoreAdaptiveSmartMixTrack(72, track, context());
    assert.equal(result.baseScore, 72);
    assert.ok(result.personalizedScore > result.baseScore);
    assert.ok(result.components.some((component) => component.key === "personalPreference"));
    assert.ok(result.components.some((component) => component.key === "discoveryTolerance"));
  });

  it("limits one inferred observation to very low confidence", () => {
    const result = scoreAdaptiveSmartMixTrack(72, track, context({
      statistics: {
        "global:artist:artist-1": { dimension: "artist", featureKey: "artist-1", positiveWeight: 1, negativeWeight: 0, observationCount: 1, explicitCount: 0, confidence: 0.15 },
      },
    }));
    const artist = result.components.find((component) => component.key === "artistPreference");
    assert.equal(artist?.confidence, "Very low");
    assert.equal(artist?.appliedAdjustment, 0);
  });

  it("increases influence for repeated consistent evidence", () => {
    const result = scoreAdaptiveSmartMixTrack(72, track, context({
      statistics: {
        "global:artist:artist-1": { dimension: "artist", featureKey: "artist-1", positiveWeight: 12, negativeWeight: 1, observationCount: 14, explicitCount: 0, confidence: 0.82 },
      },
    }));
    const artist = result.components.find((component) => component.key === "artistPreference");
    assert.equal(artist?.confidence, "High");
    assert.ok((artist?.appliedAdjustment || 0) > 1);
  });

  it("can disable inferred behavior without deleting explicit feedback", () => {
    const base = context();
    const result = scoreAdaptiveSmartMixTrack(72, track, {
      ...base,
      settings: { ...base.settings, includeInferredBehavior: false },
      personalization: {
        ...base.personalization!,
        explicitFeedback: {
          ...base.personalization!.explicitFeedback!,
          artistPreferences: { "artist-1": { state: "PREFER", adjustment: 2.5 } },
        },
      },
      statistics: {
        "global:artist:artist-1": { dimension: "artist", featureKey: "artist-1", positiveWeight: 0, negativeWeight: 20, observationCount: 20, explicitCount: 0, confidence: 1 },
      },
    });
    const artist = result.components.find((component) => component.key === "artistPreference");
    const personal = result.components.find((component) => component.key === "personalPreference");
    assert.ok((artist?.appliedAdjustment || 0) > 0);
    assert.equal(personal?.appliedAdjustment, 0);
  });

  it("lets recent explicit feedback override conflicting inferred history", () => {
    const base = context();
    const result = scoreAdaptiveSmartMixTrack(72, track, {
      ...base,
      personalization: {
        ...base.personalization!,
        explicitFeedback: {
          ...base.personalization!.explicitFeedback!,
          trackPreferences: { "track-1": { state: "LIKED", adjustment: 3 } },
        },
      },
      statistics: {
        "global:track:track-1": { dimension: "track", featureKey: "track-1", positiveWeight: 0, negativeWeight: 20, observationCount: 20, explicitCount: 0, confidence: 1 },
      },
    });
    const rejection = result.components.find((component) => component.key === "historicalRejection");
    assert.equal(rejection?.appliedAdjustment, 0);
  });

  it("caps large adjustments using the maximum influence setting", () => {
    const result = scoreAdaptiveSmartMixTrack(72, track, context({
      settings: { ...DEFAULT_ADAPTIVE_SCORING_SETTINGS, maximumInfluence: 0.25 },
      personalization: {
        ...context().personalization!,
        explicitFeedback: {
          trackPreferences: { "track-1": { state: "LIKED", adjustment: 3 } },
          artistPreferences: { "artist-1": { state: "PREFER", adjustment: 2.5 } },
          playlistFits: { "track-1": { state: "GOOD_FIT", adjustment: 4 } },
          transitionPenalties: {},
          hardExcludedTrackIds: [],
        },
      },
      statistics: {
        "global:artist:artist-1": { dimension: "artist", featureKey: "artist-1", positiveWeight: 20, negativeWeight: 0, observationCount: 20, explicitCount: 5, confidence: 1 },
      },
    }));
    assert.ok(result.cappedAdjustment <= 5);
    assert.equal(result.adjustmentWasCapped, true);
  });

  it("keeps never-recommend as a hard exclusion", () => {
    const base = context();
    const result = scoreAdaptiveSmartMixTrack(72, track, {
      ...base,
      personalization: {
        ...base.personalization!,
        explicitFeedback: {
          trackPreferences: { "track-1": { state: "NEVER_RECOMMEND", adjustment: -1000 } },
          artistPreferences: {},
          playlistFits: {},
          transitionPenalties: {},
          hardExcludedTrackIds: ["track-1"],
        },
      },
    });
    assert.equal(result.excluded, true);
    assert.equal(result.exclusionReason, "Never recommend");
  });
});

describe("adaptive scoring persistence and API contracts", () => {
  it("uses an additive indexed migration", () => {
    const migration = readFileSync(join(process.cwd(), "prisma", "migrations", "20260716020000_adaptive_smart_mix_scoring", "migration.sql"), "utf8");
    assert.match(migration, /CREATE TABLE "AdaptiveScoringProfile"/);
    assert.match(migration, /AdaptivePreferenceStatistic_userId_scopeKey_dimension_featureKey_key/);
    assert.match(migration, /ON DELETE CASCADE/);
    assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE/);
  });

  it("requires cookie authentication on adaptive routes", () => {
    const routes = [
      join(process.cwd(), "src", "app", "api", "personalization", "adaptive", "route.ts"),
      join(process.cwd(), "src", "app", "api", "personalization", "adaptive", "recalculate", "route.ts"),
      join(process.cwd(), "src", "app", "api", "personalization", "adaptive", "reset", "route.ts"),
      join(process.cwd(), "src", "app", "api", "personalization", "adaptive", "statistics", "route.ts"),
      join(process.cwd(), "src", "app", "api", "personalization", "adaptive", "explanations", "[trackId]", "route.ts"),
    ].map((path) => readFileSync(path, "utf8"));
    for (const route of routes) {
      assert.match(route, /mixarr_session/);
      assert.match(route, /Unauthorized/);
    }
  });
});
