import { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { getWorkerIdentity } from "../workerHealth";
import {
  assertAutomationStateTransition,
  findDependencyCycle,
  OrchestrationDomainError,
  orchestrationConflictKeys,
  orchestrationIdempotencyKey,
  sortEligibleJobs,
  topologicalPlaylistOrder,
  type AutomationStateValue,
  type DependencyEdge,
  type PlaylistPriorityValue,
} from "./core";
import { getOrchestrationSettings } from "./settings";

const ACTIVE_STATUSES = ["QUEUED", "WAITING", "BLOCKED", "RUNNING"] as const;
const DEPENDENCY_TYPES = ["DEPENDS_ON", "RUNS_AFTER"] as const;

function json(value: unknown): Prisma.InputJsonValue | undefined {
  return value == null ? undefined : value as Prisma.InputJsonValue;
}

function safeMetadata(value: unknown): Prisma.InputJsonValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const blocked = /(token|secret|password|credential|authorization)/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !blocked.test(key)).slice(0, 40)) as Prisma.InputJsonValue;
}

export async function auditOrchestration(input: {
  userId?: string | null; managedPlaylistId?: string | null; jobId?: string | null; eventType: string;
  severity?: string; actorType?: string; actorId?: string | null; message: string; metadata?: unknown;
}) {
  return prisma.playlistOrchestrationAuditEvent.create({ data: {
    userId: input.userId || null, managedPlaylistId: input.managedPlaylistId || null, jobId: input.jobId || null,
    eventType: input.eventType, severity: input.severity || "INFO", actorType: input.actorType || "SYSTEM",
    actorId: input.actorId || null, message: input.message.slice(0, 2_000), metadataJson: safeMetadata(input.metadata),
  } });
}

async function ownedLibrary(userId: string, libraryId: string) {
  const library = await prisma.library.findFirst({ where: { id: libraryId, server: { userId } }, select: { id: true } });
  if (!library) throw new OrchestrationDomainError("INVALID_LIBRARY", "The selected library is unavailable or does not belong to this user.", { libraryId });
  return library;
}

export async function registerManagedPlaylist(input: {
  userId: string; libraryId: string; playlistId?: string; generatedPlaylistId?: string; displayName?: string;
  automationEnabled?: boolean; priority?: PlaylistPriorityValue; actorId?: string;
}) {
  await ownedLibrary(input.userId, input.libraryId);
  const generated = input.generatedPlaylistId ? await prisma.generatedPlaylist.findFirst({
    where: { id: input.generatedPlaylistId, userId: input.userId }, include: { identity: { select: { id: true } } },
  }) : null;
  if (input.generatedPlaylistId && !generated) throw new OrchestrationDomainError("PLAYLIST_NOT_FOUND", "The generated playlist was not found.");
  const playlistId = input.playlistId || generated?.plexPlaylistRatingKey;
  if (!playlistId) throw new OrchestrationDomainError("PLAYLIST_ID_REQUIRED", "A Plex playlist id is required.");
  const displayName = (input.displayName || generated?.plexPlaylistTitle || "Managed playlist").trim();
  const settings = await getOrchestrationSettings();
  const automationEnabled = input.automationEnabled ?? settings.autoEnableRegisteredPlaylists;
  const historical = await prisma.managedPlaylist.findUnique({ where: { userId_playlistId: { userId: input.userId, playlistId } } });
  if (historical?.enabled) throw new OrchestrationDomainError("PLAYLIST_ALREADY_MANAGED", `${displayName} is already registered for orchestration.`, { playlistId });
  if (historical) {
    const row = await prisma.managedPlaylist.update({ where: { id: historical.id }, data: { libraryId: input.libraryId, generatedPlaylistId: generated?.id, playlistIdentityId: generated?.identity?.id, displayName, enabled: true, automationEnabled, automationState: automationEnabled ? "ACTIVE" : "DISABLED", automationStateReason: null, priority: input.priority || settings.defaultPriority, plexAvailable: true, unregisteredAt: null } });
    await auditOrchestration({ userId: input.userId, managedPlaylistId: row.id, eventType: "PLAYLIST_REGISTERED", actorType: input.actorId ? "USER" : "SYSTEM", actorId: input.actorId, message: `${displayName} was re-registered for playlist orchestration.`, metadata: { playlistId, generatedPlaylistId: generated?.id } });
    return row;
  }
  try {
    const row = await prisma.managedPlaylist.create({ data: {
      userId: input.userId, libraryId: input.libraryId, playlistId, generatedPlaylistId: generated?.id,
      playlistIdentityId: generated?.identity?.id, displayName, automationEnabled,
      automationState: automationEnabled ? "ACTIVE" : "DISABLED", priority: input.priority || settings.defaultPriority,
    } });
    await auditOrchestration({ userId: input.userId, managedPlaylistId: row.id, eventType: "PLAYLIST_REGISTERED", actorType: input.actorId ? "USER" : "SYSTEM", actorId: input.actorId, message: `${displayName} was registered for playlist orchestration.`, metadata: { playlistId, generatedPlaylistId: generated?.id } });
    return row;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new OrchestrationDomainError("PLAYLIST_ALREADY_MANAGED", `${displayName} is already registered for orchestration.`, { playlistId });
    }
    throw error;
  }
}

