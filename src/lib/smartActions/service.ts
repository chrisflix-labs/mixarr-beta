import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { setTrackMetadataCorrection, findOwnedTrackWithMetadata } from "../metadataCorrectionService";
import { executeSmartRefreshEvaluation } from "../smartRefresh";
import { createPlaylistVersion } from "../playlists/versions/playlist-version-service";
import { syncTrackIdsToPlexPlaylist } from "../playlistService";
import { safeFinishJobHistory, safeStartJobHistory } from "../jobHistory";
import { bulkEligibleActionIds, canTransitionSmartAction, confidenceLevel, detectSmartActionConflicts, isMaintenanceWindow, riskRank } from "./core";
import { defaultSmartActionProviders } from "./providers";
import {
  SMART_ACTION_STATUSES, SMART_ACTION_TYPES, expectedImpactSchema, recommendationTypeDefaults,
  smartActionPayloadSchema, smartActionPreviewSchema, type SmartActionCandidate, type SmartActionPayload,
  type SmartActionRiskLevel, type SmartActionStatus,
} from "./types";

const ACTIVE_STATUSES: SmartActionStatus[] = ["PENDING", "APPROVED", "SNOOZED", "SCHEDULED", "RUNNING", "FAILED"];
const HISTORY_STATUSES: SmartActionStatus[] = ["COMPLETED", "REJECTED", "EXPIRED", "FAILED", "CANCELED", "SUPERSEDED"];
const json = (value: unknown) => value as Prisma.InputJsonValue;

export class SmartActionError extends Error {
  constructor(message: string, public status = 400, public code = "SMART_ACTION_ERROR") { super(message); }
}

export const smartActionSettingsSchema = z.object({
  enabled: z.boolean().optional(), generateDuringNightlySync: z.boolean().optional(), generateAfterPlaylistCreation: z.boolean().optional(),
  generateAfterMetadataAnalysis: z.boolean().optional(), minimumConfidenceToDisplay: z.number().int().min(0).max(100).optional(),
  highConfidenceThreshold: z.number().int().min(66).max(100).optional(), mediumConfidenceThreshold: z.number().int().min(1).max(99).optional(),
  maximumPendingActions: z.number().int().min(10).max(5_000).optional(), expireAfterDays: z.number().int().min(1).max(365).optional(),
  recommendationTypes: z.record(z.enum(SMART_ACTION_TYPES), z.boolean()).optional(), maintenanceEnabled: z.boolean().optional(),
  maintenanceStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  maintenanceDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  maximumActionsPerWindow: z.number().int().min(1).max(500).optional(), maximumPlaylistsPerWindow: z.number().int().min(1).max(100).optional(),
  maximumConcurrentActions: z.number().int().min(1).max(5).optional(), allowPlexRefreshes: z.boolean().optional(),
  allowMetadataChanges: z.boolean().optional(), allowPlaylistRegeneration: z.boolean().optional(), pauseDuringPlayback: z.boolean().optional(),
  automationEmergencyDisabled: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.highConfidenceThreshold != null && value.mediumConfidenceThreshold != null && value.mediumConfidenceThreshold >= value.highConfidenceThreshold) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Medium confidence must be below high confidence." });
  }
});

const defaultSettingsData = {
  recommendationTypesJson: json(recommendationTypeDefaults), maintenanceDaysJson: json([0, 1, 2, 3, 4]),
};

export async function getSmartActionSettings(userId: string) {
  const settings = await prisma.smartActionSetting.upsert({ where: { userId }, create: { userId, ...defaultSettingsData }, update: {} });
  const policies = await prisma.smartActionAutomationPolicy.findMany({ where: { userId }, orderBy: { actionType: "asc" } });
  return { ...settings, recommendationTypes: settings.recommendationTypesJson as Record<string, boolean>, maintenanceDays: settings.maintenanceDaysJson as number[], policies };
}

export async function updateSmartActionSettings(userId: string, raw: unknown) {
  const input = smartActionSettingsSchema.parse(raw);
  const current = await getSmartActionSettings(userId);
  const high = input.highConfidenceThreshold ?? current.highConfidenceThreshold;
  const medium = input.mediumConfidenceThreshold ?? current.mediumConfidenceThreshold;
  if (medium >= high) throw new SmartActionError("Medium confidence must be below high confidence.");
  await prisma.smartActionSetting.update({ where: { userId }, data: {
    ...input,
    ...(input.recommendationTypes ? { recommendationTypesJson: json({ ...recommendationTypeDefaults, ...input.recommendationTypes }) } : {}),
    ...(input.maintenanceDays ? { maintenanceDaysJson: json(Array.from(new Set(input.maintenanceDays))) } : {}),
    recommendationTypes: undefined, maintenanceDays: undefined,
  } as Prisma.SmartActionSettingUpdateInput });
  return getSmartActionSettings(userId);
}

const automationPolicySchema = z.object({
  actionType: z.enum(SMART_ACTION_TYPES), enabled: z.boolean(), minimumConfidence: z.number().int().min(85).max(100),
  maximumRisk: z.enum(["LOW", "MODERATE", "HIGH"]), maximumPerWindow: z.number().int().min(1).max(50),
}).strict();

