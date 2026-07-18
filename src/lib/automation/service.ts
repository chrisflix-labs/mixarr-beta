import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { acquireJobLock } from "../jobLock";
import { exportTracksToPlex, syncGeneratedPlaylistToPlex } from "../playlistService";
import { createPlaylistVersionInTransaction } from "../playlists/versions/playlist-version-service";
import { previewPlaylistVersionRestore, restorePlaylistVersion } from "../playlists/versions/playlist-version-restore";
import {
  automationPolicySchema,
  automationPolicyUpdateSchema,
  evaluateAutomationPolicy,
  plainLanguagePolicySummary,
  policyForPreset,
  type AutomationCandidate,
  type AutomationPolicy,
  type AutomationPolicyDecision,
  type AutomationPolicyInput,
} from "./policy";

export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
  permissionLevel: "SUGGEST_ONLY", preset: "CONSERVATIVE", isCustom: false,
  allowAdditions: false, allowRemovals: false, allowReorder: false,
  maximumAdditionsPerUpdate: 0, maximumRemovalsPerUpdate: 0,
  minimumAdditionConfidence: 90, minimumRemovalConfidence: 95,
  maximumChangesPerDay: 0, maximumChangesPerWeek: 0,
  maximumAdditionsPerDay: 0, maximumRemovalsPerDay: 0,
  maximumAdditionsPerWeek: 0, maximumRemovalsPerWeek: 0,
  quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", timezone: "UTC",
  quietHoursDaysJson: null, allowAnalysisDuringQuietHours: true, allowProposalsDuringQuietHours: true,
  requireApprovalForRegeneration: true, paused: false, pauseReason: null,
};

const POLICY_SELECT = {
  permissionLevel: true, preset: true, isCustom: true, allowAdditions: true, allowRemovals: true, allowReorder: true,
  maximumAdditionsPerUpdate: true, maximumRemovalsPerUpdate: true, minimumAdditionConfidence: true, minimumRemovalConfidence: true,
  maximumChangesPerDay: true, maximumChangesPerWeek: true, maximumAdditionsPerDay: true, maximumRemovalsPerDay: true,
  maximumAdditionsPerWeek: true, maximumRemovalsPerWeek: true, quietHoursEnabled: true, quietHoursStart: true, quietHoursEnd: true,
  timezone: true, quietHoursDaysJson: true, allowAnalysisDuringQuietHours: true, allowProposalsDuringQuietHours: true,
  requireApprovalForRegeneration: true, paused: true, pauseReason: true,
} as const;

function parseStoredPolicy(value: Record<string, unknown>) {
  return automationPolicySchema.parse({ ...value, quietHoursDaysJson: Array.isArray(value.quietHoursDaysJson) ? value.quietHoursDaysJson : null });
}

