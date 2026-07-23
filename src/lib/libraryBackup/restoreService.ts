/**
 * Library Intelligence Backup — restore service.
 *
 * Handles upload → validate → stage → preview → apply, with conservative
 * matching, conflict policies, provenance, known-no-data preservation, idempotent
 * resumable batches, and deferred (staged) restore before a Plex library sync.
 * Never queues analysis work and never contacts an external service.
 */
import prisma from "../prisma";
import { APP_VERSION_NUMBER } from "../appVersion";
import {
  ANALYSIS_DATA_VERSION,
  BACKUP_SCHEMA_VERSION,
  BackupValidationError,
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
  isAutoApplicableMatch,
  type CategoryPolicies,
  type ConflictPolicy,
  type MatchIndexes,
  type MatchResult,
} from "./trackMatching";
import { validateArchive, parseTrackRecords } from "./restoreReader";
import { writeUpload } from "./backupStorage";
import { AUDIO_FEATURE_NUMBER_FIELDS, AUDIO_FEATURE_STRING_FIELDS, AUDIO_FEATURE_TIMESTAMP_FIELDS } from "./archiveFormat";

const APPLY_BATCH_SIZE = 200;
const INDEX_BATCH_SIZE = 1000;

/** Transient queue states that must never be restored as active work. */
const TRANSIENT_STATUSES = new Set(["queued", "running", "retrying", "worker_owned", "locked", "cancel_requested", "processing", "pending"]);

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
  waitingForLibrarySync: boolean;
};

