import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { comparePlaylists } from "@/lib/playlistCoordination";

const schema = z.object({ sourcePlaylistId: z.string().uuid(), targetPlaylistId: z.string().uuid() });
export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const input = schema.parse(await request.json()); return NextResponse.json({ overlap: await comparePlaylists(userId, input.sourcePlaylistId, input.targetPlaylistId) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to compare playlists" }, { status: 400 }); }
}
