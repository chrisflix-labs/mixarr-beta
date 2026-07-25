import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupManagedDirectory,
  managedDirectorySize,
  registerActiveManagedFile,
  resolveStoragePaths,
  resolveStoragePolicy,
} from "./storage";
import { migrateLegacyStorage } from "./storageStartup";
import { runStorageCleanup as _compileStorageMaintenanceForCli } from "./storageMaintenance";
import { fetchPlexItemPages } from "./syncEngine";
import { setBoundedCache } from "./boundedCache";

test("Docker storage paths resolve below the approved config and data roots", () => {
  const paths = resolveStoragePaths({ DOCKER: "1", MIXARR_CONFIG_DIR: "/config", MIXARR_DATA_DIR: "/data" });
  assert.equal(paths.config, path.resolve("/config"));
  for (const [name, value] of Object.entries(paths)) {
    if (name === "config" || name === "database") continue;
    assert.ok(value === path.resolve("/data") || value.startsWith(`${path.resolve("/data")}${path.sep}`), `${name} escaped /data`);
  }
});

test("storage limits require explicit positive or unlimited values", () => {
  assert.equal(resolveStoragePolicy({ MIXARR_CACHE_MAX_SIZE_GB: "unlimited" }).cacheLimit.mode, "unlimited");
  assert.throws(() => resolveStoragePolicy({ MIXARR_CACHE_MAX_SIZE_GB: "0" }), /positive number/);
  assert.throws(() => resolveStoragePolicy({ MIXARR_CACHE_MAX_SIZE_GB: "-1" }), /positive number/);
  assert.throws(() => resolveStoragePolicy({ MIXARR_STORAGE_WARNING_PERCENT: "95", MIXARR_STORAGE_CRITICAL_PERCENT: "90" }), /greater/);
});

test("storage policy defaults are bounded and large-library safe", () => {
  const policy = resolveStoragePolicy({});
  assert.equal(policy.cacheEnabled, true);
  assert.deepEqual(policy.cacheLimit, { mode: "limited", bytes: 10 * 1024 ** 3 });
  assert.equal(policy.cacheRetentionDays, 30);
  assert.equal(policy.tempRetentionHours, 24);
  assert.equal(policy.jobRetentionDays, 14);
  assert.equal(policy.scanHistoryRetentionDays, 30);
  assert.equal(policy.aiHistoryRetentionDays, 30);
  assert.equal(policy.scanBatchSize, 500);
  assert.equal(policy.scanMaxConcurrency, 4);
  assert.equal(policy.scanProgressInterval, 1000);
});

test("invalid retention, concurrency, and free-space values are rejected", () => {
  assert.throws(() => resolveStoragePolicy({ MIXARR_CACHE_RETENTION_DAYS: "-1" }), /between/);
  assert.throws(() => resolveStoragePolicy({ MIXARR_SCAN_MAX_CONCURRENCY: "0" }), /between/);
  assert.throws(() => resolveStoragePolicy({ MIXARR_MIN_FREE_SPACE_GB: "0" }), /between/);
});

test("process-local caches prune expired entries and enforce cardinality", () => {
  const cache = new Map<string, { expiresAt: number; value: number }>();
  cache.set("expired", { expiresAt: 1, value: 0 });
  setBoundedCache(cache, "one", { expiresAt: 10_000, value: 1 }, 2, 100);
  setBoundedCache(cache, "two", { expiresAt: 10_000, value: 2 }, 2, 100);
  setBoundedCache(cache, "three", { expiresAt: 10_000, value: 3 }, 2, 100);
  assert.deepEqual(Array.from(cache.keys()), ["two", "three"]);
});

test("cleanup dry-run reports files without modifying them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mixarr-storage-dry-"));
  const file = path.join(root, "expired.cache");
  await writeFile(file, "1234567890");
  await utimes(file, new Date(0), new Date(0));
  const preview = await cleanupManagedDirectory({ root, olderThanMs: 1, dryRun: true });
  assert.equal(preview.filesRemoved, 1);
  assert.equal(preview.bytesReclaimed, 10);
  assert.equal((await stat(file)).size, 10);
});

