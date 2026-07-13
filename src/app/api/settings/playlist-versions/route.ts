import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";

const defaults = { playlistVersionHistoryEnabled: true, playlistVersionRetention: 25, saveManualPlaylistVersions: true, savePlaylistScoreSnapshots: true, cleanupPlaylistVersionsAutomatically: false };
const schema = z.object({
  playlistVersionHistoryEnabled: z.boolean(), playlistVersionRetention: z.number().int().min(1).max(500),
  saveManualPlaylistVersions: z.boolean(), savePlaylistScoreSnapshots: z.boolean(), cleanupPlaylistVersionsAutomatically: z.boolean(),
});

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await prisma.syncSettings.findUnique({ where: { userId }, select: { playlistVersionHistoryEnabled: true, playlistVersionRetention: true, saveManualPlaylistVersions: true, savePlaylistScoreSnapshots: true, cleanupPlaylistVersionsAutomatically: true } });
  return NextResponse.json({ settings: settings || defaults });
}

export async function PUT(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid version settings" }, { status: 400 });
  const settings = await prisma.syncSettings.upsert({ where: { userId }, create: { userId, ...parsed.data }, update: parsed.data, select: { playlistVersionHistoryEnabled: true, playlistVersionRetention: true, saveManualPlaylistVersions: true, savePlaylistScoreSnapshots: true, cleanupPlaylistVersionsAutomatically: true } });
  return NextResponse.json({ settings });
}

