import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { createPlaylistVersion, listPlaylistVersions } from "@/lib/playlists/versions/playlist-version-service";

const createSchema = z.object({ label: z.string().trim().max(100).optional(), description: z.string().trim().max(500).optional(), isPinned: z.boolean().default(true) });

export async function GET(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const result = await listPlaylistVersions(userId, params.playlistId, {
    cursor: url.searchParams.get("cursor") ? Number(url.searchParams.get("cursor")) : undefined,
    limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
    filter: url.searchParams.get("filter") || undefined,
  });
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Generated playlist not found" }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: params.playlistId, userId }, select: { id: true } });
  if (!playlist) return NextResponse.json({ error: "Generated playlist not found" }, { status: 404 });
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid save point" }, { status: 400 });
  const version = await createPlaylistVersion({ generatedPlaylistId: params.playlistId, reason: "manual_edit", label: parsed.data.label, description: parsed.data.description || "Manual restore point", isPinned: parsed.data.isPinned, isAutomatic: false });
  return NextResponse.json({ version }, { status: 201 });
}

