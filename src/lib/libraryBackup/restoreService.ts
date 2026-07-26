/**
 * Library Intelligence Backup — restore service.
 *
 * Handles upload → validate → stage → preview → apply, with conservative
 * matching, conflict policies, provenance, known-no-data preservation, idempotent
 * resumable batches, and deferred (staged) restore before a Plex library sync.
 * Never queues analysis work and never contacts an external service.
 */
import prisma from "../prisma";
import type { Prisma } from "@prisma/client";
import { APP_VERSION_NUMBER } from "../appVersion";
import {
  ANALYSIS_DATA_VERSION,
  BACKUP_SCHEMA_VERSION,
  BackupValidationError,
  type BackupManifest,
  type BackupTrackRecord,
} from "./archiveFormat";
import {
  createEmptyIndexes,
  effectivePolicyForCategory,
  indexTargetTrack,
  resolveConflictAction,
  resolveMatch,
  computeFingerprint,
  computeMetadataKey,
  hashNormalizedPath,
  hashNormalizedPathCandidates,
  isAutoApplicableMatch,
  type CategoryPolicies,
  type ConflictPolicy,
  type MatchIndexes,
  type MatchResult,
} from "./trackMatching";
import { validateArchive, parseTrackRecords } from "./restoreReader";
import { writeUpload } from "./backupStorage";
import { AUDIO_FEATURE_NUMBER_FIELDS, AUDIO_FEATURE_STRING_FIELDS, AUDIO_FEATURE_TIMESTAMP_FIELDS } from "./archiveFormat";
import { extractMediaPartIdentities } from "./archiveWriter";

const APPLY_BATCH_SIZE = 200;
const INDEX_BATCH_SIZE = 1000;

/** Transient queue states that must never be restored as active work. */
const TRANSIENT_STATUSES = new Set(["queued", "running", "retrying", "worker_owned", "locked", "cancel_requested", "processing"]);

function safeRestoreStatus(status: string | number | null | undefined): string | null {
  if (typeof status !== "string") return null;
  return TRANSIENT_STATUSES.has(status.toLowerCase()) ? "incomplete" : status;
}

// ---------------------------------------------------------------------------
// Upload + staging
// ---------------------------------------------------------------------------

export type CreatedRestoreJob = {
  restoreJobId: string;
  status: string;
  archiveTrackCount: number;
  invalidCount: number;
  duplicateCount: number;
  compatibility: string;
  warnings: string[];
  manifestComplete: boolean;
  legacy: boolean;
  expectedRecords: number;
  waitingForLibrarySync: boolean;
};

export async function createRestoreJobFromUpload(
  userId: string,
  fileName: string,
  buffer: Buffer,
): Promise<CreatedRestoreJob> {
  const validated = validateArchive(buffer, BACKUP_SCHEMA_VERSION, ANALYSIS_DATA_VERSION);
  const parsed = parseTrackRecords(validated.tracksBuffer, validated.manifest.schema_version);
  const expectedRecords = validated.manifest.total_intelligence_records_exported || validated.manifest.counts.tracks;
  const manifestCountMismatch = expectedRecords !== parsed.records.length + parsed.duplicateCount;
  const parsedCategoryCounts = summarizeProjectedCategories(parsed.records);
  if (validated.manifest.schema_version >= 2 && (
    !validated.manifest.complete
    || parsed.invalidCount > 0
    || parsed.duplicateCount > 0
    || manifestCountMismatch
    || !manifestCategoriesMatch(validated.manifest.category_counts, parsedCategoryCounts)
  )) {
    throw new BackupValidationError(
      `Backup artifact is incomplete: expected ${expectedRecords} records, parsed ${parsed.records.length}, invalid ${parsed.invalidCount}, repeated ${parsed.duplicateCount}.`,
    );
  }

  const uploadedPath = await writeUpload(fileName, buffer).catch(() => null);

  const activeTracks = await prisma.track.count({ where: { syncStatus: "active", library: { server: { userId } } } });
  const waitingForLibrarySync = activeTracks === 0;

  const job = await prisma.libraryRestoreJob.create({
    data: {
      userId,
      archiveFileName: fileName.slice(0, 200),
      uploadedPath,
      backupSchemaVersion: validated.manifest.schema_version,
      backupMixarrVersion: validated.manifest.mixarr_version,
      status: waitingForLibrarySync ? "waiting_for_library_sync" : "validating",
      phase: waitingForLibrarySync ? "waiting_for_library_sync" : "validating",
      compatibility: validated.compatibility,
      archiveTrackCount: parsed.records.length,
      previewJson: {
        ingestion: {
          backupRecordsFound: parsed.parsedLineCount,
          parsedRecords: parsed.records.length,
          invalidRecords: parsed.invalidCount,
          duplicateRecords: parsed.duplicateCount,
          reasonCounts: parsed.reasonCounts,
          legacy: validated.manifest.legacy,
          manifestComplete: validated.manifest.complete,
          manifest: validated.manifest,
        },
      } as unknown as object,
    },
  });

  // Stage records in bounded batches.
  for (let i = 0; i < parsed.records.length; i += 500) {
    const slice = parsed.records.slice(i, i + 500);
    await prisma.libraryRestoreStagedRecord.createMany({
      data: slice.map((record, idx) => ({
        restoreJobId: job.id,
        recordIndex: i + idx,
        backupTrackId: record.id.slice(0, 128),
        fingerprint: record.fingerprint,
        pathHash: record.path_hash,
        plexGuid: record.plex_guid,
        ratingKey: record.rating_key,
        recordJson: record as unknown as object,
        matchStatus: "pending",
      })),
    });
  }

  return {
    restoreJobId: job.id,
    status: job.status,
    archiveTrackCount: parsed.records.length,
    invalidCount: parsed.invalidCount,
    duplicateCount: parsed.duplicateCount,
    compatibility: validated.compatibility,
    warnings: parsed.warnings,
    manifestComplete: validated.manifest.complete,
    legacy: validated.manifest.legacy,
    expectedRecords,
    waitingForLibrarySync,
  };
}

