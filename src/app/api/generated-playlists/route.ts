import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const playlists = await prisma.generatedPlaylist.findMany({
    where: { userId },
    orderBy: [{ lastGeneratedAt: "desc" }, { updatedAt: "desc" }],
    include: {
      _count: { select: { tracks: true } },
      automationSettings: true,
    },
  });

  return NextResponse.json({ playlists });
}
