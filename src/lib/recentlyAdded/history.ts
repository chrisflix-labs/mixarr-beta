import prisma from "../prisma";

export async function getRecentlyAddedHistory(userId: string, input?: { cursor?: string | null; limit?: number }) {
  const limit = Math.min(100, Math.max(1, input?.limit || 25));
  const runs = await prisma.recentlyAddedAutomationRun.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: limit + 1,
    ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: { _count: { select: { changes: true } } },
  });
  return { runs: runs.slice(0, limit), nextCursor: runs.length > limit ? runs[limit - 1]?.id || null : null };
}

export async function clearRecentlyAddedHistory(userId: string) {
  const result = await prisma.recentlyAddedAutomationRun.deleteMany({ where: { userId, status: { notIn: ["scanning", "analyzing_new_tracks", "matching_playlists", "applying_approved_automation"] } } });
  return { deleted: result.count, playlistVersionsDeleted: 0 };
}