function manifestCategoriesMatch(
  manifest: BackupManifest["category_counts"],
  parsed: ReturnType<typeof summarizeProjectedCategories>,
): boolean {
  return manifest.audio_features.completed === parsed.audioFeatures.completed
    && manifest.audio_features.incomplete === parsed.audioFeatures.incomplete
    && manifest.audio_features.pending === parsed.audioFeatures.pending
    && manifest.audio_features.failed === parsed.audioFeatures.failed
    && manifest.audio_features.known_no_data === parsed.audioFeatures.knownNoData
    && manifest.bpm.attempted === parsed.bpm.attempted
    && manifest.bpm.values === parsed.bpm.values
    && manifest.bpm.completed === parsed.bpm.completed
    && manifest.bpm.pending === parsed.bpm.pending
    && manifest.bpm.failed === parsed.bpm.failed
    && manifest.bpm.known_no_data === parsed.bpm.knownNoData
    && manifest.popularity.attempted === parsed.popularity.attempted
    && manifest.popularity.values === parsed.popularity.values
    && manifest.popularity.completed === parsed.popularity.completed
    && manifest.popularity.pending === parsed.popularity.pending
    && manifest.popularity.failed === parsed.popularity.failed
    && manifest.popularity.known_no_data === parsed.popularity.knownNoData
    && manifest.genres.attempted === parsed.genres.attempted
    && manifest.genres.values === parsed.genres.values
    && manifest.genres.completed === parsed.genres.completed
    && manifest.genres.pending === parsed.genres.pending
    && manifest.genres.failed === parsed.genres.failed
    && manifest.genres.known_no_data === parsed.genres.knownNoData;
}

// ---------------------------------------------------------------------------
// Index building over the current library
// ---------------------------------------------------------------------------

export async function buildMatchIndexes(userId: string, libraryId?: string): Promise<MatchIndexes> {
  const indexes = createEmptyIndexes();
  let cursor: string | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await prisma.track.findMany({
      where: { syncStatus: "active", library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } } },
      select: {
        id: true, plexGuid: true, plexGuids: true, plexId: true, ratingKey: true,
        mediaPath: true, plexMediaPartId: true, fileSize: true, plexServerId: true, plexLibraryId: true,
        duration: true, trackIndex: true, plexMetadata: true,
        title: true, artist: { select: { title: true } }, album: { select: { title: true } },
      },
      orderBy: { id: "asc" },
      take: INDEX_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      const disc = extractDisc(row.plexMetadata);
      const mediaParts = extractMediaPartIdentities(row);
      indexTargetTrack(indexes, {
        id: row.id,
        plexGuid: row.plexGuid,
        plexGuids: Array.isArray(row.plexGuids) ? (row.plexGuids.filter((g) => typeof g === "string") as string[]) : null,
        plexId: row.plexId,
        ratingKey: row.ratingKey,
        plexServerId: row.plexServerId,
        plexLibraryId: row.plexLibraryId,
        mediaPartIds: mediaParts.map((part) => part.part_id).filter((id): id is string => !!id),
        pathHash: hashNormalizedPath(row.mediaPath),
        pathHashes: [
          ...hashNormalizedPathCandidates(row.mediaPath),
          ...mediaParts.flatMap((part) => part.path_hashes),
        ],
        fingerprint: computeFingerprint({
          artist: row.artist?.title, album: row.album?.title, title: row.title,
          discNumber: disc, trackNumber: row.trackIndex, durationMs: row.duration,
        }),
        metadataKey: computeMetadataKey({ artist: row.artist?.title, album: row.album?.title, title: row.title }),
        durationMs: row.duration,
      });
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < INDEX_BATCH_SIZE) break;
  }
  return indexes;
}

