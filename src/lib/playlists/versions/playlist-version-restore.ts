import type { Prisma } from "@prisma/client";
import prisma from "../../prisma";
import { scorePlaylist } from "../../playlistScoring";
import { normalizeSmartMixTuningConfig } from "../../smartMixEngine/v2";
import { syncGeneratedPlaylistToPlex } from "../../playlistService";
import { diffPlaylistVersions } from "./playlist-version-diff";
import { capturePlaylistSnapshot } from "./playlist-version-snapshot";
import { createPlaylistVersionInTransaction, describePlaylistVersion, getPlaylistVersion } from "./playlist-version-service";

export type MissingTrackStrategy = "cancel" | "restore_available";

async function loadRestoreContext(userId: string, generatedPlaylistId: string, versionId: string) {
  const [playlist, target] = await Promise.all([
    prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, include: { tracks: { orderBy: { position: "asc" } } } }),
    getPlaylistVersion(userId, generatedPlaylistId, versionId),
  ]);
  if (!playlist) throw new Error("Generated playlist not found");
  if (!target) throw new Error("Version no longer exists");
  const snapshot = target.snapshot;
  if (!snapshot) throw new Error(target.validationError || "Version could not be loaded");
  return { playlist, target: { ...target, snapshot } };
}

export async function previewPlaylistVersionRestore(userId: string, generatedPlaylistId: string, versionId: string) {
  const { playlist, target } = await loadRestoreContext(userId, generatedPlaylistId, versionId);
  const currentStored = await capturePlaylistSnapshot(prisma, generatedPlaylistId);
  const missingTracks = target.snapshot.data.tracks.filter((track) => track.availability !== "available");
  const diff = diffPlaylistVersions({ fromVersionId: target.version.id, toVersionId: "current", from: target.snapshot.data, to: currentStored.data });
  return {
    targetVersion: target.version,
    current: { updatedAt: playlist.updatedAt.toISOString(), trackCount: playlist.trackCount },
    diff,
    missingTracks,
    canRestoreExactly: missingTracks.length === 0,
    warning: missingTracks.length ? `${missingTracks.length} track${missingTracks.length === 1 ? " is" : "s are"} no longer available. Choose “Restore available tracks only” to continue without them.` : null,
  };
}

