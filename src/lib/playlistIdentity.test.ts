import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculatePlaylistIdentityProfile, confidenceForIdentity, mergeIdentityProfiles, scorePlaylistIdentityTrack } from "./playlistIdentity";
import type { PlaylistIdentityScoringContext, WeightedIdentityTrack } from "./playlistIdentity";

const sample = (id: string, input: Partial<WeightedIdentityTrack> = {}): WeightedIdentityTrack => ({
  id, artistId: "artist-a", artistName: "Artist A", genres: ["Electronic"], moods: ["Moody"],
  bpm: 110, energy: .6, popularity: 45, durationMs: 240000, year: 2018, metadataConfidence: .9, position: 1, weight: 1, ...input,
});

describe("playlist identity profile", () => {
  it("learns mood, energy, BPM, artists, genres, discovery, and section curves", () => {
    const profile = calculatePlaylistIdentityProfile([
      sample("one", { position: 1, bpm: 96, energy: .4 }),
      sample("two", { position: 2, bpm: 110, energy: .65 }),
      sample("three", { position: 3, bpm: 122, energy: .8, artistId: "artist-b", artistName: "Artist B", moods: ["Atmospheric"] }),
    ]);
    assert.ok(profile.coreMoods.includes("Moody"));
    assert.deepEqual(profile.bpmCurve.sections, [96, 110, 122]);
    assert.equal(profile.energyCurve.type, "rising");
    assert.ok(profile.preferredArtists.length >= 2);
    assert.equal(profile.preferredGenres[0].name, "Electronic");
    assert.ok(profile.discoveryPreference != null);
  });

  it("learns safely when metadata is missing", () => {
    const profile = calculatePlaylistIdentityProfile([sample("one", { bpm: null, energy: null, moods: [], genres: [], popularity: null })]);
    assert.equal(profile.bpmRange, null);
    assert.equal(profile.energyRange, null);
    assert.equal(profile.metadataCoverage.bpm, 0);
    assert.equal(profile.sampleCount, 1);
  });

  it("uses weighted historical evidence conservatively", () => {
    const current = calculatePlaylistIdentityProfile([sample("current", { bpm: 120, weight: 4 }), sample("old", { bpm: 80, weight: .2 })]);
    assert.ok((current.averageBpm || 0) > 115);
  });

  it("reports low confidence with sparse or missing metadata", () => {
    const profile = calculatePlaylistIdentityProfile([sample("one", { bpm: null, moods: [], energy: null })]);
    const confidence = confidenceForIdentity(profile, { versions: 0, explicitSignals: 0 });
    assert.equal(confidence.label, "INSUFFICIENT_DATA");
    assert.ok(confidence.reasons.some((reason) => reason.includes("BPM")));
  });
});

describe("playlist identity effective values", () => {
  it("gives user-defined values precedence over learned values", () => {
    const learned = calculatePlaylistIdentityProfile([sample("one", { bpm: 90 }), sample("two", { bpm: 130 })]);
    const effective = mergeIdentityProfiles(learned, { bpmRange: [95, 122], coreMoods: ["Atmospheric"] }, new Set());
    assert.deepEqual(effective.bpmRange, [95, 122]);
    assert.deepEqual(effective.coreMoods, ["Atmospheric"]);
  });
});

describe("playlist identity scoring", () => {
  const profile = calculatePlaylistIdentityProfile(Array.from({ length: 12 }, (_, index) => sample(String(index), { position: index + 1 })));
  const context = (mode: PlaylistIdentityScoringContext["mode"] = "BALANCED"): PlaylistIdentityScoringContext => ({
    identityId: "identity", enabled: true, mode, strength: 1, confidence: 0.9, profile,
    artistScores: { "artist-a": 8 }, genreScores: { electronic: 8 }, trackMemory: {},
  });

  it("keeps identity as a separate bounded adjustment", () => {
    const result = scorePlaylistIdentityTrack({ ...sample("candidate"), tags: [{ type: "genre", name: "Electronic" }, { type: "mood", name: "Moody" }], artist: { tags: [] } }, context());
    assert.equal(result.applied, true);
    assert.ok(result.adjustment > 0);
    assert.ok(result.reasons.some((reason) => /mood|artist|genre/i.test(reason)));
  });

  it("scales Flexible below Strong and Strict", () => {
    const track = { ...sample("candidate"), tags: [{ type: "genre", name: "Electronic" }], artist: { tags: [] } };
    assert.ok(scorePlaylistIdentityTrack(track, context("FLEXIBLE")).adjustment < scorePlaylistIdentityTrack(track, context("STRONG")).adjustment);
    assert.ok(scorePlaylistIdentityTrack(track, context("STRONG")).adjustment < scorePlaylistIdentityTrack(track, context("STRICT")).adjustment);
  });

  it("hard excludes only permanent playlist-specific rejection memory", () => {
    const permanent = context();
    permanent.trackMemory.candidate = { importance: "NORMAL", rejectionState: "NEVER_USE", permanentRejection: true, acceptanceScore: 0, rejectionCount: 1 };
    assert.equal(scorePlaylistIdentityTrack(sample("candidate"), permanent).excluded, true);
    const weak = context();
    weak.trackMemory.candidate = { importance: "NORMAL", rejectionState: "WEAK_NEGATIVE", permanentRejection: false, acceptanceScore: 0, rejectionCount: 1 };
    assert.equal(scorePlaylistIdentityTrack(sample("candidate"), weak).excluded, false);
  });
});
