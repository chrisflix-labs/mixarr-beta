import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessDuplicateRelationship,
  countMissingPlexInstances,
  createDuplicateCandidateIndex,
  duplicatePersistenceDisposition,
  findBestDuplicateCandidateFromIndex,
  plexTrackInstanceIdentity,
  selectDuplicateEnrichmentSource,
  shouldInheritDuplicateField,
} from "./duplicateRecordings";
import { applyDuplicatePolicy, playlistConfigSchema } from "./playlistService";

function track(overrides: Record<string, any> = {}) {
  return {
    id: "track-a",
    ratingKey: "100",
    plexGuid: "plex://track/recording-a",
    mediaPath: "C:/Music/A.flac",
    title: "Example Song",
    artist: { title: "Example Artist" },
    album: { title: "Studio Album" },
    duration: 180_000,
    metadataCorrections: [],
    audioFeature: null,
    ...overrides,
  };
}

describe("non-destructive Plex duplicate preservation", () => {
  it("gives different rating keys different physical identities even when the GUID is shared", () => {
    const first = plexTrackInstanceIdentity("server", "library", "100");
    const second = plexTrackInstanceIdentity("server", "library", "101");
    assert.notEqual(first, second);
    assert.equal(new Set([first, second]).size, 2);
  });

  it("keeps all 100 unique Plex items active, including recording duplicates", () => {
    const identities = Array.from({ length: 100 }, (_, index) => plexTrackInstanceIdentity("server", "library", String(index)));
    assert.equal(new Set(identities).size, 100);
    assert.equal(countMissingPlexInstances(identities.map((identity) => identity.split("\u0000")[2]), []), 100);
  });

  it("classifies strong evidence as one canonical recording without merging rows", () => {
    const left = track();
    const right = track({ id: "track-b", ratingKey: "101", mediaPath: "D:/Compilation/A.mp3", album: { title: "Compilation" }, duration: 180_900 });
    const assessment = assessDuplicateRelationship(left, right);
    const disposition = duplicatePersistenceDisposition(assessment);
    assert.equal(assessment.confidence, "high");
    assert.equal(disposition.persistAsSeparateTrack, true);
    assert.equal(disposition.autoGroup, true);
  });

  it("saves an ambiguous match as a separate active review item", () => {
    const assessment = assessDuplicateRelationship(
      track({ plexGuid: null, mediaPath: "C:/A.mp3", album: { title: "Release A" } }),
      track({ id: "track-b", ratingKey: "101", plexGuid: null, mediaPath: "D:/B.mp3", album: { title: "Release B" }, duration: 181_000 }),
    );
    assert.equal(assessment.confidence, "medium");
    assert.deepEqual(duplicatePersistenceDisposition(assessment), { persistAsSeparateTrack: true, autoGroup: false, reviewStatus: "needs_review" });
  });

  it("uses indexed candidate lookup for large libraries", () => {
    const candidates = Array.from({ length: 36_617 }, (_, index) => track({ id: `track-${index}`, ratingKey: String(index), plexGuid: `guid-${index}`, title: `Song ${index}` }));
    candidates[36_616] = track({ id: "match", ratingKey: "existing", mediaPath: "D:/copy.mp3" });
    const match = findBestDuplicateCandidateFromIndex(track({ id: "new", ratingKey: "new", mediaPath: "E:/copy.flac" }), createDuplicateCandidateIndex(candidates));
    assert.equal(match?.candidate.id, "match");
    assert.equal(match?.assessment.confidence, "high");
  });

  it("chooses verified manual enrichment before local and API values", () => {
    const api = track({ id: "api", apiBpm: 120, bpmConfidence: 0.99 });
    const local = track({ id: "local", localBpm: 121, bpmConfidence: 0.94 });
    const manual = track({ id: "manual", metadataCorrections: [{ field: "bpm", valueJson: 123, isActive: true, isVerified: true }] });
    const selected = selectDuplicateEnrichmentSource([api, local, manual]);
    assert.equal(selected?.source.id, "manual");
    assert.equal(selected?.enrichment.bpm, 123);
    assert.equal(selected?.enrichment.provider, "Manual verified correction");
  });

  it("inherits BPM, mood, and energy only when no track-level override or stronger source exists", () => {
    const empty = track();
    assert.equal(shouldInheritDuplicateField(empty, "bpm"), true);
    assert.equal(shouldInheritDuplicateField(empty, "mood"), true);
    assert.equal(shouldInheritDuplicateField(empty, "energy"), true);
    const overridden = track({ metadataCorrections: [{ field: "bpm", valueJson: 130, isActive: true, isVerified: true }] });
    assert.equal(shouldInheritDuplicateField(overridden, "bpm"), false);
    assert.equal(shouldInheritDuplicateField(track({ localBpm: 128 }), "bpm"), false);
  });

  it("is idempotent for repeated sync and repairs the 89-track gap", () => {
    const plex = Array.from({ length: 36_617 }, (_, index) => String(index));
    const storedBefore = plex.slice(0, 36_528);
    assert.equal(countMissingPlexInstances(plex, storedBefore), 89);
    const repaired = new Set([...storedBefore, ...plex]);
    assert.equal(repaired.size, 36_617);
    assert.equal(countMissingPlexInstances(plex, repaired), 0);
    assert.equal(new Set([...Array.from(repaired), ...plex]).size, 36_617);
  });

  it("avoids duplicate canonical recordings by default and prefers the higher-quality playable copy", () => {
    const config = playlistConfigSchema.parse({ duplicateStrategy: "prefer_highest_quality", rules: [], limit: 10 });
    const mp3 = track({ id: "mp3", canonicalRecordingId: "group-a", fileFormat: "mp3", bitrate: 192, syncStatus: "active", localFileStatus: "available", artistId: "artist" });
    const flac = track({ id: "flac", canonicalRecordingId: "group-a", fileFormat: "flac", bitrate: 1000, syncStatus: "active", localFileStatus: "available", artistId: "artist" });
    const selected = applyDuplicatePolicy([mp3, flac], config, 10);
    assert.deepEqual(selected.map((item) => item.id), ["flac"]);
    const alternateConfig = playlistConfigSchema.parse({ duplicateStrategy: "allow_alternate_copies", rules: [], limit: 10 });
    assert.equal(applyDuplicatePolicy([mp3, flac], alternateConfig, 10).length, 2);
  });
});