export async function restorePlaylistVersion(input: {
  userId: string;
  generatedPlaylistId: string;
  versionId: string;
  expectedPlaylistUpdatedAt: string;
  missingTrackStrategy: MissingTrackStrategy;
  restoreSettings: boolean;
  restorePlaylistMetadata: boolean;
}) {
  const { playlist, target } = await loadRestoreContext(input.userId, input.generatedPlaylistId, input.versionId);
  if (playlist.updatedAt.toISOString() !== input.expectedPlaylistUpdatedAt) {
    throw new Error("Playlist changed. This playlist was modified after the restore preview was created. Review an updated comparison before restoring.");
  }
  const requestedTracks = target.snapshot.data.tracks;
  const requestedIds = requestedTracks.map((track) => track.trackId).filter((id): id is string => Boolean(id));
  const availableTracks = requestedIds.length ? await prisma.track.findMany({
    where: { id: { in: requestedIds }, syncStatus: "active", library: { server: { userId: input.userId } } },
    include: { artist: { include: { tags: true } }, album: true, popularity: true, audioFeature: true, tags: true, library: { include: { server: true } } },
  }) : [];
  const availableById = new Map(availableTracks.map((track) => [track.id, track]));
  const missing = requestedTracks.filter((track) => !track.trackId || !availableById.has(track.trackId));
  if (missing.length && input.missingTrackStrategy !== "restore_available") {
    throw new Error(`${missing.length} historical track${missing.length === 1 ? " is" : "s are"} unavailable. The playlist was not changed.`);
  }
  const selected = requestedTracks.filter((track): track is typeof track & { trackId: string } => Boolean(track.trackId && availableById.has(track.trackId)));
  if (!selected.length) throw new Error("No available tracks remain in this version. The playlist was not changed.");
  const orderedLibraryTracks = selected.map((track) => availableById.get(track.trackId)!);
  const targetSettings = target.snapshot.data.playlist.generationSettings?.settings || null;
  const tuning = normalizeSmartMixTuningConfig((targetSettings as any)?.tuningConfig);
  const recalculatedScore = scorePlaylist(orderedLibraryTracks, tuning);

  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.generatedPlaylist.findFirst({ where: { id: input.generatedPlaylistId, userId: input.userId }, select: { updatedAt: true } });
    if (!fresh || fresh.updatedAt.toISOString() !== input.expectedPlaylistUpdatedAt) throw new Error("Playlist changed. Create a new restore preview before continuing.");
    const backup = await createPlaylistVersionInTransaction(tx, {
      generatedPlaylistId: input.generatedPlaylistId,
      reason: "manual_edit",
      description: `Automatic backup before restoring Version ${target.version.revisionNumber}`,
      isAutomatic: true,
      syncStatus: "synced",
      force: true,
    });
    await tx.generatedPlaylistTrack.deleteMany({ where: { generatedPlaylistId: input.generatedPlaylistId } });
    await tx.generatedPlaylistTrack.createMany({
      data: selected.map((snapshotTrack, index) => {
        const libraryTrack = availableById.get(snapshotTrack.trackId)!;
        return {
          generatedPlaylistId: input.generatedPlaylistId,
          trackId: snapshotTrack.trackId,
          plexTrackRatingKey: libraryTrack.ratingKey || libraryTrack.plexId,
          position: index + 1,
          title: snapshotTrack.titleSnapshot,
          artist: snapshotTrack.artistSnapshot,
          album: snapshotTrack.albumSnapshot,
          locked: snapshotTrack.locked,
          liked: snapshotTrack.liked,
          regenerationExcluded: snapshotTrack.regenerationExcluded,
        };
      }),
    });
    await tx.generatedPlaylist.update({
      where: { id: input.generatedPlaylistId },
      data: {
        trackCount: selected.length,
        qualityScoreJson: recalculatedScore as unknown as Prisma.InputJsonValue,
        ...(input.restoreSettings && targetSettings ? { filtersJson: targetSettings as Prisma.InputJsonValue, tuningConfigJson: (targetSettings as any).tuningConfig as Prisma.InputJsonValue } : {}),
        ...(input.restorePlaylistMetadata ? { plexPlaylistTitle: target.snapshot.data.playlist.name } : {}),
        lastRegeneratedAt: new Date(),
      },
    });
    const restored = await createPlaylistVersionInTransaction(tx, {
      generatedPlaylistId: input.generatedPlaylistId,
      reason: "restore",
      description: describePlaylistVersion("restore", { sourceRevision: target.version.revisionNumber }),
      restoredFromVersionId: target.version.id,
      syncStatus: "pending",
      force: true,
    });
    return { backup, restored };
  });

  let syncStatus: "synced" | "failed" = "synced";
  let syncError: string | null = null;
  try {
    await syncGeneratedPlaylistToPlex(input.userId, input.generatedPlaylistId);
  } catch (error) {
    syncStatus = "failed";
    syncError = error instanceof Error ? error.message : "Plex synchronization failed";
  }
  await prisma.playlistRevision.update({ where: { id: result.restored.id }, data: { syncStatus } });
  console.info("[PlaylistVersions] restore completed", { playlistId: input.generatedPlaylistId, sourceVersionId: target.version.id, targetVersionId: result.restored.id, revisionNumber: result.restored.revisionNumber, missingTrackCount: missing.length, syncStatus });
  return {
    success: true,
    restoredVersion: { ...result.restored, syncStatus },
    safetyVersion: result.backup,
    restoredTrackCount: selected.length,
    missingTrackCount: missing.length,
    syncStatus,
    syncError,
  };
}
