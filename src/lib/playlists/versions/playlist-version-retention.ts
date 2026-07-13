import type { Prisma } from "@prisma/client";

export const DEFAULT_PLAYLIST_VERSION_RETENTION = 25;

export async function cleanupPlaylistVersions(tx: Prisma.TransactionClient, generatedPlaylistId: string, keep = DEFAULT_PLAYLIST_VERSION_RETENTION) {
  const versions = await tx.playlistRevision.findMany({
    where: { generatedPlaylistId },
    orderBy: { revisionNumber: "desc" },
    select: { id: true, isPinned: true, isCurrent: true, reason: true, restoredFromVersionId: true },
  });
  const restoreReferences = new Set(versions.map((version) => version.restoredFromVersionId).filter((id): id is string => Boolean(id)));
  const deletable = versions.slice(Math.max(1, keep)).filter((version) =>
    !version.isPinned && !version.isCurrent && !restoreReferences.has(version.id) && version.reason !== "initial_generation",
  );
  if (!deletable.length) return { deleted: 0, kept: versions.length };
  const result = await tx.playlistRevision.deleteMany({ where: { id: { in: deletable.map((version) => version.id) }, generatedPlaylistId } });
  return { deleted: result.count, kept: versions.length - result.count };
}