function extractDisc(plexMetadata: unknown): number | null {
  if (plexMetadata && typeof plexMetadata === "object") {
    const raw = (plexMetadata as Record<string, unknown>).parentIndex;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Current-value existence flags
// ---------------------------------------------------------------------------

type CurrentFlags = { audio: boolean; bpm: boolean; popularity: boolean; genres: boolean };

async function fetchCurrentFlags(trackIds: string[]): Promise<Map<string, CurrentFlags>> {
  const map = new Map<string, CurrentFlags>();
  for (let i = 0; i < trackIds.length; i += 500) {
    const slice = trackIds.slice(i, i + 500);
    const rows = await prisma.track.findMany({
      where: { id: { in: slice } },
      select: {
        id: true, effectiveBpm: true, bpm: true, bpmAnalysisStatus: true, popularityStatus: true, genreStatus: true,
        audioFeature: { select: { effectiveEnergy: true, energy: true, audioFeatureStatus: true } },
        popularity: { select: { provider: true, score: true } },
        _count: { select: { tags: { where: { type: "genre" } } } },
      },
    });
    for (const r of rows) {
      map.set(r.id, {
        audio: !!r.audioFeature,
        bpm: r.effectiveBpm !== null || r.bpm !== null || !!r.bpmAnalysisStatus,
        popularity: !!r.popularity || !!r.popularityStatus,
        genres: (r._count?.tags ?? 0) > 0 || !!r.genreStatus,
      });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Preview (no track writes)
// ---------------------------------------------------------------------------

export type RestorePreview = {
  restoreJobId: string;
  status: "ready" | "partial" | "incompatible";
  compatibility: string;
  backupRecordsFound: number;
  invalidRecords: number;
  schemaIncompatibilities: string[];
  tracksInBackup: number;
  tracksInLibrary: number;
  matches: { exact: number; fallback: number; highConfidence: number; ambiguous: number; unmatched: number };
  categories: Record<string, { existing: number; wouldAdd: number; wouldOverwrite: number; skipped: number; noDataRestored: number }>;
  expectedCategoryCounts: unknown;
  projectedCategoryCounts: unknown;
  sample: { title: string | null; artist: string | null; matchType: string }[];
  warnings: string[];
};

function recordHasCategory(record: BackupTrackRecord, category: "audio_features" | "bpm" | "popularity" | "genres"): boolean {
  if (category === "audio_features") return !!record.audio_feature;
  if (category === "bpm") return !!record.bpm && ["bpm", "apiBpm", "localBpm", "effectiveBpm"].some((k) => typeof record.bpm![k] === "number");
  if (category === "popularity") return !!record.popularity && typeof record.popularity.score === "number" && record.popularity.provider !== "not_found";
  return !!record.genres && record.genres.names.length > 0;
}

function recordNoData(record: BackupTrackRecord, category: "bpm" | "popularity" | "genres"): boolean {
  if (category === "popularity") return !!record.popularity && (record.popularity.popularityStatus === "no_data" || record.popularity.provider === "not_found");
  if (category === "genres") return !!record.genres && record.genres.no_data;
  return !!record.bpm && (record.bpm.bpmAnalysisStatus === "no_data" || record.bpm.bpmAnalysisStatus === "local_not_found");
}

export async function previewRestore(
  restoreJobId: string,
  policy: ConflictPolicy,
  categoryPolicies: CategoryPolicies | undefined,
): Promise<RestorePreview> {
  const job = await prisma.libraryRestoreJob.findUnique({ where: { id: restoreJobId } });
  if (!job) throw new BackupValidationError("Restore job not found.");

  const staged = await prisma.libraryRestoreStagedRecord.findMany({ where: { restoreJobId }, orderBy: { recordIndex: "asc" } });
  const indexes = await buildMatchIndexes(job.userId);
  const tracksInLibrary = indexes.durationByTrackId.size;

  const resolved = staged.map((s) => {
    const record = s.recordJson as unknown as BackupTrackRecord;
    return { stagedId: s.id, record, match: resolveMatch(record, indexes) };
  });
  const matchedIds = resolved.filter((r) => r.match.trackId).map((r) => r.match.trackId as string);
  const currentFlags = await fetchCurrentFlags(Array.from(new Set(matchedIds)));

  const matches = { exact: 0, fallback: 0, highConfidence: 0, ambiguous: 0, unmatched: 0 };
  const categories: RestorePreview["categories"] = {
    audio_features: emptyCategory(), bpm: emptyCategory(), popularity: emptyCategory(), genres: emptyCategory(),
  };

  for (const { record, match } of resolved) {
    if (match.matchType === "ambiguous") matches.ambiguous += 1;
    else if (match.matchType === "unmatched") matches.unmatched += 1;
    else if (match.matchType === "exact_guid" || match.matchType === "exact_source_id" || match.matchType === "exact_rating_key" || match.matchType === "exact_media_part") matches.exact += 1;
    else {
      matches.fallback += 1;
      matches.highConfidence += 1;
    }

    if (!match.trackId || !isAutoApplicableMatch(match.matchType)) continue;
    const flags = currentFlags.get(match.trackId) ?? { audio: false, bpm: false, popularity: false, genres: false };

    for (const category of ["audio_features", "bpm", "popularity", "genres"] as const) {
      const cat = categories[category];
      const hasBackupValue = recordHasCategory(record, category);
      const hasNoData = category !== "audio_features" && recordNoData(record, category as "bpm" | "popularity" | "genres");
      if (!hasBackupValue && !hasNoData) continue;
      const hasCurrent = flags[category === "audio_features" ? "audio" : category === "bpm" ? "bpm" : category === "popularity" ? "popularity" : "genres"];
      const effPolicy = effectivePolicyForCategory(category === "audio_features" ? "audio_features" : category, policy, categoryPolicies);
      const action = resolveConflictAction(hasCurrent, effPolicy);
      if (hasNoData && !hasBackupValue) {
        if (action === "apply") cat.noDataRestored += 1;
        continue;
      }
      if (hasCurrent) cat.existing += 1;
      if (action === "skip") cat.skipped += 1;
      else if (hasCurrent) cat.wouldOverwrite += 1;
      else cat.wouldAdd += 1;
    }
  }

  const priorPreview = job.previewJson && typeof job.previewJson === "object"
    ? job.previewJson as Record<string, unknown> : {};
  const ingestion = priorPreview.ingestion && typeof priorPreview.ingestion === "object"
    ? priorPreview.ingestion as Record<string, unknown> : {};
  const invalidRecords = Number(ingestion.invalidRecords ?? 0) || 0;
  const manifest = ingestion.manifest && typeof ingestion.manifest === "object"
    ? ingestion.manifest as Record<string, unknown> : {};
  const schemaIncompatibilities = job.compatibility === "requires_migration"
    ? ["analysis_data_version_requires_migration"] : [];
  const partial = matches.unmatched > 0 || matches.ambiguous > 0 || invalidRecords > 0 || schemaIncompatibilities.length > 0;
  const preview: RestorePreview = {
    restoreJobId,
    status: schemaIncompatibilities.length ? "incompatible" : partial ? "partial" : "ready",
    compatibility: job.compatibility ?? "unknown",
    backupRecordsFound: Number(ingestion.backupRecordsFound ?? staged.length) || staged.length,
    invalidRecords,
    schemaIncompatibilities,
    tracksInBackup: staged.length,
    tracksInLibrary,
    matches,
    categories,
    expectedCategoryCounts: manifest.category_counts ?? null,
    projectedCategoryCounts: summarizeProjectedCategories(resolved.filter((item) => !!item.match.trackId).map((item) => item.record)),
    sample: resolved.slice(0, 25).map((r) => ({ title: r.record.title, artist: r.record.artist, matchType: r.match.matchType })),
    warnings: [
      ...(ingestion.legacy ? ["Legacy schema-v1 backup: expected counts were derived from parsed contents and fields unavailable in the legacy artifact cannot be recovered."] : []),
      ...(job.compatibility === "requires_migration" ? ["Backup analysis version requires a migration adapter that is not available."] : []),
      ...(matches.unmatched ? [`${matches.unmatched} backup records are unmatched.`] : []),
      ...(matches.ambiguous ? [`${matches.ambiguous} backup records have ambiguous identities.`] : []),
      ...(invalidRecords ? [`${invalidRecords} backup records are invalid.`] : []),
    ],
  };

  // Persist the dry-run identity plan before any Library Intelligence mutation.
  await prisma.libraryRestoreMatch.deleteMany({ where: { restoreJobId } });
  for (let i = 0; i < resolved.length; i += APPLY_BATCH_SIZE) {
    const slice = resolved.slice(i, i + APPLY_BATCH_SIZE);
    await prisma.$transaction([
      prisma.libraryRestoreMatch.createMany({
        data: slice.map(({ record, match }) => ({
          restoreJobId,
          backupTrackId: record.id.slice(0, 128),
          matchedTrackId: match.trackId,
          matchType: match.matchType,
          confidence: match.confidence,
          candidatesJson: match.candidates.length ? match.candidates.slice(0, 20) : undefined,
        })),
      }),
      ...slice.map(({ stagedId, match }) => prisma.libraryRestoreStagedRecord.update({
        where: { id: stagedId },
        data: {
          matchStatus: match.trackId && isAutoApplicableMatch(match.matchType) ? "matched" : match.matchType,
          matchType: match.matchType,
          matchedTrackId: match.trackId,
          reason: match.matchType,
        },
      })),
    ]);
  }

  await prisma.libraryRestoreJob.update({
    where: { id: restoreJobId },
    data: {
      status: "preview_ready",
      phase: "preview_ready",
      conflictPolicy: policy,
      categoryPolicyJson: (categoryPolicies ?? {}) as object,
      previewJson: preview as unknown as object,
      matchedCount: matches.exact + matches.fallback,
      ambiguousCount: matches.ambiguous,
      unmatchedCount: matches.unmatched,
    },
  });

  return preview;
}

function summarizeProjectedCategories(records: BackupTrackRecord[]) {
  const out = {
    audioFeatures: { completed: 0, incomplete: 0, pending: 0, failed: 0, knownNoData: 0 },
    popularity: { attempted: 0, values: 0, completed: 0, pending: 0, failed: 0, knownNoData: 0 },
    genres: { attempted: 0, values: 0, completed: 0, pending: 0, failed: 0, knownNoData: 0 },
    bpm: { attempted: 0, values: 0, completed: 0, pending: 0, failed: 0, knownNoData: 0 },
  };
  for (const record of records) {
    const audioStatus = record.audio_feature?.audioFeatureStatus;
    if (audioStatus === "complete") out.audioFeatures.completed += 1;
    else out.audioFeatures.incomplete += 1;
    if (audioStatus === "pending") out.audioFeatures.pending += 1;
    if (audioStatus === "failed") out.audioFeatures.failed += 1;
    if (audioStatus === "no_data") out.audioFeatures.knownNoData += 1;
    const popularityStatus = record.popularity?.popularityStatus;
    const popularityHasValue = typeof record.popularity?.score === "number" && record.popularity.provider !== "not_found";
    if (popularityHasValue || (popularityStatus && popularityStatus !== "pending")) out.popularity.attempted += 1;
    if (popularityHasValue) out.popularity.values += 1;
    if (popularityStatus === "success") out.popularity.completed += 1;
    if (popularityStatus === "pending") out.popularity.pending += 1;
    if (popularityStatus === "failed") out.popularity.failed += 1;
    if (recordNoData(record, "popularity")) out.popularity.knownNoData += 1;
    if (record.genres?.names.length || (record.genres?.status && record.genres.status !== "pending")) out.genres.attempted += 1;
    if (record.genres?.names.length) out.genres.values += 1;
    if (record.genres?.status === "success") out.genres.completed += 1;
    if (record.genres?.status === "pending") out.genres.pending += 1;
    if (record.genres?.status === "failed") out.genres.failed += 1;
    if (recordNoData(record, "genres")) out.genres.knownNoData += 1;
    const bpmHasValue = recordHasCategory(record, "bpm");
    if (bpmHasValue || (record.bpm?.bpmAnalysisStatus && record.bpm.bpmAnalysisStatus !== "pending")) out.bpm.attempted += 1;
    if (bpmHasValue) out.bpm.values += 1;
    if (record.bpm?.bpmAnalysisStatus === "complete") out.bpm.completed += 1;
    if (record.bpm?.bpmAnalysisStatus === "pending") out.bpm.pending += 1;
    if (record.bpm?.bpmAnalysisStatus === "failed") out.bpm.failed += 1;
    if (recordNoData(record, "bpm")) out.bpm.knownNoData += 1;
  }
  return out;
}

function emptyCategory() {
  return { existing: 0, wouldAdd: 0, wouldOverwrite: 0, skipped: 0, noDataRestored: 0 };
}

// ---------------------------------------------------------------------------
// Apply (idempotent, batched, resumable)
// ---------------------------------------------------------------------------

export type RestoreReport = {
  status: "fully_restored" | "restored_with_warnings" | "partial_restore" | "failed" | "incompatible_backup";
  restoreJobId: string;
  archiveFileName: string;
  backupMixarrVersion: string | null;
  restoreDate: string;
  tracksInArchive: number;
  matched: number;
  matchedRecords: number;
  backupRecords: number;
  unmatched: number;
  unmatchedRecords: number;
  ambiguous: number;
  ambiguousRecords: number;
  invalidRecords: number;
  writeFailures: number;
  recordsSuccessfullyRestored: number;
  recordsAlreadyIdentical: number;
  recordsRolledBack: number;
  skippedReasonCounts: Record<string, number>;
  audioFeaturesRestored: number;
  bpmRestored: number;
  popularityRestored: number;
  genresRestored: number;
  noDataRestored: number;
  existingPreserved: number;
  existingOverwritten: number;
  invalidSkipped: number;
  olderVersionRestored: number;
  warnings: string[];
  categories: ReturnType<typeof summarizeProjectedCategories>;
  reconciliation: {
    matchedTracks: number;
    expected: ReturnType<typeof summarizeProjectedCategories>;
    restored: ReturnType<typeof summarizeProjectedCategories>;
    equal: boolean;
  };
  durationMs: number;
};

export async function applyRestore(
  restoreJobId: string,
  policy: ConflictPolicy,
  categoryPolicies: CategoryPolicies | undefined,
  confirmPartial = false,
): Promise<RestoreReport> {
  const startedAt = Date.now();
  const job = await prisma.libraryRestoreJob.findUnique({ where: { id: restoreJobId } });
  if (!job) throw new BackupValidationError("Restore job not found.");
  if (!job.previewJson || typeof job.previewJson !== "object") {
    throw new BackupValidationError("Run the restore dry run before applying this backup.");
  }
  const preview = job.previewJson as unknown as RestorePreview;
  const invalidRecords = preview.invalidRecords ?? 0;
  if (preview.schemaIncompatibilities?.length) {
    throw new BackupValidationError("This backup is incompatible with the current restore schema.");
  }
  if (!confirmPartial && ((preview.matches?.unmatched ?? 0) > 0 || (preview.matches?.ambiguous ?? 0) > 0 || invalidRecords > 0)) {
    throw new BackupValidationError(
      `Dry run is not complete: ${preview.matches?.unmatched ?? 0} unmatched, ${preview.matches?.ambiguous ?? 0} ambiguous, ${invalidRecords} invalid. Explicitly confirm a partial restore to continue.`,
    );
  }

  const provenanceId = restoreJobId;
  const report = {
    audioFeaturesRestored: 0, bpmRestored: 0, popularityRestored: 0, genresRestored: 0,
    noDataRestored: 0, existingPreserved: 0, existingOverwritten: 0,
    matched: 0, unmatched: 0, ambiguous: 0,
    alreadyIdentical: 0, writeFailures: 0, rolledBack: 0,
  };

  await prisma.libraryRestoreJob.update({ where: { id: restoreJobId }, data: { status: "matching", phase: "matching", cancelRequested: false } });
  const indexes = await buildMatchIndexes(job.userId);

  // If the library has no tracks yet (fresh database before a Plex sync), do not
  // mark every staged record as permanently unmatched. Keep them staged so the
  // restore can be applied after a lightweight library sync.
  if (indexes.durationByTrackId.size === 0) {
    await prisma.libraryRestoreJob.update({
      where: { id: restoreJobId },
      data: { status: "waiting_for_library_sync", phase: "waiting_for_library_sync" },
    });
    return {
      status: "partial_restore",
      restoreJobId, archiveFileName: job.archiveFileName, backupMixarrVersion: job.backupMixarrVersion,
      restoreDate: new Date().toISOString(), tracksInArchive: job.archiveTrackCount,
      backupRecords: job.archiveTrackCount, matched: 0, matchedRecords: 0, unmatched: 0, unmatchedRecords: 0,
      ambiguous: 0, ambiguousRecords: 0, invalidRecords, writeFailures: 0,
      recordsSuccessfullyRestored: 0, recordsAlreadyIdentical: 0, recordsRolledBack: 0, skippedReasonCounts: { waiting_for_library_sync: job.archiveTrackCount },
      audioFeaturesRestored: 0, bpmRestored: 0, popularityRestored: 0, genresRestored: 0, noDataRestored: 0,
      existingPreserved: 0, existingOverwritten: 0, invalidSkipped: 0, olderVersionRestored: 0,
      warnings: ["No library tracks are available yet. Configure Plex and run a library sync, then apply this restore."],
      categories: summarizeProjectedCategories([]),
      reconciliation: { matchedTracks: 0, expected: summarizeProjectedCategories([]), restored: summarizeProjectedCategories([]), equal: false },
      durationMs: Date.now() - startedAt,
    };
  }

  await prisma.libraryRestoreJob.update({ where: { id: restoreJobId }, data: { status: "restoring", phase: "restoring" } });

  // Only records not already applied — makes re-runs and resume idempotent.
  let processedBatches = job.lastBatchIndex;
  let cursorIndex = -1;
  const restoredTrackIds: string[] = [];
  let stoppedOnFailure = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const current = await prisma.libraryRestoreJob.findUnique({ where: { id: restoreJobId }, select: { cancelRequested: true } });
    if (current?.cancelRequested) {
      await prisma.libraryRestoreJob.update({ where: { id: restoreJobId }, data: { status: "canceled", phase: "canceled", finishedAt: new Date() } });
      break;
    }

    // "applied" records are never re-processed (idempotent). Previously unmatched
    // or ambiguous records ARE re-attempted so a retry after a Plex sync can match
    // tracks that did not exist on the first pass.
    const batch = await prisma.libraryRestoreStagedRecord.findMany({
      where: { restoreJobId, matchStatus: "matched", recordIndex: { gt: cursorIndex } },
      orderBy: { recordIndex: "asc" },
      take: APPLY_BATCH_SIZE,
    });
    if (!batch.length) break;
    cursorIndex = batch[batch.length - 1].recordIndex;
    processedBatches += 1;
    let failedRecordIndex: number | null = null;

    try {
      const batchReport = {
        audioFeaturesRestored: 0, bpmRestored: 0, popularityRestored: 0, genresRestored: 0,
        noDataRestored: 0, existingPreserved: 0, existingOverwritten: 0,
      };
      let batchAlreadyIdentical = 0;
      const batchResult = await prisma.$transaction(async (tx) => {
        const trackIds: string[] = [];
        for (const staged of batch) {
          const record = staged.recordJson as unknown as BackupTrackRecord;
          const trackId = staged.matchedTrackId;
          if (!trackId) throw new Error(`Restore plan record ${staged.recordIndex} has no target track.`);
          let applied: string[];
          try {
            applied = await applyRecordToTrack(tx, trackId, record, policy, categoryPolicies, provenanceId, batchReport);
          } catch (error) {
            failedRecordIndex = staged.recordIndex;
            throw error;
          }
          if (!applied.length) batchAlreadyIdentical += 1;
          await tx.libraryRestoreStagedRecord.update({
            where: { id: staged.id },
            data: { matchStatus: "applied", appliedBatch: processedBatches, reason: applied.join(",") || "already_current" },
          });
          trackIds.push(trackId);
        }
        return trackIds;
      }, { maxWait: 30_000, timeout: 300_000 });
      restoredTrackIds.push(...batchResult);
      report.matched += batchResult.length;
      report.alreadyIdentical += batchAlreadyIdentical;
      report.audioFeaturesRestored += batchReport.audioFeaturesRestored;
      report.bpmRestored += batchReport.bpmRestored;
      report.popularityRestored += batchReport.popularityRestored;
      report.genresRestored += batchReport.genresRestored;
      report.noDataRestored += batchReport.noDataRestored;
      report.existingPreserved += batchReport.existingPreserved;
      report.existingOverwritten += batchReport.existingOverwritten;
    } catch (error) {
      report.writeFailures += 1;
      report.rolledBack += batch.length;
      stoppedOnFailure = true;
      console.error("[LibraryBackup]", JSON.stringify({
        event: "restore_batch_failed", restoreJobId, batch: processedBatches,
        recordsRolledBack: batch.length, failedRecordIndex,
        error: error instanceof Error ? error.message : String(error),
      }));
      break;
    }

    await prisma.libraryRestoreJob.update({
      where: { id: restoreJobId },
      data: { lastBatchIndex: processedBatches, appliedCount: { increment: 0 }, updatedAt: new Date() },
    });
  }

  const finalJob = await prisma.libraryRestoreJob.findUnique({ where: { id: restoreJobId }, select: { cancelRequested: true, compatibility: true } });
  const warnings: string[] = [];
  if (finalJob?.compatibility === "requires_migration") warnings.push("Some restored values came from a newer analysis version.");

  const allStaged = await prisma.libraryRestoreStagedRecord.findMany({
    where: { restoreJobId },
    orderBy: { recordIndex: "asc" },
    select: { recordJson: true, matchStatus: true, matchedTrackId: true },
  });
  const matchedStaged = allStaged.filter((item) => ["matched", "applied"].includes(item.matchStatus) && item.matchedTrackId);
  const appliedTotal = allStaged.filter((item) => item.matchStatus === "applied" && item.matchedTrackId).length;
  const expected = summarizeProjectedCategories(matchedStaged.map((item) => item.recordJson as unknown as BackupTrackRecord));
  const matchedTrackIds = Array.from(new Set(matchedStaged.map((item) => item.matchedTrackId as string)));
  const restored = await calculateReconciliation(matchedTrackIds);
  const reconciliationEqual = JSON.stringify(expected) === JSON.stringify(restored);
  const unmatched = preview.matches?.unmatched ?? 0;
  const ambiguous = preview.matches?.ambiguous ?? 0;
  const canceled = finalJob?.cancelRequested;
  const fullyRestored = !canceled && !stoppedOnFailure && report.writeFailures === 0
    && unmatched === 0 && ambiguous === 0 && invalidRecords === 0
    && appliedTotal === job.archiveTrackCount && matchedTrackIds.length === job.archiveTrackCount && reconciliationEqual;
  const status: RestoreReport["status"] = stoppedOnFailure
    ? "failed"
    : fullyRestored
      ? "fully_restored"
      : (unmatched || ambiguous || invalidRecords || !reconciliationEqual) ? "partial_restore" : "restored_with_warnings";
  if (!reconciliationEqual) warnings.push("Post-restore aggregate reconciliation did not reproduce the backup contents.");
  if (unmatched) warnings.push(`${unmatched} backup records could not be matched; existing data for those tracks was preserved.`);
  if (ambiguous) warnings.push(`${ambiguous} backup records matched more than one track and were not applied.`);
  if (report.writeFailures) warnings.push(`${report.writeFailures} record write failed; ${report.rolledBack} records in its deterministic batch were rolled back.`);

  const restoreReport: RestoreReport = {
    status,
    restoreJobId,
    archiveFileName: job.archiveFileName,
    backupMixarrVersion: job.backupMixarrVersion,
    restoreDate: new Date().toISOString(),
    tracksInArchive: job.archiveTrackCount,
    backupRecords: job.archiveTrackCount,
    matched: appliedTotal,
    matchedRecords: appliedTotal,
    unmatched,
    unmatchedRecords: unmatched,
    ambiguous,
    ambiguousRecords: ambiguous,
    invalidRecords,
    writeFailures: report.writeFailures,
    recordsSuccessfullyRestored: Math.max(0, report.matched - report.alreadyIdentical),
    recordsAlreadyIdentical: report.alreadyIdentical,
    recordsRolledBack: report.rolledBack,
    skippedReasonCounts: {
      ...(unmatched ? { unmatched } : {}),
      ...(ambiguous ? { ambiguous } : {}),
      ...(invalidRecords ? { invalid: invalidRecords } : {}),
      ...(report.existingPreserved ? { conflict_policy_preserved: report.existingPreserved } : {}),
      ...(report.rolledBack ? { rolled_back_batch_records: report.rolledBack } : {}),
    },
    audioFeaturesRestored: report.audioFeaturesRestored,
    bpmRestored: report.bpmRestored,
    popularityRestored: report.popularityRestored,
    genresRestored: report.genresRestored,
    noDataRestored: report.noDataRestored,
    existingPreserved: report.existingPreserved,
    existingOverwritten: report.existingOverwritten,
    invalidSkipped: invalidRecords,
    olderVersionRestored: finalJob?.compatibility === "compatible_older" ? report.matched : 0,
    warnings,
    categories: restored,
    reconciliation: { matchedTracks: matchedTrackIds.length, expected, restored, equal: reconciliationEqual },
    durationMs: Date.now() - startedAt,
  };

  console.info("[LibraryBackup]", JSON.stringify({
    event: "restore_reconciled", restoreJobId, status,
    backupRecords: job.archiveTrackCount, matchedRecords: appliedTotal,
    unmatchedRecords: unmatched, ambiguousRecords: ambiguous, invalidRecords,
    writeFailures: report.writeFailures, reconciliationEqual,
  }));
  await prisma.libraryRestoreJob.update({
    where: { id: restoreJobId },
    data: {
      status: canceled ? "canceled" : status,
      phase: canceled ? "canceled" : status,
      reportJson: restoreReport as unknown as object,
      appliedCount: appliedTotal,
      matchedCount: appliedTotal,
      unmatchedCount: unmatched,
      ambiguousCount: ambiguous,
      finishedAt: new Date(),
    },
  });

  return restoreReport;
}

async function calculateReconciliation(trackIds: string[]): Promise<ReturnType<typeof summarizeProjectedCategories>> {
  const out = summarizeProjectedCategories([]);
  for (let i = 0; i < trackIds.length; i += 500) {
    const rows = await prisma.track.findMany({
      where: { id: { in: trackIds.slice(i, i + 500) } },
      select: {
        popularityStatus: true, genreStatus: true, bpmAnalysisStatus: true,
        bpm: true, apiBpm: true, localBpm: true, effectiveBpm: true,
        audioFeature: { select: { audioFeatureStatus: true } },
        popularity: { select: { provider: true, score: true } },
        tags: { where: { type: "genre" }, select: { id: true } },
      },
    });
    for (const row of rows) {
      const audioStatus = row.audioFeature?.audioFeatureStatus;
      if (audioStatus === "complete") out.audioFeatures.completed += 1;
      else out.audioFeatures.incomplete += 1;
      if (audioStatus === "pending") out.audioFeatures.pending += 1;
      if (audioStatus === "failed") out.audioFeatures.failed += 1;
      if (audioStatus === "no_data") out.audioFeatures.knownNoData += 1;
      const popularityHasValue = !!(row.popularity && row.popularity.provider !== "not_found" && typeof row.popularity.score === "number");
      if (popularityHasValue || (row.popularityStatus && row.popularityStatus !== "pending")) out.popularity.attempted += 1;
      if (popularityHasValue) out.popularity.values += 1;
      if (row.popularityStatus === "success") out.popularity.completed += 1;
      if (row.popularityStatus === "pending") out.popularity.pending += 1;
      if (row.popularityStatus === "failed") out.popularity.failed += 1;
      if (row.popularityStatus === "no_data") out.popularity.knownNoData += 1;
      if (row.tags.length || (row.genreStatus && row.genreStatus !== "pending")) out.genres.attempted += 1;
      if (row.tags.length) out.genres.values += 1;
      if (row.genreStatus === "success") out.genres.completed += 1;
      if (row.genreStatus === "pending") out.genres.pending += 1;
      if (row.genreStatus === "failed") out.genres.failed += 1;
      if (row.genreStatus === "no_data") out.genres.knownNoData += 1;
      const bpmHasValue = [row.bpm, row.apiBpm, row.localBpm, row.effectiveBpm].some((value) => typeof value === "number");
      if (bpmHasValue || (row.bpmAnalysisStatus && row.bpmAnalysisStatus !== "pending")) out.bpm.attempted += 1;
      if (bpmHasValue) out.bpm.values += 1;
      if (row.bpmAnalysisStatus === "complete") out.bpm.completed += 1;
      if (row.bpmAnalysisStatus === "pending") out.bpm.pending += 1;
      if (row.bpmAnalysisStatus === "failed") out.bpm.failed += 1;
      if (row.bpmAnalysisStatus === "no_data" || row.bpmAnalysisStatus === "local_not_found") out.bpm.knownNoData += 1;
    }
  }
  return out;
}

/** Apply one backup record's intelligence to a matched track, honoring policies. */
async function applyRecordToTrack(
  db: Prisma.TransactionClient,
  trackId: string,
  record: BackupTrackRecord,
  policy: ConflictPolicy,
  categoryPolicies: CategoryPolicies | undefined,
  provenanceId: string,
  report: { audioFeaturesRestored: number; bpmRestored: number; popularityRestored: number; genresRestored: number; noDataRestored: number; existingPreserved: number; existingOverwritten: number },
): Promise<string[]> {
  const applied: string[] = [];
  const now = new Date();

  const track = await db.track.findUnique({
    where: { id: trackId },
    select: {
      id: true, effectiveBpm: true, bpm: true, genreStatus: true,
      popularityStatus: true, bpmAnalysisStatus: true,
      bpmRestoredFromBackupId: true, genreRestoredFromBackupId: true,
      audioFeature: { select: { id: true, effectiveEnergy: true, energy: true, audioFeatureStatus: true, restoredFromBackupId: true } },
      popularity: { select: { id: true, provider: true, score: true, restoredFromBackupId: true } },
      _count: { select: { tags: { where: { type: "genre" } } } },
    },
  });
  if (!track) return applied;

  // --- Audio features ---
  if (record.audio_feature) {
    const hasCurrent = !!track.audioFeature;
    const action = resolveConflictAction(hasCurrent, effectivePolicyForCategory("audio_features", policy, categoryPolicies));
    if (track.audioFeature?.restoredFromBackupId === provenanceId) {
      report.existingPreserved += 1;
    } else if (action === "apply") {
      const data = buildAudioFeatureWrite(record.audio_feature, provenanceId, now);
      await db.audioFeature.upsert({
        where: { trackId },
        create: { trackId, ...data },
        update: data,
      });
      report.audioFeaturesRestored += 1;
      if (hasCurrent) report.existingOverwritten += 1;
      applied.push("audio_features");
    } else if (hasCurrent) {
      report.existingPreserved += 1;
    }
  }

  // --- BPM (lives on Track) ---
  const trackData: Record<string, unknown> = {};
  if (record.bpm) {
    const hasValue = ["bpm", "apiBpm", "localBpm", "effectiveBpm"].some((k) => typeof record.bpm![k] === "number");
    const noData = record.bpm.bpmAnalysisStatus === "no_data" || record.bpm.bpmAnalysisStatus === "local_not_found";
    const hasCurrent = track.effectiveBpm !== null || track.bpm !== null || !!track.bpmAnalysisStatus;
    const action = resolveConflictAction(hasCurrent, effectivePolicyForCategory("bpm", policy, categoryPolicies));
    if (track.bpmRestoredFromBackupId === provenanceId) {
      report.existingPreserved += 1;
    } else if (action === "apply") {
      for (const field of ["bpm", "apiBpm", "localBpm", "effectiveBpm", "bpmConfidence"] as const) {
        if (field in record.bpm) trackData[field] = typeof record.bpm[field] === "number" ? record.bpm[field] : null;
      }
      for (const field of ["bpmSource", "bpmAnalysisScope", "bpmFailureReason"] as const) {
        if (field in record.bpm) trackData[field] = typeof record.bpm[field] === "string" ? record.bpm[field] : null;
      }
      if ("bpmAnalysisStatus" in record.bpm) trackData.bpmAnalysisStatus = safeRestoreStatus(record.bpm.bpmAnalysisStatus);
      if ("bpmAnalyzedAt" in record.bpm) {
        trackData.bpmAnalyzedAt = typeof record.bpm.bpmAnalyzedAt === "string" ? new Date(record.bpm.bpmAnalyzedAt) : null;
      }
      trackData.bpmRestoredFromBackupId = provenanceId;
      trackData.bpmRestoredAt = now;
      if (hasValue) {
        report.bpmRestored += 1;
        applied.push("bpm");
      } else {
        if (noData) report.noDataRestored += 1;
        applied.push(noData ? "bpm_no_data" : "bpm_state");
      }
    } else if (hasCurrent) {
      report.existingPreserved += 1;
    }
  }

  // --- Popularity ---
  if (record.popularity) {
    const hasScore = typeof record.popularity.score === "number" && record.popularity.provider && record.popularity.provider !== "not_found";
    const noData = record.popularity.popularityStatus === "no_data" || record.popularity.provider === "not_found";
    const hasCurrent = !!track.popularity || !!track.popularityStatus;
    const action = resolveConflictAction(hasCurrent, effectivePolicyForCategory("popularity", policy, categoryPolicies));
    if (track.popularity?.restoredFromBackupId === provenanceId) {
      report.existingPreserved += 1;
    } else if (action === "apply" && hasScore) {
      const data = {
        provider: String(record.popularity.provider).slice(0, 64),
        score: record.popularity.score as number,
        confidence: typeof record.popularity.confidence === "number" ? record.popularity.confidence : null,
        matchedArtist: typeof record.popularity.matchedArtist === "string" ? record.popularity.matchedArtist : null,
        matchedTitle: typeof record.popularity.matchedTitle === "string" ? record.popularity.matchedTitle : null,
        lastUpdated: typeof record.popularity.lastUpdated === "string" ? new Date(record.popularity.lastUpdated) : now,
        restoredFromBackupId: provenanceId,
        restoredAt: now,
      };
      await db.popularity.upsert({ where: { trackId }, create: { trackId, ...data }, update: data });
      report.popularityRestored += 1;
      if (hasCurrent) report.existingOverwritten += 1;
      applied.push("popularity");
    } else if (action === "apply") {
      if (track.popularity && policy === "prefer_backup") await db.popularity.delete({ where: { trackId } });
      if (noData) report.noDataRestored += 1;
      applied.push(noData ? "popularity_no_data" : "popularity_state");
    } else if (hasCurrent) {
      report.existingPreserved += 1;
    }
    if (action === "apply" && track.popularity?.restoredFromBackupId !== provenanceId) {
      if ("popularityStatus" in record.popularity) trackData.popularityStatus = safeRestoreStatus(record.popularity.popularityStatus);
      if ("popularityAttemptedAt" in record.popularity) {
        trackData.popularityAttemptedAt = typeof record.popularity.popularityAttemptedAt === "string" ? new Date(record.popularity.popularityAttemptedAt) : null;
      }
      if ("popularityFailureReason" in record.popularity) {
        trackData.popularityFailureReason = typeof record.popularity.popularityFailureReason === "string" ? record.popularity.popularityFailureReason : null;
      }
    }
  }

  // --- Genres (Tag relations) ---
  if (record.genres) {
    const hasCurrent = (track._count?.tags ?? 0) > 0 || !!track.genreStatus;
    const action = resolveConflictAction(hasCurrent, effectivePolicyForCategory("genres", policy, categoryPolicies));
    if (track.genreRestoredFromBackupId === provenanceId) {
      report.existingPreserved += 1;
    } else if (action === "apply") {
      await connectGenres(db, trackId, record.genres.names, policy === "prefer_backup");
      trackData.genreStatus = record.genres.status;
      trackData.genreRestoredFromBackupId = provenanceId;
      trackData.genreRestoredAt = now;
      trackData.genreAttemptedAt = record.genres.attempted_at ? new Date(record.genres.attempted_at) : null;
      trackData.genreFailureReason = record.genres.failure_reason;
      trackData.tagsSyncedAt = record.genres.synced_at ? new Date(record.genres.synced_at) : null;
      if (record.genres.names.length) {
        report.genresRestored += 1;
        if (hasCurrent) report.existingOverwritten += 1;
        applied.push("genres");
      } else {
        if (record.genres.no_data) report.noDataRestored += 1;
        applied.push(record.genres.no_data ? "genres_no_data" : "genres_state");
      }
    } else if (hasCurrent) {
      report.existingPreserved += 1;
    }
  }

  if (Object.keys(trackData).length) {
    await db.track.update({ where: { id: trackId }, data: trackData });
  }
  return applied;
}

function buildAudioFeatureWrite(feature: Record<string, string | number | null>, provenanceId: string, now: Date): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of AUDIO_FEATURE_NUMBER_FIELDS) {
    if (typeof feature[field] === "number" || feature[field] === null) data[field] = feature[field];
  }
  for (const field of AUDIO_FEATURE_STRING_FIELDS) {
    if (typeof feature[field] === "string" || feature[field] === null) data[field] = feature[field];
  }
  for (const field of AUDIO_FEATURE_TIMESTAMP_FIELDS) {
    if (typeof feature[field] === "string") data[field] = new Date(feature[field] as string);
    else if (feature[field] === null && field !== "lastUpdated") data[field] = null;
  }
  // Convert any transient status into a safe terminal state.
  if ("audioFeatureStatus" in feature) {
    data.audioFeatureStatus = typeof feature.audioFeatureStatus === "string"
      ? safeRestoreStatus(feature.audioFeatureStatus)
      : null;
  } else {
    data.audioFeatureStatus = "complete";
  }
  data.restoredFromBackupId = provenanceId;
  data.restoredAt = now;
  return data;
}

async function connectGenres(db: Prisma.TransactionClient, trackId: string, names: string[], replace: boolean): Promise<void> {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))).slice(0, 128);
  if (replace) {
    const existing = await db.tag.findMany({
      where: { type: "genre", tracks: { some: { id: trackId } } },
      select: { id: true },
    });
    if (existing.length) {
      await db.track.update({ where: { id: trackId }, data: { tags: { disconnect: existing.map(({ id }) => ({ id })) } } });
    }
  }
  if (!unique.length) return;
  const tagIds: string[] = [];
  for (const name of unique) {
    const tag = await db.tag.upsert({
      where: { type_name: { type: "genre", name } },
      create: { type: "genre", name },
      update: {},
      select: { id: true },
    });
    tagIds.push(tag.id);
  }
  await db.track.update({ where: { id: trackId }, data: { tags: { connect: tagIds.map((id) => ({ id })) } } });
}