export async function unregisterManagedPlaylist(userId: string, id: string, actorId?: string) {
  const playlist = await prisma.managedPlaylist.findFirst({ where: { id, userId } });
  if (!playlist) throw new OrchestrationDomainError("MANAGED_PLAYLIST_NOT_FOUND", "Managed playlist not found.");
  const active = await prisma.playlistOrchestrationJob.count({ where: { managedPlaylistId: id, status: { in: ["QUEUED", "WAITING", "BLOCKED", "RUNNING"] } } });
  if (active) throw new OrchestrationDomainError("PLAYLIST_HAS_ACTIVE_JOBS", "Cancel or finish active orchestration jobs before unregistering this playlist.", { activeJobs: active });
  const relationshipCount = await prisma.managedPlaylistRelationship.count({ where: { OR: [{ sourceManagedPlaylistId: id }, { targetManagedPlaylistId: id }] } });
  if (relationshipCount) throw new OrchestrationDomainError("PLAYLIST_HAS_RELATIONSHIPS", "Remove playlist relationships before unregistering this playlist.", { relationshipCount });
  const updated = await prisma.managedPlaylist.update({ where: { id }, data: { enabled: false, automationEnabled: false, automationState: "DISABLED", automationStateReason: "Unregistered from orchestration", unregisteredAt: new Date(), currentJobId: null } });
  await auditOrchestration({ userId, managedPlaylistId: id, eventType: "PLAYLIST_UNREGISTERED", actorType: "USER", actorId, message: `${playlist.displayName} was removed from orchestration. The Plex playlist was not deleted.` });
  return updated;
}

export async function updateManagedPlaylist(userId: string, id: string, patch: { automationEnabled?: boolean; enabled?: boolean; priority?: PlaylistPriorityValue; state?: AutomationStateValue; reason?: string | null; orchestrationMode?: "COORDINATED" | "OBSERVE_ONLY" | "DRY_RUN_ONLY" }, actorId?: string) {
  const current = await prisma.managedPlaylist.findFirst({ where: { id, userId } });
  if (!current) throw new OrchestrationDomainError("MANAGED_PLAYLIST_NOT_FOUND", "Managed playlist not found.");
  const desired = patch.state || (patch.automationEnabled === false ? "DISABLED" : patch.automationEnabled === true && current.automationState === "DISABLED" ? "ACTIVE" : undefined);
  if (desired) assertAutomationStateTransition(current.automationState, desired);
  if (desired === "RUNNING") throw new OrchestrationDomainError("ADMIN_OVERRIDE_REQUIRED", "Runtime RUNNING state can only be set by the orchestration worker.");
  const updated = await prisma.managedPlaylist.update({ where: { id }, data: {
    enabled: patch.enabled, automationEnabled: patch.automationEnabled, priority: patch.priority,
    orchestrationMode: patch.orchestrationMode, automationState: desired, automationStateReason: desired && ["ACTIVE", "RUNNING"].includes(desired) ? null : patch.reason,
  } });
  const eventType = patch.priority && patch.priority !== current.priority ? "PRIORITY_CHANGED" : patch.automationEnabled === true ? "AUTOMATION_ENABLED" : patch.automationEnabled === false ? "AUTOMATION_DISABLED" : desired === "PAUSED" ? "AUTOMATION_PAUSED" : desired === "ACTIVE" ? "AUTOMATION_RESUMED" : "PLAYLIST_UPDATED";
  await auditOrchestration({ userId, managedPlaylistId: id, eventType, actorType: "USER", actorId, message: `${current.displayName} orchestration settings were updated.`, metadata: patch });
  return updated;
}

async function relationshipEdgesForUser(userId: string, pending?: DependencyEdge) {
  const rows = await prisma.managedPlaylistRelationship.findMany({ where: { sourceManagedPlaylist: { userId }, enabled: true }, select: { sourceManagedPlaylistId: true, targetManagedPlaylistId: true, relationshipType: true, enabled: true } });
  const edges = rows.map((row) => ({ sourceId: row.sourceManagedPlaylistId, targetId: row.targetManagedPlaylistId, type: row.relationshipType, enabled: row.enabled })) as DependencyEdge[];
  if (pending) edges.push(pending);
  return edges;
}

