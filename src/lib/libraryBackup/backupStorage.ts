/**
 * Server-side storage for Library Intelligence backup archives.
 *
 * Resolves a configurable backup directory (MIXARR_BACKUP_DIR, default
 * /app/backups) and provides safe read/write/delete helpers. Absolute paths are
 * kept server-side only and never returned to the frontend.
 */
import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BACKUP_FILE_EXTENSION } from "./archiveFormat";

const DEFAULT_CONTAINER_DIR = "/app/backups";

export function resolveBackupDir(): string {
  const configured = process.env.MIXARR_BACKUP_DIR?.trim();
  if (configured) return configured;
  const inContainer = process.env.DOCKER === "1" || process.env.CONTAINER === "1";
  if (inContainer) return DEFAULT_CONTAINER_DIR;
  return path.join(process.cwd(), "backups");
}

/** True if `dir` exists (creatable) AND the process can actually write to it. */
async function isUsableDir(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true });
    // mkdir on an existing dir is a no-op that succeeds regardless of write
    // permission (common with bind mounts owned by another uid), so probe a write.
    const probe = path.join(dir, `.mixarr-write-test-${process.pid}`);
    await writeFile(probe, "ok");
    await unlink(probe).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

let warnedFallback = false;

/**
 * Resolve a writable backup directory. Prefers the configured/default location,
 * but if it is not writable (e.g. a bind mount owned by a different uid) it falls
 * back to a writable temp dir so a backup never crashes outright. The browser
 * download remains the reliable copy in that case.
 */
export async function ensureBackupDir(): Promise<string> {
  const preferred = resolveBackupDir();
  if (await isUsableDir(preferred)) return preferred;

  const fallbacks = [path.join("/app/tmp", "mixarr-backups"), path.join(os.tmpdir(), "mixarr-backups")];
  for (const fallback of fallbacks) {
    if (await isUsableDir(fallback)) {
      if (!warnedFallback) {
        warnedFallback = true;
        console.warn(
          `[LibraryBackup] Backup directory "${preferred}" is not writable by this process; ` +
          `using "${fallback}" instead. This location may not persist — download backups to keep them, ` +
          `or make the backup directory writable by the container user (uid 1001). See the v2.4.11 backup guide.`,
        );
      }
      return fallback;
    }
  }
  // Last resort: return the preferred dir so the caller surfaces a clear error.
  return preferred;
}

/** Sanitize a user-provided backup base name into a safe file name. */
export function safeBackupFileName(base: string): string {
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  const stem = cleaned || "library-intelligence-backup";
  return stem.endsWith(BACKUP_FILE_EXTENSION) ? stem : stem + BACKUP_FILE_EXTENSION;
}

/** Resolve a stored path and guarantee it stays inside the backup directory. */
export async function resolveStoredPath(fileName: string): Promise<string> {
  const dir = await ensureBackupDir();
  const base = path.basename(fileName); // strip any directory components
  const full = path.join(dir, base);
  const rel = path.relative(dir, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Refusing to write backup outside the backup directory.");
  }
  return full;
}

export async function writeArchive(fileName: string, data: Buffer): Promise<{ storedPath: string; size: number }> {
  const storedPath = await resolveStoredPath(fileName);
  await writeFile(storedPath, data);
  const info = await stat(storedPath);
  return { storedPath, size: info.size };
}

export async function readArchive(storedPath: string): Promise<Buffer> {
  return readFile(storedPath);
}

export async function deleteArchive(storedPath: string | null | undefined): Promise<void> {
  if (!storedPath) return;
  try {
    await unlink(storedPath);
  } catch {
    // Already gone — treat as success.
  }
}

export async function archiveExists(storedPath: string | null | undefined): Promise<boolean> {
  if (!storedPath) return false;
  try {
    await stat(storedPath);
    return true;
  } catch {
    return false;
  }
}

/** Uploaded-archive staging (kept separate from finished backups). */
export async function ensureUploadDir(): Promise<string> {
  const dir = path.join(await ensureBackupDir(), "uploads");
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeUpload(fileName: string, data: Buffer): Promise<string> {
  const dir = await ensureUploadDir();
  const base = path.basename(fileName);
  const full = path.join(dir, `${Date.now()}-${base}`);
  await writeFile(full, data);
  return full;
}

export const BACKUP_STORAGE_WARNING =
  "Keep a downloaded copy or store backups on a volume separate from the Mixarr database. " +
  "Backups stored with the database may be lost if that volume is removed.";
