/** Server-side storage for Library Intelligence backup archives. */
import { mkdir, writeFile, readFile, unlink, stat, rename } from "node:fs/promises";
import path from "node:path";
import { BACKUP_FILE_EXTENSION } from "./archiveFormat";
import { assertStorageAvailable, registerActiveManagedFile, resolveStoragePaths } from "../storage";

export function resolveBackupDir(): string {
  return resolveStoragePaths().backups;
}

async function isUsableDir(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.mixarr-write-test-${process.pid}`);
    await writeFile(probe, "ok");
    await unlink(probe).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * v2.4.15 never falls back into an unmounted container path. An invalid mount
 * is surfaced instead of silently consuming ephemeral writable-layer storage.
 */
export async function ensureBackupDir(): Promise<string> {
  const preferred = resolveBackupDir();
  if (await isUsableDir(preferred)) return preferred;
  throw new Error(`Backup directory "${preferred}" is not writable. Mount MIXARR_BACKUP_DIR and grant uid 1001 write access.`);
}

export function safeBackupFileName(base: string): string {
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  const stem = cleaned || "library-intelligence-backup";
  return stem.endsWith(BACKUP_FILE_EXTENSION) ? stem : stem + BACKUP_FILE_EXTENSION;
}

export async function resolveStoredPath(fileName: string): Promise<string> {
  const dir = await ensureBackupDir();
  const full = path.join(dir, path.basename(fileName));
  const relative = path.relative(dir, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Refusing to write backup outside the backup directory.");
  return full;
}

export async function writeArchive(fileName: string, data: Buffer): Promise<{ storedPath: string; size: number }> {
  await assertStorageAvailable("Library backup", true);
  const storedPath = await resolveStoredPath(fileName);
  const temporaryPath = `${storedPath}.${process.pid}.tmp`;
  const release = registerActiveManagedFile(temporaryPath);
  try {
    await writeFile(temporaryPath, data, { flag: "wx" });
    await rename(temporaryPath, storedPath);
  } finally {
    release();
    await unlink(temporaryPath).catch(() => undefined);
  }
  return { storedPath, size: (await stat(storedPath)).size };
}

export async function readArchive(storedPath: string): Promise<Buffer> {
  return readFile(storedPath);
}

export async function deleteArchive(storedPath: string | null | undefined): Promise<void> {
  if (!storedPath) return;
  await unlink(storedPath).catch(() => undefined);
}

export async function archiveExists(storedPath: string | null | undefined): Promise<boolean> {
  if (!storedPath) return false;
  try { await stat(storedPath); return true; } catch { return false; }
}

export async function ensureUploadDir(): Promise<string> {
  const dir = path.join(await ensureBackupDir(), "uploads");
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeUpload(fileName: string, data: Buffer): Promise<string> {
  await assertStorageAvailable("Library restore upload", true);
  const dir = await ensureUploadDir();
  const full = path.join(dir, `${Date.now()}-${path.basename(fileName)}`);
  await writeFile(full, data, { flag: "wx" });
  return full;
}

export const BACKUP_STORAGE_WARNING =
  "Keep a downloaded copy or store backups on a volume separate from the Mixarr database. " +
  "Backups stored with the database may be lost if that volume is removed.";
