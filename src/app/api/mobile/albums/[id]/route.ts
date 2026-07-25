import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { decideFromFormat } from "@/lib/mobile/directPlay";
import { mobileError, requireMobileUser, runMobileRoute, serializeAlbum, serializeTrack } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

function discOf(track: any): number {
  const value = Number(track?.plexMetadata?.parentIndex);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function trackNo(track: any): number {
  const value = Number(track?.trackIndex);
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

/** Album detail with a correctly ordered, multi-disc-aware track listing. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return runMobileRoute(async () => {
    const { userId } = await requireMobileUser(req, "library.read");

    const album = await prisma.album.findFirst({
      where: { id: params.id, syncStatus: "active", library: { server: { userId } } },
      include: { artist: { select: { title: true } } },
    });
    if (!album) return mobileError(404, "NOT_FOUND", "Album not found.");

    const trackRows = await prisma.track.findMany({
      where: { albumId: album.id, syncStatus: "active" },
      include: { album: { include: { artist: { select: { title: true } } } }, artist: { select: { title: true, thumb: true } } },
    });

    // Order by disc, then track number, then title. Missing track numbers sort last.
    const ordered = [...trackRows].sort((a, b) => {
      const disc = discOf(a) - discOf(b);
      if (disc !== 0) return disc;
      const no = trackNo(a) - trackNo(b);
      if (no !== 0) return no;
      return a.title.localeCompare(b.title);
    });

    const totalMs = ordered.reduce((sum, track) => sum + (track.duration ?? 0), 0);
    const discCount = ordered.reduce((max, track) => Math.max(max, discOf(track)), 1);

    return NextResponse.json({
      ...serializeAlbum(album),
      trackCount: ordered.length,
      duration: totalMs > 0 ? Math.round(totalMs / 1000) : null,
      discCount,
      tracks: ordered.map((track) => serializeTrack(track, decideFromFormat(track.fileFormat))),
    });
  });
}