export async function updateSmartActionAutomationPolicy(userId: string, raw: unknown) {
  const input = automationPolicySchema.parse(raw);
  return prisma.smartActionAutomationPolicy.upsert({
    where: { userId_actionType: { userId, actionType: input.actionType } }, create: { userId, ...input }, update: input,
  });
}

function validateCandidate(candidate: SmartActionCandidate) {
  if (!SMART_ACTION_TYPES.includes(candidate.actionType)) throw new SmartActionError("Unsupported Smart Action type.");
  const payload = smartActionPayloadSchema.parse(candidate.actionPayload);
  if (payload.type !== candidate.actionType) throw new SmartActionError("The typed action payload does not match the action type.");
  return { payload, preview: smartActionPreviewSchema.parse(candidate.previewPayload), impact: expectedImpactSchema.parse(candidate.expectedImpact) };
}

async function validateCandidateOwnership(candidate: SmartActionCandidate) {
  if (candidate.libraryId) {
    const library = await prisma.library.findFirst({ where: { id: candidate.libraryId, server: { userId: candidate.userId } }, select: { id: true } });
    if (!library) throw new SmartActionError("Library not found or unavailable.", 404, "LIBRARY_NOT_FOUND");
  }
  if (candidate.playlistId) {
    const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: candidate.playlistId, userId: candidate.userId }, select: { id: true } });
    if (!playlist) throw new SmartActionError("Playlist not found or unavailable.", 404, "PLAYLIST_NOT_FOUND");
  }
}

async function audit(actionId: string, input: { actorUserId?: string | null; actorType?: string; eventType: string; previousStatus?: string | null; newStatus?: string | null; reason?: string | null; result?: unknown }) {
  return prisma.smartActionAuditEvent.create({ data: {
    actionId, actorUserId: input.actorUserId || null, actorType: input.actorType || (input.actorUserId ? "USER" : "SYSTEM"),
    eventType: input.eventType, previousStatus: input.previousStatus || null, newStatus: input.newStatus || null,
    reason: input.reason?.slice(0, 1_000) || null, ...(input.result !== undefined ? { resultJson: json(input.result) } : {}),
  } });
}

export async function submitSmartAction(candidate: SmartActionCandidate) {
  const settings = await getSmartActionSettings(candidate.userId);
  if (!settings.enabled) return { action: null, outcome: "disabled" as const };
  const toggles = settings.recommendationTypes as Record<string, boolean>;
  if (toggles[candidate.actionType] === false) return { action: null, outcome: "type_disabled" as const };
  const { payload, preview, impact } = validateCandidate(candidate);
  await validateCandidateOwnership(candidate);
  const score = Math.max(0, Math.min(100, Math.round(candidate.confidenceScore)));
  if (score < settings.minimumConfidenceToDisplay) return { action: null, outcome: "below_threshold" as const };
  const existing = await prisma.smartAction.findFirst({ where: { userId: candidate.userId, deduplicationKey: candidate.deduplicationKey, status: { in: ACTIVE_STATUSES } }, orderBy: { createdAt: "desc" } });
  const data = {
    libraryId: candidate.libraryId || null, playlistId: candidate.playlistId || null, actionType: candidate.actionType,
    title: candidate.title.slice(0, 240), summary: candidate.summary.slice(0, 1_000), explanation: candidate.explanation.slice(0, 5_000),
    confidenceScore: score, confidenceLevel: confidenceLevel(score, { high: settings.highConfidenceThreshold, medium: settings.mediumConfidenceThreshold }),
    priority: candidate.priority || 0, sourceService: candidate.sourceService.slice(0, 100), sourceVersion: candidate.sourceVersion.slice(0, 50),
    actionPayload: json(payload), previewPayload: json(preview), expectedImpact: json(impact), riskLevel: candidate.riskLevel,
    sourceFingerprint: candidate.sourceFingerprint || null, expiresAt: candidate.expiresAt || new Date(Date.now() + settings.expireAfterDays * 86_400_000),
  };
  if (existing && existing.sourceFingerprint === data.sourceFingerprint) {
    const action = await prisma.smartAction.update({ where: { id: existing.id }, data });
    await audit(action.id, { eventType: "UPDATED", previousStatus: existing.status, newStatus: existing.status, reason: "Equivalent recommendation evidence was refreshed." });
    return { action, outcome: "updated" as const };
  }
  if (existing) {
    await prisma.smartAction.update({ where: { id: existing.id }, data: { status: "SUPERSEDED", reviewedAt: new Date() } });
    await audit(existing.id, { eventType: "SUPERSEDED", previousStatus: existing.status, newStatus: "SUPERSEDED", reason: "The proposed change materially changed." });
  }
  const activeCount = await prisma.smartAction.count({ where: { userId: candidate.userId, status: { in: ["PENDING", "APPROVED", "SNOOZED", "SCHEDULED"] } } });
  if (activeCount >= settings.maximumPendingActions) return { action: null, outcome: "limit_reached" as const };
  const action = await prisma.smartAction.create({ data: { userId: candidate.userId, deduplicationKey: candidate.deduplicationKey.slice(0, 500), ...data } });
  await audit(action.id, { eventType: "GENERATED", previousStatus: null, newStatus: "PENDING", reason: candidate.sourceService });
  const { emitIntegrationEvent } = await import("../integrations/service");
  await emitIntegrationEvent("smart_action.pending", { smartAction: { id: action.id, type: action.actionType, title: action.title, confidence: action.confidenceLevel, risk: action.riskLevel } }, { actorType: "system" }, `smart_action.pending:${action.id}`);
  return { action, outcome: "created" as const };
}

