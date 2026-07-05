import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPlaylistSafetyRules,
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
    assert.equal(summarizePlaylistSafetyRules(config), "Safety: avoid back-to-back artists, warn below 10 tracks");
  });
});