test("cleanup treats an absent managed directory as empty", async () => {
  const root = path.join(os.tmpdir(), `mixarr-storage-absent-${process.pid}-${Date.now()}`);
  assert.deepEqual(await cleanupManagedDirectory({ root, dryRun: true }), { filesRemoved: 0, bytesReclaimed: 0, skippedActive: 0, skippedSymlinks: 0, errors: [] });
});

test("cleanup skips active files and never follows symlinks", async (context) => {
  if (process.platform === "win32") {
    context.skip("Windows developer mode may deny symlink creation");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "mixarr-storage-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "mixarr-storage-outside-"));
  const active = path.join(root, "active.cache");
  const outsideFile = path.join(outside, "music.flac");
  await Promise.all([writeFile(active, "active"), writeFile(outsideFile, "never delete")]);
  await symlink(outside, path.join(root, "escape"), "dir");
  const release = registerActiveManagedFile(active);
  const result = await cleanupManagedDirectory({ root, olderThanMs: 0 });
  release();
  assert.equal(result.skippedActive, 1);
  assert.equal(result.skippedSymlinks, 1);
  assert.equal(await readFile(outsideFile, "utf8"), "never delete");
});

test("cache size cleanup removes oldest files until the configured bound", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mixarr-storage-size-"));
  for (let index = 0; index < 4; index += 1) {
    const file = path.join(root, `${index}.cache`); await writeFile(file, "x".repeat(10)); await utimes(file, new Date(index * 1000), new Date(index * 1000));
  }
  const result = await cleanupManagedDirectory({ root, maximumBytes: 20 });
  assert.equal(result.filesRemoved, 2);
  assert.equal(await managedDirectorySize(root), 20);
});

test("legacy storage migration is verified and runs only once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mixarr-storage-migrate-"));
  const source = path.join(root, "legacy"); const target = path.join(root, "managed"); const marker = path.join(root, "config", "migration.json");
  await mkdir(source, { recursive: true }); await writeFile(path.join(source, "one.mixarr-library-backup"), "backup");
  const first = await migrateLegacyStorage({ source, target, marker, allowedExtensions: [".mixarr-library-backup"] });
  assert.equal(first.migrated, 1); assert.equal(await readFile(path.join(target, "one.mixarr-library-backup"), "utf8"), "backup");
  await writeFile(path.join(source, "two.mixarr-library-backup"), "second");
  const second = await migrateLegacyStorage({ source, target, marker, allowedExtensions: [".mixarr-library-backup"] });
  assert.equal(second.alreadyCompleted, true); assert.equal(second.migrated, 0);
});

test("v2.4.15 scan path is paged, stable-keyed, staged, and suppresses unchanged writes", async () => {
  const source = await readFile(path.join(process.cwd(), "src/lib/syncEngine.ts"), "utf8");
  const migration = await readFile(path.join(process.cwd(), "prisma/migrations/20260803010000_storage_safety_v2415/migration.sql"), "utf8");
  assert.match(source, /fetchPlexItemPages/);
  assert.match(source, /existingByInstance\.get/);
  assert.doesNotMatch(source, /existingTracks\.filter/);
  assert.match(source, /if \(!unchanged\) await db\.track\.update/);
  assert.match(source, /plexScanSeenTrack\.createMany/);
  assert.match(source, /scanBatchSize/);
  assert.match(source, /recordingFingerprint/);
  assert.match(migration, /CREATE UNLOGGED TABLE IF NOT EXISTS "PlexScanSeenTrack"/);
});

test("scan cancellation is cooperative and never starts another HTTP page", async () => {
  const controller = new AbortController();
  controller.abort(new Error("synthetic cancellation"));
  await assert.rejects(
    fetchPlexItemPages("http://127.0.0.1:1", "private-token", "1", 10, 500, async () => undefined, controller.signal),
    /synthetic cancellation/,
  );
});