export async function createRestoreJobFromUpload(
  userId: string,
  fileName: string,
  buffer: Buffer,
): Promise<CreatedRestoreJob> {
  const validated = validateArchive(buffer, BACKUP_SCHEMA_VERSION, ANALYSIS_DATA_VERSION);
  const parsed = parseTrackRecords(validated.tracksBuffer);

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
    waitingForLibrarySync,
  };
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
        mediaPath: true, duration: true, trackIndex: true, plexMetadata: true,
        title: true, artist: { select: { title: true } }, album: { select: { title: true } },
      },
      orderBy: { id: "asc" },
      take: INDEX_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      const disc = extractDisc(row.plexMetadata);
      indexTargetTrack(indexes, {
        id: row.id,
        plexGuid: row.plexGuid,
        plexGuids: Array.isArray(row.plexGuids) ? (row.plexGuids.filter((g) => typeof g === "string") as string[]) : null,
        plexId: row.plexId,
        ratingKey: row.ratingKey,
        pathHash: hashNormalizedPath(row.mediaPath),
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
        id: true, effectiveBpm: true, bpm: true,
        audioFeature: { select: { effectiveEnergy: true, energy: true, audioFeatureStatus: true } },
        popularity: { select: { provider: true, score: true } },
        _count: { select: { tags: { where: { type: "genre" } } } },
      },
    });
    for (const r of rows) {
      map.set(r.id, {
        audio: !!(r.audioFeature && (r.audioFeature.effectiveEnergy !== null || r.audioFeature.energy !== null || r.audioFeature.audioFeatureStatus === "complete")),
        bpm: r.effectiveBpm !== null || r.bpm !== null,
        popularity: !!(r.popularity && r.popularity.provider && typeof r.popularity.score === "number"),
        genres: (r._count?.tags ?? 0) > 0,
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
  compatibility: string;
  tracksInBackup: number;
  tracksInLibrary: number;
  matches: { exact: number; highConfidence: number; ambiguous: number; unmatched: number };
  categories: Record<string, { existing: number; wouldAdd: number; wouldOverwrite: number; skipped: number; noDataRestored: number }>;
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
    return { record, match: resolveMatch(record, indexes) };
  });
  const matchedIds = resolved.filter((r) => r.match.trackId).map((r) => r.match.trackId as string);
  const currentFlags = await fetchCurrentFlags(Array.from(new Set(matchedIds)));

  const matches = { exact: 0, highConfidence: 0, ambiguous: 0, unmatched: 0 };
  const categories: RestorePreview["categories"] = {
    audio_features: emptyCategory(), bpm: emptyCategory(), popularity: emptyCategory(), genres: emptyCategory(),
  };

  for (const { record, match } of resolved) {
    if (match.matchType === "ambiguous") matches.ambiguous += 1;
    else if (match.matchType === "unmatched") matches.unmatched += 1;
    else if (match.matchType === "exact_guid" || match.matchType === "exact_source_id" || match.matchType === "exact_rating_key") matches.exact += 1;
    else matches.highConfidence += 1;

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

  const preview: RestorePreview = {
    restoreJobId,
    compatibility: job.compatibility ?? "unknown",
    tracksInBackup: staged.length,
    tracksInLibrary,
    matches,
    categories,
    sample: resolved.slice(0, 25).map((r) => ({ title: r.record.title, artist: r.record.artist, matchType: r.match.matchType })),
    warnings: job.compatibility === "requires_migration" ? ["Backup analysis version is newer than this build; values are restored but review is recommended."] : [],
  };

  await prisma.libraryRestoreJob.update({
    where: { id: restoreJobId },
    data: {
      status: "preview_ready",
      phase: "preview_ready",
      conflictPolicy: policy,
      categoryPolicyJson: (categoryPolicies ?? {}) as object,
      previewJson: preview as unknown as object,
      matchedCount: matches.exact + matches.highConfidence,
      ambiguousCount: matches.ambiguous,
      unmatchedCount: matches.unmatched,
    },
  });

  return preview;
}

function emptyCategory() {
  return { existing: 0, wouldAdd: 0, wouldOverwrite: 0, skipped: 0, noDataRestored: 0 };
}

// ---------------------------------------------------------------------------
// Apply (idempotent, batched, resumable)
// ---------------------------------------------------------------------------

export type RestoreReport = {
  restoreJobId: string;
  archiveFileName: string;
  backupMixarrVersion: string | null;
  restoreDate: string;
  tracksInArchive: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
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
  durationMs: number;
};

export async function applyRestore(
  restoreJobId: string,
  policy: ConflictPolicy,
  categoryPolicies: CategoryPolicies | undefined,
): Promise<RestoreReport> {
  const startedAt = Date.now();
  const job = await prisma.libraryRestoreJob.findUnique({ where: { id: restoreJobId } });
  if (!job) throw new BackupValidationError("Restore job not found.");

  const provenanceId = restoreJobId;
  const report = {
    audioFeaturesRestored: 0, bpmRestored: 0, popularityRestored: 0, genresRestored: 0,
    noDataRestored: 0, existingPreserved: 0, existingOverwritten: 0,
    matched: 0, unmatched: 0, ambiguous: 0,
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
      restoreJobId, archiveFileName: job.archiveFileName, backupMixarrVersion: job.backupMixarrVersion,
      restoreDate: new Date().toISOString(), tracksInArchive: job.archiveTrackCount,
      matched: 0, unmatched: 0, ambiguous: 0,
      audioFeaturesRestored: 0, bpmRestored: 0, popularityRestored: 0, genresRestored: 0, noDataRestored: 0,
      existingPreserved: 0, existingOverwritten: 0, invalidSkipped: 0, olderVersionRestored: 0,
      warnings: ["No library tracks are available yet. Configure Plex and run a library sync, then apply this restore."],
      durationMs: Date.now() - startedAt,
    };
  }

  await prisma.libraryRestoreJob.update({ where: { id: restoreJobId }, data: { status: "restoring", phase: "restoring" } });

  // Only records not already applied — makes re-runs and resume idempotent.
  let processedBatches = job.lastBatchIndex;
  let cursorIndex = -1;
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
      where: { restoreJobId, matchStatus: { in: ["pending", "matched", "unmatched", "ambiguous"] }, recordIndex: { gt: cursorIndex } },
      orderBy: { recordIndex: "asc" },
      take: APPLY_BATCH_SIZE,
    });
    if (!batch.length) break;
    cursorIndex = batch[batch.length - 1].recordIndex;
    processedBatches += 1;

    for (const staged of batch) {
      const record = staged.recordJson as unknown as BackupTrackRecord;
      const match: MatchResult = resolveMatch(record, indexes);

      // Always persist how it matched.
      await prisma.libraryRestoreMatch.create({
        data: {
          restoreJobId, backupTrackId: record.id.slice(0, 128), matchedTrackId: match.trackId,
          matchType: match.matchType, confidence: match.confidence,
          candidatesJson: match.candidates.length ? (match.candidates.slice(0, 20) as object) : undefined,
        },
      });

      if (!match.trackId || !isAutoApplicableMatch(match.matchType)) {
        if (match.matchType === "ambiguous") report.ambiguous += 1; else report.unmatched += 1;
        await prisma.libraryRestoreStagedRecord.update({
          where: { id: staged.id },
          data: { matchStatus: match.matchType === "ambiguous" ? "ambiguous" : "unmatched", matchType: match.matchType, reason: match.matchType },
        });
        continue;
      }
      report.matched += 1;

      const applied = await applyRecordToTrack(match.trackId, record, policy, categoryPolicies, provenanceId, report);
      await prisma.libraryRestoreStagedRecord.update({
        where: { id: staged.id },
        data: { matchStatus: "applied", matchType: match.matchType, matchedTrackId: match.trackId, appliedBatch: processedBatches, reason: applied.join(",") || null },
      });
    }

    await prisma.libraryRestoreJob.update({
      where: { id: restoreJobId },
      data: { lastBatchIndex: processedBatches, appliedCount: { increment: 0 }, updatedAt: new Date() },
    });
  }

  const finalJob = await prisma.libraryRestoreJob.findUnique({ where: { id: restoreJobId }, select: { cancelRequested: true, compatibility: true } });
  const warnings: string[] = [];
  if (finalJob?.compatibility === "requires_migration") warnings.push("Some restored values came from a newer analysis version.");

  const restoreReport: RestoreReport = {
    restoreJobId,
    archiveFileName: job.archiveFileName,
    backupMixarrVersion: job.backupMixarrVersion,
    restoreDate: new Date().toISOString(),
    tracksInArchive: job.archiveTrackCount,
    matched: report.matched,
    unmatched: report.unmatched,
    ambiguous: report.ambiguous,
    audioFeaturesRestored: report.audioFeaturesRestored,
    bpmRestored: report.bpmRestored,
    popularityRestored: report.popularityRestored,
    genresRestored: report.genresRestored,
    noDataRestored: report.noDataRestored,
    existingPreserved: report.existingPreserved,
    existingOverwritten: report.existingOverwritten,
    invalidSkipped: 0,
    olderVersionRestored: finalJob?.compatibility === "compatible_older" ? report.matched : 0,
    warnings,
    durationMs: Date.now() - startedAt,
  };

  const canceled = finalJob?.cancelRequested;
  await prisma.libraryRestoreJob.update({
    where: { id: restoreJobId },
    data: {
      status: canceled ? "canceled" : warnings.length ? "completed_with_warnings" : "completed",
      phase: canceled ? "canceled" : "completed",
      reportJson: restoreReport as unknown as object,
      appliedCount: report.matched,
      matchedCount: report.matched,
      unmatchedCount: report.unmatched,
      ambiguousCount: report.ambiguous,
      finishedAt: new Date(),
    },
  });

  return restoreReport;
}

