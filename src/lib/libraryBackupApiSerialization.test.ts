import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRestoreDryRunPreview,
  serializeRestoreJob,
  serializeRestorePreview,
} from "./libraryBackup/apiSerialization";

function restoreRow(previewJson: unknown) {
  return {
    id: "restore-1",
    archiveFileName: "library.mixarr-backup",
    backupSchemaVersion: 2,
    backupMixarrVersion: "2.4.21",
    status: "validating",
    phase: "validating",
    conflictPolicy: "fill_missing",
    compatibility: "compatible",
    archiveTrackCount: 36_816,
    matchedCount: 0,
    unmatchedCount: 0,
    ambiguousCount: 0,
    appliedCount: 0,
    previewJson,
    reportJson: null,
    error: null,
    startedAt: new Date("2026-07-26T18:00:00.000Z"),
    finishedAt: null,
  };
}

describe("Library Intelligence restore API serialization", () => {
  it("does not expose upload ingestion state as a completed dry run", () => {
    const ingestionOnly = {
      ingestion: {
        backupRecordsFound: 36_816,
        parsedRecords: 36_816,
        invalidRecords: 0,
      },
    };

    assert.equal(isRestoreDryRunPreview(ingestionOnly), false);
    assert.equal(serializeRestoreJob(restoreRow(ingestionOnly)).preview, null);
  });

  it("normalizes a completed dry run for defensive client rendering", () => {
    const preview = serializeRestorePreview({
      status: "ready",
      matches: { exact: 36_816, fallback: undefined, ambiguous: 0, unmatched: 0 },
      backupRecordsFound: 36_816,
      tracksInBackup: 36_816,
      tracksInLibrary: 36_816,
      invalidRecords: 0,
      categories: null,
      warnings: null,
      schemaIncompatibilities: null,
    });

    assert.ok(preview);
    assert.deepEqual(preview.matches, {
      exact: 36_816,
      fallback: 0,
      highConfidence: 0,
      ambiguous: 0,
      unmatched: 0,
    });
    assert.deepEqual(preview.warnings, []);
    assert.deepEqual(preview.schemaIncompatibilities, []);
    assert.deepEqual(preview.categories, {});
  });
});