export async function generateSmartActions(userId: string, options?: { libraryId?: string; playlistId?: string; limit?: number }) {
  const settings = await getSmartActionSettings(userId);
  if (!settings.enabled) return { status: "disabled", created: 0, updated: 0, skipped: 0, providers: [] };
  const job = await safeStartJobHistory({ userId, type: "smart_actions", name: "Generate Smart Actions", trigger: "manual", metadata: { stages: ["Collecting signals", "Analyzing playlists", "Calculating recommendations", "Generating previews", "Deduplicating actions", "Saving actions"] } });
  const totals = { created: 0, updated: 0, skipped: 0 };
  const providerResults: Array<{ provider: string; candidates: number; failed?: string }> = [];
  try {
    for (const provider of defaultSmartActionProviders) {
      try {
        const candidates = await provider.generate(userId, options);
        providerResults.push({ provider: provider.id, candidates: candidates.length });
        for (const candidate of candidates) {
          const result = await submitSmartAction(candidate);
          if (result.outcome === "created") totals.created += 1;
          else if (result.outcome === "updated") totals.updated += 1;
          else totals.skipped += 1;
        }
      } catch (error) {
        providerResults.push({ provider: provider.id, candidates: 0, failed: error instanceof Error ? error.message : "Provider failed" });
      }
    }
    await expireAndWakeSmartActions(userId);
    await safeFinishJobHistory({ job, status: providerResults.some((item) => item.failed) ? "completed_with_warnings" : "completed", summary: `Smart Action generation completed. ${totals.created} created, ${totals.updated} updated, ${totals.skipped} skipped.`, counts: { attempted: totals.created + totals.updated + totals.skipped, processed: totals.created + totals.updated, skipped: totals.skipped, failed: providerResults.filter((item) => item.failed).length }, metadata: { providers: providerResults, stage: "Complete" } });
    return { status: "completed", ...totals, providers: providerResults };
  } catch (error) {
    await safeFinishJobHistory({ job, status: "failed", summary: "Smart Action generation failed.", error: error instanceof Error ? error.message : "Unknown error" });
    throw error;
  }
}

export async function listSmartActions(userId: string, input: { page?: number; pageSize?: number; status?: string; actionType?: string; confidence?: string; risk?: string; playlistId?: string; libraryId?: string; search?: string; sort?: string; history?: boolean } = {}) {
  const page = Math.max(1, input.page || 1); const pageSize = Math.min(100, Math.max(1, input.pageSize || 25));
  const status = input.status && SMART_ACTION_STATUSES.includes(input.status as SmartActionStatus) ? input.status : undefined;
  const where: Prisma.SmartActionWhereInput = {
    userId,
    ...(status ? { status } : input.history ? { status: { in: HISTORY_STATUSES } } : { status: { in: ["PENDING", "APPROVED", "SCHEDULED", "FAILED"] } }),
    ...(input.actionType && SMART_ACTION_TYPES.includes(input.actionType as never) ? { actionType: input.actionType } : {}),
    ...(input.confidence && ["HIGH", "MEDIUM", "LOW"].includes(input.confidence) ? { confidenceLevel: input.confidence } : {}),
    ...(input.risk && ["LOW", "MODERATE", "HIGH"].includes(input.risk) ? { riskLevel: input.risk } : {}),
    ...(input.playlistId ? { playlistId: input.playlistId } : {}), ...(input.libraryId ? { libraryId: input.libraryId } : {}),
    ...(input.search ? { OR: [
      { title: { contains: input.search, mode: "insensitive" } }, { summary: { contains: input.search, mode: "insensitive" } },
      { explanation: { contains: input.search, mode: "insensitive" } }, { playlist: { plexPlaylistTitle: { contains: input.search, mode: "insensitive" } } },
    ] } : {}),
  };
  const orderBy: Prisma.SmartActionOrderByWithRelationInput[] = input.sort === "confidence" ? [{ confidenceScore: "desc" }, { createdAt: "desc" }]
    : input.sort === "impact" ? [{ priority: "desc" }, { confidenceScore: "desc" }] : input.sort === "oldest" ? [{ createdAt: "asc" }]
      : input.sort === "type" ? [{ actionType: "asc" }, { createdAt: "desc" }] : [{ priority: "desc" }, { confidenceScore: "desc" }, { createdAt: "desc" }];
  const [items, total] = await Promise.all([
    prisma.smartAction.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: { playlist: { select: { id: true, plexPlaylistTitle: true } }, library: { select: { id: true, name: true } }, playlistRevisions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, revisionNumber: true } } } }),
    prisma.smartAction.count({ where }),
  ]);
  const parsed = items.map((item) => ({ ...item, actionPayload: smartActionPayloadSchema.parse(item.actionPayload) }));
  const bulkEligibleIds = bulkEligibleActionIds(parsed.map((item) => ({ id: item.id, playlistId: item.playlistId, actionType: item.actionType, actionPayload: item.actionPayload, confidenceLevel: item.confidenceLevel, riskLevel: item.riskLevel as SmartActionRiskLevel, status: item.status })));
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), bulkEligibleIds };
}

