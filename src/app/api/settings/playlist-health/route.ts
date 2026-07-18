import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPlaylistHealthSettings, PlaylistHealthError, updatePlaylistHealthSettings } from "@/lib/playlistHealth";

export const dynamic = "force-dynamic";
export async function GET() { const userId = cookies().get("mixarr_session")?.value; return userId ? NextResponse.json(await getPlaylistHealthSettings(userId), { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
export async function PATCH(request: Request) {
  const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await updatePlaylistHealthSettings(userId, await request.json())); }
  catch (error) { const known = error instanceof PlaylistHealthError; return NextResponse.json({ error: (error as any)?.issues?.[0]?.message || (error instanceof Error ? error.message : "Unable to save playlist health settings"), code: known ? error.code : "INVALID_INPUT" }, { status: known ? error.status : 400 }); }
}
