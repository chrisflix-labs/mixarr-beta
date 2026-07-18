import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { analyzeUserPlaylists, PlaylistHealthError } from "@/lib/playlistHealth";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try { const body = await request.json().catch(() => ({})); return NextResponse.json(await analyzeUserPlaylists(userId, { playlistId: typeof body.playlistId === "string" ? body.playlistId : undefined, limit: Number(body.limit || 100) })); }
  catch (error) { const known = error instanceof PlaylistHealthError; return NextResponse.json({ error: error instanceof Error ? error.message : "Playlist analysis failed", code: known ? error.code : "ANALYSIS_FAILED" }, { status: known ? error.status : 400 }); }
}
