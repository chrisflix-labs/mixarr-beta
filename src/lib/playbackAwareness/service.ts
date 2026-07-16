import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import type { PlaybackAwarenessSettings, PlaybackProfileSnapshot, PlaybackScoringContext } from "./types";

const PROFILE_BATCH = 500;
const EVENT_BATCH = 2_000;
const DAY_MS = 86_400_000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackAwarenessSettings = {
  enabled: false,
  influence: 0.25,
  recentlyPlayedBehavior: "soft",
  recentlyPlayedWindowDays: 14,
  forgottenFavoriteDays: 180,
  useSkipHistory: true,
  useCompletionHistory: true,
  useReplayHistory: true,
  playbackAwareDiscovery: true,
  completionThreshold: 0.9,
  skipThreshold: 0.35,
  minimumSkipDurationMs: 10_000,
  minimumObservations: 3,
  maximumAdjustment: 8,
  historyRetentionDays: 730,
  syncIntervalHours: 24,
};

export const playbackSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  influence: z.coerce.number().min(0).max(1).optional(),
  recentlyPlayedBehavior: z.enum(["disabled", "soft", "strict"]).optional(),
  recentlyPlayedWindowDays: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(90), z.null()]).optional(),
  forgottenFavoriteDays: z.union([z.literal(90), z.literal(180), z.literal(365), z.null()]).optional(),
  useSkipHistory: z.boolean().optional(),
  useCompletionHistory: z.boolean().optional(),
  useReplayHistory: z.boolean().optional(),
  playbackAwareDiscovery: z.boolean().optional(),
  completionThreshold: z.coerce.number().min(0.5).max(1).optional(),
  skipThreshold: z.coerce.number().min(0.05).max(0.8).optional(),
  minimumSkipDurationMs: z.coerce.number().int().min(1_000).max(120_000).optional(),
  minimumObservations: z.coerce.number().int().min(1).max(50).optional(),
  maximumAdjustment: z.coerce.number().min(0).max(20).optional(),
  historyRetentionDays: z.coerce.number().int().min(30).max(3650).optional(),
  syncIntervalHours: z.coerce.number().int().min(1).max(168).optional(),
}).refine((value) => (
  value.completionThreshold == null || value.skipThreshold == null || value.skipThreshold < value.completionThreshold
), { message: "Skip threshold must be lower than the completion threshold" });

export const plexUserMappingSchema = z.object({
  serverId: z.string().uuid(),
  plexAccountId: z.string().uuid(),
  targetUserId: z.string().uuid().optional(),
  enabled: z.boolean().default(true),
});

function settingsFromRow(row: any): PlaybackAwarenessSettings {
  return {
    enabled: row.enabled,
    influence: row.influence,
    recentlyPlayedBehavior: row.recentlyPlayedBehavior,
    recentlyPlayedWindowDays: [7, 14, 30, 90].includes(row.recentlyPlayedWindowDays) ? row.recentlyPlayedWindowDays : null,
    forgottenFavoriteDays: [90, 180, 365].includes(row.forgottenFavoriteDays) ? row.forgottenFavoriteDays : null,
    useSkipHistory: row.useSkipHistory,
    useCompletionHistory: row.useCompletionHistory,
    useReplayHistory: row.useReplayHistory,
    playbackAwareDiscovery: row.playbackAwareDiscovery,
    completionThreshold: row.completionThreshold,
    skipThreshold: row.skipThreshold,
    minimumSkipDurationMs: row.minimumSkipDurationMs,
    minimumObservations: row.minimumObservations,
    maximumAdjustment: row.maximumAdjustment,
    historyRetentionDays: row.historyRetentionDays,
    syncIntervalHours: row.syncIntervalHours,
  };
}

export async function ensurePlaybackSettings(userId: string) {
  return prisma.playbackAwarenessSetting.upsert({
    where: { userId },
    create: { userId, ...DEFAULT_PLAYBACK_SETTINGS },
    update: {},
  });
}

