import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireMobileUser, runMobileRoute, serializeAlbum } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

/** Library home: section counts plus a Recently Added album shelf. */
export async function GET(req: Request) {
  return runMobileRoute(async () => {
    const { userId } = await requireMobileUser(req, "library.read");
    const scope = { syncStatus: "active", library: { server: { userId } } };

    const [artistCount, albumCount, trackCount, playlistCount, recentlyAdded] = await Promise.all([
      prisma.artist.count({ where: scope }),
      prisma.album.count({ where: scope }),
      prisma.track.count({ where: scope }),
      prisma.generatedPlaylist.count({ where: { userId } }),
      prisma.album.findMany({
        where: scope,
        orderBy: { addedAt: "desc" },
        take: 20,
        include: { artist: { select: { title: true } }, _count: { select: { tracks: true } } },
      }),
    ]);

    return NextResponse.json({
      sections: {
        artists: { count: artistCount },
        albums: { count: albumCount },
        songs: { count: trackCount },
        playlists: { count: playlistCount },
      },
      recentlyAdded: recentlyAdded.map(serializeAlbum),
    });
  });
}
