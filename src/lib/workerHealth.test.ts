import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isHeartbeatStale,
  isSafeToAutoRequeueJobType,
  recoveryHintForJob,
} from "./workerHealth";

describe("worker health reliability helpers", () => {
  it("detects stale worker heartbeats after the threshold", () => {
    const now = new Date("2026-07-08T12:00:00.000Z").getTime();

    assert.equal(isHeartbeatStale("2026-07-08T11:59:30.000Z", now, 60_000), false);
    assert.equal(isHeartbeatStale("2026-07-08T11:58:30.000Z", now, 60_000), true);
    assert.equal(isHeartbeatStale(null, now, 60_000), true);
  });

  it("allows safe enrichment and analysis jobs to be requeued", () => {
    assert.equal(isSafeToAutoRequeueJobType("plex_sync"), true);
    assert.equal(isSafeToAutoRequeueJobType("audio_features"), true);
    assert.equal(isSafeToAutoRequeueJobType("local_audio_features"), true);
    assert.equal(isSafeToAutoRequeueJobType("bpm"), true);
    assert.equal(isSafeToAutoRequeueJobType("popularity"), true);
    assert.equal(isSafeToAutoRequeueJobType("tags"), true);
    assert.equal(isSafeToAutoRequeueJobType("library_health"), true);
  });

  it("does not automatically requeue playlist or destructive jobs", () => {
    assert.equal(isSafeToAutoRequeueJobType("playlist"), false);
    assert.equal(isSafeToAutoRequeueJobType("other", "generated playlist replacement"), false);
    assert.match(recoveryHintForJob("playlist", "playlist update"), /Manual review required/);
  });
});
