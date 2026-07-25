import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { decideFromFormat } from "@/lib/mobile/directPlay";
import { mobileError, requireMobileUser, runMobileRoute, serializeAlbum, serializeArtist, serializeTrack } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

/** Artist detail: header info, albums, and available tracks (server ordering). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return runMobileRoute(async () => {
    const { userId } = await requireMobileUser(req, "library.read");

    const artist = await prisma.artist.findFirst({
      where: { id: params.id, syncStatus: "active", library: { server: { userId } } },
      include: { _count: { select: { albums: true, tracks: true } } },
    });
    if (!artist) return mobileError(404, "NOT_FOUND", "Artist not found.");

    const [albums, tracks] = await Promise.all([
      prisma.album.findMany({
        where: { artistId: artist.id, syncStatus: "active" },
        orderBy: [{ year: "asc" }, { title: "asc" }],
        include: { artist: { select: { title: true } }, _count: { select: { tracks: true } } },
      }),
      prisma.track.findMany({
        where: { artistId: artist.id, syncStatus: "active" },
        orderBy: [{ viewCount: "desc" }, { title: "asc" }],
        take: 50,
        include: { album: { include: { artist: { select: { title: true } } } }, artist: { select: { title: true, thumb: true } } },
      }),
    ]);

    return NextResponse.json({
      ...serializeArtist(artist),
      summary: artist.summary ?? null,
      albums: albums.map(serializeAlbum),
      tracks: tracks.map((track) => serializeTrack(track, decideFromFormat(track.fileFormat))),
    });
  });
}
