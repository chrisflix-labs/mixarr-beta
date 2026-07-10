import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPlaylistSafetyRules,
  buildPreviewMessages,
  playlistConfigSchema,
  summarizePlaylistSafetyRules,
} from "./playlistService";

function configWithSafety(safetyRules: Record<string, unknown>, limit = 10) {
  return playlistConfigSchema.parse({
    rules: [],
    limit,
    negativeFilters: {},
    safetyRules,
  });
}

function track(id: string, artistId: string, albumId: string) {
  return {
    id,
    title: id,
    artistId,
    albumId,
    artist: { id: artistId, title: artistId },
    album: { id: albumId, title: albumId },
  };
}

describe("playlist safety rules", () => {
  it("spaces same-artist tracks when alternatives exist", () => {
    const result = applyPlaylistSafetyRules([
      track("one", "artist-a", "album-a"),
      track("two", "artist-a", "album-b"),
      track("three", "artist-b", "album-c"),
      track("four", "artist-c", "album-d"),
    ], configWithSafety({ avoidSameArtistBackToBack: true, warnIfFewerThan: false }));

    for (let index = 1; index < result.tracks.length; index += 1) {
      assert.notEqual(result.tracks[index - 1].artistId, result.tracks[index].artistId);
    }
    assert.equal(result.metadata.artistSpacingApplied, true);
    assert.equal(result.metadata.warnings.some((warning) => warning.includes("Artist spacing could not")), false);
  });

  it("warns when artist spacing cannot be fully applied", () => {
    const result = applyPlaylistSafetyRules([
      track("one", "artist-a", "album-a"),
      track("two", "artist-a", "album-b"),
      track("three", "artist-a", "album-c"),
    ], configWithSafety({ avoidSameArtistBackToBack: true, warnIfFewerThan: false }));

    assert.equal(result.metadata.warnings.some((warning) => warning.includes("not enough unique artists")), true);
  });

  it("respects max tracks per artist and album", () => {
    const result = applyPlaylistSafetyRules([
      track("one", "artist-a", "album-a"),
      track("two", "artist-a", "album-a"),
      track("three", "artist-a", "album-b"),
      track("four", "artist-b", "album-c"),
    ], configWithSafety({
      avoidSameArtistBackToBack: false,
      limitTracksPerArtist: true,
      maxTracksPerArtist: 2,
      limitTracksPerAlbum: true,
      maxTracksPerAlbum: 1,
      warnIfFewerThan: false,
    }));

    assert.deepEqual(result.tracks.map((item) => item.id), ["one", "four"]);
    assert.equal(result.metadata.removedBySafetyRules, 2);
    assert.equal(result.metadata.artistLimitApplied, true);
    assert.equal(result.metadata.albumLimitApplied, true);
  });

  it("adds low-track-count warnings without blocking results", () => {
    const result = applyPlaylistSafetyRules([
      track("one", "artist-a", "album-a"),
      track("two", "artist-b", "album-b"),
    ], configWithSafety({ avoidSameArtistBackToBack: false, warnIfFewerThan: true, minimumTrackCount: 10 }));

    assert.equal(result.tracks.length, 2);
    assert.equal(result.metadata.warnings.some((warning) => warning.includes("only has 2 tracks")), true);
  });

  it("loads old configs without safety fields using defaults", () => {
    const config = playlistConfigSchema.parse({
      rules: [],
      limit: 25,
      negativeFilters: {},
    });

    assert.equal(config.safetyRules.avoidSameArtistBackToBack, true);
    assert.equal(config.safetyRules.maxTracksPerArtist, 3);
    assert.equal(config.safetyRules.maxTracksPerAlbum, 2);
    assert.equal(config.safetyRules.minimumTrackCount, 10);
    assert.equal(summarizePlaylistSafetyRules(config), "Safety rules: avoid back-to-back artists, warn below 10 tracks");
  });

  it("saves beta mood blending settings in playlist configs", () => {
    const config = playlistConfigSchema.parse({
      rules: [],
      limit: 25,
      engineVersion: "v2",
      moodBlendMode: "smooth_transition",
      selectedMoodPath: ["Happy", "Energetic", "Party"],
      moodStrength: 77,
      transitionSmoothness: 88,
      moodStrictness: 62,
      fallbackTolerance: 28,
      bridgeTrackPreference: 74,
      moodVariety: 41,
      conflictSensitivity: 79,
      selectedMoodPreset: "high_energy_ramp",
    });

    assert.equal(config.moodBlendMode, "smooth_transition");
    assert.deepEqual(config.selectedMoodPath, ["Happy", "Energetic", "Party"]);
    assert.equal(config.moodStrength, 77);
    assert.equal(config.transitionSmoothness, 88);
    assert.equal(config.moodStrictness, 62);
    assert.equal(config.fallbackTolerance, 28);
    assert.equal(config.bridgeTrackPreference, 74);
    assert.equal(config.moodVariety, 41);
    assert.equal(config.conflictSensitivity, 79);
    assert.equal(config.selectedMoodPreset, "high_energy_ramp");
  });

  it("does not warn about repeated artists when repeats are within max tracks per artist", () => {
    const config = configWithSafety({
      avoidSameArtistBackToBack: false,
      limitTracksPerArtist: true,
      maxTracksPerArtist: 3,
      warnIfFewerThan: false,
    }, 9);
    const messages = buildPreviewMessages({
      tracks: [
        track("one", "artist-a", "album-a"),
        track("two", "artist-a", "album-b"),
        track("three", "artist-a", "album-c"),
        track("four", "artist-b", "album-d"),
        track("five", "artist-b", "album-e"),
        track("six", "artist-b", "album-f"),
      ],
      matchedTrackCount: 9,
      requestedLimit: 9,
      safetyRules: config.safetyRules,
    });

    assert.equal(messages.some((message) => message.severity === "warning" && message.message.includes("artist")), false);
  });

  it("warns when repeated artists exceed max tracks per artist", () => {
    const config = configWithSafety({
      avoidSameArtistBackToBack: false,
      limitTracksPerArtist: true,
      maxTracksPerArtist: 2,
      warnIfFewerThan: false,
    }, 5);
    const messages = buildPreviewMessages({
      tracks: [
        track("one", "artist-a", "album-a"),
        track("two", "artist-a", "album-b"),
        track("three", "artist-a", "album-c"),
        track("four", "artist-b", "album-d"),
      ],
      matchedTrackCount: 5,
      requestedLimit: 5,
      safetyRules: config.safetyRules,
    });

    assert.equal(messages.some((message) => message.severity === "warning" && message.message.includes("exceed the max 2")), true);
  });

  it("warns about back-to-back artists only when adjacency remains", () => {
    const config = configWithSafety({
      avoidSameArtistBackToBack: true,
      limitTracksPerArtist: false,
      warnIfFewerThan: false,
    }, 5);
    const spacedMessages = buildPreviewMessages({
      tracks: [
        track("one", "artist-a", "album-a"),
        track("two", "artist-b", "album-b"),
        track("three", "artist-a", "album-c"),
      ],
      matchedTrackCount: 5,
      requestedLimit: 5,
      safetyRules: config.safetyRules,
    });
    const adjacentMessages = buildPreviewMessages({
      tracks: [
        track("one", "artist-a", "album-a"),
        track("two", "artist-a", "album-b"),
        track("three", "artist-b", "album-c"),
      ],
      matchedTrackCount: 5,
      requestedLimit: 5,
      safetyRules: config.safetyRules,
    });

    assert.equal(spacedMessages.some((message) => message.message.includes("back-to-back")), false);
    assert.equal(adjacentMessages.some((message) => message.message.includes("back-to-back")), true);
  });
});