export async function getAutomationPolicy(userId: string) {
  const stored = await prisma.automationPolicy.upsert({
    where: { userId }, update: {}, create: { userId, ...DEFAULT_AUTOMATION_POLICY, quietHoursDaysJson: undefined }, select: POLICY_SELECT,
  });
  const normalized = { ...(stored as unknown as Record<string, unknown>), quietHoursDaysJson: Array.isArray(stored.quietHoursDaysJson) ? stored.quietHoursDaysJson : null };
  const parsed = automationPolicySchema.safeParse(normalized);
  if (!parsed.success) {
    console.error("[AutomationPolicy] invalid stored policy; using disabled fallback", { userId, reasonCode: "policy_invalid", issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    return { ...DEFAULT_AUTOMATION_POLICY, permissionLevel: "DISABLED" as const, preset: "CUSTOM" as const, isCustom: true };
  }
  return parsed.data;
}

export async function saveAutomationPolicy(userId: string, raw: unknown) {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const current = await getAutomationPolicy(userId);
  let next: AutomationPolicy;
  if (body.applyPreset === true && ["CONSERVATIVE", "BALANCED", "AGGRESSIVE"].includes(String(body.preset))) {
    next = policyForPreset(body.preset as "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE", current);
  } else {
    const update = automationPolicyUpdateSchema.parse(body);
    const candidate = { ...current, ...update };
    const presetChanged = Object.keys(update).some((key) => !["preset", "isCustom"].includes(key));
    next = automationPolicySchema.parse({ ...candidate, preset: presetChanged ? "CUSTOM" : candidate.preset, isCustom: presetChanged ? true : candidate.isCustom });
  }
  const saved = await prisma.automationPolicy.upsert({
    where: { userId },
    update: { ...next, quietHoursDaysJson: next.quietHoursDaysJson === null ? Prisma.JsonNull : next.quietHoursDaysJson, revisionCounter: { increment: 1 } },
    create: { userId, ...next, quietHoursDaysJson: next.quietHoursDaysJson === null ? undefined : next.quietHoursDaysJson },
    select: POLICY_SELECT,
  });
  return parseStoredPolicy(saved as unknown as Record<string, unknown>);
}

export async function setAutomationPause(userId: string, paused: boolean, reason?: string | null) {
  await getAutomationPolicy(userId);
  const saved = await prisma.automationPolicy.update({
    where: { userId }, data: { paused, pauseReason: paused ? reason?.trim() || null : null, pausedAt: paused ? new Date() : null, pausedByUserId: paused ? userId : null, revisionCounter: { increment: 1 } }, select: POLICY_SELECT,
  });
  return parseStoredPolicy(saved as unknown as Record<string, unknown>);
}

export async function getEffectivePlaylistPolicy(userId: string, generatedPlaylistId: string) {
  const [globalPolicy, playlist] = await Promise.all([
    getAutomationPolicy(userId),
    prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, include: { automationSettings: true } }),
  ]);
  if (!playlist) return null;
  const override = playlist.automationSettings;
  if (!override || override.useGlobalPolicy) return { playlist, policy: globalPolicy, source: "GLOBAL" as const };
  const policy = automationPolicySchema.parse({
    ...globalPolicy,
    ...(override.permissionLevel ? { permissionLevel: override.permissionLevel } : {}),
    ...(override.preset ? { preset: override.preset } : {}),
    ...(override.allowAdditions != null ? { allowAdditions: override.allowAdditions } : {}),
    ...(override.allowRemovals != null ? { allowRemovals: override.allowRemovals } : {}),
    ...(override.allowReorder != null ? { allowReorder: override.allowReorder } : {}),
    ...(override.maximumAdditionsPerUpdate != null ? { maximumAdditionsPerUpdate: override.maximumAdditionsPerUpdate } : {}),
    ...(override.maximumRemovalsPerUpdate != null ? { maximumRemovalsPerUpdate: override.maximumRemovalsPerUpdate } : {}),
    ...(override.minimumAdditionConfidence != null ? { minimumAdditionConfidence: override.minimumAdditionConfidence } : {}),
    ...(override.minimumRemovalConfidence != null ? { minimumRemovalConfidence: override.minimumRemovalConfidence } : {}),
    ...(override.requireApprovalForRegeneration != null ? { requireApprovalForRegeneration: override.requireApprovalForRegeneration } : {}),
    isCustom: true,
  });
  return { playlist, policy, source: "PLAYLIST_OVERRIDE" as const };
}

function zonedDateParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return { key: `${get("year")}-${get("month")}-${get("day")}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")) };
}

export async function getAutomationUsage(userId: string, policy?: AutomationPolicy, now = new Date()) {
  const resolvedPolicy = policy || await getAutomationPolicy(userId);
  const current = zonedDateParts(now, resolvedPolicy.timezone);
  const currentDayNumber = Math.floor(Date.UTC(...current.key.split("-").map(Number).map((value, index) => index === 1 ? value - 1 : value) as [number, number, number]) / 86_400_000);
  const currentWeekStart = currentDayNumber - ((current.weekday + 6) % 7);
  const rows = await prisma.automationActivity.findMany({
    where: { userId, createdAt: { gte: new Date(now.getTime() - 9 * 86_400_000) }, status: { in: ["APPLIED", "ROLLED_BACK", "PARTIAL"] } },
    select: { createdAt: true, appliedAdditions: true, appliedRemovals: true, appliedReorders: true, usageAdjustment: true },
  });
  const usage = { today: { additions: 0, removals: 0, reorders: 0 }, week: { additions: 0, removals: 0, reorders: 0 } };
  for (const row of rows) {
    const parts = zonedDateParts(row.createdAt, resolvedPolicy.timezone);
    const dayNumber = Math.floor(Date.UTC(...parts.key.split("-").map(Number).map((value, index) => index === 1 ? value - 1 : value) as [number, number, number]) / 86_400_000);
    const target = dayNumber === currentDayNumber ? [usage.today, usage.week] : dayNumber >= currentWeekStart ? [usage.week] : [];
    for (const bucket of target) {
      bucket.additions += row.appliedAdditions;
      bucket.removals += row.appliedRemovals;
      bucket.reorders += row.appliedReorders + row.usageAdjustment;
    }
  }
  const totals = { today: usage.today.additions + usage.today.removals + usage.today.reorders, week: usage.week.additions + usage.week.removals + usage.week.reorders };
  return { ...usage, totals, limits: { day: resolvedPolicy.maximumChangesPerDay, week: resolvedPolicy.maximumChangesPerWeek } };
}

export async function evaluatePlaylistAutomation(input: Omit<AutomationPolicyInput, "policy" | "protectedPlaylist" | "playlistPaused" | "usedToday" | "usedThisWeek"> & { userId: string; generatedPlaylistId: string }) {
  const effective = await getEffectivePlaylistPolicy(input.userId, input.generatedPlaylistId);
  if (!effective) return evaluateAutomationPolicy({ policy: null, source: input.source, additions: input.additions, removals: input.removals });
  const removalTrackIds = (input.removals || []).map((item) => item.trackId).filter((id): id is string => Boolean(id));
  const [usage, protectedMemberships] = await Promise.all([
    getAutomationUsage(input.userId, effective.policy, input.now),
    removalTrackIds.length ? prisma.generatedPlaylistTrack.findMany({ where: { generatedPlaylistId: input.generatedPlaylistId, trackId: { in: removalTrackIds } }, select: { trackId: true, automationProtected: true, locked: true, liked: true, regenerationExcluded: true } }) : [],
  ]);
  const membershipByTrack = new Map(protectedMemberships.filter((item) => item.trackId).map((item) => [item.trackId!, item]));
  const removals = (input.removals || []).map((item) => {
    const member = item.trackId ? membershipByTrack.get(item.trackId) : null;
    return { ...item, protected: Boolean(item.protected || member?.automationProtected), locked: Boolean(item.locked || member?.locked || member?.regenerationExcluded), important: Boolean(item.important || member?.liked) };
  });
  return evaluateAutomationPolicy({
    ...input, removals, policy: effective.policy, protectedPlaylist: effective.playlist.automationSettings?.protected || false,
    playlistPaused: effective.playlist.automationSettings?.paused || false, usedToday: usage.today, usedThisWeek: usage.week,
  });
}

export async function savePlaylistPolicyOverride(userId: string, generatedPlaylistId: string, raw: unknown) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, select: { id: true } });
  if (!playlist) return null;
  const schema = z.object({
    permissionLevel: z.enum(["DISABLED", "SUGGEST_ONLY", "REQUIRE_APPROVAL", "FULLY_AUTOMATIC"]).optional(),
    preset: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE", "CUSTOM"]).optional(),
    allowAdditions: z.boolean().optional(), allowRemovals: z.boolean().optional(), allowReorder: z.boolean().optional(),
    maximumAdditionsPerUpdate: z.coerce.number().int().min(0).max(500).optional(), maximumRemovalsPerUpdate: z.coerce.number().int().min(0).max(500).optional(),
    minimumAdditionConfidence: z.coerce.number().int().min(0).max(100).optional(), minimumRemovalConfidence: z.coerce.number().int().min(0).max(100).optional(),
    requireApprovalForRegeneration: z.boolean().optional(),
  });
  const parsed = schema.parse(raw);
  return prisma.playlistAutomationSettings.upsert({
    where: { generatedPlaylistId }, update: { userId, useGlobalPolicy: false, ...parsed }, create: { userId, generatedPlaylistId, useGlobalPolicy: false, ...parsed },
  });
}

export async function resetPlaylistPolicyOverride(userId: string, generatedPlaylistId: string) {
  const owned = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, select: { id: true } });
  if (!owned) return null;
  return prisma.playlistAutomationSettings.upsert({ where: { generatedPlaylistId }, update: { useGlobalPolicy: true }, create: { userId, generatedPlaylistId, useGlobalPolicy: true } });
}

export async function setPlaylistProtection(userId: string, generatedPlaylistId: string, protectedValue: boolean, reason?: string | null) {
  const owned = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, select: { id: true } });
  if (!owned) return null;
  return prisma.playlistAutomationSettings.upsert({
    where: { generatedPlaylistId },
    update: { protected: protectedValue, protectionReason: protectedValue ? reason?.trim() || null : null, protectedByUserId: protectedValue ? userId : null, protectedAt: protectedValue ? new Date() : null },
    create: { userId, generatedPlaylistId, protected: protectedValue, protectionReason: protectedValue ? reason?.trim() || null : null, protectedByUserId: protectedValue ? userId : null, protectedAt: protectedValue ? new Date() : null },
  });
}

export async function setTrackProtection(userId: string, generatedPlaylistId: string, trackId: string, protectedValue: boolean, reason?: string | null) {
  const membership = await prisma.generatedPlaylistTrack.findFirst({ where: { generatedPlaylistId, trackId, generatedPlaylist: { userId } }, select: { id: true } });
  if (!membership) return null;
  return prisma.generatedPlaylistTrack.update({ where: { id: membership.id }, data: { automationProtected: protectedValue, protectionReason: protectedValue ? reason?.trim() || null : null, protectedByUserId: protectedValue ? userId : null, protectedAt: protectedValue ? new Date() : null } });
}

export async function createAutomationProposal(input: {
  userId: string; generatedPlaylistId: string; source: string; decision: AutomationPolicyDecision;
  items: Array<AutomationCandidate & { action: "ADD" | "REMOVE"; plexRatingKey?: string | null; positionBefore?: number | null; positionAfter?: number | null; explanation?: unknown }>;
  idempotencyKey: string; requestingJobId?: string | null; expiresAt?: Date | null; status?: "PENDING" | "SUGGESTED" | "DELAYED";
}) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: input.generatedPlaylistId, userId: input.userId }, select: { id: true, updatedAt: true, revisions: { orderBy: { revisionNumber: "desc" }, take: 1, select: { revisionNumber: true } } } });
  if (!playlist) return null;
  return prisma.automationProposal.upsert({
    where: { idempotencyKey: input.idempotencyKey }, update: {},
    create: {
      userId: input.userId, generatedPlaylistId: input.generatedPlaylistId, source: input.source, status: input.status || "PENDING",
      sourceRevisionNumber: playlist.revisions[0]?.revisionNumber ?? null, sourcePlaylistUpdatedAt: playlist.updatedAt,
      policyDecisionJson: input.decision as unknown as Prisma.InputJsonValue, policySnapshotJson: input.decision.policySnapshot as Prisma.InputJsonValue,
      summaryJson: { proposed: input.items.length, allowedAdditions: input.decision.allowedAdditions, allowedRemovals: input.decision.allowedRemovals }, warningsJson: input.decision.warnings,
      requestingJobId: input.requestingJobId || null, idempotencyKey: input.idempotencyKey, expiresAt: input.expiresAt === null ? null : input.expiresAt || new Date(Date.now() + 14 * 86_400_000),
      items: { create: input.items.map((item) => ({ action: item.action, trackId: item.trackId || null, plexRatingKey: item.plexRatingKey || null, positionBefore: item.positionBefore || null, positionAfter: item.positionAfter || null, confidence: item.confidence == null ? null : Math.round(item.confidence), explanationJson: item.explanation as Prisma.InputJsonValue | undefined, status: "PENDING" })) },
    }, include: { items: true },
  });
}

export async function recordAutomationActivity(input: {
  userId: string; generatedPlaylistId: string; source: string; status: string; decision: AutomationPolicyDecision;
  proposedAdditions?: number; proposedRemovals?: number; appliedAdditions?: number; appliedRemovals?: number; appliedReorders?: number;
  playlistRevisionId?: string | null; proposalId?: string | null; jobId?: string | null; error?: string | null;
  items?: Array<{ action: string; trackId?: string | null; plexRatingKey?: string | null; confidence?: number | null; outcome: string; reasonCode?: string | null; explanation?: unknown }>;
}) {
  return prisma.automationActivity.create({ data: {
    userId: input.userId, generatedPlaylistId: input.generatedPlaylistId, source: input.source, status: input.status,
    permissionLevel: String(input.decision.policySnapshot.permissionLevel || "SUGGEST_ONLY"), reasonCode: input.decision.reasonCode, summary: input.decision.summary,
    proposedAdditions: input.proposedAdditions || 0, proposedRemovals: input.proposedRemovals || 0, appliedAdditions: input.appliedAdditions || 0,
    appliedRemovals: input.appliedRemovals || 0, appliedReorders: input.appliedReorders || 0, policySnapshotJson: input.decision.policySnapshot as Prisma.InputJsonValue,
    decisionJson: input.decision as unknown as Prisma.InputJsonValue, jobId: input.jobId || null, proposalId: input.proposalId || null,
    playlistRevisionId: input.playlistRevisionId || null, error: input.error || null, completedAt: ["APPLIED", "BLOCKED", "FAILED", "SUGGESTED", "AWAITING_APPROVAL"].includes(input.status) ? new Date() : null,
    items: input.items?.length ? { create: input.items.map((item) => ({ action: item.action, trackId: item.trackId || null, plexRatingKey: item.plexRatingKey || null, confidence: item.confidence == null ? null : Math.round(item.confidence), outcome: item.outcome, reasonCode: item.reasonCode || null, explanationJson: item.explanation as Prisma.InputJsonValue | undefined })) } : undefined,
  }, include: { items: true } });
}

export async function getAutomationOverview(userId: string) {
  const policy = await getAutomationPolicy(userId);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [usage, protectedPlaylists, pendingApprovals, lastActivity, completedToday] = await Promise.all([
    getAutomationUsage(userId, policy),
    prisma.playlistAutomationSettings.count({ where: { userId, protected: true } }),
    prisma.automationProposal.count({ where: { userId, status: "PENDING" } }),
    prisma.automationActivity.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, summary: true, createdAt: true, generatedPlaylistId: true } }),
    prisma.automationActivity.count({ where: { userId, status: "APPLIED", completedAt: { gte: startOfToday } } }),
  ]);
  return { policy, policySummary: plainLanguagePolicySummary(policy), usage, protectedPlaylists, pendingApprovals, lastActivity, completedToday };
}

export async function listAutomationProposals(userId: string, input?: { status?: string; playlistId?: string; limit?: number }) {
  const limit = Math.min(100, Math.max(1, input?.limit || 50));
  return prisma.automationProposal.findMany({
    where: { userId, ...(input?.status ? { status: input.status } : {}), ...(input?.playlistId ? { generatedPlaylistId: input.playlistId } : {}) },
    orderBy: { createdAt: "desc" }, take: limit,
    include: { generatedPlaylist: { select: { id: true, plexPlaylistTitle: true, updatedAt: true } }, items: { orderBy: { createdAt: "asc" } } },
  });
}

export async function getAutomationProposal(userId: string, proposalId: string) {
  return prisma.automationProposal.findFirst({ where: { id: proposalId, userId }, include: { generatedPlaylist: { select: { id: true, plexPlaylistTitle: true, updatedAt: true, trackCount: true } }, items: { orderBy: { createdAt: "asc" } } } });
}

export async function rejectAutomationProposal(userId: string, proposalId: string, reason?: string | null, selectedItemIds?: string[]) {
  const proposal = await getAutomationProposal(userId, proposalId);
  if (!proposal) return null;
  if (!["PENDING", "PARTIALLY_APPROVED"].includes(proposal.status)) return proposal;
  const selected = selectedItemIds?.length ? new Set(selectedItemIds) : null;
  await prisma.$transaction(async (tx) => {
    await tx.automationProposalItem.updateMany({ where: { proposalId, status: "PENDING", ...(selected ? { id: { in: Array.from(selected) } } : {}) }, data: { status: "REJECTED", reasonCode: "user_rejected" } });
    const remaining = await tx.automationProposalItem.count({ where: { proposalId, status: "PENDING", ...(selected ? { id: { notIn: Array.from(selected) } } : {}) } });
    await tx.automationProposal.update({ where: { id: proposalId }, data: { status: remaining ? "PARTIALLY_APPROVED" : "REJECTED", reviewedByUserId: userId, reviewedAt: new Date(), rejectionReason: reason?.trim() || null } });
  });
  return getAutomationProposal(userId, proposalId);
}

export async function recalculateAutomationProposal(userId: string, proposalId: string) {
  const proposal = await getAutomationProposal(userId, proposalId);
  if (!proposal) return null;
  if (["APPLIED", "RECALCULATED"].includes(proposal.status)) return proposal;
  const { runRecentlyAddedAutomation } = await import("../recentlyAdded/automation");
  const result = await runRecentlyAddedAutomation({ userId, triggerType: proposal.source === "SCHEDULED_REGENERATION" ? "scheduled" : "manual", scan: false });
  await prisma.automationProposal.update({ where: { id: proposal.id }, data: { status: "RECALCULATED", reviewedByUserId: userId, reviewedAt: new Date() } });
  return { proposal: await getAutomationProposal(userId, proposalId), recalculation: result };
}

export async function dismissAutomationProposal(userId: string, proposalId: string) {
  const proposal = await getAutomationProposal(userId, proposalId);
  if (!proposal) return null;
  if (!["EXPIRED", "STALE", "SUGGESTED", "DELAYED", "REJECTED"].includes(proposal.status)) throw new Error("Only expired, stale, delayed, rejected, or suggestion proposals can be dismissed.");
  return prisma.automationProposal.update({ where: { id: proposal.id }, data: { status: "DISMISSED", reviewedByUserId: userId, reviewedAt: new Date() } });
}

export async function approveAutomationProposal(userId: string, proposalId: string, selectedItemIds?: string[]) {
  const lock = acquireJobLock({ name: "automation proposal approval", keys: [`automation:user:${userId}`, `automation:proposal:${proposalId}`], source: "approval_queue" });
  if (!lock.acquired) throw new Error("This automation proposal is already being processed.");
  try {
    const proposal = await getAutomationProposal(userId, proposalId);
    if (!proposal) return null;
    if (proposal.status === "APPLIED") return proposal;
    if (!["PENDING", "PARTIALLY_APPROVED"].includes(proposal.status)) throw new Error("This proposal is no longer pending.");
    if (proposal.expiresAt && proposal.expiresAt <= new Date()) {
      await prisma.automationProposal.update({ where: { id: proposal.id }, data: { status: "EXPIRED" } });
      throw new Error("This proposal expired and must be recalculated.");
    }
    if (proposal.generatedPlaylist.updatedAt.getTime() !== proposal.sourcePlaylistUpdatedAt.getTime()) {
      await prisma.automationProposal.update({ where: { id: proposal.id }, data: { status: "STALE" } });
      throw new Error("The playlist changed after this proposal was created. Recalculate it before approval.");
    }
    const selected = new Set(selectedItemIds?.length ? selectedItemIds : proposal.items.filter((item) => item.status === "PENDING").map((item) => item.id));
    const requested = proposal.items.filter((item) => item.status === "PENDING" && selected.has(item.id));
    if (!requested.length) throw new Error("Select at least one pending change.");
    const playlistTracks = await prisma.generatedPlaylistTrack.findMany({ where: { generatedPlaylistId: proposal.generatedPlaylistId }, select: { trackId: true, locked: true, liked: true, automationProtected: true } });
    const membership = new Map(playlistTracks.filter((item) => item.trackId).map((item) => [item.trackId!, item]));
    const additions = requested.filter((item) => item.action === "ADD").map((item) => ({ id: item.id, trackId: item.trackId, confidence: item.confidence, metadataComplete: Boolean(item.trackId && item.plexRatingKey) }));
    const removals = requested.filter((item) => item.action === "REMOVE").map((item) => { const member = item.trackId ? membership.get(item.trackId) : null; return { id: item.id, trackId: item.trackId, confidence: item.confidence, metadataComplete: Boolean(item.trackId), protected: member?.automationProtected, locked: member?.locked, important: member?.liked }; });
    const decision = await evaluatePlaylistAutomation({ userId, generatedPlaylistId: proposal.generatedPlaylistId, source: "APPROVAL_QUEUE", approvalGranted: true, additions, removals });
    if (!decision.allowed) {
      await recordAutomationActivity({ userId, generatedPlaylistId: proposal.generatedPlaylistId, source: "APPROVAL_QUEUE", status: "BLOCKED", decision, proposedAdditions: additions.length, proposedRemovals: removals.length, proposalId });
      throw new Error(decision.summary);
    }
    const allowedAdditions = requested.filter((item) => decision.eligibleAdditionIds.includes(item.id) && item.trackId);
    const allowedRemovals = requested.filter((item) => decision.eligibleRemovalIds.includes(item.id) && item.trackId);
    const additionTracks = allowedAdditions.length ? await prisma.track.findMany({ where: { id: { in: allowedAdditions.map((item) => item.trackId!) }, library: { server: { userId } }, syncStatus: "active" }, include: { artist: true, album: true } }) : [];
    const byId = new Map(additionTracks.map((track) => [track.id, track]));
    let backupId: string | null = null;
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.generatedPlaylist.findFirst({ where: { id: proposal.generatedPlaylistId, userId, updatedAt: proposal.sourcePlaylistUpdatedAt }, include: { tracks: { orderBy: { position: "asc" } } } });
      if (!fresh) throw new Error("The playlist changed while approval was being processed. Recalculate the proposal.");
      const backup = await createPlaylistVersionInTransaction(tx, { generatedPlaylistId: proposal.generatedPlaylistId, reason: "automation_backup", description: `Automatic backup before applying proposal ${proposal.id}`, force: true });
      backupId = backup.id;
      if (allowedRemovals.length) await tx.generatedPlaylistTrack.deleteMany({ where: { generatedPlaylistId: proposal.generatedPlaylistId, trackId: { in: allowedRemovals.map((item) => item.trackId!) }, automationProtected: false, locked: false } });
      const currentCount = await tx.generatedPlaylistTrack.count({ where: { generatedPlaylistId: proposal.generatedPlaylistId } });
      const validAdditions = allowedAdditions.map((item) => byId.get(item.trackId!)).filter((track): track is NonNullable<typeof track> => Boolean(track) && !membership.has(track!.id));
      if (validAdditions.length) await tx.generatedPlaylistTrack.createMany({ data: validAdditions.map((track, index) => ({ generatedPlaylistId: proposal.generatedPlaylistId, trackId: track.id, plexTrackRatingKey: track.ratingKey || track.plexId, position: currentCount + index + 1, title: track.title, artist: track.artist.title, album: track.album.title, liked: Number(track.rating) >= 8 })), skipDuplicates: true });
      const remaining = await tx.generatedPlaylistTrack.findMany({ where: { generatedPlaylistId: proposal.generatedPlaylistId }, orderBy: { position: "asc" }, select: { id: true, trackId: true, position: true } });
      const desiredPositions = new Map(allowedAdditions.filter((item) => item.trackId && item.positionAfter).map((item) => [item.trackId!, item.positionAfter!]));
      remaining.sort((left, right) => (desiredPositions.get(left.trackId || "") ?? left.position) - (desiredPositions.get(right.trackId || "") ?? right.position));
      for (let index = 0; index < remaining.length; index += 1) await tx.generatedPlaylistTrack.update({ where: { id: remaining[index].id }, data: { position: index + 1 } });
      await tx.generatedPlaylist.update({ where: { id: proposal.generatedPlaylistId }, data: { trackCount: remaining.length, lastRegeneratedAt: new Date() } });
      await tx.playlistOverlapSummary.updateMany({ where: { OR: [{ playlistAId: proposal.generatedPlaylistId }, { playlistBId: proposal.generatedPlaylistId }] }, data: { stale: true } });
      await tx.playlistCoordinationSetting.updateMany({ where: { playlistId: proposal.generatedPlaylistId }, data: { analysisStale: true } });
      await tx.automationProposalItem.updateMany({ where: { id: { in: [...allowedAdditions, ...allowedRemovals].map((item) => item.id) } }, data: { status: "APPROVED" } });
    });
    let syncError: string | null = null;
    try {
      const current = await prisma.generatedPlaylist.findFirst({ where: { id: proposal.generatedPlaylistId, userId }, include: { tracks: { orderBy: { position: "asc" }, select: { trackId: true } } } });
      if (!current) throw new Error("Playlist no longer exists.");
      if (current.plexPlaylistRatingKey) await syncGeneratedPlaylistToPlex(userId, proposal.generatedPlaylistId);
      else {
        const trackIds = current.tracks.map((track) => track.trackId).filter((id): id is string => Boolean(id));
        const exported = await exportTracksToPlex({ userId, name: current.plexPlaylistTitle, trackIds, optionsJson: JSON.stringify({ engineVersion: current.engineVersion, limit: trackIds.length }) });
        await prisma.generatedPlaylist.update({ where: { id: current.id }, data: { serverId: exported.serverId, plexPlaylistRatingKey: exported.playlistId } });
      }
    } catch (error) { syncError = error instanceof Error ? error.message : "Plex synchronization failed"; }
    const activity = await recordAutomationActivity({
      userId, generatedPlaylistId: proposal.generatedPlaylistId, source: "APPROVAL_QUEUE", status: syncError ? "PARTIAL" : "APPLIED", decision,
      proposedAdditions: additions.length, proposedRemovals: removals.length, appliedAdditions: syncError ? 0 : allowedAdditions.length, appliedRemovals: syncError ? 0 : allowedRemovals.length,
      playlistRevisionId: backupId, proposalId, error: syncError,
      items: requested.map((item) => ({ action: item.action, trackId: item.trackId, plexRatingKey: item.plexRatingKey, confidence: item.confidence, outcome: decision.eligibleAdditionIds.includes(item.id) || decision.eligibleRemovalIds.includes(item.id) ? (syncError ? "PARTIAL" : "APPLIED") : "SKIPPED", reasonCode: syncError ? "plex_unavailable" : decision.skipped.find((skip) => skip.candidateId === item.id)?.reasonCode })),
    });
    await prisma.automationProposal.update({ where: { id: proposal.id }, data: { status: syncError ? "PARTIAL" : "APPLIED", reviewedByUserId: userId, reviewedAt: new Date(), appliedActivityId: activity.id } });
    if (syncError) throw new Error(`Plex only partially synchronized: ${syncError}`);
    return getAutomationProposal(userId, proposalId);
  } finally { lock.release(); }
}

export async function listAutomationActivity(userId: string, input?: { status?: string; source?: string; playlistId?: string; limit?: number }) {
  return prisma.automationActivity.findMany({
    where: { userId, ...(input?.status ? { status: input.status } : {}), ...(input?.source ? { source: input.source } : {}), ...(input?.playlistId ? { generatedPlaylistId: input.playlistId } : {}) },
    orderBy: { createdAt: "desc" }, take: Math.min(100, Math.max(1, input?.limit || 50)),
    include: { generatedPlaylist: { select: { id: true, plexPlaylistTitle: true, updatedAt: true } }, items: true, playlistRevision: { select: { id: true, revisionNumber: true, createdAt: true } } },
  });
}

export async function getAutomationActivity(userId: string, activityId: string) {
  return prisma.automationActivity.findFirst({ where: { id: activityId, userId }, include: { generatedPlaylist: { select: { id: true, plexPlaylistTitle: true, updatedAt: true } }, items: true, playlistRevision: true } });
}

export async function rollbackAutomationActivity(userId: string, activityId: string, confirm: boolean, expectedPlaylistUpdatedAt?: string) {
  const activity = await getAutomationActivity(userId, activityId);
  if (!activity) return null;
  if (!activity.playlistRevisionId) throw new Error("Rollback is unavailable because no recoverable pre-update version was recorded.");
  if (activity.rollbackStatus === "ROLLED_BACK") return { alreadyRolledBack: true, activity };
  if (!confirm) {
    const preview = await previewPlaylistVersionRestore(userId, activity.generatedPlaylistId, activity.playlistRevisionId);
    return { preview, activity, warning: activity.generatedPlaylist.updatedAt > (activity.completedAt || activity.createdAt) ? "The playlist changed after this automated update. Rollback may overwrite later changes." : null };
  }
  if (!expectedPlaylistUpdatedAt) throw new Error("Preview this rollback before confirming it.");
  const result = await restorePlaylistVersion({ userId, generatedPlaylistId: activity.generatedPlaylistId, versionId: activity.playlistRevisionId, expectedPlaylistUpdatedAt, missingTrackStrategy: "restore_available", restoreSettings: false, restorePlaylistMetadata: false });
  await prisma.$transaction([
    prisma.automationActivity.update({ where: { id: activity.id }, data: { rollbackStatus: result.syncStatus === "synced" ? "ROLLED_BACK" : "PARTIAL", rolledBackAt: new Date(), rolledBackByUserId: userId } }),
    prisma.automationActivity.create({ data: { userId, generatedPlaylistId: activity.generatedPlaylistId, source: "USER_REQUESTED", status: result.syncStatus === "synced" ? "ROLLED_BACK" : "PARTIAL", permissionLevel: activity.permissionLevel, reasonCode: result.syncStatus === "synced" ? "rollback_completed" : "rollback_partial", summary: result.syncStatus === "synced" ? "The latest automated update was rolled back." : "Rollback completed locally but Plex synchronization failed.", appliedAdditions: -activity.appliedAdditions, appliedRemovals: -activity.appliedRemovals, appliedReorders: -activity.appliedReorders, policySnapshotJson: activity.policySnapshotJson as Prisma.InputJsonValue, decisionJson: { rolledBackActivityId: activity.id, restoredVersionId: activity.playlistRevisionId } } }),
  ]);
  return { result, rolledBackActivityId: activity.id };
}
