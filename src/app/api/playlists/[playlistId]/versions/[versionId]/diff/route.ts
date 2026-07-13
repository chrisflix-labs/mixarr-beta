import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { comparePlaylistVersions } from "@/lib/playlists/versions/playlist-version-service";

export async function GET(request: Request, { params }: { params: { playlistId: string; versionId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requested = new URL(request.url).searchParams.get("to");
  const current = requested ? { id: requested } : await prisma.playlistRevision.findFirst({ where: { generatedPlaylistId: params.playlistId, isCurrent: true, generatedPlaylist: { userId } }, select: { id: true } });
  if (!current) return NextResponse.json({ error: "Current playlist version is unavailable" }, { status: 404 });
  try {
    return NextResponse.json(await comparePlaylistVersions(userId, params.playlistId, params.versionId, current.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Comparison failed" }, { status: 400 });
  }
}