export async function createManagedPlaylistRelationship(input: { userId: string; sourceManagedPlaylistId: string; targetManagedPlaylistId: string; relationshipType: "DEPENDS_ON" | "RUNS_AFTER" | "RELATED"; priority?: number; metadata?: unknown; actorId?: string }) {
  if (input.sourceManagedPlaylistId === input.targetManagedPlaylistId) throw new OrchestrationDomainError("SELF_RELATIONSHIP", "A playlist cannot relate to itself.");
  const playlists = await prisma.managedPlaylist.findMany({ where: { id: { in: [input.sourceManagedPlaylistId, input.targetManagedPlaylistId] }, userId: input.userId, enabled: true }, select: { id: true, userId: true, libraryId: true, displayName: true } });
  if (playlists.length !== 2) throw new OrchestrationDomainError("INVALID_PLAYLIST_REFERENCE", "Both managed playlists must exist and belong to the current user.");
  if (playlists[0].libraryId !== playlists[1].libraryId) throw new OrchestrationDomainError("INCOMPATIBLE_PLAYLIST_LIBRARY", "Playlist relationships must stay within one library in v2.2.0.");
  if (DEPENDENCY_TYPES.includes(input.relationshipType as typeof DEPENDENCY_TYPES[number])) {
    const edges = await relationshipEdgesForUser(input.userId, { sourceId: input.sourceManagedPlaylistId, targetId: input.targetManagedPlaylistId, type: input.relationshipType });
    const cycle = findDependencyCycle(edges);
    if (cycle) {
      const names = new Map(playlists.map((playlist) => [playlist.id, playlist.displayName]));
      throw new OrchestrationDomainError("CIRCULAR_DEPENDENCY", `Circular dependency detected: ${cycle.map((id) => names.get(id) || id).join(" -> ")}.`, { cycle });
    }
  }
  try {
    const relationship = await prisma.managedPlaylistRelationship.create({ data: {
      sourceManagedPlaylistId: input.sourceManagedPlaylistId, targetManagedPlaylistId: input.targetManagedPlaylistId,
      relationshipType: input.relationshipType, priority: Math.max(-100, Math.min(100, Math.trunc(input.priority || 0))), metadataJson: json(input.metadata),
    } });
    await auditOrchestration({ userId: input.userId, managedPlaylistId: input.sourceManagedPlaylistId, eventType: "RELATIONSHIP_CREATED", actorType: "USER", actorId: input.actorId, message: `Playlist relationship ${input.relationshipType} was created.`, metadata: { relationshipId: relationship.id, targetManagedPlaylistId: input.targetManagedPlaylistId } });
    return relationship;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new OrchestrationDomainError("DUPLICATE_RELATIONSHIP", "This playlist relationship already exists.");
    throw error;
  }
}

export async function deleteManagedPlaylistRelationship(userId: string, id: string, actorId?: string) {
  const relationship = await prisma.managedPlaylistRelationship.findFirst({ where: { id, sourceManagedPlaylist: { userId } } });
  if (!relationship) throw new OrchestrationDomainError("RELATIONSHIP_NOT_FOUND", "Playlist relationship not found.");
  await prisma.managedPlaylistRelationship.delete({ where: { id } });
  await auditOrchestration({ userId, managedPlaylistId: relationship.sourceManagedPlaylistId, eventType: "RELATIONSHIP_REMOVED", actorType: "USER", actorId, message: `Playlist relationship ${relationship.relationshipType} was removed.`, metadata: { relationshipId: id, targetManagedPlaylistId: relationship.targetManagedPlaylistId } });
}

