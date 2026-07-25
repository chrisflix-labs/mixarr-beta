import { access, lstat, mkdir, readdir, rm, stat, statfs } from "fs/promises";
import { constants as fsConstants, existsSync } from "fs";
import os from "os";
import path from "path";

export type StorageLimitMode = "limited" | "unlimited";

export type StoragePaths = {
  config: string;
  data: string;
  database: string;
  cache: string;
  temp: string;
  artwork: string;
  backups: string;
  exports: string;
  jobs: string;
  scans: string;
  logs: string;
};

export type StoragePolicy = {
  cacheEnabled: boolean;
  cacheLimit: { mode: StorageLimitMode; bytes: number | null };
  cacheRetentionDays: number;
  tempRetentionHours: number;
  jobRetentionDays: number;
  scanHistoryRetentionDays: number;
  aiHistoryRetentionDays: number;
  warningPercent: number;
  criticalPercent: number;
  minimumFreeBytes: number;
  scanBatchSize: number;
  scanMaxConcurrency: number;
  scanProgressInterval: number;
};

export type FileCleanupResult = {
  filesRemoved: number;
  bytesReclaimed: number;
  skippedActive: number;
  skippedSymlinks: number;
  errors: string[];
};

export type ManagedFile = { path: string; bytes: number; modifiedMs: number };

const activeManagedFiles = new Set<string>();

