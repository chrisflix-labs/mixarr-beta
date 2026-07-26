/**
 * Background runner for Library Intelligence backup creation. Persists all
 * progress to the LibraryBackupJob row so a backup keeps running (and stays
 * observable) even if the browser is closed.
 */
import prisma from "../prisma";
import { APP_VERSION_NUMBER } from "../appVersion";
import { countBackupTracks, getBackupSourceContext, streamTrackRecords, writeArchiveFromRecords } from "./backupBuilder";
import { readArchive, safeBackupFileName, writeArchive } from "./backupStorage";
import { ANALYSIS_DATA_VERSION, BACKUP_SCHEMA_VERSION } from "./archiveFormat";
import { parseTrackRecords, validateArchive } from "./restoreReader";

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
  const expectedRecords = await countBackupTracks(userId, options.libraryId);
  const source = await getBackupSourceContext(userId, options.libraryId);
  console.info("[LibraryBackup]", JSON.stringify({
    event: "backup_export_started", jobId, eligibleDatabaseRecords: expectedRecords,
  }));
  const built = await writeArchiveFromRecords(streamTrackRecords(userId, options.libraryId), {
    mixarrVersion: APP_VERSION_NUMBER,
    notes: options.notes ?? null,
    expectedRecords,
    ...source,
    onProgress: (n) => {
      processed = n;
      void prisma.libraryBackupJob.update({ where: { id: jobId }, data: { processed: n, phase: "exporting", status: "exporting" } }).catch(() => undefined);
    },
  });

  await prisma.libraryBackupJob.update({ where: { id: jobId }, data: { status: "writing", phase: "writing", processed: built.counts.tracks } });

  const fileName = safeBackupFileName(options.fileNameBase || `mixarr-library-${new Date().toISOString().slice(0, 10)}`);
  const { storedPath, size } = await writeArchive(fileName, built.archive);

  await prisma.libraryBackupJob.update({ where: { id: jobId }, data: { status: "verifying", phase: "verifying" } });
  const writtenBuffer = await readArchive(storedPath);
  const validated = validateArchive(writtenBuffer, BACKUP_SCHEMA_VERSION, ANALYSIS_DATA_VERSION);
  const parsed = parseTrackRecords(validated.tracksBuffer, validated.manifest.schema_version);
  const verifiedComplete = built.manifest.complete
    && validated.manifest.complete
    && parsed.invalidCount === 0
    && parsed.duplicateCount === 0
    && parsed.records.length === expectedRecords
    && validated.manifest.diagnostics.records_written === parsed.records.length;
  const verificationStatus = verifiedComplete ? "verified" : "failed";
  const finalStatus = verifiedComplete ? "completed" : "partial";
  console.info("[LibraryBackup]", JSON.stringify({
    event: "backup_export_verified",
    jobId,
    eligibleDatabaseRecords: expectedRecords,
    recordsRead: built.manifest.diagnostics.records_read,
    recordsSerialized: built.manifest.diagnostics.records_serialized,
    recordsWritten: parsed.records.length,
    invalidRecords: parsed.invalidCount,
    duplicateRecords: parsed.duplicateCount,
    complete: verifiedComplete,
  }));

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
      verificationStatus,
      verifiedAt: verifiedComplete ? new Date() : null,
    },
  });

  await prisma.libraryBackupJob.update({
    where: { id: jobId },
    data: {
      status: finalStatus,
      phase: finalStatus,
      archiveId: archive.id,
      trackCount: built.counts.tracks,
      processed: built.counts.tracks,
      countsJson: {
        ...built.counts,
        diagnostics: built.manifest.diagnostics,
        complete: verifiedComplete,
        missing: Math.max(0, expectedRecords - parsed.records.length),
      } as unknown as object,
      error: verifiedComplete ? null : `Backup artifact is partial: wrote ${parsed.records.length} of ${expectedRecords} records.`,
      finishedAt: new Date(),
    },
  });
  void processed;
}
