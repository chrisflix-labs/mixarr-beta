import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { safeRecordJobHistory } from "@/lib/jobHistory";
import { recordPlaylistHistoryEntry } from "@/lib/playlistHistory";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const playlist = await prisma.generatedPlaylist.findFirst({
    where: { id: params.id, userId },
    include: {
      tracks: { orderBy: { position: "asc" } },
    },
  });

  if (!playlist) {
    return NextResponse.json({ error: "Generated playlist not found" }, { status: 404 });
  }

  return NextResponse.json({ playlist });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const playlist = await prisma.generatedPlaylist.findFirst({
      where: { id: params.id, userId },
      include: {
        tracks: { orderBy: { position: "asc" } },
      },
    });

    if (!playlist) {
      return NextResponse.json({ error: "Generated playlist not found" }, { status: 404 });
    }

    await recordPlaylistHistoryEntry({
      userId,
      generatedPlaylistId: playlist.id,
      serverId: playlist.serverId,
      plexPlaylistRatingKey: playlist.plexPlaylistRatingKey,
      playlistName: playlist.plexPlaylistTitle,
      eventType: "removed_tracking",
      sourceType: playlist.sourceType,
      recipeId: playlist.recipeId,
      recipeName: playlist.recipeName,
      smartPresetId: playlist.smartPresetId,
      smartPresetName: playlist.smartPresetName,
      moodPresetId: playlist.moodPresetId,
      moodPresetName: playlist.moodPresetName,
      bpmPresetId: playlist.bpmPresetId,
      bpmPresetName: playlist.bpmPresetName,
      engineVersion: playlist.engineVersion || "v1",
      trackCount: playlist.trackCount,
      filters: playlist.filtersJson,
      safetyRules: playlist.safetyRulesJson,
      summary: `Removed "${playlist.plexPlaylistTitle}" from Generated Playlists tracking. Plex playlist was not deleted.`,
      trackIds: playlist.tracks.map((track) => track.trackId).filter((trackId): trackId is string => Boolean(trackId)),
    });

    await prisma.generatedPlaylist.delete({ where: { id: playlist.id } });
    await safeRecordJobHistory({
      userId,
      type: "playlist",
      name: "Generated playlist tracking removed",
      status: "success",
      trigger: "manual",
      summary: `Removed generated playlist tracking for "${playlist.plexPlaylistTitle}".`,
      counts: { attempted: 1, processed: 1, skipped: 0, failed: 0 },
      metadata: {
        generatedPlaylistId: playlist.id,
        plexPlaylistRatingKey: playlist.plexPlaylistRatingKey,
        playlistName: playlist.plexPlaylistTitle,
        sourceType: playlist.sourceType,
        engineVersion: playlist.engineVersion || "v1",
        plexPlaylistDeleted: false,
      },
    });

    return NextResponse.json({ success: true, playlistName: playlist.plexPlaylistTitle });
  } catch (error: any) {
    const message = error.message || "Failed to remove generated playlist tracking";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
