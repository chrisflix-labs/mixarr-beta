import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { metadataCorrectionRelations } from "../metadataCorrections";
import { getRecentlyAddedSettings, normalizeRecentlyAddedExclusions } from "./settings";
import { quarantineDecision, scoreNewMusic } from "./scoring";
import { logRateLimited } from "../logging";

const WRITE_CHUNK = 200;

export function chunkRecentlyAddedItems<T>(items: T[], size = WRITE_CHUNK) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export async function detectRecentlyAddedTracks({
  userId,
  libraryId,
  syncLogId,
  source = "manual",
}: {
  userId: string;
  libraryId?: string | null;
  syncLogId?: string | null;
  source?: "manual" | "plex_sync" | "scheduled";
}) {
  const settings = await getRecentlyAddedSettings(userId);
  const exclusions = normalizeRecentlyAddedExclusions(settings.exclusionsJson);
  const cutoff = new Date(Date.now() - settings.timeWindowDays * 86_400_000);
  const where: Prisma.TrackWhereInput = {
    library: { server: { userId } },
    syncStatus: "active",
    recentlyAddedState: null,
    ...(exclusions.libraryIds.length ? { libraryId: { notIn: exclusions.libraryIds } } : {}),
    ...(exclusions.artistIds.length ? { artistId: { notIn: exclusions.artistIds } } : {}),
    ...(exclusions.albumIds.length ? { albumId: { notIn: exclusions.albumIds } } : {}),
    ...(exclusions.genres.length ? { tags: { none: { name: { in: exclusions.genres, mode: "insensitive" } } } } : {}),
    ...(libraryId ? { libraryId } : {}),
    ...(syncLogId
      ? { lastSeenSyncId: syncLogId, lastSyncChangeTypes: { contains: "new_track" } }
      : { addedAt: { gte: cutoff } }),
  };
  const tracks = await prisma.track.findMany({
    where,
    orderBy: [{ addedAt: "desc" }, { id: "asc" }],
    take: settings.maxTracksPerRun,
    select: { id: true, addedAt: true },
  });
  const batch = await prisma.recentlyAddedBatch.create({
    data: { userId, libraryId: libraryId || null, syncLogId: syncLogId || null, source, status: "detecting", discoveredCount: tracks.length },
  });
  for (const group of chunkRecentlyAddedItems(tracks)) {
    await prisma.recentlyAddedTrackState.createMany({
      data: group.map((track) => ({ trackId: track.id, batchId: batch.id, status: settings.quarantineUntilAnalyzed ? "waiting_for_analysis" : "new" })),
      skipDuplicates: true,
    });
    await prisma.track.updateMany({
      where: { id: { in: group.map((track) => track.id) } },
      data: { recentlyAddedBatchId: batch.id, recentlyAddedStatus: settings.quarantineUntilAnalyzed ? "waiting_for_analysis" : "new" },
    });
    for (const track of group) {
      await prisma.track.update({ where: { id: track.id }, data: { plexAddedAt: track.addedAt || undefined } });
    }
  }
  await prisma.recentlyAddedBatch.update({ where: { id: batch.id }, data: { status: "detected", completedAt: new Date() } });
  await prisma.recentlyAddedSettings.update({ where: { userId }, data: { lastScanAt: new Date() } });
  console.info("[RecentlyAdded] detection completed", { userId, libraryId: libraryId || null, batchId: batch.id, discovered: tracks.length, source });
  return { batchId: batch.id, discovered: tracks.length, hasMore: tracks.length === settings.maxTracksPerRun };
}

