import { Prisma } from "@prisma/client";
import path from "path";
import prisma from "./prisma";
import {
  cleanupManagedDirectory,
  fileStorageDiagnostics,
  resolveStoragePaths,
  resolveStoragePolicy,
  type FileCleanupResult,
} from "./storage";

export type CleanupScope = "expired" | "cache" | "all_cache" | "temp" | "jobs" | "scans" | "ai" | "artwork";

export type StorageCleanupResult = {
  dryRun: boolean;
  scope: CleanupScope;
  startedAt: string;
  completedAt: string;
  filesRemoved: number;
  databaseRecordsRemoved: number;
  bytesReclaimed: number;
  skippedActiveFiles: number;
  skippedSymlinks: number;
  errors: string[];
  details: Record<string, number>;
};

function cutoff(days: number, now: Date) {
  return new Date(now.getTime() - days * 86_400_000);
}

function mergeFileResult(target: StorageCleanupResult, name: string, result: FileCleanupResult) {
  target.filesRemoved += result.filesRemoved;
  target.bytesReclaimed += result.bytesReclaimed;
  target.skippedActiveFiles += result.skippedActive;
  target.skippedSymlinks += result.skippedSymlinks;
  target.errors.push(...result.errors);
  target.details[`${name}Files`] = result.filesRemoved;
  target.details[`${name}Bytes`] = result.bytesReclaimed;
}

async function candidateIds(model: { findMany(args: any): Promise<Array<{ id: string }>> }, where: any, take: number, orderField = "createdAt") {
  return (await model.findMany({ where, select: { id: true }, orderBy: { [orderField]: "asc" }, take })).map((row) => row.id);
}

async function deleteCandidates(model: { deleteMany(args: any): Promise<{ count: number }> }, ids: string[], dryRun: boolean) {
  return dryRun || !ids.length ? ids.length : (await model.deleteMany({ where: { id: { in: ids } } })).count;
}