export async function dependencySnapshot(managedPlaylistId: string) {
  const owner = await prisma.managedPlaylist.findUnique({ where: { id: managedPlaylistId }, select: { userId: true, id: true, displayName: true } });
  if (!owner) throw new OrchestrationDomainError("MANAGED_PLAYLIST_NOT_FOUND", "Managed playlist not found.");
  const all = await prisma.managedPlaylistRelationship.findMany({ where: { enabled: true, sourceManagedPlaylist: { enabled: true, userId: owner.userId } }, include: { sourceManagedPlaylist: { select: { id: true, displayName: true } }, targetManagedPlaylist: { select: { id: true, displayName: true, enabled: true, automationEnabled: true, automationState: true, plexAvailable: true, lastSuccessfulJobId: true, lastCompletedAt: true } } } });
  const dependencyRows = all.filter((row) => DEPENDENCY_TYPES.includes(row.relationshipType as typeof DEPENDENCY_TYPES[number]));
  const reachable = new Set([managedPlaylistId]);
  const relevant: typeof dependencyRows = [];
  const pending = [managedPlaylistId];
  while (pending.length) {
    const sourceId = pending.shift()!;
    for (const row of dependencyRows.filter((candidate) => candidate.sourceManagedPlaylistId === sourceId)) {
      relevant.push(row);
      if (!reachable.has(row.targetManagedPlaylistId)) { reachable.add(row.targetManagedPlaylistId); pending.push(row.targetManagedPlaylistId); }
    }
  }
  const edges = relevant.map((row) => ({ sourceId: row.sourceManagedPlaylistId, targetId: row.targetManagedPlaylistId, type: row.relationshipType, enabled: row.enabled })) as DependencyEdge[];
  const cycle = findDependencyCycle(edges);
  const order = cycle ? [] : topologicalPlaylistOrder(Array.from(reachable), edges);
  const dependencies = relevant.map((row) => ({
    id: row.targetManagedPlaylist.id, name: row.targetManagedPlaylist.displayName, type: row.relationshipType,
    state: !row.targetManagedPlaylist.enabled || !row.targetManagedPlaylist.plexAvailable ? "DEPENDENCY_UNAVAILABLE"
      : row.targetManagedPlaylist.automationState === "PAUSED" || !row.targetManagedPlaylist.automationEnabled ? "BLOCKED_BY_PAUSED_PLAYLIST"
      : row.targetManagedPlaylist.automationState === "ERROR" ? "BLOCKED_BY_FAILED_DEPENDENCY"
      : row.targetManagedPlaylist.lastSuccessfulJobId ? "READY" : "WAITING_FOR_DEPENDENCY",
    lastSuccessfulJobId: row.targetManagedPlaylist.lastSuccessfulJobId,
    lastCompletedAt: row.targetManagedPlaylist.lastCompletedAt,
  }));
  return { playlist: owner, dependencies, cycle, order, satisfied: !cycle && dependencies.every((dependency) => dependency.state === "READY") };
}

export async function queueOrchestrationJob(input: { userId: string; managedPlaylistId: string; jobType: "GENERATE" | "REGENERATE" | "SYNC" | "ANALYZE" | "PREVIEW" | "DRY_RUN"; trigger: "MANUAL" | "SCHEDULED" | "RECENTLY_ADDED" | "DEPENDENCY" | "SYSTEM" | "RETRY"; dryRun?: boolean; priority?: number; scheduledFor?: Date; payload?: unknown; requestKey?: string; parentJobId?: string; rootJobId?: string; actorId?: string }) {
  const playlist = await prisma.managedPlaylist.findFirst({ where: { id: input.managedPlaylistId, userId: input.userId, enabled: true } });
  if (!playlist) throw new OrchestrationDomainError("MANAGED_PLAYLIST_NOT_FOUND", "Managed playlist not found.");
  if (!playlist.automationEnabled && input.trigger !== "MANUAL") throw new OrchestrationDomainError("PLAYLIST_AUTOMATION_DISABLED", `${playlist.displayName} automation is disabled.`);
  if (["PAUSED", "DISABLED"].includes(playlist.automationState) && input.trigger !== "MANUAL") throw new OrchestrationDomainError("PLAYLIST_AUTOMATION_PAUSED", `${playlist.displayName} automation is ${playlist.automationState.toLowerCase()}.`);
  const settings = await getOrchestrationSettings();
  if (input.trigger === "SCHEDULED" && !settings.allowScheduledOrchestration) throw new OrchestrationDomainError("SCHEDULED_ORCHESTRATION_DISABLED", "Scheduled playlist orchestration is disabled.");
  const scheduledFor = input.scheduledFor || new Date();
  const dryRun = input.dryRun === true || input.jobType === "DRY_RUN" || playlist.orchestrationMode !== "COORDINATED" || settings.dryRunByDefault;
  const idempotencyKey = orchestrationIdempotencyKey({ managedPlaylistId: playlist.id, jobType: input.jobType, trigger: input.trigger, scheduledFor, configuration: input.payload, requestKey: input.requestKey });
  const dependency = await dependencySnapshot(playlist.id);
  const waitingReason = !settings.enabled ? "Playlist orchestration is globally disabled." : dependency.cycle ? `Circular dependency: ${dependency.cycle.join(" -> ")}` : !dependency.satisfied ? "Waiting for playlist dependencies." : null;
  const status = waitingReason ? "WAITING" : "QUEUED";
  try {
    const job = await prisma.playlistOrchestrationJob.create({ data: {
      userId: input.userId, managedPlaylistId: playlist.id, libraryId: playlist.libraryId, parentJobId: input.parentJobId,
      rootJobId: input.rootJobId || input.parentJobId || undefined, jobType: input.jobType, status, playlistPriority: playlist.priority,
      priority: Math.max(-100, Math.min(100, Math.trunc(input.priority || 0))), trigger: input.trigger, dryRun,
      idempotencyKey, scheduledFor, dependencySnapshotJson: json(dependency), requestPayloadJson: json(input.payload), waitingReason,
    } });
    await prisma.managedPlaylist.update({ where: { id: playlist.id }, data: { lastQueuedAt: new Date(), automationState: status === "WAITING" ? "WAITING" : playlist.automationState, automationStateReason: waitingReason } });
    await auditOrchestration({ userId: input.userId, managedPlaylistId: playlist.id, jobId: job.id, eventType: "JOB_QUEUED", actorType: input.actorId ? "USER" : "SYSTEM", actorId: input.actorId, message: `${input.jobType} job queued for ${playlist.displayName}${dryRun ? " (dry run)" : ""}.`, metadata: { trigger: input.trigger, status, idempotencyKey } });
    return { job, duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.playlistOrchestrationJob.findUnique({ where: { idempotencyKey } });
      await auditOrchestration({ userId: input.userId, managedPlaylistId: playlist.id, jobId: existing?.id, eventType: "DUPLICATE_JOB_PREVENTED", actorType: input.actorId ? "USER" : "SYSTEM", actorId: input.actorId, message: `Duplicate ${input.jobType} request was linked to the existing job.`, metadata: { idempotencyKey } });
      return { job: existing!, duplicate: true };
    }
    throw error;
  }
}

