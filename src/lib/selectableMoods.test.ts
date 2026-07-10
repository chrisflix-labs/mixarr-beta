import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  aggregateSelectableMoodIndexFromTracks,
  collectTrackSelectableMoods,
  normalizeMoodList,
} from "./selectableMoods";

function track(id: string, metadata: Record<string, unknown> = {}) {
  return {
    id,
    syncStatus: "active",
    libraryId: "library-a",
    audioFeature: {
      effectiveEnergy: 0.7,
      effectiveMood: 0.8,
      audioFeatureStatus: "success",
      audioFeatureSource: "local_essentia",
      energySource: "local_essentia",
      valenceSource: "local_essentia",
      localEnergy: 0.7,
      localMood: 0.8,
    },
    ...metadata,
  };
}

describe("selectable mood index", () => {
  it("returns available moods for a fully enriched library without mood tags", () => {
    const index = aggregateSelectableMoodIndexFromTracks({
      tracks: [
        track("happy", { audioFeature: { effectiveEnergy: 0.62, effectiveMood: 0.9, audioFeatureStatus: "success" } }),
        track("party", { audioFeature: { effectiveEnergy: 0.92, effectiveMood: 0.88, audioFeatureStatus: "success" } }),
        track("chill", { audioFeature: { effectiveEnergy: 0.25, effectiveMood: 0.58, audioFeatureStatus: "success" } }),
      ],
      libraryId: "library-a",
    });

    assert.equal(index.status, "available");
    assert.equal(index.totalTracks, 3);
    assert.equal(index.tracksWithMood, 3);
    assert.equal(index.tracksWithoutMood, 0);
    assert.ok(index.moods.length >= 3);
  });

  it("does not report 100 percent missing when every track has usable mood metadata", () => {
    const index = aggregateSelectableMoodIndexFromTracks({
      tracks: [track("one"), track("two"), track("three")],
      libraryId: "library-a",
    });

    assert.equal(index.tracksWithoutMood, 0);
    assert.equal(index.tracksWithMood, 3);
  });

  it("normalizes and merges capitalization variants", () => {
    const index = aggregateSelectableMoodIndexFromTracks({
      tracks: [
        track("one", { tags: [{ type: "mood", name: "Happy" }] }),
        track("two", { tags: [{ type: "mood", name: "happy" }] }),
        track("three", { tags: [{ type: "mood", name: "HAPPY" }] }),
      ],
      libraryId: "library-a",
    });

    assert.equal(index.moods.find((mood) => mood.normalizedName === "happy")?.trackCount, 3);
  });

  it("trims whitespace from stored mood values", () => {
    const moods = normalizeMoodList(["  Happy  ", "\nEnergetic\t"]);

    assert.deepEqual(moods.map((mood) => mood.normalizedName), ["happy", "energetic"]);
  });

  it("deduplicates duplicate moods on one track", () => {
    const moods = collectTrackSelectableMoods(track("one", {
      tags: [
        { type: "mood", name: "Happy" },
        { type: "mood", name: " happy " },
      ],
    }));

    assert.equal(moods.filter((mood) => mood.normalizedName === "happy").length, 1);
  });

  it("supports multiple mood tags per track", () => {
    const moods = collectTrackSelectableMoods(track("one", {
      tags: [
        { type: "mood", name: "Happy" },
        { type: "mood", name: "Energetic" },
      ],
    }));

    assert.equal(moods.some((mood) => mood.normalizedName === "happy"), true);
    assert.equal(moods.some((mood) => mood.normalizedName === "energetic"), true);
  });

  it("ignores null, empty, and placeholder mood values", () => {
    const moods = normalizeMoodList([null, "", "unknown", "none", "N/A", "Happy"] as unknown[]);

    assert.deepEqual(moods.map((mood) => mood.normalizedName), ["happy"]);
  });

  it("does not crash on malformed JSON mood values", () => {
    const failures: Record<string, number> = {};
    const moods = normalizeMoodList(["[\"Happy\"", "Energetic"], failures);

    assert.deepEqual(moods.map((mood) => mood.normalizedName), ["energetic"]);
    assert.equal(failures.malformed_json, 1);
  });

  it("prevents moods from leaking across scoped libraries", () => {
    const index = aggregateSelectableMoodIndexFromTracks({
      tracks: [
        track("one", { libraryId: "library-a", tags: [{ type: "mood", name: "Happy" }] }),
        track("two", { libraryId: "library-b", tags: [{ type: "mood", name: "Dark" }] }),
      ],
      libraryId: "library-a",
    });

    assert.equal(index.moods.some((mood) => mood.normalizedName === "happy"), true);
    assert.equal(index.moods.some((mood) => mood.normalizedName === "dark"), false);
  });

  it("returns pending when enrichment is running and no usable moods exist yet", () => {
    const index = aggregateSelectableMoodIndexFromTracks({
      tracks: [track("one", { audioFeature: { audioFeatureStatus: "pending" } })],
      libraryId: "library-a",
    });

    assert.equal(index.status, "pending");
    assert.equal(index.pendingTracks, 1);
  });

  it("returns empty when enrichment completed but no usable mood values exist", () => {
    const index = aggregateSelectableMoodIndexFromTracks({
      tracks: [track("one", { audioFeature: { audioFeatureStatus: "success", effectiveMood: null, effectiveEnergy: null } })],
      libraryId: "library-a",
    });

    assert.equal(index.status, "empty");
  });

  it("recomputes after enrichment completion instead of keeping a stale empty result", () => {
    const before = aggregateSelectableMoodIndexFromTracks({
      tracks: [track("one", { audioFeature: { audioFeatureStatus: "pending" } })],
      libraryId: "library-a",
    });
    const after = aggregateSelectableMoodIndexFromTracks({
      tracks: [track("one", { audioFeature: { effectiveEnergy: 0.9, effectiveMood: 0.85, audioFeatureStatus: "success" } })],
      libraryId: "library-a",
    });

    assert.equal(before.status, "pending");
    assert.equal(after.status, "available");
    assert.equal(after.tracksWithoutMood, 0);
  });

  it("reproduces the fully enriched 33841 track regression without showing missing mood coverage", () => {
    const tracks = Array.from({ length: 33841 }, (_, index) => track(`track-${index}`, {
      audioFeature: {
        effectiveEnergy: index % 2 === 0 ? 0.9 : 0.3,
        effectiveMood: index % 3 === 0 ? 0.9 : 0.55,
        audioFeatureStatus: "success",
      },
    }));
    const index = aggregateSelectableMoodIndexFromTracks({ tracks, libraryId: "library-a" });

    assert.equal(index.status, "available");
    assert.equal(index.totalTracks, 33841);
    assert.equal(index.tracksWithMood, 33841);
    assert.equal(index.tracksWithoutMood, 0);
    assert.ok(index.moods.length > 0);
  });

  it("keeps the mood-tags API query batched below database bind limits", () => {
    const routePath = path.join(process.cwd(), "src", "app", "api", "mood-tags", "route.ts");
    const routeSource = fs.readFileSync(routePath, "utf8");

    assert.match(routeSource, /MOOD_TAG_TRACK_BATCH_SIZE\s*=\s*2_000/);
    assert.match(routeSource, /take:\s*MOOD_TAG_TRACK_BATCH_SIZE/);
    assert.match(routeSource, /cursor:\s*\{\s*id:\s*cursor\s*\}/);
    assert.doesNotMatch(routeSource, /id:\s*\{\s*in:\s*trackIds\s*\}/);
  });
});