export async function getPlaybackSettings(userId: string) {
  const [row, mappings] = await Promise.all([
    ensurePlaybackSettings(userId),
    prisma.plexUserMapping.findMany({
      where: { userId },
      include: { server: { select: { id: true, name: true } }, plexAccount: true },
      orderBy: { server: { name: "asc" } },
    }),
  ]);
  return {
    settings: settingsFromRow(row),
    mappings: mappings.map((mapping) => ({
      id: mapping.id,
      serverId: mapping.serverId,
      serverName: mapping.server.name,
      plexAccountId: mapping.plexAccountId,
      plexUserId: mapping.plexUserId,
      plexUsername: mapping.plexUsername,
      enabled: mapping.enabled,
    })),
    active: row.enabled && mappings.some((mapping) => mapping.enabled),
  };
}

export async function updatePlaybackSettings(userId: string, raw: unknown) {
  const value = playbackSettingsSchema.parse(raw);
  await ensurePlaybackSettings(userId);
  await prisma.playbackAwarenessSetting.update({ where: { userId }, data: value });
  return getPlaybackSettings(userId);
}

export async function listPlexPlaybackUsers(userId: string, includeAllUsers = false) {
  const servers = await prisma.server.findMany({
    where: includeAllUsers ? {} : { userId },
    select: {
      id: true,
      name: true,
      userId: true,
      plexAccounts: { orderBy: { username: "asc" } },
      plexUserMappings: {
        where: includeAllUsers ? {} : { userId },
        select: { id: true, userId: true, plexAccountId: true, enabled: true },
      },
    },
    orderBy: { name: "asc" },
  });
  return servers.map((server) => ({
    id: server.id,
    name: server.name,
    ownerUserId: server.userId,
    accounts: server.plexAccounts.map((account) => ({
      id: account.id,
      plexUserId: account.plexUserId,
      username: account.username,
      email: account.email,
      thumb: account.thumb,
      mappedUserIds: server.plexUserMappings.filter((mapping) => mapping.plexAccountId === account.id && mapping.enabled).map((mapping) => mapping.userId),
    })),
  }));
}

export async function mapPlexPlaybackUser(actorUserId: string, raw: unknown, canManageOthers = false) {
  const value = plexUserMappingSchema.parse(raw);
  const targetUserId = value.targetUserId || actorUserId;
  if (targetUserId !== actorUserId && !canManageOthers) throw new Error("ADMIN_REQUIRED");
  const account = await prisma.plexAccount.findFirst({
    where: { id: value.plexAccountId, serverId: value.serverId },
    include: { server: { select: { userId: true } } },
  });
  if (!account) throw new Error("Plex user was not found");
  if (!canManageOthers && account.server.userId !== actorUserId) throw new Error("Plex server was not found");
  await prisma.plexUserMapping.upsert({
    where: { userId_serverId: { userId: targetUserId, serverId: value.serverId } },
    create: {
      userId: targetUserId,
      serverId: value.serverId,
      plexAccountId: account.id,
      plexUserId: account.plexUserId,
      plexUsername: account.username,
      enabled: value.enabled,
    },
    update: {
      plexAccountId: account.id,
      plexUserId: account.plexUserId,
      plexUsername: account.username,
      enabled: value.enabled,
    },
  });
  return getPlaybackSettings(targetUserId);
}

type AggregateState = {
  trackId: string;
  plexUserId: string;
  total: number;
  completed: number;
  skipped: number;
  completionTotal: number;
  completionSamples: number;
  firstPlayedAt: Date;
  lastPlayedAt: Date;
  lastCompletedAt: Date | null;
  lastSkippedAt: Date | null;
  recent7: number;
  recent14: number;
  recent30: number;
  recent90: number;
};