export async function getSmartAction(userId: string, id: string) {
  const action = await prisma.smartAction.findFirst({ where: { id, userId }, include: {
    playlist: { select: { id: true, plexPlaylistTitle: true, updatedAt: true } }, library: { select: { id: true, name: true } },
    auditEvents: { orderBy: { createdAt: "desc" }, take: 100 }, playlistRevisions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, revisionNumber: true, createdAt: true } },
  } });
  if (!action) return null;
  const resourceFilters: Prisma.SmartActionWhereInput[] = [];
  if (action.playlistId) resourceFilters.push({ playlistId: action.playlistId });
  if (action.libraryId) resourceFilters.push({ libraryId: action.libraryId });
  const related = resourceFilters.length ? await prisma.smartAction.findMany({ where: { userId, id: { not: id }, status: { in: ACTIVE_STATUSES }, OR: resourceFilters }, take: 20, select: { id: true, title: true, status: true, actionType: true, playlistId: true, actionPayload: true } }) : [];
  const source = { id: action.id, playlistId: action.playlistId, actionType: action.actionType, actionPayload: smartActionPayloadSchema.parse(action.actionPayload) };
  const conflicts = detectSmartActionConflicts([source, ...related.map((item) => ({ ...item, actionPayload: smartActionPayloadSchema.parse(item.actionPayload) }))]);
  return { ...action, conflicts, related: related.map(({ actionPayload: _, ...item }) => item) };
}

export async function getSmartActionSummary(userId: string) {
  await expireAndWakeSmartActions(userId);
  const groups = await prisma.smartAction.groupBy({ by: ["status", "confidenceLevel", "actionType"], where: { userId }, _count: true });
  const count = (predicate: (row: typeof groups[number]) => boolean) => groups.filter(predicate).reduce((sum, row) => sum + row._count, 0);
  const recentlyCompletedAfter = new Date(Date.now() - 7 * 86_400_000);
  const recentlyCompleted = await prisma.smartAction.count({ where: { userId, status: "COMPLETED", completedAt: { gte: recentlyCompletedAfter } } });
  return {
    pending: count((row) => row.status === "PENDING"), high: count((row) => row.status === "PENDING" && row.confidenceLevel === "HIGH"),
    medium: count((row) => row.status === "PENDING" && row.confidenceLevel === "MEDIUM"), low: count((row) => row.status === "PENDING" && row.confidenceLevel === "LOW"),
    waiting: count((row) => ["APPROVED", "SCHEDULED"].includes(row.status)), snoozed: count((row) => row.status === "SNOOZED"), recentlyCompleted,
    failed: count((row) => row.status === "FAILED"), byType: Object.fromEntries(SMART_ACTION_TYPES.map((type) => [type, count((row) => row.status === "PENDING" && row.actionType === type)])),
  };
}

async function transition(userId: string, id: string, to: SmartActionStatus, data: Prisma.SmartActionUpdateInput, reason?: string) {
  const action = await prisma.smartAction.findFirst({ where: { id, userId } });
  if (!action) throw new SmartActionError("Smart Action not found.", 404, "NOT_FOUND");
  if (!canTransitionSmartAction(action.status as SmartActionStatus, to)) throw new SmartActionError(`A ${action.status.toLowerCase()} action cannot move to ${to.toLowerCase()}.`, 409, "INVALID_STATUS");
  const updated = await prisma.smartAction.update({ where: { id }, data: { ...data, status: to } });
  await audit(id, { actorUserId: userId, eventType: to, previousStatus: action.status, newStatus: to, reason });
  return updated;
}

export const approveSmartAction = (userId: string, id: string) => transition(userId, id, "APPROVED", { approvedAt: new Date(), reviewedAt: new Date(), approvedBy: userId }, "Explicit user approval");
export const rejectSmartAction = (userId: string, id: string, reason?: string) => transition(userId, id, "REJECTED", { rejectedAt: new Date(), reviewedAt: new Date(), rejectionReason: reason?.slice(0, 500) || null }, reason || "Rejected by user");
export const cancelSmartAction = (userId: string, id: string) => transition(userId, id, "CANCELED", { reviewedAt: new Date() }, "Canceled by user");

export async function snoozeSmartAction(userId: string, id: string, input: { preset?: string; until?: string; condition?: string }) {
  const durations: Record<string, number> = { ONE_DAY: 1, THREE_DAYS: 3, ONE_WEEK: 7, ONE_MONTH: 30 };
  const until = input.until ? new Date(input.until) : input.preset && durations[input.preset] ? new Date(Date.now() + durations[input.preset] * 86_400_000) : null;
  const condition = input.condition && ["PLAYLIST_CHANGES", "NEW_TRACKS_ANALYZED"].includes(input.condition) ? input.condition : null;
  if ((!until || Number.isNaN(until.getTime()) || until <= new Date()) && !condition) throw new SmartActionError("Choose a future snooze date or a supported condition.");
  return transition(userId, id, "SNOOZED", { snoozedUntil: until, snoozeCondition: condition, reviewedAt: new Date() }, condition || `Snoozed until ${until?.toISOString()}`);
}