export async function runStorageCleanup(input: { scope?: CleanupScope; dryRun?: boolean; actorId?: string; now?: Date; batchSize?: number } = {}): Promise<StorageCleanupResult> {
  const scope = input.scope || "expired";
  const dryRun = input.dryRun === true;
  const now = input.now || new Date();
  const batchSize = Math.max(1, Math.min(5000, input.batchSize || 1000));
  const paths = resolveStoragePaths();
  const policy = resolveStoragePolicy();
  const result: StorageCleanupResult = {
    dryRun, scope, startedAt: now.toISOString(), completedAt: now.toISOString(), filesRemoved: 0,
    databaseRecordsRemoved: 0, bytesReclaimed: 0, skippedActiveFiles: 0, skippedSymlinks: 0, errors: [], details: {},
  };

  if (["expired", "temp"].includes(scope)) {
    mergeFileResult(result, "temporary", await cleanupManagedDirectory({ root: paths.temp, olderThanMs: policy.tempRetentionHours * 3_600_000, dryRun, now: now.getTime() }));
  }
  if (["expired", "cache", "all_cache"].includes(scope)) {
    mergeFileResult(result, "cache", await cleanupManagedDirectory({
      root: paths.cache,
      olderThanMs: scope === "all_cache" ? 0 : policy.cacheRetentionDays * 86_400_000,
      maximumBytes: policy.cacheLimit.mode === "limited" ? policy.cacheLimit.bytes : null,
      dryRun,
      now: now.getTime(),
    }));
  }
  if (scope === "artwork") {
    const [recipes, groups] = await Promise.all([
      prisma.playlistRecipe.findMany({ where: { artworkUrl: { not: null } }, select: { artworkUrl: true } }),
      prisma.playlistGroup.findMany({ where: { artworkUrl: { not: null } }, select: { artworkUrl: true } }),
    ]);
    const prefix = "/api/storage/artwork/";
    const referenced = new Set([...recipes, ...groups].flatMap((row) => {
      if (!row.artworkUrl?.startsWith(prefix)) return [];
      return [path.resolve(paths.artwork, ...row.artworkUrl.slice(prefix.length).split("/").map((part) => decodeURIComponent(part)))];
    }));
    mergeFileResult(result, "orphanedArtwork", await cleanupManagedDirectory({ root: paths.artwork, dryRun, select: (file) => !referenced.has(file.path) }));
  }

  if (["expired", "jobs"].includes(scope)) {
    const ids = await candidateIds(prisma.jobHistory, { startedAt: { lt: cutoff(policy.jobRetentionDays, now) }, status: { notIn: ["queued", "running", "waiting"] } }, batchSize, "startedAt");
    const count = await deleteCandidates(prisma.jobHistory, ids, dryRun);
    result.databaseRecordsRemoved += count; result.details.jobHistory = count;
  }
  if (["expired", "scans"].includes(scope)) {
    const ids = await candidateIds(prisma.syncLog, { startedAt: { lt: cutoff(policy.scanHistoryRetentionDays, now) }, status: { not: "in_progress" } }, batchSize, "startedAt");
    const count = await deleteCandidates(prisma.syncLog, ids, dryRun);
    result.databaseRecordsRemoved += count; result.details.scanHistory = count;
    // The staging table is introduced by the v2.4.15 migration. Raw SQL keeps
    // startup compatible while an existing installation is still migrating.
    try {
      const stale = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT count(*)::bigint AS count FROM "PlexScanSeenTrack" WHERE "createdAt" < ${new Date(now.getTime() - policy.tempRetentionHours * 3_600_000)} LIMIT ${batchSize}
      `);
      const staged = Math.min(batchSize, Number(stale[0]?.count || 0));
      if (!dryRun && staged > 0) await prisma.$executeRaw(Prisma.sql`DELETE FROM "PlexScanSeenTrack" WHERE ctid IN (SELECT ctid FROM "PlexScanSeenTrack" WHERE "createdAt" < ${new Date(now.getTime() - policy.tempRetentionHours * 3_600_000)} LIMIT ${batchSize})`);
      result.databaseRecordsRemoved += staged; result.details.scanCheckpoints = staged;
    } catch { /* Migration may not be installed yet. */ }
  }
  if (["expired", "ai"].includes(scope)) {
    const historyCutoff = cutoff(policy.aiHistoryRetentionDays, now);
    const ids = await candidateIds(prisma.aiRequestAudit, { createdAt: { lt: historyCutoff }, status: { notIn: ["QUEUED", "RUNNING", "STREAMING", "RETRIED"] } }, batchSize);
    const responseIds = await candidateIds(prisma.aiResponseRecord, { createdAt: { lt: historyCutoff } }, batchSize);
    const jobIds = await candidateIds(prisma.aiJob, { createdAt: { lt: historyCutoff }, status: { notIn: ["PENDING", "RUNNING", "RETRY_SCHEDULED", "WAITING"] } }, batchSize);
    const quarantineIds = await candidateIds(prisma.aiQuarantineRecord, { createdAt: { lt: historyCutoff }, status: { notIn: ["OPEN", "AWAITING_REVIEW"] } }, batchSize);
    const securityIds = await candidateIds(prisma.aiSecurityEvent, { createdAt: { lt: historyCutoff } }, batchSize);
    const approvalIds = await candidateIds(prisma.aiApprovalEvent, { createdAt: { lt: historyCutoff } }, batchSize);
    const trimmingIds = await candidateIds(prisma.aiContextTrimmingRecord, { createdAt: { lt: historyCutoff } }, batchSize);
    const alertIds = await candidateIds(prisma.aiAlertEvent, { createdAt: { lt: historyCutoff } }, batchSize);
    const recipeIds = await candidateIds(prisma.aiRecipeRequest, { createdAt: { lt: historyCutoff }, status: { notIn: ["PREPARING", "RUNNING", "AWAITING_REVIEW"] } }, batchSize);
    const requests = await deleteCandidates(prisma.aiRequestAudit, ids, dryRun);
    const responses = await deleteCandidates(prisma.aiResponseRecord, responseIds, dryRun);
    const jobs = await deleteCandidates(prisma.aiJob, jobIds, dryRun);
    const quarantines = await deleteCandidates(prisma.aiQuarantineRecord, quarantineIds, dryRun);
    const security = await deleteCandidates(prisma.aiSecurityEvent, securityIds, dryRun);
    const approvals = await deleteCandidates(prisma.aiApprovalEvent, approvalIds, dryRun);
    const trimming = await deleteCandidates(prisma.aiContextTrimmingRecord, trimmingIds, dryRun);
    const alerts = await deleteCandidates(prisma.aiAlertEvent, alertIds, dryRun);
    const recipes = await deleteCandidates(prisma.aiRecipeRequest, recipeIds, dryRun);
    const auditIds = await candidateIds(prisma.aiGovernanceAudit, { createdAt: { lt: cutoff(policy.aiHistoryRetentionDays, now) } }, batchSize);
    const governance = await deleteCandidates(prisma.aiGovernanceAudit, auditIds, dryRun);
    const secureIds = await candidateIds(prisma.aiSecureDebugPayload, { expiresAt: { lt: now } }, batchSize);
    const secure = await deleteCandidates(prisma.aiSecureDebugPayload, secureIds, dryRun);
    const reservations = dryRun
      ? await prisma.aiBudgetReservation.count({ where: { expiresAt: { lt: now }, status: { not: "ACTIVE" } } })
      : (await prisma.aiBudgetReservation.deleteMany({ where: { expiresAt: { lt: now }, status: { not: "ACTIVE" } } })).count;

    // Prompt-bearing and metadata-snapshot features predate the shared AI audit
    // models. They need the same bounded default rather than silently retaining
    // full prompts, responses, track context, and troubleshooting bundles.
    const naturalLanguageIds = await candidateIds(prisma.naturalLanguageRequest, { createdAt: { lt: historyCutoff }, status: { in: ["COMPLETED", "FAILED", "CANCELLED"] } }, batchSize);
    const naturalLanguageIntentIds = naturalLanguageIds.length
      ? await candidateIds(prisma.intentInterpretation, { naturalLanguageId: { in: naturalLanguageIds } }, batchSize)
      : [];
    const naturalLanguageIntents = await deleteCandidates(prisma.intentInterpretation, naturalLanguageIntentIds, dryRun);
    const naturalLanguage = await deleteCandidates(prisma.naturalLanguageRequest, naturalLanguageIds, dryRun);
    const summaryIds = await candidateIds(prisma.playlistAiSummary as any, { generatedAt: { lt: historyCutoff }, status: { notIn: ["QUEUED", "RUNNING", "GENERATING"] } }, batchSize, "generatedAt");
    const playlistSummaries = await deleteCandidates(prisma.playlistAiSummary, summaryIds, dryRun);
    const snapshotIds = await candidateIds(prisma.playlistAnalysisSnapshot, { createdAt: { lt: historyCutoff }, summaries: { none: {} } }, batchSize);
    const playlistSnapshots = await deleteCandidates(prisma.playlistAnalysisSnapshot, snapshotIds, dryRun);
    const explanationIds = await candidateIds(prisma.recommendationExplanation, { createdAt: { lt: historyCutoff } }, batchSize);
    const recommendationExplanations = await deleteCandidates(prisma.recommendationExplanation, explanationIds, dryRun);
    const metadataJobIds = await candidateIds(prisma.metadataAnalysisJob, { createdAt: { lt: historyCutoff }, status: { notIn: ["QUEUED", "RUNNING", "CANCELLING"] } }, batchSize);
    const metadataJobs = await deleteCandidates(prisma.metadataAnalysisJob, metadataJobIds, dryRun);
    const suggestionIds = await candidateIds(prisma.metadataSuggestion, { createdAt: { lt: historyCutoff }, status: { in: ["REJECTED", "ARCHIVED"] } }, batchSize);
    const metadataSuggestions = await deleteCandidates(prisma.metadataSuggestion, suggestionIds, dryRun);
    const metadataAuditIds = await candidateIds(prisma.metadataSuggestionAuditEvent, { createdAt: { lt: historyCutoff } }, batchSize);
    const metadataAudits = await deleteCandidates(prisma.metadataSuggestionAuditEvent, metadataAuditIds, dryRun);
    const metadataExportIds = await candidateIds(prisma.metadataSuggestionExport, { createdAt: { lt: historyCutoff } }, batchSize);
    const metadataExports = await deleteCandidates(prisma.metadataSuggestionExport, metadataExportIds, dryRun);
    const troubleshootingIds = await candidateIds(prisma.troubleshootingSession, { expiresAt: { lt: now } }, batchSize, "expiresAt");
    const troubleshootingSessions = await deleteCandidates(prisma.troubleshootingSession, troubleshootingIds, dryRun);
    const feedbackIds = await candidateIds(prisma.aiQualityFeedback, { createdAt: { lt: historyCutoff } }, batchSize);
    const qualityFeedback = await deleteCandidates(prisma.aiQualityFeedback, feedbackIds, dryRun);
    const privacyIds = await candidateIds(prisma.aiPrivacyAcknowledgment, { revokedAt: { lt: historyCutoff } }, batchSize, "revokedAt");
    const privacyAcknowledgments = await deleteCandidates(prisma.aiPrivacyAcknowledgment, privacyIds, dryRun);

    const extended = naturalLanguageIntents + naturalLanguage + playlistSummaries + playlistSnapshots + recommendationExplanations
      + metadataJobs + metadataSuggestions + metadataAudits + metadataExports + troubleshootingSessions + qualityFeedback + privacyAcknowledgments;
    result.databaseRecordsRemoved += requests + responses + jobs + quarantines + security + approvals + trimming + alerts + recipes + governance + secure + reservations + extended;
    Object.assign(result.details, {
      aiRequests: requests, aiResponses: responses, aiJobs: jobs, aiQuarantines: quarantines, aiSecurityEvents: security,
      aiApprovals: approvals, aiContextTrimming: trimming, aiAlerts: alerts, aiRecipeRequests: recipes,
      aiGovernanceAudits: governance, aiSecureDebugPayloads: secure, aiBudgetReservations: reservations,
      naturalLanguageIntents, naturalLanguageRequests: naturalLanguage, playlistAiSummaries: playlistSummaries,
      playlistAnalysisSnapshots: playlistSnapshots, recommendationExplanations, metadataAnalysisJobs: metadataJobs,
      metadataSuggestions, metadataSuggestionAudits: metadataAudits, metadataSuggestionExports: metadataExports,
      troubleshootingSessions, aiQualityFeedback: qualityFeedback, revokedPrivacyAcknowledgments: privacyAcknowledgments,
    });
  }

  result.completedAt = new Date().toISOString();
  if (!dryRun) {
    await prisma.systemState.upsert({
      where: { key: "storageCleanupLastResult" },
      create: { key: "storageCleanupLastResult", value: JSON.stringify(result) },
      update: { value: JSON.stringify(result) },
    }).catch(() => undefined);
  }
  return result;
}

async function relationSize(tableNames: string[]) {
  if (!tableNames.length) return 0;
  const rows = await prisma.$queryRawUnsafe<Array<{ bytes: bigint }>>(
    `SELECT COALESCE(sum(pg_total_relation_size(quote_ident(table_name)::regclass)), 0)::bigint AS bytes
       FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    tableNames,
  );
  return Number(rows[0]?.bytes || 0);
}

export async function getStorageDiagnostics() {
  const paths = resolveStoragePaths();
  const policy = resolveStoragePolicy();
  const files = await fileStorageDiagnostics(paths);
  const [database, wal, scanHistoryBytes, jobHistoryBytes, aiHistoryBytes, counts, cleanupState] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ bytes: bigint }>>("SELECT pg_database_size(current_database())::bigint AS bytes").catch(() => [{ bytes: BigInt(0) }]),
    prisma.$queryRawUnsafe<Array<{ bytes: bigint }>>("SELECT COALESCE(sum(size), 0)::bigint AS bytes FROM pg_ls_waldir()").catch(() => [{ bytes: BigInt(0) }]),
    relationSize(["SyncLog", "PlexScanSeenTrack"]),
    relationSize(["JobHistory", "LibraryBackupJob", "LibraryRestoreJob", "MetadataAnalysisJob", "PlaylistOrchestrationJob"]),
    relationSize(["AiRequestAudit", "AiResponseRecord", "AiProviderAttempt", "AiGovernanceAudit", "AiSecurityEvent", "AiSecureDebugPayload", "AiQuarantineRecord", "AiRecipeRequest", "AiRecipeProposal", "AiRecipeAuditEvent", "NaturalLanguageRequest", "NaturalLanguageRequestRevision", "NaturalLanguageRequestAudit", "IntentInterpretation", "PlaylistAnalysisSnapshot", "PlaylistAiSummary", "RecommendationExplanation", "RecommendationTrackEvaluation", "MetadataAnalysisJob", "MetadataSuggestion", "MetadataSuggestionTrack", "MetadataSuggestionSource", "MetadataSuggestionReview", "MetadataSuggestionAuditEvent", "TroubleshootingSession", "TroubleshootingFinding", "TroubleshootingSuggestion", "TroubleshootingAuditEvent"]),
    Promise.all([
      prisma.track.count(), prisma.syncLog.count(), prisma.jobHistory.count(),
      Promise.all([
        prisma.aiRequestAudit.count(), prisma.aiResponseRecord.count(), prisma.aiJob.count(), prisma.aiRecipeRequest.count(),
        prisma.naturalLanguageRequest.count(), prisma.playlistAnalysisSnapshot.count(), prisma.playlistAiSummary.count(),
        prisma.recommendationExplanation.count(), prisma.metadataSuggestion.count(), prisma.troubleshootingSession.count(),
      ]).then((values) => values.reduce((sum, value) => sum + value, 0)),
    ]),
    prisma.systemState.findUnique({ where: { key: "storageCleanupLastResult" }, select: { value: true } }).catch(() => null),
  ]);
  let lastCleanup: StorageCleanupResult | null = null;
  try { lastCleanup = cleanupState?.value ? JSON.parse(cleanupState.value) : null; } catch { lastCleanup = null; }
  const databaseBytes = Number(database[0]?.bytes || 0);
  const databaseWalBytes = Number(wal[0]?.bytes || 0);
  const totalManagedBytes = databaseBytes + files.cacheBytes + files.artworkBytes + files.temporaryBytes + files.backupBytes + files.exportBytes + files.logBytes + files.jobsBytes + files.scansBytes;
  return {
    databaseEngine: "postgresql",
    databaseBytes,
    databaseWalBytes,
    databaseShmBytes: 0,
    cacheBytes: files.cacheBytes,
    artworkBytes: files.artworkBytes,
    temporaryBytes: files.temporaryBytes,
    backupBytes: files.backupBytes,
    exportBytes: files.exportBytes,
    logBytes: files.logBytes,
    scanHistoryBytes,
    jobHistoryBytes,
    aiHistoryBytes,
    totalManagedBytes,
    filesystemTotalBytes: files.totalBytes,
    filesystemFreeBytes: files.freeBytes,
    filesystemUsedPercent: files.usedPercent,
    configuredPaths: paths,
    configuredLimits: policy,
    lastCleanupAt: lastCleanup?.completedAt || null,
    lastCleanupResult: lastCleanup,
    lastCleanupReclaimedBytes: lastCleanup?.bytesReclaimed || 0,
    unexpectedWritablePaths: files.unexpectedWritablePaths,
    records: { tracks: counts[0], scanHistory: counts[1], jobHistory: counts[2], aiHistory: counts[3] },
  };
}
