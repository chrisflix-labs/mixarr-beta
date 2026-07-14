import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTrackWhereClause, playlistConfigSchema } from "./playlistService";
import { activeSyncStatusWhere } from "./syncStatus";
import { reconcileCompletedLibrary, seenSyncData } from "./syncEngine";

function transactionDouble() {
  const calls = {
    trackUpdates: [] as any[],
    albumUpdates: [] as any[],
    artistUpdates: [] as any[],
  };
  return {
    calls,
    track: {
      updateMany: async (args: any) => { calls.trackUpdates.push(args); return { count: 41 }; },
      findFirst: async () => null,
    },
    album: { updateMany: async (args: any) => { calls.albumUpdates.push(args); return { count: 2 }; } },
    artist: { updateMany: async (args: any) => { calls.artistUpdates.push(args); return { count: 1 }; } },
  };
}

describe("Plex library reconciliation", () => {
  it("marks active tracks not seen in the completed run as missing", async () => {
    const tx = transactionDouble();
    const seenAt = new Date("2026-06-22T12:00:00Z");

    const result = await reconcileCompletedLibrary(tx, {
      libraryId: "library-a",
      syncRunId: "sync-2",
      seenAt,
      snapshotComplete: true,
    });

    assert.deepEqual(tx.calls.trackUpdates, [{
      where: {
        libraryId: "library-a",
        syncStatus: "active",
        OR: [{ lastSeenSyncId: null }, { lastSeenSyncId: { not: "sync-2" } }],
      },
      data: { syncStatus: "missing", missingSince: seenAt, lastSyncChangeTypes: "|missing_from_plex|" },
    }]);
    assert.equal(result.markedMissing, 41);
    assert.equal(result.restored, 0);
    assert.equal(result.restoreVerificationFailures, 0);
  });

  it("restores a seen item to active and clears missing/deleted timestamps", () => {
    const seenAt = new Date("2026-06-22T12:00:00Z");
    assert.deepEqual(seenSyncData("sync-3", seenAt, "plex-section-4"), {
      plexLibraryId: "plex-section-4",
      syncStatus: "active",
      lastSeenAt: seenAt,
      lastSeenSyncId: "sync-3",
      missingSince: null,
      deletedAt: null,
    });
  });

  it("counts a missing track as restored only when one persisted row changes", async () => {
    const row: any = {
      id: "track-restored",
      libraryId: "library-a",
      syncStatus: "missing",
      lastSeenSyncId: "sync-restore",
      missingSince: new Date("2026-06-20T00:00:00Z"),
      deletedAt: new Date("2026-06-21T00:00:00Z"),
      bpm: 128,
      mood: "energetic",
      personalizationHistory: ["kept"],
    };
    const tx: any = {
      track: {
        updateMany: async ({ where, data }: any) => {
          if (data.syncStatus === "active") {
            const matches = row.id === where.id
              && row.libraryId === where.libraryId
              && row.syncStatus === where.syncStatus
              && row.lastSeenSyncId === where.lastSeenSyncId;
            if (!matches) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
          }
          return { count: 0 };
        },
        findFirst: async ({ where }: any) => row.id === where.id && row.libraryId === where.libraryId ? row : null,
      },
      album: { updateMany: async () => ({ count: 0 }) },
      artist: { updateMany: async () => ({ count: 0 }) },
    };
    const candidate = { trackId: row.id, plexRatingKey: "plex-100", previousSyncStatus: "missing" };
    const first = await reconcileCompletedLibrary(tx, {
      libraryId: row.libraryId,
      syncRunId: row.lastSeenSyncId,
      seenAt: new Date(),
      snapshotComplete: true,
      restoreCandidates: [candidate],
    });

    assert.equal(first.restored, 1);
    assert.equal(first.restoreVerificationFailures, 0);
    assert.equal(row.syncStatus, "active");
    assert.equal(row.missingSince, null);
    assert.equal(row.deletedAt, null);
    assert.equal(row.bpm, 128);
    assert.equal(row.mood, "energetic");
    assert.deepEqual(row.personalizationHistory, ["kept"]);

    const second = await reconcileCompletedLibrary(tx, {
      libraryId: row.libraryId,
      syncRunId: row.lastSeenSyncId,
      seenAt: new Date(),
      snapshotComplete: true,
      restoreCandidates: [],
    });
    assert.equal(second.restored, 0);
    assert.equal([row].filter((track) => track.syncStatus === "active").length, 1);
  });

  it("restores 87 rows exactly once and preserves enrichment fields", async () => {
    const rows = Array.from({ length: 87 }, (_, index) => ({
      id: `track-${index}`,
      libraryId: "library-87",
      syncStatus: "missing",
      lastSeenSyncId: "sync-87",
      missingSince: new Date(),
      deletedAt: null,
      bpm: 90 + index,
      energy: index / 100,
      corrections: { bpm: 123 },
      interactions: index,
    }));
    const tx: any = {
      track: {
        updateMany: async ({ where, data }: any) => {
          if (data.syncStatus !== "active") return { count: 0 };
          const row = rows.find((item) => item.id === where.id && item.libraryId === where.libraryId && item.syncStatus === where.syncStatus && item.lastSeenSyncId === where.lastSeenSyncId);
          if (!row) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
        findFirst: async ({ where }: any) => rows.find((item) => item.id === where.id && item.libraryId === where.libraryId) || null,
      },
      album: { updateMany: async () => ({ count: 0 }) },
      artist: { updateMany: async () => ({ count: 0 }) },
    };
    const beforeActive = rows.filter((track) => track.syncStatus === "active").length;
    const result = await reconcileCompletedLibrary(tx, {
      libraryId: "library-87",
      syncRunId: "sync-87",
      seenAt: new Date(),
      snapshotComplete: true,
      restoreCandidates: rows.map((row) => ({ trackId: row.id, plexRatingKey: `plex-${row.id}`, previousSyncStatus: "missing" })),
    });

    assert.equal(result.restored, 87);
    assert.equal(rows.filter((track) => track.syncStatus === "active").length - beforeActive, 87);
    assert.equal(rows[42].bpm, 132);
    assert.deepEqual(rows[42].corrections, { bpm: 123 });
    assert.equal(rows[42].interactions, 42);

    const next = await reconcileCompletedLibrary(tx, {
      libraryId: "library-87",
      syncRunId: "sync-87",
      seenAt: new Date(),
      snapshotComplete: true,
    });
    assert.equal(next.restored, 0);
    assert.equal(rows.filter((track) => track.syncStatus === "active").length, 87);
  });

  it("surfaces a restore verification failure instead of reporting success", async () => {
    const tx: any = {
      track: {
        updateMany: async ({ data }: any) => ({ count: data.syncStatus === "active" ? 0 : 0 }),
        findFirst: async () => ({ syncStatus: "missing", missingSince: new Date(), deletedAt: null }),
      },
      album: { updateMany: async () => ({ count: 0 }) },
      artist: { updateMany: async () => ({ count: 0 }) },
    };
    const result = await reconcileCompletedLibrary(tx, {
      libraryId: "library-a",
      syncRunId: "sync-failed-restore",
      seenAt: new Date(),
      snapshotComplete: true,
      restoreCandidates: [{ trackId: "track-a", plexRatingKey: "plex-a", previousSyncStatus: "missing" }],
    });
    assert.equal(result.restored, 0);
    assert.equal(result.restoreVerificationFailures, 1);
  });

  it("protects records involved in unresolved identity conflicts from missing reconciliation", async () => {
    const tx = transactionDouble();
    await reconcileCompletedLibrary(tx, {
      libraryId: "library-a",
      syncRunId: "sync-conflict",
      seenAt: new Date(),
      snapshotComplete: true,
      conflictProtectedTrackIds: ["track-conflict-a", "track-conflict-b"],
    });
    assert.deepEqual(tx.calls.trackUpdates[0].where.id, { notIn: ["track-conflict-a", "track-conflict-b"] });
  });

  it("does not mutate records for an incomplete or failed snapshot", async () => {
    const tx = transactionDouble();

    await assert.rejects(
      reconcileCompletedLibrary(tx, {
        libraryId: "library-a",
        syncRunId: "sync-failed",
        seenAt: new Date(),
        snapshotComplete: false,
      }),
      /reconciliation skipped/,
    );

    assert.equal(tx.calls.trackUpdates.length, 0);
    assert.equal(tx.calls.albumUpdates.length, 0);
    assert.equal(tx.calls.artistUpdates.length, 0);
  });

  it("defines dashboard counts as active-only", () => {
    assert.deepEqual(activeSyncStatusWhere(), { syncStatus: "active" });
  });

  it("excludes missing and deleted tracks from playlist generation", () => {
    const config = playlistConfigSchema.parse({ rules: [], limit: 50 });
    const where = buildTrackWhereClause("user-a", config);
    assert.ok(where.AND.some((condition: any) => condition.syncStatus === "active"));
  });

  it("uses the safe playlist default when the UI submits limit zero", () => {
    const config = playlistConfigSchema.parse({ rules: [], limit: 0 });
    assert.equal(config.limit, 100);
  });
});
