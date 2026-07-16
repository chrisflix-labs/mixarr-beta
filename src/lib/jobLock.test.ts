import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GLOBAL_SYNC_JOB_KEY, acquireJobLock, getJobDebugSnapshot, resetJobLocksForTests, setJobPhase } from "./jobLock";
import { syncJobKeys } from "./syncJobRunner";

describe("sync job locking", () => {
  it("uses a stable library-scoped lock for concurrent Plex sync attempts", () => {
    assert.deepEqual(syncJobKeys("plex", "library-1"), [
      "plex-sync:library:library-1",
      GLOBAL_SYNC_JOB_KEY,
      "plex",
    ]);
    assert.equal(syncJobKeys("plex", "library-1")[0], syncJobKeys("plex", "library-1")[0]);
    assert.notEqual(syncJobKeys("plex", "library-1")[0], syncJobKeys("plex", "library-2")[0]);
  });

  it("prevents duplicate manual sync jobs and releases cleanly", () => {
    resetJobLocksForTests();
    const first = acquireJobLock({ name: "audio features sync", keys: [GLOBAL_SYNC_JOB_KEY, "audio"] });
    assert.equal(first.acquired, true);
    if (!first.acquired) throw new Error("expected first lock");

    const duplicate = acquireJobLock({ name: "audio features sync", keys: [GLOBAL_SYNC_JOB_KEY, "audio"] });
    assert.equal(duplicate.acquired, false);
    if (duplicate.acquired) throw new Error("expected duplicate to be blocked");
    assert.equal(duplicate.activeJob.name, "audio features sync");

    first.release();
    const next = acquireJobLock({ name: "audio features sync", keys: [GLOBAL_SYNC_JOB_KEY, "audio"] });
    assert.equal(next.acquired, true);
    if (next.acquired) next.release();
  });

  it("causes scheduler-style jobs to skip while a manual sync is active", () => {
    resetJobLocksForTests();
    const manual = acquireJobLock({ name: "Plex metadata sync", keys: [GLOBAL_SYNC_JOB_KEY, "plex:library-1"] });
    assert.equal(manual.acquired, true);
    if (!manual.acquired) throw new Error("expected manual lock");
    setJobPhase(manual.job, "Importing tracks");

    const scheduler = acquireJobLock({ name: "nightly sync pipeline", keys: [GLOBAL_SYNC_JOB_KEY, "scheduler"], source: "scheduler" });
    assert.equal(scheduler.acquired, false);
    const snapshot = getJobDebugSnapshot(new Date(manual.job.startedAt).getTime() + 10_000);
    assert.equal(snapshot.activeJob?.name, "Plex metadata sync");
    assert.equal(snapshot.activeJob?.phase, "Importing tracks");
    assert.equal(snapshot.lastSkipped?.name, "nightly sync pipeline");

    manual.release();
  });

  it("lets the nightly parent run its local child without weakening the global lock", () => {
    resetJobLocksForTests();
    const nightly = acquireJobLock({ name: "nightly sync pipeline", keys: [GLOBAL_SYNC_JOB_KEY, "scheduler"], source: "scheduler" });
    assert.equal(nightly.acquired, true);
    if (!nightly.acquired) throw new Error("expected nightly lock");

    const child = acquireJobLock({ name: "local Essentia audio feature backfill", keys: ["audio_feature:local"], source: "local-audio-feature-engine" });
    assert.equal(child.acquired, true);
    const manual = acquireJobLock({ name: "audio features sync", keys: [GLOBAL_SYNC_JOB_KEY, "audio"], source: "manual" });
    assert.equal(manual.acquired, false);

    if (child.acquired) child.release();
    nightly.release();
  });
});