test("scan failure, cancellation, and concurrency use a global lock and guarded staging cleanup", async () => {
  const source = await readFile(path.join(process.cwd(), "src/lib/syncEngine.ts"), "utf8");
  assert.match(source, /plex-scan-lock:global/);
  assert.match(source, /abortSignal\?\.throwIfAborted/);
  assert.match(source, /finally \{/);
  assert.match(source, /if \(releaseDurableLock\).*TRUNCATE TABLE/);
  assert.match(source, /plexScanSeenTrack\.deleteMany/);
  assert.doesNotMatch(source, /JSON\.stringify\([^\n]*plexTracks/);
});

test("PostgreSQL migration adds stable lookup and retention indexes", async () => {
  const migration = await readFile(path.join(process.cwd(), "prisma/migrations/20260803010000_storage_safety_v2415/migration.sql"), "utf8");
  for (const expected of [
    "Track_libraryId_recordingFingerprint_idx",
    "Track_libraryId_mediaPath_idx",
    "Track_libraryId_updatedAt_idx",
    "SyncLog_status_startedAt_idx",
    "JobHistory_status_startedAt_idx",
    "AiGovernanceAudit_createdAt_idx",
    'ALTER TABLE "PlexScanSeenTrack" SET UNLOGGED',
  ]) assert.ok(migration.includes(expected), `missing migration safeguard: ${expected}`);
});

test("retention cleanup covers scan, job, staging, and privacy-sensitive AI history", async () => {
  const source = await readFile(path.join(process.cwd(), "src/lib/storageMaintenance.ts"), "utf8");
  for (const model of [
    "jobHistory", "syncLog", "aiRequestAudit", "aiResponseRecord", "aiJob",
    "aiQuarantineRecord", "aiSecurityEvent", "aiApprovalEvent", "aiContextTrimmingRecord",
    "aiAlertEvent", "aiRecipeRequest", "aiGovernanceAudit", "aiSecureDebugPayload", "aiBudgetReservation",
    "naturalLanguageRequest", "intentInterpretation", "playlistAnalysisSnapshot", "playlistAiSummary",
    "recommendationExplanation", "metadataAnalysisJob", "metadataSuggestion", "metadataSuggestionAuditEvent",
    "metadataSuggestionExport", "troubleshootingSession", "aiQualityFeedback", "aiPrivacyAcknowledgment",
  ]) assert.ok(source.includes(`prisma.${model}`), `missing retention for ${model}`);
  assert.match(source, /DELETE FROM "PlexScanSeenTrack"/);
  assert.match(source, /batchSize = Math\.max\(1, Math\.min\(5000/);
});

test("storage diagnostics expose every required category and cleanup evidence", async () => {
  const source = await readFile(path.join(process.cwd(), "src/lib/storageMaintenance.ts"), "utf8");
  for (const field of [
    "databaseBytes", "databaseWalBytes", "databaseShmBytes", "cacheBytes", "artworkBytes", "temporaryBytes",
    "backupBytes", "exportBytes", "logBytes", "scanHistoryBytes", "jobHistoryBytes", "aiHistoryBytes",
    "totalManagedBytes", "filesystemTotalBytes", "filesystemFreeBytes", "filesystemUsedPercent",
    "lastCleanupAt", "lastCleanupReclaimedBytes", "unexpectedWritablePaths",
  ]) assert.match(source, new RegExp(`\\b${field}\\b`), `missing diagnostic ${field}`);
});

test("administrative deletion is authenticated, confirmed, and explicitly preserves music", async () => {
  const source = await readFile(path.join(process.cwd(), "src/app/api/admin/storage/route.ts"), "utf8");
  assert.match(source, /requireAdminUser/);
  assert.match(source, /DELETE MIXARR MANAGED DATA/);
  assert.match(source, /Music library files are never included/);
  assert.match(source, /dryRun: z\.boolean\(\)\.default\(true\)/);
});

test("temporary analysis and artwork use managed storage paths", async () => {
  const [bpm, features, recipe, community] = await Promise.all([
    readFile(path.join(process.cwd(), "src/lib/localBpmEngine.ts"), "utf8"),
    readFile(path.join(process.cwd(), "src/lib/localAudioFeatureEngine.ts"), "utf8"),
    readFile(path.join(process.cwd(), "src/lib/mixRecipes/transferService.ts"), "utf8"),
    readFile(path.join(process.cwd(), "src/lib/communityRecipes/service.ts"), "utf8"),
  ]);
  assert.match(bpm, /resolveStoragePaths\(\)\.temp/);
  assert.match(features, /resolveStoragePaths\(\)\.temp/);
  assert.match(recipe, /resolveStoragePaths\(\)\.artwork/);
  assert.match(community, /resolveStoragePaths\(\)\.artwork/);
  assert.match(recipe, /registerActiveManagedFile/);
  assert.match(community, /registerActiveManagedFile/);
});

test("legacy standalone runtime no longer writes into application source and bounds its provider cache", async () => {
  const source = await readFile(path.join(process.cwd(), "server.js"), "utf8");
  assert.match(source, /process\.env\.MIXARR_DATA_DIR/);
  assert.match(source, /os\.homedir\(\)/);
  assert.match(source, /PROVIDER_CACHE_MAX_ENTRIES/);
  assert.match(source, /DB_TEMP_FILE/);
  assert.doesNotMatch(source, /path\.join\(__dirname, "data"\)/);
});

test("storage CLI and 150k production-path benchmark are release scripts", async () => {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  for (const command of ["storage-report", "cleanup:dry-run", "cleanup", "benchmark-library-scan"]) assert.ok(packageJson.scripts[command]);
  const benchmark = await readFile(path.join(process.cwd(), "scripts/benchmark-library-scan.js"), "utf8");
  assert.match(benchmark, /150000/);
  assert.match(benchmark, /runSyncEngine/);
  assert.match(benchmark, /initial|Initial/);
  assert.match(benchmark, /interrupted/);
});

test("normal per-track logging is debug-only or rate-limited", async () => {
  const [sync, matching, popularity, tags, features] = await Promise.all([
    readFile(path.join(process.cwd(), "src/lib/syncEngine.ts"), "utf8"),
    readFile(path.join(process.cwd(), "src/lib/recentlyAdded/matching.ts"), "utf8"),
    readFile(path.join(process.cwd(), "src/lib/popularityEngine.ts"), "utf8"),
    readFile(path.join(process.cwd(), "src/lib/trackTagEngine.ts"), "utf8"),
    readFile(path.join(process.cwd(), "src/lib/audioFeatureEngine.ts"), "utf8"),
  ]);
  assert.match(sync, /logDebug\(`\[PlexSync\] Track/);
  assert.match(matching, /logDebug\("\[RecentlyAdded\] match calculated/);
  for (const source of [popularity, tags, features]) assert.match(source, /logRateLimited/);
});

test("Docker startup is offline, mounted, read-only, and log-rotated", async () => {
  const [dockerfile, compose] = await Promise.all([readFile(path.join(process.cwd(), "Dockerfile"), "utf8"), readFile(path.join(process.cwd(), "docker-compose.yml"), "utf8")]);
  assert.doesNotMatch(dockerfile, /CMD \[.*npx --yes/);
  assert.match(dockerfile, /\.\/node_modules\/\.bin\/prisma/);
  assert.match(compose, /- mixarr_data:\/data/);
  assert.match(compose, /- mixarr_config:\/config/);
  assert.match(dockerfile, /VOLUME \["\/config", "\/data"\]/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /max-size: "10m"/);
  assert.match(compose, /max-file: "5"/);
});
