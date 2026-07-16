import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { startPlaybackHistorySync } from "@/lib/playbackAwareness";

const schema = z.object({
  serverId: z.string().uuid(),
  mode: z.enum(["incremental", "full"]).default("incremental"),
});

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const value = schema.parse(await request.json());
    const server = await prisma.server.findFirst({ where: { id: value.serverId, userId }, select: { id: true } });
    if (!server) return NextResponse.json({ error: "Plex server not found" }, { status: 404 });
    const result = await startPlaybackHistorySync({ serverId: server.id, userId, source: "manual", mode: value.mode });
    return NextResponse.json(result, { status: result.started ? 202 : 409 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.issues?.[0]?.message || error?.message || "Could not start playback sync" }, { status: error?.issues ? 400 : 500 });
  }
}