function jobConflictKeys(job: { managedPlaylistId: string | null; jobType: string; managedPlaylist: { playlistId: string; playlistIdentityId: string | null; libraryId: string } | null }) {
  if (!job.managedPlaylistId || !job.managedPlaylist) return [];
  return orchestrationConflictKeys({ managedPlaylistId: job.managedPlaylistId, plexPlaylistId: job.managedPlaylist.playlistId, playlistIdentityId: job.managedPlaylist.playlistIdentityId, libraryId: job.managedPlaylist.libraryId, writesPlaylist: !["ANALYZE", "PREVIEW", "DRY_RUN"].includes(job.jobType) });
}

async function acquireJobLocks(job: Awaited<ReturnType<typeof findCandidateJobs>>[number]) {
  const settings = await getOrchestrationSettings();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + settings.staleJobTimeoutMinutes * 60_000);
  const ownerId = getWorkerIdentity().workerId;
  const baseKeys = jobConflictKeys(job);
  return prisma.$transaction(async (tx) => {
    await tx.playlistOrchestrationLock.deleteMany({ where: { leaseExpiresAt: { lt: now } } });
    const locks = await tx.playlistOrchestrationLock.findMany({ where: { releasedAt: null }, select: { conflictKey: true, jobId: true } });
    const occupied = new Map(locks.map((lock) => [lock.conflictKey, lock.jobId]));
    const directConflict = baseKeys.find((key) => occupied.has(key));
    if (directConflict) return { acquired: false as const, reason: `Conflict key ${directConflict} is held by job ${occupied.get(directConflict)}.`, conflictKey: directConflict };
    const selectSlot = (prefix: string, maximum: number) => Array.from({ length: maximum }, (_, index) => `${prefix}:${index + 1}`).find((key) => !occupied.has(key));
    const globalSlot = selectSlot("concurrency:global", settings.globalMaxConcurrentJobs);
    const userSlot = selectSlot(`concurrency:user:${job.userId}`, settings.perUserMaxConcurrentJobs);
    const librarySlot = job.libraryId ? selectSlot(`concurrency:library:${job.libraryId}`, settings.perLibraryMaxConcurrentJobs) : "concurrency:library:none:1";
    if (!globalSlot || !userSlot || !librarySlot) return { acquired: false as const, reason: "An orchestration concurrency limit is currently reached.", conflictKey: "concurrency" };
    const keys = [...baseKeys, globalSlot, userSlot, librarySlot];
    await tx.playlistOrchestrationLock.createMany({ data: keys.map((conflictKey) => ({ conflictKey, jobId: job.id, managedPlaylistId: job.managedPlaylistId, libraryId: job.libraryId, ownerId, heartbeatAt: now, leaseExpiresAt })) });
    return { acquired: true as const, ownerId, keys, leaseExpiresAt };
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { acquired: false as const, reason: "Another worker acquired a required lock first.", conflictKey: "concurrent-claim" };
    throw error;
  });
}

async function findCandidateJobs() {
  return prisma.playlistOrchestrationJob.findMany({ where: { status: { in: ["QUEUED", "WAITING"] }, scheduledFor: { lte: new Date() } }, include: { managedPlaylist: true }, orderBy: { requestedAt: "asc" }, take: 100 });
}

