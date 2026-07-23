/**
 * Serializers that shape backup/restore rows for the frontend. They never expose
 * server filesystem paths, secrets, or internal stack traces, and convert BigInt
 * sizes to numbers.
 */
type ArchiveRow = {
  id: string;
  fileName: string;
  schemaVersion: number;
  mixarrVersion: string;
  fileSizeBytes: bigint;
  archiveSha256: string | null;
  trackCount: number;
  audioFeatureCount: number;
  bpmCount: number;
  popularityCount: number;
  genreCount: number;
  noDataCount: number;
  notes: string | null;
  verificationStatus: string;
  verifiedAt: Date | null;
  lastRestoredAt: Date | null;
  createdAt: Date;
};

export function serializeArchiveSummary(row: ArchiveRow) {
  return {
    id: row.id,
    fileName: row.fileName,
    schemaVersion: row.schemaVersion,
    mixarrVersion: row.mixarrVersion,
    fileSizeBytes: Number(row.fileSizeBytes),
    archiveSha256: row.archiveSha256,
    counts: {
      tracks: row.trackCount,
      audioFeatures: row.audioFeatureCount,
      bpm: row.bpmCount,
      popularity: row.popularityCount,
      genres: row.genreCount,
      noData: row.noDataCount,
    },
    notes: row.notes,
    verificationStatus: row.verificationStatus,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastRestoredAt: row.lastRestoredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

type RestoreRow = {
  id: string;
  archiveFileName: string;
  backupSchemaVersion: number | null;
  backupMixarrVersion: string | null;
  status: string;
  phase: string;
  conflictPolicy: string;
  compatibility: string | null;
  archiveTrackCount: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  appliedCount: number;
  previewJson: unknown;
  reportJson: unknown;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export function serializeRestoreJob(row: RestoreRow) {
  return {
    id: row.id,
    archiveFileName: row.archiveFileName,
    backupSchemaVersion: row.backupSchemaVersion,
    backupMixarrVersion: row.backupMixarrVersion,
    status: row.status,
    phase: row.phase,
    conflictPolicy: row.conflictPolicy,
    compatibility: row.compatibility,
    archiveTrackCount: row.archiveTrackCount,
    matchedCount: row.matchedCount,
    unmatchedCount: row.unmatchedCount,
    ambiguousCount: row.ambiguousCount,
    appliedCount: row.appliedCount,
    preview: row.previewJson ?? null,
    report: row.reportJson ?? null,
    // A generic message only — never a raw stack trace.
    error: row.error ? "Restore failed. See restore status and warnings for details." : null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

type BackupJobRow = {
  id: string;
  status: string;
  phase: string;
  processed: number;
  totalEstimate: number;
  trackCount: number;
  archiveId: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export function serializeBackupJob(row: BackupJobRow) {
  return {
    id: row.id,
    status: row.status,
    phase: row.phase,
    processed: row.processed,
    totalEstimate: row.totalEstimate,
    trackCount: row.trackCount,
    archiveId: row.archiveId,
    error: row.error ? "Backup failed. Check server logs for details." : null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
