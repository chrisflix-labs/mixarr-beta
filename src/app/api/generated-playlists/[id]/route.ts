import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

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