export async function claimNextOrchestrationJob() {
  const settings = await getOrchestrationSettings();
  if (!settings.enabled) {
    await prisma.playlistOrchestrationJob.updateMany({ where: { status: "QUEUED" }, data: { status: "WAITING", waitingReason: "Playlist orchestration is globally disabled." } });
    return null;
  }
  const candidates = sortEligibleJobs((await findCandidateJobs()).map((job) => ({ ...job, playlistPriority: job.playlistPriority as PlaylistPriorityValue })));
  for (const job of candidates) {
    if (!job.managedPlaylist || !job.managedPlaylist.enabled || !job.managedPlaylist.automationEnabled || ["PAUSED", "DISABLED", "ERROR"].includes(job.managedPlaylist.automationState)) {
      await prisma.playlistOrchestrationJob.update({ where: { id: job.id }, data: { status: "BLOCKED", waitingReason: "The managed playlist is disabled, paused, unavailable, or in an error state." } });
      continue;
    }
    const dependency = await dependencySnapshot(job.managedPlaylist.id);
    if (!dependency.satisfied) {
      const reason = dependency.cycle ? `Circular dependency: ${dependency.cycle.join(" -> ")}` : `Waiting for dependency: ${dependency.dependencies.filter((item) => item.state !== "READY").map((item) => item.name).join(", ")}`;
      await prisma.playlistOrchestrationJob.update({ where: { id: job.id }, data: { status: dependency.cycle ? "BLOCKED" : "WAITING", waitingReason: reason } });
      continue;
    }
    const claimed = await prisma.playlistOrchestrationJob.updateMany({ where: { id: job.id, status: { in: ["QUEUED", "WAITING"] } }, data: { status: "RUNNING", startedAt: new Date(), attemptCount: { increment: 1 }, waitingReason: null, operationPhase: "PLANNING" } });
    if (!claimed.count) continue;
    const locks = await acquireJobLocks(job);
    if (!locks.acquired) {
      await prisma.playlistOrchestrationJob.update({ where: { id: job.id }, data: { status: "WAITING", startedAt: null, waitingReason: locks.reason } });
      await auditOrchestration({ userId: job.userId, managedPlaylistId: job.managedPlaylistId, jobId: job.id, eventType: "CONFLICT_DETECTED", severity: "WARNING", message: `Job delayed: ${locks.reason}`, metadata: { conflictKey: locks.conflictKey } });
      continue;
    }
    await prisma.$transaction([
      prisma.playlistOrchestrationJob.update({ where: { id: job.id }, data: { lockedBy: locks.ownerId, lockedAt: new Date(), heartbeatAt: new Date(), leaseExpiresAt: locks.leaseExpiresAt } }),
      prisma.managedPlaylist.update({ where: { id: job.managedPlaylist.id }, data: { currentJobId: job.id, lastStartedAt: new Date(), automationState: "RUNNING", automationStateReason: null } }),
    ]);
    await auditOrchestration({ userId: job.userId, managedPlaylistId: job.managedPlaylistId, jobId: job.id, eventType: "JOB_STARTED", message: `Orchestration job started for ${job.managedPlaylist.displayName}.`, metadata: { lockedBy: locks.ownerId, dryRun: job.dryRun } });
    await auditOrchestration({ userId: job.userId, managedPlaylistId: job.managedPlaylistId, jobId: job.id, eventType: "LOCK_ACQUIRED", message: `Required orchestration locks were acquired for ${job.managedPlaylist.displayName}.`, metadata: { conflictKeys: locks.keys } });
    return prisma.playlistOrchestrationJob.findUnique({ where: { id: job.id }, include: { managedPlaylist: true } });
  }
  return null;
}

export async function heartbeatOrchestrationJob(jobId: string, phase?: string) {
  const settings = await getOrchestrationSettings();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + settings.staleJobTimeoutMinutes * 60_000);
  await prisma.$transaction([
    prisma.playlistOrchestrationJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { heartbeatAt: now, leaseExpiresAt, operationPhase: phase } }),
    prisma.playlistOrchestrationLock.updateMany({ where: { jobId, releasedAt: null }, data: { heartbeatAt: now, leaseExpiresAt } }),
  ]);
}

export async function releaseOrchestrationLocks(jobId: string) {
  await prisma.playlistOrchestrationLock.deleteMany({ where: { jobId } });
}