/** Apply one backup record's intelligence to a matched track, honoring policies. */
async function applyRecordToTrack(
  trackId: string,
  record: BackupTrackRecord,
  policy: ConflictPolicy,
  categoryPolicies: CategoryPolicies | undefined,
  provenanceId: string,
  report: { audioFeaturesRestored: number; bpmRestored: number; popularityRestored: number; genresRestored: number; noDataRestored: number; existingPreserved: number; existingOverwritten: number },
): Promise<string[]> {
  const applied: string[] = [];
  const now = new Date();

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: {
      id: true, effectiveBpm: true, bpm: true, genreStatus: true,
      audioFeature: { select: { id: true, effectiveEnergy: true, energy: true, audioFeatureStatus: true } },
      popularity: { select: { id: true, provider: true, score: true } },
      _count: { select: { tags: { where: { type: "genre" } } } },
    },
  });
  if (!track) return applied;

  // --- Audio features ---
  if (record.audio_feature) {
    const hasCurrent = !!(track.audioFeature && (track.audioFeature.effectiveEnergy !== null || track.audioFeature.energy !== null || track.audioFeature.audioFeatureStatus === "complete"));
    const action = resolveConflictAction(hasCurrent, effectivePolicyForCategory("audio_features", policy, categoryPolicies));
    if (action === "apply") {
      const data = buildAudioFeatureWrite(record.audio_feature, provenanceId, now);
      await prisma.audioFeature.upsert({
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
    const hasCurrent = track.effectiveBpm !== null || track.bpm !== null;
    const action = resolveConflictAction(hasCurrent, effectivePolicyForCategory("bpm", policy, categoryPolicies));
    if (action === "apply" && hasValue) {
      if (typeof record.bpm.bpm === "number") trackData.bpm = record.bpm.bpm;
      if (typeof record.bpm.apiBpm === "number") trackData.apiBpm = record.bpm.apiBpm;
      if (typeof record.bpm.localBpm === "number") trackData.localBpm = record.bpm.localBpm;
      if (typeof record.bpm.effectiveBpm === "number") trackData.effectiveBpm = record.bpm.effectiveBpm;
      if (typeof record.bpm.bpmConfidence === "number") trackData.bpmConfidence = record.bpm.bpmConfidence;
      if (typeof record.bpm.bpmSource === "string") trackData.bpmSource = record.bpm.bpmSource;
      trackData.bpmAnalysisStatus = safeRestoreStatus(record.bpm.bpmAnalysisStatus) ?? "complete";
      if (typeof record.bpm.bpmAnalyzedAt === "string") trackData.bpmAnalyzedAt = new Date(record.bpm.bpmAnalyzedAt);
      trackData.bpmRestoredFromBackupId = provenanceId;
      trackData.bpmRestoredAt = now;
      report.bpmRestored += 1;
      applied.push("bpm");
    } else if (action === "apply" && noData) {
      trackData.bpmAnalysisStatus = "no_data";
      trackData.bpmRestoredFromBackupId = provenanceId;
      trackData.bpmRestoredAt = now;
      report.noDataRestored += 1;
      applied.push("bpm_no_data");
    } else if (hasCurrent) {
      report.existingPreserved += 1;
    }
  }

  // --- Popularity ---
  if (record.popularity) {
    const hasScore = typeof record.popularity.score === "number" && record.popularity.provider && record.popularity.provider !== "not_found";
    const noData = record.popularity.popularityStatus === "no_data" || record.popularity.provider === "not_found";
    const hasCurrent = !!(track.popularity && track.popularity.provider && typeof track.popularity.score === "number");
    const action = resolveConflictAction(hasCurrent, effectivePolicyForCategory("popularity", policy, categoryPolicies));
    if (action === "apply" && hasScore) {
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
      await prisma.popularity.upsert({ where: { trackId }, create: { trackId, ...data }, update: data });
      trackData.popularityStatus = safeRestoreStatus(record.popularity.popularityStatus) ?? "success";
      if (typeof record.popularity.popularityAttemptedAt === "string") trackData.popularityAttemptedAt = new Date(record.popularity.popularityAttemptedAt);
      report.popularityRestored += 1;
      if (hasCurrent) report.existingOverwritten += 1;
      applied.push("popularity");
    } else if (action === "apply" && noData) {
      trackData.popularityStatus = "no_data";
      trackData.popularityAttemptedAt = typeof record.popularity.popularityAttemptedAt === "string" ? new Date(record.popularity.popularityAttemptedAt) : now;
      report.noDataRestored += 1;
      applied.push("popularity_no_data");
    } else if (hasCurrent) {
      report.existingPreserved += 1;
    }
  }

  // --- Genres (Tag relations) ---
  if (record.genres) {
    const hasCurrent = (track._count?.tags ?? 0) > 0;
    const action = resolveConflictAction(hasCurrent, effectivePolicyForCategory("genres", policy, categoryPolicies));
    if (action === "apply" && record.genres.names.length) {
      await connectGenres(trackId, record.genres.names);
      trackData.genreStatus = "success";
      trackData.genreRestoredFromBackupId = provenanceId;
      trackData.genreRestoredAt = now;
      if (record.genres.synced_at) trackData.tagsSyncedAt = new Date(record.genres.synced_at);
      report.genresRestored += 1;
      if (hasCurrent) report.existingOverwritten += 1;
      applied.push("genres");
    } else if (action === "apply" && record.genres.no_data) {
      trackData.genreStatus = "no_data";
      trackData.genreAttemptedAt = record.genres.attempted_at ? new Date(record.genres.attempted_at) : now;
      trackData.genreRestoredFromBackupId = provenanceId;
      trackData.genreRestoredAt = now;
      report.noDataRestored += 1;
      applied.push("genres_no_data");
    } else if (hasCurrent) {
      report.existingPreserved += 1;
    }
  }

  if (Object.keys(trackData).length) {
    await prisma.track.update({ where: { id: trackId }, data: trackData });
  }
  return applied;
}

function buildAudioFeatureWrite(feature: Record<string, string | number | null>, provenanceId: string, now: Date): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of AUDIO_FEATURE_NUMBER_FIELDS) {
    if (typeof feature[field] === "number") data[field] = feature[field];
  }
  for (const field of AUDIO_FEATURE_STRING_FIELDS) {
    if (typeof feature[field] === "string") data[field] = feature[field];
  }
  for (const field of AUDIO_FEATURE_TIMESTAMP_FIELDS) {
    if (typeof feature[field] === "string") data[field] = new Date(feature[field] as string);
  }
  // Convert any transient status into a safe terminal state.
  if (typeof data.audioFeatureStatus === "string") data.audioFeatureStatus = safeRestoreStatus(data.audioFeatureStatus as string) ?? "complete";
  else data.audioFeatureStatus = "complete";
  data.restoredFromBackupId = provenanceId;
  data.restoredAt = now;
  return data;
}

async function connectGenres(trackId: string, names: string[]): Promise<void> {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))).slice(0, 128);
  if (!unique.length) return;
  const tagIds: string[] = [];
  for (const name of unique) {
    const tag = await prisma.tag.upsert({
      where: { type_name: { type: "genre", name } },
      create: { type: "genre", name },
      update: {},
      select: { id: true },
    });
    tagIds.push(tag.id);
  }
  await prisma.track.update({ where: { id: trackId }, data: { tags: { connect: tagIds.map((id) => ({ id })) } } });
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
    await applyRestore(job.id, (job.conflictPolicy as ConflictPolicy) || "fill_missing", (job.categoryPolicyJson as CategoryPolicies) || undefined);
    applied += 1;
  }
  return applied;
}
