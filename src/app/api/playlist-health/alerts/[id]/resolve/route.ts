import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PlaylistHealthError, transitionPlaylistHealthAlert } from "@/lib/playlistHealth";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { const body = await request.json().catch(() => ({})); return NextResponse.json(await transitionPlaylistHealthAlert(userId, params.id, "RESOLVE", body.note)); }
  catch (error) { const known = error instanceof PlaylistHealthError; return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to resolve alert" }, { status: known ? error.status : 400 }); }
}