// ---------------------------------------------------------------------------
// Cancel / retry / deferred
// ---------------------------------------------------------------------------

export async function requestCancel(restoreJobId: string): Promise<void> {
  await prisma.libraryRestoreJob.update({ where: { id: restoreJobId }, data: { cancelRequested: true } });
}

export async function markInterruptedRestores(userId: string): Promise<number> {
  const result = await prisma.libraryRestoreJob.updateMany({
    where: { userId, status: { in: ["matching", "restoring"] } },
    data: { status: "interrupted", phase: "interrupted" },
  });
  return result.count;
}

/** Re-attempt matching for restores that were waiting for a Plex library sync. */
export async function resumeDeferredRestores(userId: string): Promise<number> {
  const jobs = await prisma.libraryRestoreJob.findMany({
    where: { userId, status: "waiting_for_library_sync" },
    select: { id: true, conflictPolicy: true, categoryPolicyJson: true },
  });
  let applied = 0;
  const activeTracks = await prisma.track.count({ where: { syncStatus: "active", library: { server: { userId } } } });
  if (activeTracks === 0) return 0;
  for (const job of jobs) {
    const policy = (job.conflictPolicy as ConflictPolicy) || "fill_missing";
    const categoryPolicies = (job.categoryPolicyJson as CategoryPolicies) || undefined;
    await previewRestore(job.id, policy, categoryPolicies);
    await applyRestore(job.id, policy, categoryPolicies);
    applied += 1;
  }
  return applied;
}