export async function scheduleSmartAction(userId: string, id: string, scheduledFor?: string) {
  const action = await prisma.smartAction.findFirst({ where: { id, userId } });
  if (!action) throw new SmartActionError("Smart Action not found.", 404, "NOT_FOUND");
  if (action.status === "PENDING") await approveSmartAction(userId, id);
  const date = scheduledFor ? new Date(scheduledFor) : null;
  if (date && (Number.isNaN(date.getTime()) || date <= new Date())) throw new SmartActionError("Scheduled time must be in the future.");
  return transition(userId, id, "SCHEDULED", { scheduledFor: date, approvedAt: action.approvedAt || new Date(), approvedBy: userId }, date ? `Scheduled for ${date.toISOString()}` : "Scheduled for the next maintenance window");
}

async function revalidateAction(action: Awaited<ReturnType<typeof prisma.smartAction.findUnique>> & {}) {
  if (!action) throw new SmartActionError("Smart Action not found.", 404, "NOT_FOUND");
  if (action.expiresAt && action.expiresAt <= new Date()) throw new SmartActionError("This recommendation expired and must be regenerated.", 409, "EXPIRED");
  const payload = smartActionPayloadSchema.parse(action.actionPayload);
  if (action.playlistId) {
    const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: action.playlistId, userId: action.userId }, select: { id: true, updatedAt: true, revisionCounter: true } });
    if (!playlist) throw new SmartActionError("The affected playlist no longer exists.", 409, "EXPIRED");
    if ("expectedPlaylistUpdatedAt" in payload && payload.expectedPlaylistUpdatedAt && playlist.updatedAt.toISOString() !== payload.expectedPlaylistUpdatedAt) throw new SmartActionError("The playlist changed after this recommendation was created. No changes were applied.", 409, "EXPIRED");
    if ("expectedPlaylistRevision" in payload && payload.expectedPlaylistRevision != null && playlist.revisionCounter !== payload.expectedPlaylistRevision) throw new SmartActionError("The playlist version changed after this recommendation was created. No changes were applied.", 409, "EXPIRED");
  }
  if (payload.type === "METADATA_CORRECTION") {
    const track = await findOwnedTrackWithMetadata(action.userId, payload.trackId);
    const verified = track.metadataCorrections.find((item) => item.field === payload.field && item.isActive && item.isVerified);
    if (verified) throw new SmartActionError("A verified manual correction now protects this metadata value.", 409, "EXPIRED");
  }
  return payload;
}

function stateByTrack(rows: Array<{ trackId: string | null; locked: boolean; liked: boolean; regenerationExcluded: boolean; automationProtected: boolean; protectionReason: string | null; protectedByUserId: string | null; protectedAt: Date | null }>) {
  return new Map(rows.filter((row): row is typeof row & { trackId: string } => Boolean(row.trackId)).map((row) => [row.trackId, row]));
}

