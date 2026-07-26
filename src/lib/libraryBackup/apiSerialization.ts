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
  manifestJson?: unknown;
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
    artifact: row.manifestJson && typeof row.manifestJson === "object" ? {
      complete: (row.manifestJson as Record<string, unknown>).complete === true,
      schemaVersion: (row.manifestJson as Record<string, unknown>).schema_version ?? row.schemaVersion,
      diagnostics: (row.manifestJson as Record<string, unknown>).diagnostics ?? null,
      categoryCounts: (row.manifestJson as Record<string, unknown>).category_counts ?? null,
      files: (row.manifestJson as Record<string, unknown>).files ?? null,
      identityStrategyVersion: (row.manifestJson as Record<string, unknown>).identity_strategy_version ?? 1,
      pathNormalizationVersion: (row.manifestJson as Record<string, unknown>).path_normalization_version ?? 1,
    } : null,
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
  countsJson?: unknown;
};

type RestorePreviewPayload = Record<string, unknown> & {
  status: "ready" | "partial" | "incompatible";
  matches: Record<string, unknown>;
};

/** Upload ingestion metadata is stored in previewJson before a dry run exists. */
export function isRestoreDryRunPreview(value: unknown): value is RestorePreviewPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const preview = value as Record<string, unknown>;
  const matches = preview.matches;
  return ["ready", "partial", "incompatible"].includes(String(preview.status))
    && !!matches
    && typeof matches === "object"
    && !Array.isArray(matches);
}

function finiteCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

export function serializeRestorePreview(value: unknown): Record<string, unknown> | null {
  if (!isRestoreDryRunPreview(value)) return null;
  const matches = value.matches;
  return {
    ...value,
    backupRecordsFound: finiteCount(value.backupRecordsFound),
    invalidRecords: finiteCount(value.invalidRecords),
    tracksInBackup: finiteCount(value.tracksInBackup),
    tracksInLibrary: finiteCount(value.tracksInLibrary),
    schemaIncompatibilities: Array.isArray(value.schemaIncompatibilities)
      ? value.schemaIncompatibilities.filter((item): item is string => typeof item === "string")
      : [],
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((item): item is string => typeof item === "string")
      : [],
    categories: value.categories && typeof value.categories === "object" && !Array.isArray(value.categories)
      ? value.categories
      : {},
    matches: {
      exact: finiteCount(matches.exact),
      fallback: finiteCount(matches.fallback),
      highConfidence: finiteCount(matches.highConfidence),
      ambiguous: finiteCount(matches.ambiguous),
      unmatched: finiteCount(matches.unmatched),
    },
  };
}

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
    // Ingestion-only payloads are internal staging state, not completed dry runs.
    preview: serializeRestorePreview(row.previewJson),
    report: row.reportJson ?? null,
    // A generic message only — never a raw stack trace.
    error: row.error ? "Restore failed. See restore status and warnings for details." : null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    counts: row.countsJson ?? null,
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
