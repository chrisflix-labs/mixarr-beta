import { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { validateBackupManifest } from "./dashboardCore";
import { recoverStaleOrchestrationJobs, retryOrchestrationJob } from "./service";
import { getOrchestrationSettings } from "./settings";

export async function validateOrchestrationBackup(userId: string, input: unknown, sourceName?: string) {
  const result = validateBackupManifest(input);
  const row = await prisma.orchestrationBackupValidation.create({ data: {
    userId, sourceName: sourceName?.slice(0, 255), status: result.status, backupSchemaVersion: result.schemaVersion,
    restoreCompatible: result.restoreCompatible, estimatedRestoreScope: result.estimatedRestoreScope,
    missingSectionsJson: result.missingSections as Prisma.InputJsonValue, corruptSectionsJson: result.corruptSections as Prisma.InputJsonValue,
    warningsJson: result.warnings as Prisma.InputJsonValue, errorsJson: result.errors as Prisma.InputJsonValue,
  } });
  await prisma.playlistOrchestrationAuditEvent.create({ data: { userId, eventType: "BACKUP_VALIDATED", actorType: "USER", actorId: userId, operationType: "BACKUP_VALIDATION", outcome: result.status, severity: result.restoreCompatible ? "INFO" : "WARNING", message: result.restoreCompatible ? "Orchestration backup validation completed successfully." : "Orchestration backup validation found missing or invalid sections.", metadataJson: { validationId: row.id, missingSections: result.missingSections, corruptSections: result.corruptSections } } });
  console.info(`[OrchestrationBackup] Completed status=${result.status} missing=${result.missingSections.length} corrupt=${result.corruptSections.length}`);
  return row;
}

export async function getLastBackupValidation(userId: string) {
  return prisma.orchestrationBackupValidation.findFirst({ where: { userId }, orderBy: { validatedAt: "desc" } });
}

export async function runV22MigrationChecks(userId: string) {
  const checks: Array<{ key: string; status: "PASS" | "WARNING" | "CRITICAL"; message: string; action?: string }> = [];
  const requiredTables = ["ManagedPlaylist", "PlaylistGroup", "PlaylistOverlapSnapshot", "LibraryCoverageSnapshot", "SmartExperiment", "SmartAction", "PlaylistHealthSnapshot", "OrchestrationPreference", "OrchestrationTrendSnapshot", "OrchestrationBackupValidation"];
  const tableRows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT c.relname AS name FROM pg_class c WHERE c.relkind = 'r' AND c.relname IN (${Prisma.join(requiredTables)})`;
  const tableSet = new Set(tableRows.map((row) => row.name));
  const missingTables = requiredTables.filter((name) => !tableSet.has(name));
  checks.push({ key: "required_tables", status: missingTables.length ? "CRITICAL" : "PASS", message: missingTables.length ? `Missing orchestration tables: ${missingTables.join(", ")}.` : "All v2.2.x orchestration tables are available.", action: missingTables.length ? "Run the documented Prisma migrations before enabling orchestration." : undefined });
  if (!missingTables.length) {
    const [managed, invalidManaged, duplicateJobs, danglingVariants, actionStatuses, healthCount, versions] = await Promise.all([
      prisma.managedPlaylist.count({ where: { userId } }),
      prisma.managedPlaylist.count({ where: { userId, OR: [{ library: { server: { userId: { not: userId } } } }, { generatedPlaylist: { is: { userId: { not: userId } } } }] } }),
      prisma.playlistOrchestrationJob.groupBy({ by: ["idempotencyKey"], where: { userId, status: { in: ["QUEUED", "WAITING", "BLOCKED", "RUNNING"] } }, having: { idempotencyKey: { _count: { gt: 1 } } }, _count: { _all: true } }),
      prisma.smartExperimentVariant.count({ where: { experiment: { userId }, generatedPlaylistId: { not: null }, generatedPlaylist: null } }),
      prisma.smartAction.groupBy({ by: ["status"], where: { userId }, _count: { _all: true } }),
      prisma.playlistHealthSnapshot.count({ where: { userId } }),
      prisma.playlistRevision.count({ where: { generatedPlaylist: { userId } } }),
    ]);
    checks.push({ key: "managed_links", status: invalidManaged ? "CRITICAL" : "PASS", message: invalidManaged ? `${invalidManaged} managed playlist link(s) are invalid.` : `${managed} managed playlist enrollment(s) retain valid ownership links.`, action: invalidManaged ? "Review affected enrollments before running automation." : undefined });
    checks.push({ key: "duplicate_jobs", status: duplicateJobs.length ? "WARNING" : "PASS", message: duplicateJobs.length ? `${duplicateJobs.length} duplicate active job key(s) require cleanup.` : "No duplicate active orchestration jobs were found.", action: duplicateJobs.length ? "Use Queue cleanup to cancel duplicates while preserving audit records." : undefined });
    checks.push({ key: "experiment_variants", status: danglingVariants ? "WARNING" : "PASS", message: danglingVariants ? `${danglingVariants} experiment variant playlist reference(s) are unavailable.` : "Experiment variant references are readable." });
    checks.push({ key: "history", status: healthCount || versions ? "PASS" : "WARNING", message: `${healthCount} health snapshot(s) and ${versions} restorable playlist version(s) remain readable.` });
    checks.push({ key: "smart_actions", status: "PASS", message: `Smart Action statuses are readable (${actionStatuses.map((row) => `${row.status}: ${row._count._all}`).join(", ") || "no actions"}).` });
  }
  const indexNames = ["PlaylistOrchestrationJob_userId_status_scheduledFor_idx", "SmartAction_userId_status_priority_createdAt_idx", "SmartExperiment_userId_status_completedAt_idx", "OrchestrationTrendSnapshot_userId_capturedAt_idx"];
  const indexRows = await prisma.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname IN (${Prisma.join(indexNames)})`;
  const missingIndexes = indexNames.filter((name) => !indexRows.some((row) => row.indexname === name));
  checks.push({ key: "dashboard_indexes", status: missingIndexes.length ? "WARNING" : "PASS", message: missingIndexes.length ? `Missing dashboard indexes: ${missingIndexes.join(", ")}.` : "v2.2.9 dashboard indexes are present.", action: missingIndexes.length ? "Apply the v2.2.9 migration; the application can continue in the meantime." : undefined });
  const critical = checks.filter((check) => check.status === "CRITICAL").length;
  const warnings = checks.filter((check) => check.status === "WARNING").length;
  console.info(`[OrchestrationMigration] Completed critical=${critical} warnings=${warnings}`);
  return { status: critical ? "CRITICAL" : warnings ? "WARNING" : "READY", checkedAt: new Date(), critical, warnings, checks };
}

export async function getJobCleanupPreview(userId: string) {
  const settings = await getOrchestrationSettings();
  const staleBefore = new Date(Date.now() - settings.staleJobTimeoutMinutes * 60_000);
  const [completed, failed, queued, stale, interrupted] = await Promise.all([
    prisma.playlistOrchestrationJob.count({ where: { userId, status: { in: ["SUCCEEDED", "CANCELLED", "SKIPPED"] } } }),
    prisma.playlistOrchestrationJob.count({ where: { userId, status: "FAILED" } }),
    prisma.playlistOrchestrationJob.count({ where: { userId, status: { in: ["QUEUED", "WAITING", "BLOCKED"] } } }),
    prisma.playlistOrchestrationJob.count({ where: { userId, status: "STALE" } }),
    prisma.playlistOrchestrationJob.count({ where: { userId, status: "RUNNING", OR: [{ heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null, startedAt: { lt: staleBefore } }] } }),
  ]);
  return { counts: { completed, failed, queued, stale, interrupted }, retention: { jobHistoryDays: settings.jobHistoryRetentionDays, auditDays: settings.auditRetentionDays }, auditPreserved: true };
}

export async function maintainOrchestrationJobs(userId: string, action: "clear_completed" | "clear_failed" | "retry_failed" | "cancel_queued" | "remove_stale" | "requeue_interrupted") {
  if (action === "requeue_interrupted") return { action, ...(await recoverStaleOrchestrationJobs()) };
  if (action === "retry_failed") {
    const rows = await prisma.playlistOrchestrationJob.findMany({ where: { userId, status: "FAILED", managedPlaylistId: { not: null } }, orderBy: { failedAt: "desc" }, take: 100, select: { id: true } });
    let retried = 0; const errors: string[] = [];
    for (const row of rows) { try { await retryOrchestrationJob(userId, row.id, userId); retried += 1; } catch (error) { errors.push(error instanceof Error ? error.message : "Retry failed"); } }
    return { action, affected: retried, errors: errors.slice(0, 10), limited: rows.length === 100 };
  }
  const statuses = action === "clear_completed" ? ["SUCCEEDED", "CANCELLED", "SKIPPED"] : action === "clear_failed" ? ["FAILED"] : action === "remove_stale" ? ["STALE"] : ["QUEUED", "WAITING", "BLOCKED"];
  if (action === "cancel_queued") {
    const result = await prisma.playlistOrchestrationJob.updateMany({ where: { userId, status: { in: statuses as any } }, data: { status: "CANCELLED", cancelledAt: new Date(), waitingReason: null } });
    await prisma.playlistOrchestrationAuditEvent.create({ data: { userId, eventType: "JOB_QUEUE_MAINTENANCE", actorType: "USER", actorId: userId, operationType: "JOB_CLEANUP", outcome: "SUCCESS", message: `${result.count} queued orchestration job(s) were cancelled. Audit history was preserved.` } });
    return { action, affected: result.count, auditPreserved: true };
  }
  const rows = await prisma.playlistOrchestrationJob.findMany({ where: { userId, status: { in: statuses as any } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 1_000 });
  const result = await prisma.playlistOrchestrationJob.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
  await prisma.playlistOrchestrationAuditEvent.create({ data: { userId, eventType: "JOB_QUEUE_MAINTENANCE", actorType: "USER", actorId: userId, operationType: "JOB_CLEANUP", outcome: "SUCCESS", message: `${result.count} ${action.replaceAll("_", " ")} job record(s) were removed. Audit history was preserved.` } });
  return { action, affected: result.count, auditPreserved: true, limited: rows.length === 1_000 };
}

export async function getOrchestrationActivity(userId: string, input: { page: number; pageSize: number; eventType?: string; playlistId?: string; groupId?: string; jobId?: string; smartActionId?: string; experimentId?: string; actorType?: string; actorId?: string; severity?: string; outcome?: string; operationType?: string; search?: string; from?: Date; to?: Date }) {
  const where: Prisma.PlaylistOrchestrationAuditEventWhereInput = { userId,
    ...(input.eventType ? { eventType: input.eventType } : {}), ...(input.playlistId ? { managedPlaylistId: input.playlistId } : {}), ...(input.groupId ? { playlistGroupId: input.groupId } : {}), ...(input.jobId ? { jobId: input.jobId } : {}), ...(input.smartActionId ? { smartActionId: input.smartActionId } : {}), ...(input.experimentId ? { experimentId: input.experimentId } : {}), ...(input.actorType ? { actorType: input.actorType } : {}), ...(input.actorId ? { actorId: input.actorId } : {}), ...(input.severity ? { severity: input.severity } : {}), ...(input.outcome ? { outcome: input.outcome } : {}), ...(input.operationType ? { operationType: input.operationType } : {}), ...(input.search ? { message: { contains: input.search, mode: "insensitive" } } : {}), ...((input.from || input.to) ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.playlistOrchestrationAuditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, include: { managedPlaylist: { select: { id: true, displayName: true, generatedPlaylistId: true } }, job: { select: { id: true, jobType: true, status: true } } } }),
    prisma.playlistOrchestrationAuditEvent.count({ where }),
  ]);
  return { items: items.map((item) => ({ ...item, restoreAvailable: item.eventType.includes("APPLIED") && Boolean(item.metadataJson && typeof item.metadataJson === "object" && "playlistRevisionId" in item.metadataJson) })), pagination: { page: input.page, pageSize: input.pageSize, total, pages: Math.ceil(total / input.pageSize) } };
}

export async function getOrchestrationActivityEvent(userId: string, id: string) {
  const event = await prisma.playlistOrchestrationAuditEvent.findFirst({
    where: { id, userId },
    include: {
      managedPlaylist: { select: { id: true, displayName: true, generatedPlaylistId: true, orchestrationMode: true, automationState: true } },
      job: { select: { id: true, jobType: true, status: true, trigger: true, dryRun: true, scheduledFor: true, completedAt: true, failedAt: true, errorCode: true, errorMessage: true } },
    },
  });
  if (!event) return null;
  const [group, smartAction, experiment] = await Promise.all([
    event.playlistGroupId ? prisma.playlistGroup.findFirst({ where: { id: event.playlistGroupId, userId }, select: { id: true, name: true, isPaused: true } }) : null,
    event.smartActionId ? prisma.smartAction.findFirst({ where: { id: event.smartActionId, userId }, select: { id: true, title: true, status: true, actionType: true, riskLevel: true } }) : null,
    event.experimentId ? prisma.smartExperiment.findFirst({ where: { id: event.experimentId, userId }, select: { id: true, name: true, status: true, suggestedWinner: true } }) : null,
  ]);
  return { ...event, group, smartAction, experiment };
}