async function applyPlaylistPayload(action: NonNullable<Awaited<ReturnType<typeof prisma.smartAction.findUnique>>>, payload: Exclude<SmartActionPayload, { type: "METADATA_CORRECTION" | "PLAYLIST_REFRESH" }>) {
  if (!action.playlistId) throw new SmartActionError("This action has no playlist target.", 409, "INVALID_TARGET");
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: action.playlistId, userId: action.userId }, include: { tracks: { orderBy: { position: "asc" } } } });
  if (!playlist || !playlist.serverId || !playlist.plexPlaylistRatingKey) throw new SmartActionError("The Plex playlist is unavailable.", 409, "INVALID_TARGET");
  const originalIds = playlist.tracks.map((row) => row.trackId).filter((id): id is string => Boolean(id));
  if (originalIds.length !== playlist.tracks.length) throw new SmartActionError("Some playlist tracks no longer have a library record.", 409, "EXPIRED");
  let desiredIds = [...originalIds];
  if (payload.type === "TRACK_ADDITION") {
    if (desiredIds.includes(payload.trackId)) throw new SmartActionError("The suggested track is already in the playlist.", 409, "EXPIRED");
    desiredIds.splice(Math.min(desiredIds.length, Math.max(0, (payload.position || desiredIds.length + 1) - 1)), 0, payload.trackId);
  } else if (payload.type === "TRACK_REMOVAL") {
    const index = desiredIds.indexOf(payload.trackId); if (index < 0) throw new SmartActionError("The suggested track is no longer in the playlist.", 409, "EXPIRED");
    desiredIds.splice(index, 1, ...(payload.replacementTrackId ? [payload.replacementTrackId] : []));
  } else if (payload.type === "PLAYLIST_OVERLAP_FIX") {
    const removed = new Set(payload.removeTrackIds); desiredIds = desiredIds.filter((id) => !removed.has(id));
    for (const id of payload.addTrackIds) if (!desiredIds.includes(id)) desiredIds.push(id);
  } else if (payload.type === "TRANSITION_FIX") desiredIds = payload.orderedTrackIds;
  else if (payload.type === "IDENTITY_DRIFT") desiredIds = payload.proposedTrackIds;
  else if (payload.type === "COVERAGE_OPPORTUNITY") desiredIds = payload.position === "START" ? [...payload.trackIds.filter((id) => !desiredIds.includes(id)), ...desiredIds] : [...desiredIds, ...payload.trackIds.filter((id) => !desiredIds.includes(id))];
  if (new Set(desiredIds).size !== desiredIds.length) throw new SmartActionError("The proposed playlist would contain duplicate track records.", 409, "INVALID_PREVIEW");
  const removedIds = originalIds.filter((id) => !desiredIds.includes(id));
  const states = stateByTrack(playlist.tracks);
  const protectedRemoval = removedIds.map((id) => states.get(id)).find((row) => row?.locked || row?.automationProtected || row?.regenerationExcluded);
  if (protectedRemoval) throw new SmartActionError("A locked or protected track would be removed. No changes were applied.", 409, "PROTECTED_TRACK");
  const tracks: any[] = [];
  for (let offset = 0; offset < desiredIds.length; offset += 300) tracks.push(...await prisma.track.findMany({ where: { id: { in: desiredIds.slice(offset, offset + 300) }, library: { server: { userId: action.userId } }, syncStatus: "active", deletedAt: null }, include: { artist: { select: { title: true } }, album: { select: { title: true } } } }));
  if (tracks.length !== desiredIds.length) throw new SmartActionError("One or more proposed tracks are no longer available.", 409, "EXPIRED");
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  const version = await createPlaylistVersion({ generatedPlaylistId: playlist.id, reason: "smart_action", label: `Before Smart Action: ${action.title}`, description: `Protected snapshot before Smart Action ${action.id}.`, force: true, smartActionId: action.id });
  try {
    await syncTrackIdsToPlexPlaylist({ userId: action.userId, serverId: playlist.serverId, playlistId: playlist.plexPlaylistRatingKey, name: playlist.plexPlaylistTitle, trackIds: desiredIds });
    await prisma.$transaction(async (tx) => {
      await tx.generatedPlaylistTrack.deleteMany({ where: { generatedPlaylistId: playlist.id } });
      await tx.generatedPlaylistTrack.createMany({ data: desiredIds.map((id, index) => {
        const track = trackMap.get(id)!; const state = states.get(id);
        return { generatedPlaylistId: playlist.id, trackId: id, plexTrackRatingKey: track.ratingKey || track.plexId, position: index + 1, title: track.title, artist: track.artist.title, album: track.album.title,
          locked: state?.locked || false, liked: state?.liked || Number(track.rating) >= 8, regenerationExcluded: state?.regenerationExcluded || false,
          automationProtected: state?.automationProtected || false, protectionReason: state?.protectionReason || null, protectedByUserId: state?.protectedByUserId || null, protectedAt: state?.protectedAt || null };
      }) });
      await tx.generatedPlaylist.update({ where: { id: playlist.id }, data: { trackCount: desiredIds.length, lastRegeneratedAt: new Date() } });
      await tx.playlistOverlapSummary.updateMany({ where: { OR: [{ playlistAId: playlist.id }, { playlistBId: playlist.id }] }, data: { stale: true } });
    });
  } catch (error) {
    await syncTrackIdsToPlexPlaylist({ userId: action.userId, serverId: playlist.serverId, playlistId: playlist.plexPlaylistRatingKey, name: playlist.plexPlaylistTitle, trackIds: originalIds }).catch(() => undefined);
    throw error;
  }
  const resultVersion = await createPlaylistVersion({ generatedPlaylistId: playlist.id, reason: "smart_action", label: `After Smart Action: ${action.title}`, description: `Result after approved Smart Action ${action.id}.`, force: true }).catch((error) => {
    console.warn("[SmartActions] Applied action but could not create the post-action comparison version", { actionId: action.id, playlistId: playlist.id, error: error instanceof Error ? error.message : "unknown" });
    return null;
  });
  return { playlistId: playlist.id, playlistVersionId: version?.id || null, resultPlaylistVersionId: resultVersion?.id || null, tracksAdded: desiredIds.filter((id) => !originalIds.includes(id)).length, tracksRemoved: removedIds.length, tracksReordered: desiredIds.filter((id, index) => originalIds.includes(id) && originalIds[index] !== id).length };
}