function boolEnv(value: string | undefined, fallback: boolean) {
  if (value == null || !value.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  throw new Error(`Invalid boolean storage setting: ${value}`);
}

function positiveInt(name: string, value: string | undefined, fallback: number, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  if (value == null || !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function sizeLimit(name: string, value: string | undefined, fallbackGb: number) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return { mode: "limited" as const, bytes: fallbackGb * 1024 ** 3 };
  if (normalized === "unlimited") return { mode: "unlimited" as const, bytes: null };
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number of GiB or the word "unlimited"; zero and negative values are invalid.`);
  }
  return { mode: "limited" as const, bytes: Math.floor(parsed * 1024 ** 3) };
}

export function isContainerRuntime() {
  return process.env.DOCKER === "1" || process.env.CONTAINER === "1" || existsSync("/.dockerenv");
}

function configuredPath(value: string | undefined, fallback: string) {
  return path.resolve(value?.trim() || fallback);
}

export function resolveStoragePaths(env: Record<string, string | undefined> = process.env): StoragePaths {
  const container = env.DOCKER === "1" || env.CONTAINER === "1" || (env === process.env && isContainerRuntime());
  const homeRoot = path.join(os.homedir(), ".mixarr");
  const config = configuredPath(env.MIXARR_CONFIG_DIR, container ? "/config" : path.join(homeRoot, "config"));
  const data = configuredPath(env.MIXARR_DATA_DIR, container ? "/data" : path.join(homeRoot, "data"));
  return {
    config,
    data,
    database: configuredPath(env.MIXARR_DATABASE_DIR, path.join(config, "database")),
    cache: configuredPath(env.MIXARR_CACHE_DIR, path.join(data, "cache")),
    temp: configuredPath(env.MIXARR_TEMP_DIR, path.join(data, "temp")),
    artwork: configuredPath(env.MIXARR_ARTWORK_DIR, path.join(data, "artwork")),
    backups: configuredPath(env.MIXARR_BACKUP_DIR, path.join(data, "backups")),
    exports: configuredPath(env.MIXARR_EXPORT_DIR, path.join(data, "exports")),
    jobs: configuredPath(env.MIXARR_JOB_DIR, path.join(data, "jobs")),
    scans: configuredPath(env.MIXARR_SCAN_DIR, path.join(data, "scans")),
    logs: configuredPath(env.MIXARR_LOG_DIR, path.join(data, "logs")),
  };
}

export function resolveStoragePolicy(env: Record<string, string | undefined> = process.env): StoragePolicy {
  const warningPercent = positiveInt("MIXARR_STORAGE_WARNING_PERCENT", env.MIXARR_STORAGE_WARNING_PERCENT, 80, 1, 99);
  const criticalPercent = positiveInt("MIXARR_STORAGE_CRITICAL_PERCENT", env.MIXARR_STORAGE_CRITICAL_PERCENT, 90, 2, 100);
  if (criticalPercent <= warningPercent) throw new Error("MIXARR_STORAGE_CRITICAL_PERCENT must be greater than MIXARR_STORAGE_WARNING_PERCENT.");
  return {
    cacheEnabled: boolEnv(env.MIXARR_CACHE_ENABLED, true),
    cacheLimit: sizeLimit("MIXARR_CACHE_MAX_SIZE_GB", env.MIXARR_CACHE_MAX_SIZE_GB, 10),
    cacheRetentionDays: positiveInt("MIXARR_CACHE_RETENTION_DAYS", env.MIXARR_CACHE_RETENTION_DAYS, 30, 1, 3650),
    tempRetentionHours: positiveInt("MIXARR_TEMP_RETENTION_HOURS", env.MIXARR_TEMP_RETENTION_HOURS, 24, 1, 8760),
    jobRetentionDays: positiveInt("MIXARR_JOB_RETENTION_DAYS", env.MIXARR_JOB_RETENTION_DAYS, 14, 1, 3650),
    scanHistoryRetentionDays: positiveInt("MIXARR_SCAN_HISTORY_RETENTION_DAYS", env.MIXARR_SCAN_HISTORY_RETENTION_DAYS, 30, 1, 3650),
    aiHistoryRetentionDays: positiveInt("MIXARR_AI_HISTORY_RETENTION_DAYS", env.MIXARR_AI_HISTORY_RETENTION_DAYS, 30, 1, 3650),
    warningPercent,
    criticalPercent,
    minimumFreeBytes: positiveInt("MIXARR_MIN_FREE_SPACE_GB", env.MIXARR_MIN_FREE_SPACE_GB, 10, 1, 1_000_000) * 1024 ** 3,
    scanBatchSize: positiveInt("MIXARR_SCAN_BATCH_SIZE", env.MIXARR_SCAN_BATCH_SIZE, 500, 50, 5000),
    scanMaxConcurrency: positiveInt("MIXARR_SCAN_MAX_CONCURRENCY", env.MIXARR_SCAN_MAX_CONCURRENCY, 4, 1, 32),
    scanProgressInterval: positiveInt("MIXARR_SCAN_PROGRESS_INTERVAL", env.MIXARR_SCAN_PROGRESS_INTERVAL, 1000, 100, 1_000_000),
  };
}

export async function initializeStorageDirectories(paths = resolveStoragePaths()) {
  const entries = Object.entries(paths) as Array<[keyof StoragePaths, string]>;
  for (const [, directory] of entries) {
    await mkdir(directory, { recursive: true });
    await access(directory, fsConstants.R_OK | fsConstants.W_OK);
  }
  return paths;
}

export function registerActiveManagedFile(filePath: string) {
  const resolved = path.resolve(filePath);
  activeManagedFiles.add(resolved);
  return () => activeManagedFiles.delete(resolved);
}

export function isPathInside(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function walkManagedFiles(root: string) {
  const files: Array<{ path: string; bytes: number; modifiedMs: number }> = [];
  let skippedSymlinks = 0;
  const errors: string[] = [];
  const pending = [path.resolve(root)];
  while (pending.length) {
    const directory = pending.pop()!;
    if (!isPathInside(root, directory)) continue;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { errors.push(`${directory}: ${error instanceof Error ? error.message : "unreadable"}`); continue; }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (!isPathInside(root, candidate)) continue;
      let info;
      try { info = await lstat(candidate); }
      catch (error) { errors.push(`${candidate}: ${error instanceof Error ? error.message : "unreadable"}`); continue; }
      if (info.isSymbolicLink()) { skippedSymlinks += 1; continue; }
      if (info.isDirectory()) pending.push(candidate);
      else if (info.isFile()) files.push({ path: candidate, bytes: info.size, modifiedMs: info.mtimeMs });
    }
  }
  return { files, skippedSymlinks, errors };
}

export async function managedDirectorySize(root: string) {
  if (!existsSync(root)) return 0;
  const { files } = await walkManagedFiles(root);
  return files.reduce((total, file) => total + file.bytes, 0);
}

export async function cleanupManagedDirectory(input: { root: string; olderThanMs?: number; maximumBytes?: number | null; dryRun?: boolean; now?: number; select?: (file: ManagedFile) => boolean }): Promise<FileCleanupResult> {
  const root = path.resolve(input.root);
  if (!existsSync(root)) return { filesRemoved: 0, bytesReclaimed: 0, skippedActive: 0, skippedSymlinks: 0, errors: [] };
  const now = input.now ?? Date.now();
  const walked = await walkManagedFiles(root);
  const candidates = walked.files
    .filter((file) => (input.olderThanMs != null && file.modifiedMs < now - input.olderThanMs) || input.select?.(file) === true)
    .sort((left, right) => left.modifiedMs - right.modifiedMs || left.path.localeCompare(right.path));
  const selected = new Map(candidates.map((file) => [file.path, file]));
  if (input.maximumBytes != null) {
    let remaining = walked.files.reduce((total, file) => total + file.bytes, 0)
      - candidates.reduce((total, file) => total + file.bytes, 0);
    for (const file of walked.files.sort((left, right) => left.modifiedMs - right.modifiedMs)) {
      if (remaining <= input.maximumBytes) break;
      if (!selected.has(file.path)) { selected.set(file.path, file); remaining -= file.bytes; }
    }
  }
  const result: FileCleanupResult = { filesRemoved: 0, bytesReclaimed: 0, skippedActive: 0, skippedSymlinks: walked.skippedSymlinks, errors: [...walked.errors] };
  for (const file of Array.from(selected.values())) {
    if (activeManagedFiles.has(path.resolve(file.path))) { result.skippedActive += 1; continue; }
    if (!isPathInside(root, file.path)) continue;
    if (!input.dryRun) {
      try { await rm(file.path, { force: true }); }
      catch (error) { result.errors.push(`${file.path}: ${error instanceof Error ? error.message : "delete failed"}`); continue; }
    }
    result.filesRemoved += 1;
    result.bytesReclaimed += file.bytes;
  }
  return result;
}

export async function filesystemCapacity(dataDirectory = resolveStoragePaths().data) {
  await mkdir(dataDirectory, { recursive: true });
  const info = await statfs(dataDirectory);
  const totalBytes = Number(info.blocks) * Number(info.bsize);
  const freeBytes = Number(info.bavail) * Number(info.bsize);
  return { totalBytes, freeBytes, usedPercent: totalBytes > 0 ? ((totalBytes - freeBytes) / totalBytes) * 100 : 0 };
}

export async function storageSafetyStatus(dataDirectory = resolveStoragePaths().data, policy = resolveStoragePolicy()) {
  const capacity = await filesystemCapacity(dataDirectory);
  const critical = capacity.usedPercent >= policy.criticalPercent || capacity.freeBytes < policy.minimumFreeBytes;
  const warning = critical || capacity.usedPercent >= policy.warningPercent;
  return { ...capacity, warning, critical, minimumFreeBytes: policy.minimumFreeBytes };
}

export async function assertStorageAvailable(operation: string, optional = true) {
  const status = await storageSafetyStatus();
  if (optional && status.critical) {
    throw Object.assign(new Error(`${operation} cannot start because Mixarr storage is critically low.`), { code: "MIXARR_STORAGE_CRITICAL", status });
  }
  return status;
}

export async function legacyWritablePathUsage() {
  const paths = resolveStoragePaths();
  const candidates = isContainerRuntime()
    ? ["/app/tmp", "/app/backups", "/app/public/uploads", "/tmp/mixarr-bpm", "/tmp/mixarr-audio-features", "/tmp/mixarr-backups"]
    : [path.join(process.cwd(), "data"), path.join(process.cwd(), "backups"), path.join(process.cwd(), "public", "uploads")];
  const unexpected: Array<{ path: string; bytes: number }> = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    if (Object.values(paths).some((approved) => isPathInside(approved, candidate))) continue;
    const bytes = await managedDirectorySize(candidate).catch(() => 0);
    if (bytes > 0) unexpected.push({ path: candidate, bytes });
  }
  return unexpected;
}

export async function fileStorageDiagnostics(paths = resolveStoragePaths()) {
  const [cacheBytes, artworkBytes, temporaryBytes, backupBytes, exportBytes, logBytes, jobsBytes, scansBytes, capacity, unexpectedWritablePaths] = await Promise.all([
    managedDirectorySize(paths.cache), managedDirectorySize(paths.artwork), managedDirectorySize(paths.temp),
    managedDirectorySize(paths.backups), managedDirectorySize(paths.exports), managedDirectorySize(paths.logs),
    managedDirectorySize(paths.jobs), managedDirectorySize(paths.scans), filesystemCapacity(paths.data), legacyWritablePathUsage(),
  ]);
  return { cacheBytes, artworkBytes, temporaryBytes, backupBytes, exportBytes, logBytes, jobsBytes, scansBytes, ...capacity, unexpectedWritablePaths };
}

export async function fileInfo(filePath: string) {
  try { const info = await stat(filePath); return info.isFile() ? info.size : 0; }
  catch { return 0; }
}
