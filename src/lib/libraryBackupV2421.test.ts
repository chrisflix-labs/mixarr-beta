import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

describe("v2.4.21 lossless Library Intelligence release contract", () => {
  it("ships the release metadata and root-cause documentation", () => {
    assert.equal(JSON.parse(read("package.json")).version, "2.4.23");
    assert.match(read("CHANGELOG.md"), /v2\.4\.21 - Lossless Library Intelligence Backup & Restore/);
    const docs = read("docs/LIBRARY_INTELLIGENCE_BACKUP_V2421.md");
    assert.match(docs, /1,529 \+ 1,243 = 2,772/);
    assert.match(docs, /v2\.4\.15/);
    assert.match(docs, /fully_restored/);
  });

  it("does not regress to GUID-only parser de-duplication", () => {
    const reader = read("src/lib/libraryBackup/restoreReader.ts");
    assert.doesNotMatch(reader, /plex_guid\s*\|\|\s*sanitized\.record\.rating_key/);
    assert.match(reader, /archive record id/i);
    assert.match(reader, /migrateLegacyV1Record/);
  });

  it("plans before mutation and uses awaited atomic resumable batches", () => {
    const service = read("src/lib/libraryBackup/restoreService.ts");
    assert.match(service, /Persist the dry-run identity plan before any Library Intelligence mutation/);
    assert.match(service, /await prisma\.\$transaction/);
    assert.match(service, /matchStatus: "applied"/);
    assert.match(service, /calculateReconciliation/);
    assert.match(service, /status:\s*RestoreReport\["status"\]/);
  });

  it("keeps partial results out of the green success path", () => {
    const ui = read("src/components/LibraryBackupManager.tsx");
    assert.match(ui, /job\.status === "fully_restored"/);
    assert.match(ui, /job\.status === "partial_restore"/);
    assert.match(ui, /tone: "error"[\s\S]*Partial restore/);
    assert.match(ui, /Current library coverage/);
    assert.match(ui, /Selected backup contents/);
    assert.match(ui, /Written backup contents/);
  });
});