export function aggregatePlaybackProfile(state: AggregateState) {
  const total = Math.max(0, state.total);
  const completionRate = total ? state.completed / total : 0;
  const skipRate = total ? state.skipped / total : 0;
  const replayCount = Math.max(0, total - 1);
  const evidence = Math.min(1, Math.log1p(total) / Math.log(21));
  const consistency = Math.max(completionRate, 1 - skipRate);
  const playbackConfidence = clamp(evidence * (0.4 + consistency * 0.6), 0, 1);
  const lastAgeDays = Math.max(0, Date.now() - state.lastPlayedAt.getTime()) / DAY_MS;
  const affinity = clamp((completionRate * 0.55 + Math.min(1, replayCount / 8) * 0.3 + (1 - skipRate) * 0.15) * 100, 0, 100);
  const forgotten = total >= 3 && completionRate >= 0.65 && lastAgeDays >= 90
    ? clamp((affinity / 100) * Math.min(1, lastAgeDays / 365) * playbackConfidence * 100, 0, 100)
    : 0;
  return {
    trackId: state.trackId,
    plexUserId: state.plexUserId,
    totalPlayCount: total,
    completedPlayCount: state.completed,
    skipCount: state.skipped,
    replayCount,
    completionRate,
    skipRate,
    firstPlayedAt: state.firstPlayedAt,
    lastPlayedAt: state.lastPlayedAt,
    lastCompletedAt: state.lastCompletedAt,
    lastSkippedAt: state.lastSkippedAt,
    averageCompletionPercent: state.completionSamples ? state.completionTotal / state.completionSamples : null,
    recentPlayCount7Days: state.recent7,
    recentPlayCount14Days: state.recent14,
    recentPlayCount30Days: state.recent30,
    recentPlayCount90Days: state.recent90,
    forgottenFavoriteScore: forgotten,
    playbackAffinityScore: affinity,
    playbackConfidence,
  };
}

function addEvent(state: AggregateState, event: any, now: number) {
  state.total += Math.max(0, Math.round(event.playCountContribution || 1));
  if (event.completed) state.completed += 1;
  if (event.skipped) state.skipped += 1;
  if (typeof event.completionPercent === "number") {
    state.completionTotal += event.completionPercent;
    state.completionSamples += 1;
  }
  if (event.playedAt < state.firstPlayedAt) state.firstPlayedAt = event.playedAt;
  if (event.playedAt > state.lastPlayedAt) state.lastPlayedAt = event.playedAt;
  if (event.completed && (!state.lastCompletedAt || event.playedAt > state.lastCompletedAt)) state.lastCompletedAt = event.playedAt;
  if (event.skipped && (!state.lastSkippedAt || event.playedAt > state.lastSkippedAt)) state.lastSkippedAt = event.playedAt;
  const age = now - event.playedAt.getTime();
  if (age <= 7 * DAY_MS) state.recent7 += 1;
  if (age <= 14 * DAY_MS) state.recent14 += 1;
  if (age <= 30 * DAY_MS) state.recent30 += 1;
  if (age <= 90 * DAY_MS) state.recent90 += 1;
}