export async function applySmartAction(userId: string, id: string, options?: { maintenance?: boolean; actorType?: string }) {
  const action = await prisma.smartAction.findFirst({ where: { id, userId } });
  if (!action) throw new SmartActionError("Smart Action not found.", 404, "NOT_FOUND");
  const allowed = options?.maintenance ? ["SCHEDULED", "APPROVED"] : ["APPROVED", "SCHEDULED"];
  if (!allowed.includes(action.status)) throw new SmartActionError("Approve this action before applying it.", 409, "APPROVAL_REQUIRED");
  const payload = smartActionPayloadSchema.parse(action.actionPayload);
  const conflictRows = action.playlistId || payload.type === "METADATA_CORRECTION" ? await prisma.smartAction.findMany({ where: {
    userId, id: { not: id }, status: { in: ["APPROVED", "SCHEDULED", "RUNNING"] },
    ...(action.playlistId ? { playlistId: action.playlistId } : { actionType: "METADATA_CORRECTION" }),
  }, take: 100, select: { id: true, playlistId: true, actionType: true, actionPayload: true } }) : [];
  const conflicts = detectSmartActionConflicts([{ id, playlistId: action.playlistId, actionType: action.actionType, actionPayload: payload }, ...conflictRows.map((row) => ({ ...row, actionPayload: smartActionPayloadSchema.parse(row.actionPayload) }))]);
  if (conflicts.length) throw new SmartActionError(conflicts[0].reason, 409, "CONFLICT");
  const claimed = await prisma.smartAction.updateMany({ where: { id, userId, status: action.status }, data: { status: "RUNNING", startedAt: new Date(), failureReason: null, executionAttempts: { increment: 1 } } });
  if (!claimed.count) throw new SmartActionError("This action is already being processed.", 409, "CONCURRENT_EXECUTION");
  await audit(id, { actorUserId: options?.actorType === "SYSTEM" ? null : userId, actorType: options?.actorType, eventType: "EXECUTION_STARTED", previousStatus: action.status, newStatus: "RUNNING" });
  try {
    const validated = await revalidateAction({ ...action, status: "RUNNING" } as any);
    let result: Record<string, unknown>;
    if (validated.type === "METADATA_CORRECTION") {
      await setTrackMetadataCorrection({ userId, trackId: validated.trackId, field: validated.field, value: validated.suggestedValue, reason: `Approved Smart Action ${id}`, verified: true });
      result = { trackId: validated.trackId, field: validated.field, previousValue: validated.currentValue, value: validated.suggestedValue };
    } else if (validated.type === "PLAYLIST_REFRESH") {
      const refresh = await executeSmartRefreshEvaluation({ userId, generatedPlaylistId: action.playlistId!, evaluationId: validated.evaluationId, automatic: false });
      const version = await prisma.playlistRevision.findFirst({ where: { generatedPlaylistId: action.playlistId!, isCurrent: true }, orderBy: { createdAt: "desc" } });
      if (version && !version.smartActionId) await prisma.playlistRevision.update({ where: { id: version.id }, data: { smartActionId: id } });
      result = { playlistId: action.playlistId, playlistVersionId: version?.id || null, refresh };
    } else result = await applyPlaylistPayload(action, validated);
    const completed = await prisma.smartAction.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date(), actualImpact: json(result), failureReason: null } });
    if (validated.type === "TRACK_ADDITION" && validated.sourceMatchId) await prisma.recentlyAddedPlaylistMatch.updateMany({ where: { id: validated.sourceMatchId, generatedPlaylist: { userId } }, data: { status: "applied", appliedAt: new Date() } });
    await audit(id, { actorUserId: options?.actorType === "SYSTEM" ? null : userId, actorType: options?.actorType, eventType: "COMPLETED", previousStatus: "RUNNING", newStatus: "COMPLETED", result });
    return completed;
  } catch (error) {
    const expired = error instanceof SmartActionError && error.code === "EXPIRED";
    const status = expired ? "EXPIRED" : "FAILED";
    await prisma.smartAction.update({ where: { id }, data: { status, ...(expired ? { reviewedAt: new Date() } : { failedAt: new Date() }), failureReason: error instanceof Error ? error.message.slice(0, 2_000) : "Execution failed" } });
    await audit(id, { actorUserId: options?.actorType === "SYSTEM" ? null : userId, actorType: options?.actorType, eventType: status, previousStatus: "RUNNING", newStatus: status, reason: error instanceof Error ? error.message : "Execution failed" });
    throw error;
  }
}

export async function bulkSmartActions(userId: string, input: { action: "APPROVE" | "REJECT" | "SNOOZE" | "APPLY" | "SCHEDULE"; ids: string[]; reason?: string; snooze?: { preset?: string; until?: string; condition?: string }; scheduledFor?: string }) {
  const ids = Array.from(new Set(input.ids)).slice(0, 100);
  const actions = await prisma.smartAction.findMany({ where: { userId, id: { in: ids } } });
  if (actions.length !== ids.length) throw new SmartActionError("One or more actions are unavailable.", 404, "NOT_FOUND");
  const parsed = actions.map((item) => ({ id: item.id, playlistId: item.playlistId, actionType: item.actionType, actionPayload: smartActionPayloadSchema.parse(item.actionPayload), confidenceLevel: item.confidenceLevel, riskLevel: item.riskLevel as SmartActionRiskLevel, status: item.status }));
  const conflicts = detectSmartActionConflicts(parsed);
  if (["APPROVE", "APPLY", "SCHEDULE"].includes(input.action) && conflicts.length) throw new SmartActionError(conflicts[0].reason, 409, "CONFLICT");
  if (["APPROVE", "APPLY", "SCHEDULE"].includes(input.action) && actions.some((item) => item.riskLevel === "HIGH")) throw new SmartActionError("High-risk actions require individual review.", 409, "INDIVIDUAL_REVIEW_REQUIRED");
  const results: Array<{ id: string; status: string; error?: string }> = [];
  for (const action of actions) {
    try {
      if (input.action === "APPROVE") await approveSmartAction(userId, action.id);
      else if (input.action === "REJECT") await rejectSmartAction(userId, action.id, input.reason);
      else if (input.action === "SNOOZE") await snoozeSmartAction(userId, action.id, input.snooze || { preset: "ONE_WEEK" });
      else if (input.action === "SCHEDULE") await scheduleSmartAction(userId, action.id, input.scheduledFor);
      else { if (action.status === "PENDING") await approveSmartAction(userId, action.id); await applySmartAction(userId, action.id); }
      results.push({ id: action.id, status: "success" });
    } catch (error) { results.push({ id: action.id, status: "failed", error: error instanceof Error ? error.message : "Action failed" }); }
  }
  return { results, succeeded: results.filter((item) => item.status === "success").length, failed: results.filter((item) => item.status === "failed").length };
}

