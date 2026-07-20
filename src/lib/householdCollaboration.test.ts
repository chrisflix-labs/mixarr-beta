import test from "node:test";
import assert from "node:assert/strict";
import { approvalRequirement, calculateEffectiveInfluence, detectPreferenceConflicts, resolveFamilyFriendlyRule, selectFairHouseholdTracks } from "./householdCollaboration/core";

const participants = [
  { id: "chris", displayName: "Chris", configuredWeight: 70, hasUsableHistory: true },
  { id: "jamie", displayName: "Jamie", configuredWeight: 20, hasUsableHistory: true },
  { id: "guest", displayName: "Guest", configuredWeight: 10, hasUsableHistory: true },
];

test("normalizes weights over and under 100 without mutating configured values", () => {
  for (const weights of [[70, 20, 10], [0.4, 0.2, 0.1]]) {
    const result = calculateEffectiveInfluence({ participants: participants.map((participant, index) => ({ ...participant, configuredWeight: weights[index] })), mode: "WEIGHTED_HOUSEHOLD", maximumIndividualInfluence: 1, sharedFavoritesWeight: 0.15 });
    assert.equal(Number((result.participants.reduce((sum, participant) => sum + participant.effectiveInfluence, 0) + result.sharedPreferenceInfluence).toFixed(8)), 1);
    assert.deepEqual(result.participants.map((participant) => participant.configuredWeight), weights);
  }
});

test("balanced mode caps domination and redistributes excluded influence", () => {
  const result = calculateEffectiveInfluence({ participants: [{ ...participants[0], configuredWeight: 100 }, { ...participants[1], configuredWeight: 1 }, { ...participants[2], excluded: true }], mode: "BALANCED_HOUSEHOLD", maximumIndividualInfluence: 0.4, sharedFavoritesWeight: 0.2 });
  assert.equal(result.participants.find((participant) => participant.id === "guest")?.effectiveInfluence, 0);
  assert.ok(result.participants.every((participant) => participant.effectiveInfluence <= 0.4));
  assert.equal(result.capApplied, false, "balanced mode equalizes active profiles before applying the cap");
});

test("weighted mode records cap reduction and no-history redistribution", () => {
  const result = calculateEffectiveInfluence({ participants: [{ ...participants[0], configuredWeight: 90 }, { ...participants[1], configuredWeight: 10 }, { ...participants[2], hasUsableHistory: false }], mode: "WEIGHTED_HOUSEHOLD", maximumIndividualInfluence: 0.5, sharedFavoritesWeight: 0 });
  assert.equal(result.participants.find((participant) => participant.id === "chris")?.effectiveInfluence, 0.5);
  assert.ok((result.participants.find((participant) => participant.id === "chris")?.capReduction || 0) > 0);
  assert.equal(result.participants.find((participant) => participant.id === "guest")?.exclusionReason, "NO_USABLE_HISTORY");
});

test("detects deterministic discovery, artist, track, and explicit conflicts", () => {
  const conflicts = detectPreferenceConflicts([
    { id: "a", displayName: "A", weight: 0.5, discovery: 0.9, explicitRule: "ALLOW", likedArtistIds: ["artist"], likedTrackIds: ["track"] },
    { id: "b", displayName: "B", weight: 0.5, discovery: 0.1, explicitRule: "BLOCK", dislikedArtistIds: ["artist"], dislikedTrackIds: ["track"] },
  ]);
  assert.deepEqual(new Set(conflicts.map((conflict) => conflict.category)), new Set(["DISCOVERY", "EXPLICIT_CONTENT", "ARTIST", "TRACK"]));
  assert.equal(conflicts.find((conflict) => conflict.category === "EXPLICIT_CONTENT")?.resolutionMethod, "STRICTEST_RULE_WINS");
});

test("child family restriction blocks explicit and unknown-rated tracks", () => {
  const family = resolveFamilyFriendlyRule({ householdRule: "ALLOW", playlistRule: "STRICTEST_PROFILE", unknownRatingRule: "BLOCK", participants: [{ displayName: "Child", memberType: "CHILD", explicitRule: "BLOCK" }] });
  assert.equal(family.blockExplicit, true);
  assert.equal(family.blockUnknownRatings, true);
  assert.match(family.reason, /Child/);
});

test("strictest-profile mode does not invent a restriction for adults who allow explicit content", () => {
  const family = resolveFamilyFriendlyRule({ householdRule: "STRICTEST_PROFILE", playlistRule: "STRICTEST_PROFILE", unknownRatingRule: "BLOCK", participants: [{ displayName: "Adult", memberType: "MEMBER", explicitRule: "ALLOW" }] });
  assert.equal(family.blockExplicit, false);
  assert.equal(family.blockUnknownRatings, false);
});

test("approval modes validate impossible thresholds", () => {
  assert.deepEqual(approvalRequirement({ mode: "MAJORITY", eligibleVoters: 4 }), { required: 3, eligible: 4, remaining: 3, satisfied: false });
  assert.deepEqual(approvalRequirement({ mode: "UNANIMOUS", eligibleVoters: 2 }), { required: 2, eligible: 2, remaining: 2, satisfied: false });
  assert.throws(() => approvalRequirement({ mode: "FIXED", fixedCount: 3, eligibleVoters: 2 }), /impossible/);
});

test("fair selection enforces dislikes, family rules, member runs, and artist repetition", () => {
  const influence = calculateEffectiveInfluence({ participants: participants.slice(0, 2), mode: "BALANCED_HOUSEHOLD", sharedFavoritesWeight: 0, maximumIndividualInfluence: 0.5 });
  const candidates = [
    { id: "blocked", artistId: "x", isExplicit: true, contentRating: "explicit", userScores: { chris: 100, jamie: 0 } },
    { id: "hard", artistId: "y", contentRating: "clean", hardDisliked: true, userScores: { chris: 100, jamie: 100 } },
    { id: "a1", artistId: "a", contentRating: "clean", userScores: { chris: 100, jamie: 10 } },
    { id: "a2", artistId: "a", contentRating: "clean", userScores: { chris: 95, jamie: 10 } },
    { id: "b1", artistId: "b", contentRating: "clean", userScores: { chris: 10, jamie: 100 } },
    { id: "c1", artistId: "c", contentRating: "clean", userScores: { chris: 10, jamie: 95 } },
  ];
  const result = selectFairHouseholdTracks({ candidates, influence, limit: 4, maximumTracksPerMemberPercent: 0.5, maximumConsecutiveMemberTracks: 1, maximumArtistRepetition: 1, familyRule: { blockExplicit: true, blockUnknownRatings: true, preferCleanVersions: true, reason: "test" } });
  assert.deepEqual(new Set(result.tracks.map((track) => track.id)), new Set(["a1", "b1"]));
  assert.match(result.adjustments.join(" "), /prevented all requested slots/);
  assert.deepEqual(new Set(result.excluded.map((item) => item.reason)), new Set(["FAMILY_FRIENDLY_EXPLICIT", "HARD_HOUSEHOLD_DISLIKE"]));
});
