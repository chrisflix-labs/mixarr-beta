import { NextResponse } from "next/server";
import { createPlaylistGroupSchema } from "@/lib/playlistGroups/schemas";
import { createPlaylistGroup, listPlaylistGroups } from "@/lib/playlistGroups/service";
import { playlistGroupApiError, playlistGroupSession, playlistGroupUnauthorized } from "@/lib/playlistGroups/api";

export async function GET(request: Request) {
  const userId = playlistGroupSession(); if (!userId) return playlistGroupUnauthorized();
  const url = new URL(request.url);
  try { return NextResponse.json({ groups: await listPlaylistGroups(userId, { search: url.searchParams.get("search") || undefined, status: url.searchParams.get("status") || undefined, sort: url.searchParams.get("sort") || undefined }) }); }
  catch (error) { return playlistGroupApiError(error); }
}

export async function POST(request: Request) {
  const userId = playlistGroupSession(); if (!userId) return playlistGroupUnauthorized();
  try { const input = createPlaylistGroupSchema.parse(await request.json()); return NextResponse.json({ group: await createPlaylistGroup(userId, input) }, { status: 201 }); }
  catch (error) { return playlistGroupApiError(error); }
}
