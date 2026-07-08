import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTrackSyncChangeSet,
  matchPlexTrackToExistingRecord,
  normalizePlexTrackForSync,
} from "./trackSync";

function plexTrack(overrides: Record<string, any> = {}) {
  return normalizePlexTrackForSync({
    ratingKey: "100",
    guid: "plex://track/guid-100",
    title: "New Title",
    grandparentTitle: "Artist",
    parentTitle: "Album",
    duration: 180_000,
    index: 1,
    rating: 8,
    Media: [{ Part: [{ file: "C:\\Music\\Artist\\Album\\New Title.flac" }] }],
    ...overrides,
  }, "1");
}

const existingTrack = {
  id: "track-1",
  plexId: "100",
  ratingKey: "100",
  plexGuid: "plex://track/guid-100",
  mediaPath: "C:\\Music\\Artist\\Album\\Old Title.flac",
  title: "Old Title",
  duration: 180_000,
  trackIndex: 1,
  rating: 8,
  syncStatus: "active",
  artistId: "artist-1",
  albumId: "album-1",
  artist: { title: "Artist" },
  album: { title: "Album" },
};

describe("Plex track sync matching", () => {
  it("matches by stable Plex rating key before metadata", () => {
    const match = matchPlexTrackToExistingRecord(plexTrack({ title: "Completely Different" }), [existingTrack]);

    assert.equal(match.type, "matched");
    if (match.type === "matched") {
      assert.equal(match.reason, "plex_rating_key");
      assert.equal(match.track.id, "track-1");
    }
  });

  it("marks the same rating key with a changed file path as moved_file", () => {
    const changes = buildTrackSyncChangeSet(existingTrack, plexTrack(), { artistId: "artist-1", albumId: "album-1" });

    assert.equal(changes.changeTypes.includes("moved_file"), true);
    assert.deepEqual(changes.changedFields.mediaPath, {
      before: "C:\\Music\\Artist\\Album\\Old Title.flac",
      after: "C:\\Music\\Artist\\Album\\New Title.flac",
    });
  });

  it("marks the same rating key with changed title as renamed_track", () => {
    const changes = buildTrackSyncChangeSet(existingTrack, plexTrack(), { artistId: "artist-1", albumId: "album-1" });

    assert.equal(changes.changeTypes.includes("renamed_track"), true);
    assert.deepEqual(changes.changedFields.title, { before: "Old Title", after: "New Title" });
  });

  it("uses metadata fallback only when it is unambiguous", () => {
    const match = matchPlexTrackToExistingRecord(plexTrack({ ratingKey: "200", guid: null }), [{
      ...existingTrack,
      plexId: "old-1",
      ratingKey: "old-1",
      plexGuid: null,
      title: "New Title",
      mediaPath: null,
    }]);

    assert.equal(match.type, "matched");
    if (match.type === "matched") assert.equal(match.reason, "metadata_fallback");
  });

  it("classifies ambiguous metadata fallback as match_conflict", () => {
    const first = {
      ...existingTrack,
      id: "track-1",
      plexId: "old-1",
      ratingKey: "old-1",
      plexGuid: null,
      title: "New Title",
      mediaPath: null,
    };
    const second = { ...first, id: "track-2", plexId: "old-2", ratingKey: "old-2" };
    const match = matchPlexTrackToExistingRecord(plexTrack({ ratingKey: "200", guid: null }), [first, second]);

    assert.equal(match.type, "conflict");
    if (match.type === "conflict") {
      assert.equal(match.reason, "metadata_fallback");
      assert.deepEqual(match.candidates.map((candidate) => candidate.id), ["track-1", "track-2"]);
    }
  });

  it("marks inactive records as restored when the identity returns", () => {
    const changes = buildTrackSyncChangeSet({ ...existingTrack, syncStatus: "missing" }, plexTrack(), { artistId: "artist-1", albumId: "album-1" });

    assert.equal(changes.changeTypes.includes("restored_from_plex"), true);
  });
});
