import prisma from "../prisma";
import { exportTracksToPlex, recordGeneratedPlaylist } from "../playlistService";
import { createRecentlyAddedNotification } from "./notifications";
import { getRecentlyAddedSettings } from "./settings";

function isoDate(date = new Date()) { return date.toISOString().slice(0, 10); }

export function renderRecentlyAddedPlaylistName(template: string, input?: { date?: Date; mood?: string; library?: string }) {
  const date = input?.date || new Date();
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - date.getDay());
  return template
    .replaceAll("{date}", isoDate(date))
    .replaceAll("{week}", `Week of ${isoDate(weekStart)}`)
    .replaceAll("{mood}", input?.mood || "Discovery")
    .replaceAll("{library}", input?.library || "Music")
    .trim();
}

export async function createRecentlyAddedMix({ userId, publishOverride }: { userId: string; publishOverride?: boolean }) {
  const settings = await getRecentlyAddedSettings(userId);
  const profile = await prisma.userRecommendationProfile.findUnique({ where: { userId }, select: { enabled: true } });
  const cutoff = new Date(Date.now() - settings.timeWindowDays * 86_400_000);
  const library = settings.recentMixLibraryId ? await prisma.library.findFirst({ where: { id: settings.recentMixLibraryId, server: { userId } } }) : null;
  const name = renderRecentlyAddedPlaylistName(settings.playlistNameTemplate, { library: library?.name });
  if (!settings.recentMixVersioned) {
    const existing = await prisma.generatedPlaylist.findFirst({ where: { userId, sourceType: "recently_added", plexPlaylistTitle: name }, orderBy: { createdAt: "desc" } });
    if (existing) return { created: false, reason: "period_playlist_exists", playlist: existing };
  }
  const states = await prisma.recentlyAddedTrackState.findMany({
    where: {
      createdAt: { gte: cutoff },
      ignored: false,
      newMusicScore: { gte: settings.recentMixMinimumScore },
      confidenceScore: { gte: settings.recentMixMinimumConfidence },
      status: { in: ["ready_for_matching", "suggested", "manually_added", "automatically_added"] },
      track: { library: { server: { userId }, ...(library ? { id: library.id } : {}) }, syncStatus: "active", ...(profile?.enabled ? { userPreferences: { none: { userId, state: "NEVER_RECOMMEND" } } } : {}) },
    },
    orderBy: [{ newMusicScore: "desc" }, { createdAt: "desc" }],
    take: settings.recentMixMaximumTrackCount,
    include: { track: true },
  });
  if (states.length < settings.recentMixMinimumTrackCount) return { created: false, reason: "not_enough_tracks", trackCount: states.length };
  const trackIds = states.map((state) => state.trackId);
  const publish = publishOverride ?? settings.recentMixPublishToPlex;
  const exported = publish ? await exportTracksToPlex({ userId, name, trackIds, optionsJson: JSON.stringify({ engineVersion: "v2", limit: trackIds.length }) }) : null;
  const generated = await recordGeneratedPlaylist({
    userId,
    serverId: exported?.serverId || null,
    plexPlaylistRatingKey: exported?.playlistId || null,
    plexPlaylistTitle: name,
    sourceType: "recently_added",
    filters: { engineVersion: "v2", limit: trackIds.length, rules: [], safetyRules: {}, recentlyAdded: { timeWindowDays: settings.timeWindowDays, minimumScore: settings.recentMixMinimumScore } },
    trackIds: exported?.exportedTrackIds || trackIds,
  });
  await createRecentlyAddedNotification({ userId, batchKey: `mix:${name}`, triggerType: "mix_created", title: "Recently added mix created", message: `${name} was created with ${trackIds.length} tracks.`, link: `/generated-playlists` });
  return { created: true, playlist: generated, name, trackCount: trackIds.length, published: publish };
}
