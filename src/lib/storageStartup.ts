import { copyFile, lstat, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import prisma from "./prisma";
import { cleanupManagedDirectory, initializeStorageDirectories, isContainerRuntime, isPathInside, legacyWritablePathUsage, resolveStoragePaths, resolveStoragePolicy, storageSafetyStatus } from "./storage";
import { runStorageCleanup } from "./storageMaintenance";

const runtime = globalThis as typeof globalThis & { mixarrStorageTimer?: NodeJS.Timeout; mixarrStorageStarted?: boolean };

async function mountPoints() {
  if (!isContainerRuntime() || !existsSync("/proc/self/mountinfo")) return [] as string[];
  const content = await readFile("/proc/self/mountinfo", "utf8").catch(() => "");
  return content.split("\n").map((line) => line.split(" ")[4]).filter(Boolean);
}

async function copyVerifyRemove(source: string, target: string) {
  await mkdir(path.dirname(target), { recursive: true });
  try { await rename(source, target); return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error; }
  const temporary = `${target}.${process.pid}.migration`;
  await copyFile(source, temporary);
  const [sourceInfo, targetInfo] = await Promise.all([stat(source), stat(temporary)]);
  if (sourceInfo.size !== targetInfo.size) throw new Error(`Storage migration verification failed for ${source}.`);
  await rename(temporary, target);
  await unlink(source);
}

export async function migrateLegacyStorage(input: { source: string; target: string; marker: string; allowedExtensions: string[] }) {
  if (existsSync(input.marker)) return { migrated: 0, bytes: 0, alreadyCompleted: true };
  let migrated = 0; let bytes = 0;
  if (existsSync(input.source) && path.resolve(input.source) !== path.resolve(input.target)) {
    const pending = [path.resolve(input.source)];
    while (pending.length) {
      const directory = pending.pop()!;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const source = path.join(directory, entry.name);
        const info = await lstat(source);
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) { pending.push(source); continue; }
        if (!info.isFile() || !input.allowedExtensions.includes(path.extname(source).toLowerCase())) continue;
        const relative = path.relative(input.source, source);
        const target = path.resolve(input.target, relative);
        if (!isPathInside(input.target, target)) throw new Error("Legacy storage migration attempted to leave the managed directory.");
        await copyVerifyRemove(source, target); migrated += 1; bytes += info.size;
      }
    }
  }
  await mkdir(path.dirname(input.marker), { recursive: true });
  const temporaryMarker = `${input.marker}.${process.pid}.tmp`;
  await writeFile(temporaryMarker, JSON.stringify({ version: 1, completedAt: new Date().toISOString(), migrated, bytes }, null, 2), { flag: "wx" });
  await rename(temporaryMarker, input.marker);
  return { migrated, bytes, alreadyCompleted: false };
}

export async function initializeStorageSafety() {
  if (runtime.mixarrStorageStarted) return;
  runtime.mixarrStorageStarted = true;
  const paths = await initializeStorageDirectories();
  const policy = resolveStoragePolicy();
  console.info("[Storage] Resolved writable paths", paths);

  const mounts = await mountPoints();
  if (isContainerRuntime() && !mounts.some((mount) => path.resolve(mount) === path.resolve(paths.data))) {
    console.warn(`[Storage] MIXARR_DATA_DIR=${paths.data} does not appear to be a dedicated container mount. Large runtime data may use the Docker writable layer.`);
  }
  if (isContainerRuntime() && !mounts.some((mount) => path.resolve(mount) === path.resolve(paths.config))) {
    console.warn(`[Storage] MIXARR_CONFIG_DIR=${paths.config} does not appear to be a dedicated container mount.`);
  }

  const marker = path.join(paths.config, "migrations", "storage-v2.4.15.json");
  const legacyBackup = isContainerRuntime() ? "/app/backups" : path.join(process.cwd(), "backups");
  const migration = await migrateLegacyStorage({ source: legacyBackup, target: paths.backups, marker, allowedExtensions: [".mixarr-library-backup"] }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  if ("migrated" in migration && migration.migrated > 0) console.info("[Storage] Legacy backup migration completed", migration);
  else if ("error" in migration) console.warn("[Storage] Legacy backup migration requires attention", migration);

  const [cleanup, capacity, unexpected] = await Promise.all([
    runStorageCleanup({ scope: "expired", batchSize: 1000 }),
    storageSafetyStatus(paths.data, policy),
    legacyWritablePathUsage(),
  ]);
  if (unexpected.length) console.warn("[Storage] Unexpected legacy writable paths contain data", unexpected);
  if (capacity.critical) console.error("[Storage] Critical free-space threshold reached", capacity);
  else if (capacity.warning) console.warn("[Storage] Storage warning threshold reached", capacity);
  console.info(`[Storage] Startup cleanup files=${cleanup.filesRemoved} rows=${cleanup.databaseRecordsRemoved} reclaimedBytes=${cleanup.bytesReclaimed}`);

  runtime.mixarrStorageTimer = setInterval(() => {
    void runStorageCleanup({ scope: "expired", batchSize: 1000 }).catch((error) => console.warn("[Storage] Scheduled cleanup failed", error instanceof Error ? error.message : error));
  }, 6 * 60 * 60_000);
  runtime.mixarrStorageTimer.unref?.();
}

export async function resetStorageStartupForTests() {
  if (runtime.mixarrStorageTimer) clearInterval(runtime.mixarrStorageTimer);
  runtime.mixarrStorageTimer = undefined;
  runtime.mixarrStorageStarted = false;
  // Keep temporary test roots tidy without touching any configured production root.
  const paths = resolveStoragePaths();
  if (process.env.NODE_ENV === "test") await cleanupManagedDirectory({ root: paths.temp, olderThanMs: 0 }).catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
}
