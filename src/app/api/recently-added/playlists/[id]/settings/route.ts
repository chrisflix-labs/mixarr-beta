import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";

const inputSchema = z.object({ mode: z.enum(["off", "suggestions", "automatic"]), excludeFromScheduledRegeneration: z.boolean().default(false) });

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: params.id, userId }, include: { automationSettings: true } });
  if (!playlist) return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  return NextResponse.json({ settings: playlist.automationSettings || { mode: "suggestions", excludeFromScheduledRegeneration: false } });
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: params.id, userId }, select: { id: true } });
  if (!playlist) return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  const input = inputSchema.parse(await request.json());
  const settings = await prisma.playlistAutomationSettings.upsert({ where: { generatedPlaylistId: params.id }, update: input, create: { userId, generatedPlaylistId: params.id, ...input } });
  return NextResponse.json({ settings });
}

