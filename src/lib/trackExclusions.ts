import prisma from "./prisma";

export const TRACK_EXCLUSION_REASONS = [
  "Do not want in playlists",
  "Bad metadata",
  "Duplicate version",
  "Wrong audio file",
  "Other",
] as const;

export function normalizeExclusionReason(reason: unknown) {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (!trimmed) return null;
  return TRACK_EXCLUSION_REASONS.includes(trimmed as any) ? trimmed : null;
}

export async function findOwnedTrackForExclusion(userId: string, trackId: string) {
  return prisma.track.findFirst({
    where: {
      id: trackId,
      library: {
        server: {
          userId,
        },
      },
    },
    select: {
      id: true,
      title: true,
      artist: { select: { title: true } },
      album: { select: { title: true } },
    },
  });
}

export async function getManualTrackExclusionIds(userId: string) {
  const exclusions = await prisma.trackExclusion.findMany({
    where: { userId },
    select: { trackId: true },
  });

  return exclusions.map((exclusion) => exclusion.trackId);
}

export async function getManualTrackExclusionCountForIds(userId: string, trackIds: string[]) {
  const uniqueTrackIds = trackIds.filter((id, index) => id && trackIds.indexOf(id) === index);
  if (uniqueTrackIds.length === 0) return 0;

  return prisma.trackExclusion.count({
    where: {
      userId,
      trackId: { in: uniqueTrackIds },
    },
  });
}

export async function filterManualTrackExclusions(userId: string, trackIds: string[]) {
  const uniqueTrackIds = trackIds.filter((id, index) => id && trackIds.indexOf(id) === index);
  if (uniqueTrackIds.length === 0) {
    return { trackIds: [], excludedTrackCount: 0 };
  }

  const exclusions = await prisma.trackExclusion.findMany({
    where: {
      userId,
      trackId: { in: uniqueTrackIds },
    },
    select: { trackId: true },
  });
  const excludedIds = new Set(exclusions.map((exclusion) => exclusion.trackId));

  return {
    trackIds: trackIds.filter((trackId) => !excludedIds.has(trackId)),
    excludedTrackCount: trackIds.filter((trackId) => excludedIds.has(trackId)).length,
  };
}
