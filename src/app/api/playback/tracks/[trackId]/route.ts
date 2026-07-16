import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: { trackId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = await prisma.userTrackPlaybackProfile.findFirst({
    where: { userId, trackId: params.trackId },
    include: { track: { select: { id: true, title: true, artist: { select: { title: true } }, album: { select: { title: true } } } } },
  });
  if (!profile) return NextResponse.json({ error: "Playback profile not found" }, { status: 404 });
  const mappings = await prisma.plexUserMapping.findMany({ where: { userId, enabled: true }, select: { serverId: true, plexUserId: true } });
  const events = await prisma.plexPlaybackEvent.findMany({
    where: { trackId: params.trackId, OR: mappings.map((mapping) => ({ serverId: mapping.serverId, plexUserId: mapping.plexUserId })) },
    orderBy: { playedAt: "desc" },
    take: 100,
    select: { id: true, playedAt: true, completionPercent: true, completed: true, skipped: true, source: true },
  });
  return NextResponse.json({ profile, events });
}