export async function analyzeRecentlyAddedTracks({ userId, batchId, trackIds }: { userId: string; batchId?: string | null; trackIds?: string[] }) {
  const settings = await getRecentlyAddedSettings(userId);
  const exclusions = normalizeRecentlyAddedExclusions(settings.exclusionsJson);
  const states = await prisma.recentlyAddedTrackState.findMany({
    where: {
      track: { library: { server: { userId } } },
      ignored: false,
      ...(batchId ? { batchId } : {}),
      ...(trackIds?.length ? { trackId: { in: trackIds.slice(0, settings.maxTracksPerRun) } } : {}),
      status: { in: ["new", "waiting_for_analysis", "failed", "low_confidence"] },
    },
    take: settings.maxTracksPerRun,
    orderBy: { createdAt: "asc" },
    include: {
      track: { include: { audioFeature: true, popularity: true, tags: true, ...metadataCorrectionRelations, recentlyAddedState: true } },
    },
  });
  let ready = 0;
  let quarantined = 0;
  let failed = 0;
  for (const group of chunkRecentlyAddedItems(states, 50)) {
    await Promise.all(group.map(async (state) => {
      try {
        const scored = scoreNewMusic(state.track);
        const decision = quarantineDecision({ track: state.track, settings });
        const excludedForConfidence = exclusions.confidenceBelow != null && scored.confidenceScore < exclusions.confidenceBelow;
        const status = excludedForConfidence ? "ignored" : decision.quarantined ? "waiting_for_analysis" : scored.score < 60 ? "low_confidence" : "ready_for_matching";
        if (!excludedForConfidence) {
          if (decision.quarantined) quarantined += 1; else ready += 1;
        }
        await prisma.$transaction([
          prisma.recentlyAddedTrackState.update({
            where: { id: state.id },
            data: {
              status,
              newMusicScore: scored.score,
              confidenceScore: scored.confidenceScore,
              scoreBreakdownJson: scored.breakdown,
              quarantineReason: decision.quarantined ? decision.reason : null,
              quarantinedAt: decision.quarantined ? state.quarantinedAt || new Date() : null,
              releasedAt: decision.quarantined ? null : new Date(),
              analyzedAt: new Date(),
              failureReason: excludedForConfidence ? `confidence_below_${exclusions.confidenceBelow}` : null,
              ignored: excludedForConfidence,
            },
          }),
          prisma.track.update({ where: { id: state.trackId }, data: { recentlyAddedStatus: status } }),
        ]);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "Analysis failed";
        await prisma.recentlyAddedTrackState.update({ where: { id: state.id }, data: { status: "failed", failureReason: message } });
        logRateLimited("error", `recently-added:analysis:${message.slice(0, 80)}`, "[RecentlyAdded] analysis failed", { reason: message.slice(0, 500) });
      }
    }));
  }
  if (batchId) await prisma.recentlyAddedBatch.update({ where: { id: batchId }, data: { processedCount: states.length - failed, failedCount: failed } }).catch(() => undefined);
  console.info("[RecentlyAdded] analysis completed", { userId, batchId: batchId || null, analyzed: states.length, ready, quarantined, failed });
  return { analyzed: states.length, ready, quarantined, failed };
}

export async function updateRecentlyAddedTrackDisposition(userId: string, trackIds: string[], action: string) {
  const owned = await prisma.track.findMany({ where: { id: { in: trackIds.slice(0, 1000) }, library: { server: { userId } } }, select: { id: true } });
  const ids = owned.map((track) => track.id);
  if (!ids.length) return { updated: 0 };
  const data = action === "manual_approve" ? { manualOverride: true, status: "ready_for_matching", releasedAt: new Date(), quarantineReason: null }
    : action === "never_auto_add" ? { neverAutoAdd: true }
    : action === "do_not_suggest" ? { doNotSuggest: true }
    : action === "manual_only" ? { manualUseOnly: true, neverAutoAdd: true }
    : { ignored: true, status: "ignored" };
  const result = await prisma.recentlyAddedTrackState.updateMany({ where: { trackId: { in: ids } }, data });
  await prisma.track.updateMany({ where: { id: { in: ids } }, data: { recentlyAddedStatus: action === "manual_approve" ? "ready_for_matching" : "ignored" } });
  return { updated: result.count };
}
