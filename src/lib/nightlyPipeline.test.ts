import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { NIGHTLY_STAGE_NAMES, runNightlyStageSequence } from "./nightlyPipeline";

describe("nightly pipeline", () => {
  it("keeps Audio Features as the final fifth stage", () => {
    assert.deepEqual(NIGHTLY_STAGE_NAMES, [
      "plex_sync",
      "popularity",
      "track_tags",
      "saved_playlist_refresh",
      "audio_features",
    ]);
    const scheduler = readFileSync(join(process.cwd(), "src/lib/backgroundScheduler.ts"), "utf8");
    const positions = NIGHTLY_STAGE_NAMES.map((name) => scheduler.indexOf(`started name=${name}`));
    assert.equal(positions.every((position) => position >= 0), true);
    assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  });

  it("awaits Audio Features before reporting pipeline completion", async () => {
    const events: string[] = [];
    let releaseAudio!: () => void;
    const audioFinished = new Promise<void>((resolve) => { releaseAudio = resolve; });
    const run = runNightlyStageSequence({
      plex_sync: async () => events.push("plex"),
      popularity: async () => events.push("popularity"),
      track_tags: async () => events.push("track_tags"),
      saved_playlist_refresh: async () => events.push("playlists"),
      audio_features: async () => { events.push("audio_started"); await audioFinished; events.push("audio_finished"); },
    }).then(() => events.push("pipeline_finished"));

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events.includes("pipeline_finished"), false);
    releaseAudio();
    await run;
    assert.deepEqual(events.slice(-2), ["audio_finished", "pipeline_finished"]);
  });

  it("routes both manual and nightly execution through the shared service", () => {
    const manualRoute = readFileSync(join(process.cwd(), "src/app/api/audio-features/start/route.ts"), "utf8");
    const scheduler = readFileSync(join(process.cwd(), "src/lib/backgroundScheduler.ts"), "utf8");
    assert.match(manualRoute, /runAudioFeatures/);
    assert.match(scheduler, /runAudioFeatures/);
    assert.doesNotMatch(manualRoute, /runLocalAudioFeatureEngine|runAudioFeatureEngine/);
    assert.doesNotMatch(scheduler, /runLocalAudioFeatureEngine|runAudioFeatureEngine/);
  });
});
