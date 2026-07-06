import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { safeRecordJobHistory } from "@/lib/jobHistory";

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
      select: { id: true, plexPlaylistTitle: true, plexPlaylistRatingKey: true, sourceType: true },
    });

    if (!playlist) {
      return NextResponse.json({ error: "Generated playlist not found" }, { status: 404 });
    }

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
        plexPlaylistDeleted: false,
      },
    });

    return NextResponse.json({ success: true, playlistName: playlist.plexPlaylistTitle });
  } catch (error: any) {
    const message = error.message || "Failed to remove generated playlist tracking";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
