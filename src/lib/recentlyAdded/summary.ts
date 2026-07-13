import prisma from "../prisma";
import { getRecentlyAddedSettings } from "./settings";

export async function getRecentlyAddedSummary(userId: string) {
  const settings = await getRecentlyAddedSettings(userId);
  const cutoff = new Date(Date.now() - settings.timeWindowDays * 86_400_000);
  const [newTracks, strongMatches, suggestions, lowConfidence, waiting, automaticallyAdded, lastRun, activeRun, notifications] = await Promise.all([
    prisma.recentlyAddedTrackState.count({ where: { track: { library: { server: { userId } } }, createdAt: { gte: cutoff } } }),
    prisma.recentlyAddedPlaylistMatch.count({ where: { generatedPlaylist: { userId }, compatibilityScore: { gte: settings.matchThreshold }, createdAt: { gte: cutoff } } }),
    prisma.recentlyAddedPlaylistMatch.count({ where: { generatedPlaylist: { userId }, status: { in: ["suggested", "pending", "approved"] }, createdAt: { gte: cutoff } } }),
    prisma.recentlyAddedTrackState.count({ where: { track: { library: { server: { userId } } }, status: "low_confidence", createdAt: { gte: cutoff } } }),
    prisma.recentlyAddedTrackState.count({ where: { track: { library: { server: { userId } } }, status: { in: ["new", "waiting_for_analysis", "analyzing"] }, createdAt: { gte: cutoff } } }),
    prisma.recentlyAddedTrackState.count({ where: { track: { library: { server: { userId } } }, status: "automatically_added", updatedAt: { gte: cutoff } } }),
    prisma.recentlyAddedAutomationRun.findFirst({ where: { userId, completedAt: { not: null } }, orderBy: { completedAt: "desc" } }),
    prisma.recentlyAddedAutomationRun.findFirst({ where: { userId, status: { in: ["scanning", "analyzing_new_tracks", "matching_playlists", "applying_approved_automation"] } }, orderBy: { startedAt: "desc" } }),
    prisma.recentlyAddedNotificationState.findMany({ where: { userId, readAt: null }, orderBy: { sentAt: "desc" }, take: 10 }),
  ]);
  const status = !settings.enabled ? "disabled" : activeRun?.status || (lastRun?.status === "failed" ? "failed" : newTracks ? "completed" : "waiting_for_new_tracks");
  return {
    settings: { enabled: settings.enabled, requirePreview: settings.requirePreview, scheduleType: settings.scheduleType },
    status,
    lastScanAt: settings.lastScanAt,
    nextScheduledRunAt: settings.nextScheduledRunAt,
    lastRun,
    counts: { newTracks, strongMatches, suggestions, lowConfidence, waiting, automaticallyAdded },
    notifications,
  };
}

export async function listRecentlyAddedTracks(userId: string, input?: { status?: string | null; cursor?: string | null; limit?: number }) {
  const limit = Math.min(200, Math.max(1, input?.limit || 50));
  const items = await prisma.recentlyAddedTrackState.findMany({
    where: { track: { library: { server: { userId } } }, ...(input?.status ? { status: input.status } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: { track: { include: { artist: true, album: true, library: true, tags: true } } },
  });
  return { tracks: items.slice(0, limit), nextCursor: items.length > limit ? items[limit - 1]?.id || null : null };
}

export async function listRecentlyAddedMatches(userId: string, input?: { status?: string | null; cursor?: string | null; limit?: number }) {
  const limit = Math.min(200, Math.max(1, input?.limit || 50));
  const items = await prisma.recentlyAddedPlaylistMatch.findMany({
    where: { generatedPlaylist: { userId }, ...(input?.status ? { status: input.status } : {}) },
    orderBy: [{ compatibilityScore: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: { track: { include: { artist: true, album: true } }, generatedPlaylist: { select: { id: true, plexPlaylistTitle: true, automationSettings: true } } },
  });
  return { matches: items.slice(0, limit), nextCursor: items.length > limit ? items[limit - 1]?.id || null : null };
}
