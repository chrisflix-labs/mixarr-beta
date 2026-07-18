import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPlaylistHealthDetail, PlaylistHealthError } from "@/lib/playlistHealth";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try { return NextResponse.json(await getPlaylistHealthDetail(userId, params.id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { const known = error instanceof PlaylistHealthError; return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load playlist health", code: known ? error.code : "FAILED" }, { status: known ? error.status : 400 }); }
}
