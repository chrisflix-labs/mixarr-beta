import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const mode = ["track", "artist", "album"].includes(url.searchParams.get("mode") || "") ? url.searchParams.get("mode")! : "track";
  const limit = Math.min(50, Math.max(5, Number(url.searchParams.get("limit") || 25)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const hideExcluded = url.searchParams.get("hideExcluded") !== "false";
  const where = { userId, ...(hideExcluded ? { OR: [{ coordinationSettings: null }, { coordinationSettings: { excludedFromEnforcement: false } }] } : {}) };
  const [playlists, total] = await Promise.all([
    prisma.generatedPlaylist.findMany({ where, select: { id: true, plexPlaylistTitle: true, trackCount: true }, orderBy: { plexPlaylistTitle: "asc" }, skip: offset, take: limit }),
    prisma.generatedPlaylist.count({ where }),
  ]);
  const ids = playlists.map((playlist) => playlist.id);
  const rows = ids.length ? await prisma.playlistOverlapSummary.findMany({ where: { playlistAId: { in: ids }, playlistBId: { in: ids } }, orderBy: { sharedTrackPercentage: "desc" } }) : [];
  const cells = rows.map((row) => ({
    playlistAId: row.playlistAId, playlistBId: row.playlistBId,
    value: mode === "artist" ? row.sharedArtistPercentage : mode === "album" ? row.sharedAlbumPercentage : row.sharedTrackPercentage,
    sharedTrackCount: row.sharedTrackCount, track: row.sharedTrackPercentage, artist: row.sharedArtistPercentage, album: row.sharedAlbumPercentage,
    withinPolicy: row.withinPolicy, stale: row.stale, calculatedAt: row.calculatedAt,
  }));
  return NextResponse.json({ mode, playlists, cells, pagination: { offset, limit, total, hasMore: offset + playlists.length < total } });
}

