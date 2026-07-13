import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareGenerationSettings, diffPlaylistVersions } from "./playlists/versions/playlist-version-diff";
import { readPlaylistSnapshot, redactVersionSettings } from "./playlists/versions/playlist-version-snapshot";
import { describePlaylistVersion } from "./playlists/versions/playlist-version-service";
import type { PlaylistVersionSnapshot, PlaylistVersionTrack } from "./playlists/versions/playlist-version-types";

function track(id: string, position: number): PlaylistVersionTrack {
  return { trackId: id, plexTrackRatingKey: id, position, locked: false, liked: false, regenerationExcluded: false, titleSnapshot: `Track ${id}`, artistSnapshot: "Artist", albumSnapshot: "Album", durationMsSnapshot: 180_000, bpmSnapshot: 120, moodSnapshot: ["Focus"], energySnapshot: 0.7 };
}

function snapshot(tracks: PlaylistVersionTrack[], settings: Record<string, unknown> = {}, score = 80): PlaylistVersionSnapshot {
  return { playlist: { name: "Test", description: null, engineFamily: "smart_mix_v2", engineVersion: "v2", generationSettings: { schemaVersion: 1, engineVersion: "v2", settings } }, tracks, scores: { overallScore: score }, summary: { trackCount: tracks.length, durationMs: tracks.length * 180_000 } };
}

describe("playlist version snapshots", () => {
  it("redacts credentials recursively without mutating useful settings", () => {
    const result = redactVersionSettings({ discovery: 50, apiKey: "secret", nested: { accessToken: "secret", mood: "Focus" }, headers: { Authorization: "secret" } }) as any;
    assert.deepEqual(result, { discovery: 50, nested: { mood: "Focus" }, headers: {} });
  });

  it("migrates v2.0.6 bare track arrays in memory", () => {
    const parsed = readPlaylistSnapshot([{ trackId: "a", plexTrackRatingKey: "1", position: 1, title: "Legacy", artist: "Artist", album: "Album", locked: true, liked: false, regenerationExcluded: false }], { name: "Old mix", engineVersion: "v2.0.6", settings: {}, scores: { overallScore: 72 } });
    assert.equal(parsed.legacy, true);
    assert.equal(parsed.snapshot?.data.tracks[0].titleSnapshot, "Legacy");
    assert.equal(parsed.snapshot?.data.tracks[0].locked, true);
  });

  it("rejects corrupt snapshots safely", () => {
    const parsed = readPlaylistSnapshot({ schemaVersion: 999, data: {} }, { name: "Bad", engineVersion: null, settings: null, scores: null });
    assert.equal(parsed.snapshot, null);
    assert.match(parsed.error || "", /cannot be restored/i);
  });
});

describe("playlist version diffs", () => {
  it("classifies reordering as movement rather than add and remove", () => {
    const diff = diffPlaylistVersions({ fromVersionId: "a", toVersionId: "b", from: snapshot([track("a", 1), track("b", 2)]), to: snapshot([track("b", 1), track("a", 2)]) });
    assert.equal(diff.summary.addedCount, 0);
    assert.equal(diff.summary.removedCount, 0);
    assert.equal(diff.summary.movedCount, 2);
  });

  it("detects additions, removals, and conservative same-position replacements", () => {
    const diff = diffPlaylistVersions({ fromVersionId: "a", toVersionId: "b", from: snapshot([track("a", 1), track("old", 2)]), to: snapshot([track("a", 1), track("new", 2)]) });
    assert.equal(diff.summary.addedCount, 1);
    assert.equal(diff.summary.removedCount, 1);
    assert.equal(diff.summary.replacedCount, 1);
    assert.equal(diff.replacements[0].inferred, true);
  });

  it("reports track state, setting, and score changes", () => {
    const changed = { ...track("a", 1), liked: true };
    const diff = diffPlaylistVersions({ fromVersionId: "a", toVersionId: "b", from: snapshot([track("a", 1)], { tuningConfig: { discovery: 20 } }, 70), to: snapshot([changed], { tuningConfig: { discovery: 45 } }, 85) });
    assert.deepEqual(diff.stateChanges[0].fields, ["liked"]);
    assert.equal(diff.settingsChanges[0].group, "Discovery");
    assert.equal(diff.scoreChanges[0].to, 85);
  });

  it("groups meaningful settings for user-facing display", () => {
    const changes = compareGenerationSettings({ moodBlend: "smooth", bpm: { maximumGap: 12 } }, { moodBlend: "strict", bpm: { maximumGap: 8 } });
    assert.deepEqual(changes.map((entry) => entry.group).sort(), ["BPM", "Mood"]);
  });
});

describe("playlist version descriptions", () => {
  it("creates clear restore and advanced regeneration descriptions", () => {
    assert.equal(describePlaylistVersion("restore", { sourceRevision: 8 }), "Restored Version 8");
    assert.match(describePlaylistVersion("advanced_regeneration", { mode: "improve_bpm_flow", count: 4 }), /improve bpm flow/i);
  });
});

