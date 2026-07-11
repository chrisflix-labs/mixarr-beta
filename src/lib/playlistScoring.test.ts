import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scorePlaylist, scoreTransition } from "./playlistScoring";

function track(id: string, metadata: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    artist: { title: `Artist ${id}` },
    album: { title: `Album ${id}` },
    ...metadata,
  };
}

describe("playlist scoring", () => {
  it("scores smooth complete playlists highly", () => {
    const score = scorePlaylist([
      track("one", { effectiveBpm: 118, popularity: { score: 80 }, audioFeature: { effectiveEnergy: 0.7, effectiveMood: 0.62 } }),
      track("two", { effectiveBpm: 122, popularity: { score: 52 }, audioFeature: { effectiveEnergy: 0.74, effectiveMood: 0.66 } }),
      track("three", { effectiveBpm: 126, popularity: { score: 28 }, audioFeature: { effectiveEnergy: 0.78, effectiveMood: 0.64 } }),
    ]);

    assert.equal(score.scoreVersion, "2.0.4");
    assert.ok(score.bpmFlowScore == null || score.bpmFlowScore >= 70);
    assert.ok(score.overallScore >= 80);
    assert.equal(score.labels.overall === "Strong" || score.labels.overall === "Excellent", true);
    assert.equal(score.weakSpotCount, 0);
  });

  it("flags weak transitions and warns without crashing on missing metadata", () => {
    const score = scorePlaylist([
      track("one", { effectiveBpm: 90, popularity: { score: 96 }, audioFeature: { effectiveEnergy: 0.2, effectiveMood: 0.2 } }),
      track("two"),
      track("three", { effectiveBpm: 150, popularity: { score: 92 }, audioFeature: { effectiveEnergy: 0.95, effectiveMood: 0.9 } }),
      track("four"),
    ]);

    assert.ok(score.overallScore < 80);
    assert.ok(score.weakSpotCount > 0);
    assert.ok(score.warnings.some((warning) => warning.includes("missing BPM")));
    assert.ok(score.warnings.some((warning) => warning.includes("flow well")));
  });

  it("scores individual transitions from neighboring metadata", () => {
    const smooth = scoreTransition(
      track("one", { effectiveBpm: 120, popularity: { score: 55 }, audioFeature: { effectiveEnergy: 0.6, effectiveMood: 0.55 } }),
      track("two", { effectiveBpm: 124, popularity: { score: 60 }, audioFeature: { effectiveEnergy: 0.66, effectiveMood: 0.58 } }),
    );
    const rough = scoreTransition(
      track("three", { effectiveBpm: 90, popularity: { score: 95 }, audioFeature: { effectiveEnergy: 0.2, effectiveMood: 0.1 } }),
      track("four", { effectiveBpm: 150, popularity: { score: 20 }, audioFeature: { effectiveEnergy: 0.95, effectiveMood: 0.9 } }),
    );

    assert.ok(smooth.score > rough.score);
    assert.ok(rough.reasons.includes("large BPM jump"));
    assert.ok(rough.reasons.includes("mood mismatch"));
  });
});
