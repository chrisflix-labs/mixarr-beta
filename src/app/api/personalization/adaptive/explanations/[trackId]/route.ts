import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: { trackId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const playlistId = new URL(request.url).searchParams.get("playlistId");
  if (!playlistId) return NextResponse.json({ error: "playlistId is required" }, { status: 400 });
  const row = await prisma.generatedPlaylistTrack.findFirst({
    where: { generatedPlaylistId: playlistId, trackId: params.trackId, generatedPlaylist: { userId } },
    select: { trackId: true, title: true, artist: true, adaptiveScoreJson: true, generatedPlaylist: { select: { adaptiveScoringVersion: true, adaptiveSettingsJson: true } } },
  });
  if (!row) return NextResponse.json({ error: "Track scoring explanation not found" }, { status: 404 });
  return NextResponse.json({
    track: { id: row.trackId, title: row.title, artist: row.artist },
    adaptiveScore: row.adaptiveScoreJson,
    adaptiveScoringVersion: row.generatedPlaylist.adaptiveScoringVersion,
    settingsSnapshot: row.generatedPlaylist.adaptiveSettingsJson,
  });
}
