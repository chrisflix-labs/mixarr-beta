import test from "node:test";
import assert from "node:assert/strict";
import { resolveExplicitFeedback, transitionPairKey } from "./personalization/feedbackRules";
import { scorePersonalizationAdjustment } from "./personalization/scoring";

const profile = {
  enabled: true, learningEnabled: true, confidence: 0, confidenceState: "NOT_ENOUGH_DATA" as const,
  minimumEventsRequired: 10, interactionCount: 0, preferredEnergyMin: null, preferredEnergyMax: null,
  preferredBpmMin: null, preferredBpmMax: null, preferredDiscoveryLevel: null, preferredDeepCutWeight: null,
  preferredPopularityWeight: null, preferredArtistVariety: null, preferredAlbumVariety: null,
  avoidRecentlyPlayed: false, avoidRecentlyUsedArtists: false, avoidLiveRecordings: false, avoidLowConfidenceMetadata: false,
};

test("explicit track precedence keeps never-recommend absolute", () => {
  const result = resolveExplicitFeedback({ trackState: "NEVER_RECOMMEND", artistState: "PREFER", fitState: "GOOD_FIT" });
  assert.equal(result.excluded, true);
  assert.equal(result.artist, 0);
  assert.ok(result.total < -100);
});

test("recommend-less artist does not cancel an individually liked track", () => {
  const result = resolveExplicitFeedback({ trackState: "LIKED", artistState: "RECOMMEND_LESS" });
  assert.equal(result.track, 3);
  assert.equal(result.artist, 0);
  assert.equal(result.total, 3);
});

test("explicit like applies while learned profile is still gathering evidence", () => {
  const scored = scorePersonalizationAdjustment(50, { id: "track-1", artistId: "artist-1" }, {
    profile,
    explicitFeedback: { trackPreferences: { "track-1": { state: "LIKED", adjustment: 3 } }, artistPreferences: {}, playlistFits: {}, transitionPenalties: {}, hardExcludedTrackIds: [] },
  });
  assert.equal(scored.finalScore, 53);
  assert.equal(scored.components?.trackFeedbackAdjustment, 3);
  assert.equal(scored.applied, true);
});

test("personalization disabled retains a global-only score", () => {
  const scored = scorePersonalizationAdjustment(50, { id: "track-1" }, {
    profile: { ...profile, enabled: false },
    explicitFeedback: { trackPreferences: { "track-1": { state: "NEVER_RECOMMEND", adjustment: -1000 } }, artistPreferences: {}, playlistFits: {}, transitionPenalties: {}, hardExcludedTrackIds: ["track-1"] },
  });
  assert.equal(scored.finalScore, 50);
  assert.equal(scored.excluded, false);
});

test("playlist-fit feedback is scoped by the supplied scoring context", () => {
  const withFit = scorePersonalizationAdjustment(50, { id: "track-1" }, { profile, explicitFeedback: { trackPreferences: {}, artistPreferences: {}, playlistFits: { "track-1": { state: "GOOD_FIT", adjustment: 4 } }, transitionPenalties: {}, hardExcludedTrackIds: [], playlistId: "workout" } });
  const unrelated = scorePersonalizationAdjustment(50, { id: "track-1" }, { profile, explicitFeedback: { trackPreferences: {}, artistPreferences: {}, playlistFits: {}, transitionPenalties: {}, hardExcludedTrackIds: [], playlistId: "sleep" } });
  assert.equal(withFit.finalScore, 54);
  assert.equal(unrelated.finalScore, 50);
});

test("poor transitions use directional pair keys instead of disliking tracks", () => {
  assert.equal(transitionPairKey("a", "b"), "a:b");
  assert.notEqual(transitionPairKey("a", "b"), transitionPairKey("b", "a"));
  const result = resolveExplicitFeedback({});
  assert.equal(result.track, 0);
});