export async function completeOrchestrationJob(jobId: string, result: unknown) {
  const job = await prisma.playlistOrchestrationJob.findUnique({ where: { id: jobId }, include: { managedPlaylist: true } });
  if (!job) return;
  await prisma.$transaction([
    prisma.playlistOrchestrationJob.update({ where: { id: jobId }, data: { status: "SUCCEEDED", completedAt: new Date(), resultSummaryJson: json(result), operationPhase: "AUDIT_COMPLETED", heartbeatAt: new Date(), leaseExpiresAt: null } }),
    ...(job.managedPlaylistId ? [prisma.managedPlaylist.update({ where: { id: job.managedPlaylistId }, data: { currentJobId: null, lastCompletedAt: new Date(), lastSuccessfulJobId: jobId, automationState: "ACTIVE", automationStateReason: null } })] : []),
    prisma.playlistOrchestrationLock.deleteMany({ where: { jobId } }),
  ]);
  await auditOrchestration({ userId: job.userId, managedPlaylistId: job.managedPlaylistId, jobId, eventType: job.dryRun ? "DRY_RUN_COMPLETED" : "JOB_SUCCEEDED", message: `${job.dryRun ? "Dry run" : "Orchestration job"} completed successfully for ${job.managedPlaylist?.displayName || "playlist"}.`, metadata: result });
  await auditOrchestration({ userId: job.userId, managedPlaylistId: job.managedPlaylistId, jobId, eventType: "LOCK_RELEASED", message: "Orchestration locks were released after successful completion." });
}

export async function failOrchestrationJob(jobId: string, error: unknown, code = "ORCHESTRATION_EXECUTION_FAILED") {
  const job = await prisma.playlistOrchestrationJob.findUnique({ where: { id: jobId }, include: { managedPlaylist: true } });
  if (!job) return;
  const message = error instanceof Error ? error.message : String(error);
  const playlistUnavailable = /playlist.*(not found|inaccessible|deleted)|404/i.test(message);
  await prisma.$transaction([
    prisma.playlistOrchestrationJob.update({ where: { id: jobId }, data: { status: "FAILED", failedAt: new Date(), errorCode: code, errorMessage: message.slice(0, 2_000), leaseExpiresAt: null } }),
    ...(job.managedPlaylistId ? [prisma.managedPlaylist.update({ where: { id: job.managedPlaylistId }, data: { currentJobId: null, lastFailedAt: new Date(), automationState: "ERROR", automationStateReason: message.slice(0, 500), plexAvailable: playlistUnavailable ? false : undefined, lastAvailabilityCheck: playlistUnavailable ? new Date() : undefined } })] : []),
    prisma.playlistOrchestrationLock.deleteMany({ where: { jobId } }),
  ]);
  await auditOrchestration({ userId: job.userId, managedPlaylistId: job.managedPlaylistId, jobId, eventType: "JOB_FAILED", severity: "ERROR", message: `Orchestration job failed: ${message.slice(0, 1_000)}`, metadata: { code, operationPhase: job.operationPhase } });
  await auditOrchestration({ userId: job.userId, managedPlaylistId: job.managedPlaylistId, jobId, eventType: "LOCK_RELEASED", message: "Orchestration locks were released after failure." });
}

export async function cancelOrchestrationJob(userId: string, jobId: string, actorId?: string) {
  const job = await prisma.playlistOrchestrationJob.findFirst({ where: { id: jobId, userId } });
  if (!job) throw new OrchestrationDomainError("JOB_NOT_FOUND", "Orchestration job not found.");
  if (!['QUEUED', 'WAITING', 'BLOCKED'].includes(job.status)) throw new OrchestrationDomainError("JOB_NOT_CANCELLABLE", "Only queued, waiting, or blocked jobs can be cancelled safely.");
  await prisma.$transaction([
    prisma.playlistOrchestrationJob.update({ where: { id: jobId }, data: { status: "CANCELLED", cancelledAt: new Date(), waitingReason: null } }),
    ...(job.managedPlaylistId ? [prisma.managedPlaylist.updateMany({ where: { id: job.managedPlaylistId, currentJobId: jobId }, data: { currentJobId: null, automationState: "ACTIVE", automationStateReason: null } })] : []),
  ]);
  await auditOrchestration({ userId, managedPlaylistId: job.managedPlaylistId, jobId, eventType: "JOB_CANCELLED", actorType: "USER", actorId, message: "Queued orchestration job was cancelled." });
}

export async function retryOrchestrationJob(userId: string, jobId: string, actorId?: string) {
  const job = await prisma.playlistOrchestrationJob.findFirst({ where: { id: jobId, userId } });
  if (!job || !job.managedPlaylistId) throw new OrchestrationDomainError("JOB_NOT_FOUND", "Orchestration job not found.");
  if (!['FAILED', 'STALE', 'CANCELLED'].includes(job.status)) throw new OrchestrationDomainError("JOB_NOT_RETRYABLE", "Only failed, stale, or cancelled jobs can be retried.");
  if (["PLEX_WRITE_STARTED", "PLEX_WRITE_COMPLETED", "DATABASE_COMMIT_COMPLETED"].includes(job.operationPhase)) throw new OrchestrationDomainError("MANUAL_REVIEW_REQUIRED", "This job may have changed Plex and requires manual review before retrying.", { operationPhase: job.operationPhase });
  return queueOrchestrationJob({ userId, managedPlaylistId: job.managedPlaylistId, jobType: job.jobType, trigger: "RETRY", dryRun: job.dryRun, priority: job.priority, payload: job.requestPayloadJson, parentJobId: job.id, rootJobId: job.rootJobId || job.id, requestKey: `retry:${job.id}:${job.attemptCount}`, actorId });
}

