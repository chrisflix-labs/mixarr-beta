import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: params.playlistId, userId }, select: { id: true } });
  if (!playlist) return NextResponse.json({ error: "Generated playlist not found" }, { status: 404 });
  const result = await prisma.playlistRevision.aggregate({ where: { generatedPlaylistId: params.playlistId }, _count: true, _sum: { snapshotSizeBytes: true } });
  return NextResponse.json({ versionCount: result._count, approximateBytes: result._sum.snapshotSizeBytes || 0 });
}