export async function expireAndWakeSmartActions(userId?: string) {
  const now = new Date(); const whereUser = userId ? { userId } : {};
  const expiredRows = await prisma.smartAction.findMany({ where: { ...whereUser, status: { in: ["PENDING", "APPROVED", "SNOOZED", "SCHEDULED"] }, expiresAt: { lte: now } }, select: { id: true, status: true } });
  for (const row of expiredRows) { await prisma.smartAction.update({ where: { id: row.id }, data: { status: "EXPIRED", reviewedAt: now } }); await audit(row.id, { eventType: "EXPIRED", previousStatus: row.status, newStatus: "EXPIRED", reason: "Recommendation retention period elapsed." }); }
  const snoozed = await prisma.smartAction.findMany({ where: { ...whereUser, status: "SNOOZED", snoozedUntil: { lte: now } } });
  let restored = 0;
  for (const row of snoozed) {
    try { await revalidateAction(row); await prisma.smartAction.update({ where: { id: row.id }, data: { status: "PENDING", snoozedUntil: null, snoozeCondition: null } }); await audit(row.id, { eventType: "SNOOZE_ENDED", previousStatus: "SNOOZED", newStatus: "PENDING", reason: "Snooze ended and recommendation remained valid." }); restored += 1; }
    catch (error) { await prisma.smartAction.update({ where: { id: row.id }, data: { status: "EXPIRED", failureReason: error instanceof Error ? error.message : "No longer valid" } }); await audit(row.id, { eventType: "EXPIRED", previousStatus: "SNOOZED", newStatus: "EXPIRED", reason: "Snoozed recommendation was obsolete after revalidation." }); }
  }
  return { expired: expiredRows.length, restored };
}

export async function runSmartActionMaintenance(userId?: string, options?: { force?: boolean }) {
  const users = userId ? [{ id: userId }] : await prisma.user.findMany({ select: { id: true } });
  const summaries = [];
  for (const user of users) {
    const settings = await getSmartActionSettings(user.id);
    const allowedDays = settings.maintenanceDays as number[];
    if (!settings.maintenanceEnabled || (!options?.force && !isMaintenanceWindow({ now: new Date(), startTime: settings.maintenanceStartTime, allowedDays }))) continue;
    if (settings.pauseDuringPlayback) {
      const playback = await prisma.plexPlaybackEvent.findFirst({ where: { server: { userId: user.id }, playedAt: { gte: new Date(Date.now() - 5 * 60_000) } }, select: { id: true } });
      if (playback) { summaries.push({ userId: user.id, status: "paused_for_playback", applied: 0, failed: 0, skipped: 0 }); continue; }
    }
    if (!settings.automationEmergencyDisabled) {
      const policies = await prisma.smartActionAutomationPolicy.findMany({ where: { userId: user.id, enabled: true } });
      for (const policy of policies) {
        const actions = await prisma.smartAction.findMany({ where: { userId: user.id, actionType: policy.actionType, status: "PENDING", confidenceScore: { gte: policy.minimumConfidence } }, orderBy: { confidenceScore: "desc" }, take: policy.maximumPerWindow });
        for (const action of actions.filter((item) => riskRank(item.riskLevel as SmartActionRiskLevel) <= riskRank(policy.maximumRisk as SmartActionRiskLevel))) {
          await transition(user.id, action.id, "APPROVED", { approvedAt: new Date(), approvedBy: `policy:${policy.id}` }, `Explicit automation policy ${policy.id}`);
          await transition(user.id, action.id, "SCHEDULED", { scheduledFor: null }, "Queued by explicit automation policy");
        }
      }
    }
    const actions = await prisma.smartAction.findMany({ where: { userId: user.id, status: "SCHEDULED", OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }] }, orderBy: [{ priority: "desc" }, { confidenceScore: "desc" }], take: settings.maximumActionsPerWindow });
    const playlistIds = new Set<string>(); let applied = 0; let failed = 0; let skipped = 0;
    for (const action of actions) {
      if (action.playlistId && !playlistIds.has(action.playlistId) && playlistIds.size >= settings.maximumPlaylistsPerWindow) { skipped += 1; continue; }
      if (action.actionType === "METADATA_CORRECTION" && !settings.allowMetadataChanges) { skipped += 1; continue; }
      if (action.actionType === "PLAYLIST_REFRESH" && !settings.allowPlaylistRegeneration) { skipped += 1; continue; }
      if (action.playlistId && !settings.allowPlexRefreshes) { skipped += 1; continue; }
      try { await applySmartAction(user.id, action.id, { maintenance: true, actorType: "SYSTEM" }); applied += 1; if (action.playlistId) playlistIds.add(action.playlistId); }
      catch { failed += 1; }
    }
    summaries.push({ userId: user.id, status: "completed", applied, failed, skipped });
  }
  return summaries;
}

export async function smartActionHistoryCsv(userId: string) {
  const rows = await prisma.smartAction.findMany({ where: { userId, status: { in: HISTORY_STATUSES } }, orderBy: { createdAt: "desc" }, take: 10_000, include: { playlist: { select: { plexPlaylistTitle: true } }, library: { select: { name: true } } } });
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return ["id,status,type,title,playlist,library,confidence,risk,created,completed,failure", ...rows.map((row) => [row.id, row.status, row.actionType, row.title, row.playlist?.plexPlaylistTitle, row.library?.name, row.confidenceScore, row.riskLevel, row.createdAt.toISOString(), row.completedAt?.toISOString(), row.failureReason].map(escape).join(","))].join("\n");
}