export async function recoverStaleOrchestrationJobs() {
  const settings = await getOrchestrationSettings();
  const staleBefore = new Date(Date.now() - settings.staleJobTimeoutMinutes * 60_000);
  const jobs = await prisma.playlistOrchestrationJob.findMany({ where: { status: "RUNNING", OR: [{ leaseExpiresAt: { lt: new Date() } }, { heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null, startedAt: { lt: staleBefore } }] }, include: { managedPlaylist: true }, take: 100 });
  let reviewRequired = 0;
  let requeued = 0;
  for (const job of jobs) {
    const safelyRetryable = ["PLANNING", "CANDIDATES_READY"].includes(job.operationPhase) && (job.dryRun || ["ANALYZE", "PREVIEW", "DRY_RUN"].includes(job.jobType));
    await prisma.$transaction([
      prisma.playlistOrchestrationJob.update({ where: { id: job.id }, data: { status: safelyRetryable ? "QUEUED" : "STALE", lockedBy: null, lockedAt: null, heartbeatAt: null, leaseExpiresAt: null, waitingReason: safelyRetryable ? "Recovered after an expired worker lease." : "Manual review required because the operation may have partially modified Plex.", errorCode: safelyRetryable ? null : "MANUAL_REVIEW_REQUIRED" } }),
      prisma.playlistOrchestrationLock.deleteMany({ where: { jobId: job.id } }),
      ...(job.managedPlaylistId ? [prisma.managedPlaylist.update({ where: { id: job.managedPlaylistId }, data: { currentJobId: null, automationState: safelyRetryable ? "WAITING" : "ERROR", automationStateReason: safelyRetryable ? "Recovered job is queued." : "Stale job requires manual review." } })] : []),
    ]);
    safelyRetryable ? requeued++ : reviewRequired++;
    await auditOrchestration({ userId: job.userId, managedPlaylistId: job.managedPlaylistId, jobId: job.id, eventType: "STALE_LOCK_RECOVERED", severity: safelyRetryable ? "WARNING" : "ERROR", message: safelyRetryable ? "Stale orchestration job was safely requeued." : "Stale orchestration job was stopped for manual review.", metadata: { operationPhase: job.operationPhase } });
  }
  await prisma.playlistOrchestrationLock.deleteMany({ where: { leaseExpiresAt: { lt: new Date() } } });
  return { inspected: jobs.length, requeued, reviewRequired };
}

export async function cleanupOrchestrationHistory() {
  const settings = await getOrchestrationSettings();
  const auditBefore = new Date(Date.now() - settings.auditRetentionDays * 86_400_000);
  const jobsBefore = new Date(Date.now() - settings.jobHistoryRetentionDays * 86_400_000);
  const auditRows = await prisma.playlistOrchestrationAuditEvent.findMany({ where: { createdAt: { lt: auditBefore } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 500 });
  const jobRows = await prisma.playlistOrchestrationJob.findMany({ where: { createdAt: { lt: jobsBefore }, status: { in: ["SUCCEEDED", "FAILED", "CANCELLED", "SKIPPED", "STALE"] } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 500 });
  const [auditResult, jobResult] = await prisma.$transaction([
    prisma.playlistOrchestrationAuditEvent.deleteMany({ where: { id: { in: auditRows.map((row) => row.id) } } }),
    prisma.playlistOrchestrationJob.deleteMany({ where: { id: { in: jobRows.map((row) => row.id) } } }),
  ]);
  return { auditEventsDeleted: auditResult.count, jobsDeleted: jobResult.count };
}

export function orchestrationErrorResponse(error: unknown) {
  if (error instanceof OrchestrationDomainError) return { status: error.code.includes("NOT_FOUND") ? 404 : error.code.includes("CONFLICT") || error.code.includes("DUPLICATE") || error.code.includes("ACTIVE") ? 409 : 400, body: { error: { code: error.code, message: error.message, details: error.details } } };
  console.error("[Orchestration] Request failed", error);
  return { status: 500, body: { error: { code: "ORCHESTRATION_INTERNAL_ERROR", message: "The orchestration request could not be completed." } } };
}

export { ACTIVE_STATUSES };