export async function rebuildPlaybackProfilesForUser(userId: string) {
  const mappings = await prisma.plexUserMapping.findMany({ where: { userId, enabled: true }, select: { serverId: true, plexUserId: true } });
  await prisma.userTrackPlaybackProfile.deleteMany({ where: { userId } });
  if (!mappings.length) return { profilesUpdated: 0, eventsProcessed: 0 };

  const where: Prisma.PlexPlaybackEventWhereInput = {
    trackId: { not: null },
    OR: mappings.map((mapping) => ({ serverId: mapping.serverId, plexUserId: mapping.plexUserId })),
  };
  let cursor: string | undefined;
  let current: AggregateState | null = null;
  let eventsProcessed = 0;
  let profilesUpdated = 0;
  let pending: Array<ReturnType<typeof aggregatePlaybackProfile> & { userId: string }> = [];
  const now = Date.now();

  const flushCurrent = () => {
    if (!current) return;
    pending.push({ userId, ...aggregatePlaybackProfile(current) });
    current = null;
  };
  const flushPending = async () => {
    if (!pending.length) return;
    await prisma.userTrackPlaybackProfile.createMany({ data: pending });
    profilesUpdated += pending.length;
    pending = [];
  };

  while (true) {
    const events = await prisma.plexPlaybackEvent.findMany({
      where,
      select: {
        id: true,
        trackId: true,
        plexUserId: true,
        playedAt: true,
        completed: true,
        skipped: true,
        completionPercent: true,
        playCountContribution: true,
      },
      orderBy: [{ trackId: "asc" }, { playedAt: "asc" }, { id: "asc" }],
      take: EVENT_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!events.length) break;
    for (const event of events) {
      if (!event.trackId) continue;
      if (current && current.trackId !== event.trackId) {
        flushCurrent();
        if (pending.length >= PROFILE_BATCH) await flushPending();
      }
      if (!current) {
        current = {
          trackId: event.trackId,
          plexUserId: event.plexUserId,
          total: 0,
          completed: 0,
          skipped: 0,
          completionTotal: 0,
          completionSamples: 0,
          firstPlayedAt: event.playedAt,
          lastPlayedAt: event.playedAt,
          lastCompletedAt: null,
          lastSkippedAt: null,
          recent7: 0,
          recent14: 0,
          recent30: 0,
          recent90: 0,
        };
      }
      addEvent(current, event, now);
      eventsProcessed += 1;
    }
    cursor = events.at(-1)?.id;
    if (events.length < EVENT_BATCH) break;
  }
  flushCurrent();
  await flushPending();
  return { profilesUpdated, eventsProcessed };
}

export async function loadPlaybackScoringContext(input: {
  userId: string;
  trackIds: string[];
  protectedTrackIds?: string[];
  maximumPersonalizationInfluence?: number;
}): Promise<PlaybackScoringContext | undefined> {
  try {
    const [settingsRow, mappingCount] = await Promise.all([
      ensurePlaybackSettings(input.userId),
      prisma.plexUserMapping.count({ where: { userId: input.userId, enabled: true } }),
    ]);
    const settings = settingsFromRow(settingsRow);
    const profiles: PlaybackProfileSnapshot[] = [];
    const trackIds = Array.from(new Set(input.trackIds.filter(Boolean)));
    for (let index = 0; index < trackIds.length; index += PROFILE_BATCH) {
      profiles.push(...await prisma.userTrackPlaybackProfile.findMany({
        where: { userId: input.userId, trackId: { in: trackIds.slice(index, index + PROFILE_BATCH) } },
      }));
    }
    const mapped = mappingCount > 0;
    return {
      settings,
      mapped,
      profiles: Object.fromEntries(profiles.map((profile) => [profile.trackId, profile])),
      protectedTrackIds: new Set(input.protectedTrackIds || []),
      maximumPersonalizationInfluence: input.maximumPersonalizationInfluence ?? 1,
      statusMessage: !settings.enabled
        ? "Playback scoring disabled"
        : !mapped ? "Map a Plex user before enabling playback recommendations"
        : profiles.length ? "Playback history loaded" : "Playback awareness unavailable: no matched history",
    };
  } catch (error) {
    console.warn("[PlaybackAwareness] context loading failed; standard scoring will continue", {
      userId: input.userId,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return undefined;
  }
}

export async function getPlaybackSyncStatus(userId: string, includeAll = false) {
  const states = await prisma.playbackSyncState.findMany({
    where: includeAll ? {} : { server: { userId } },
    include: { server: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return states.map((state) => ({
    ...state,
    errorMessage: state.errorMessage || null,
    server: state.server,
  }));
}

export async function getPlaybackDashboardSummary(userId: string) {
  const [settings, totalProfiles, played7, played30, completed, replayed, skipped, forgotten, aggregates] = await Promise.all([
    getPlaybackSettings(userId),
    prisma.userTrackPlaybackProfile.count({ where: { userId } }),
    prisma.userTrackPlaybackProfile.count({ where: { userId, recentPlayCount7Days: { gt: 0 } } }),
    prisma.userTrackPlaybackProfile.count({ where: { userId, recentPlayCount30Days: { gt: 0 } } }),
    prisma.userTrackPlaybackProfile.count({ where: { userId, totalPlayCount: { gte: 3 }, completionRate: { gte: 0.75 } } }),
    prisma.userTrackPlaybackProfile.count({ where: { userId, replayCount: { gte: 2 } } }),
    prisma.userTrackPlaybackProfile.count({ where: { userId, totalPlayCount: { gte: 3 }, skipRate: { gte: 0.35 } } }),
    prisma.userTrackPlaybackProfile.count({ where: { userId, forgottenFavoriteScore: { gte: 25 } } }),
    prisma.userTrackPlaybackProfile.aggregate({ where: { userId }, _avg: { playbackConfidence: true }, _sum: { totalPlayCount: true } }),
  ]);
  const confidence = aggregates._avg.playbackConfidence || 0;
  return {
    status: settings.active ? (totalProfiles ? "Active" : "Limited history") : settings.settings.enabled ? "Mapping required" : "Disabled",
    settings,
    counts: { totalProfiles, played7, played30, completed, replayed, skipped, forgotten, totalPlays: aggregates._sum.totalPlayCount || 0 },
    confidence,
    confidenceLabel: confidence < 0.2 ? "Insufficient data" : confidence < 0.45 ? "Limited history" : confidence < 0.75 ? "Moderate signal" : "Strong signal",
  };
}

export async function listPlaybackProfileTracks(input: {
  userId: string;
  category?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}) {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(100, Math.max(10, input.pageSize || 25));
  const where: Prisma.UserTrackPlaybackProfileWhereInput = {
    userId: input.userId,
    ...(input.category === "completed" ? { totalPlayCount: { gte: 3 }, completionRate: { gte: 0.75 } } : {}),
    ...(input.category === "replayed" ? { replayCount: { gte: 2 } } : {}),
    ...(input.category === "skipped" ? { totalPlayCount: { gte: 3 }, skipRate: { gte: 0.35 } } : {}),
    ...(input.category === "forgotten" ? { forgottenFavoriteScore: { gte: 25 } } : {}),
    ...(input.category === "recent" ? { recentPlayCount30Days: { gt: 0 } } : {}),
  };
  const orderBy: Prisma.UserTrackPlaybackProfileOrderByWithRelationInput = input.sort === "lastPlayed"
    ? { lastPlayedAt: "desc" }
    : input.category === "skipped" ? { skipRate: "desc" }
    : input.category === "forgotten" ? { forgottenFavoriteScore: "desc" }
    : { playbackAffinityScore: "desc" };
  const [total, profiles] = await Promise.all([
    prisma.userTrackPlaybackProfile.count({ where }),
    prisma.userTrackPlaybackProfile.findMany({
      where,
      include: { track: { select: { id: true, title: true, ratingKey: true, artist: { select: { title: true } }, album: { select: { title: true } } } } },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { profiles, page, pageSize, total, pageCount: Math.ceil(total / pageSize) };
}

export async function resetPlaybackProfile(userId: string) {
  const result = await prisma.userTrackPlaybackProfile.deleteMany({ where: { userId } });
  return { profilesRemoved: result.count, rawHistoryPreserved: true };
}

export async function listUnmatchedPlaybackEvents(input: { page?: number; pageSize?: number }) {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(100, Math.max(10, input.pageSize || 25));
  const where = { unmatchedReason: { not: null } };
  const [total, events] = await Promise.all([
    prisma.plexPlaybackEvent.count({ where }),
    prisma.plexPlaybackEvent.findMany({
      where,
      include: { server: { select: { name: true } }, library: { select: { name: true } } },
      orderBy: { playedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { events, page, pageSize, total, pageCount: Math.ceil(total / pageSize) };
}
