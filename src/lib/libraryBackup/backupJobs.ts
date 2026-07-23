/**
 * Background runner for Library Intelligence backup creation. Persists all
 * progress to the LibraryBackupJob row so a backup keeps running (and stays
 * observable) even if the browser is closed.
 */
import prisma from "../prisma";
import { APP_VERSION_NUMBER } from "../appVersion";
import { countBackupTracks, streamTrackRecords, writeArchiveFromRecords } from "./backupBuilder";
import { safeBackupFileName, writeArchive } from "./backupStorage";

export type CreateBackupOptions = { libraryId?: string; notes?: string | null; fileNameBase?: string };

export async function startBackupJob(userId: string, options: CreateBackupOptions = {}): Promise<{ jobId: string }> {
  const totalEstimate = await countBackupTracks(userId, options.libraryId);
  const job = await prisma.libraryBackupJob.create({
    data: { userId, status: "preparing", phase: "preparing", libraryId: options.libraryId ?? null, notes: options.notes ?? null, totalEstimate },
  });

  // Fire-and-forget; status lives in the DB row.
  void runBackupJob(job.id, userId, options).catch(async (error) => {
    await prisma.libraryBackupJob.update({
      where: { id: job.id },
      data: { status: "failed", phase: "failed", error: error instanceof Error ? error.message : String(error), finishedAt: new Date() },
    }).catch(() => undefined);
    console.error("[LibraryBackup] Backup job failed", error);
  });

  return { jobId: job.id };
}

async function runBackupJob(jobId: string, userId: string, options: CreateBackupOptions): Promise<void> {
  await prisma.libraryBackupJob.update({ where: { id: jobId }, data: { status: "reading", phase: "reading" } });

  let processed = 0;
  const built = await writeArchiveFromRecords(streamTrackRecords(userId, options.libraryId), {
    mixarrVersion: APP_VERSION_NUMBER,
    notes: options.notes ?? null,
    onProgress: (n) => {
      processed = n;
      void prisma.libraryBackupJob.update({ where: { id: jobId }, data: { processed: n, phase: "exporting", status: "exporting" } }).catch(() => undefined);
    },
  });

  await prisma.libraryBackupJob.update({ where: { id: jobId }, data: { status: "writing", phase: "writing", processed: built.counts.tracks } });

  const fileName = safeBackupFileName(options.fileNameBase || `mixarr-library-${new Date().toISOString().slice(0, 10)}`);
  const { storedPath, size } = await writeArchive(fileName, built.archive);

  await prisma.libraryBackupJob.update({ where: { id: jobId }, data: { status: "verifying", phase: "verifying" } });

  const archive = await prisma.libraryBackupArchive.create({
    data: {
      userId,
      fileName,
      storedPath,
      schemaVersion: built.manifest.schema_version,
      mixarrVersion: built.manifest.mixarr_version,
      fileSizeBytes: BigInt(size),
      archiveSha256: built.archiveSha256,
      trackCount: built.counts.tracks,
      audioFeatureCount: built.counts.audio_features,
      bpmCount: built.counts.bpm,
      popularityCount: built.counts.popularity,
      genreCount: built.counts.genres,
      noDataCount: built.counts.no_data,
      countsJson: built.counts as unknown as object,
      manifestJson: built.manifest as unknown as object,
      notes: options.notes ?? null,
      verificationStatus: "verified",
      verifiedAt: new Date(),
    },
  });

  await prisma.libraryBackupJob.update({
    where: { id: jobId },
    data: { status: "completed", phase: "completed", archiveId: archive.id, trackCount: built.counts.tracks, processed: built.counts.tracks, countsJson: built.counts as unknown as object, finishedAt: new Date() },
  });
  void processed;
}
