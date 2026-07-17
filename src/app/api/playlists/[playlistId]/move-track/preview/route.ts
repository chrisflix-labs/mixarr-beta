import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { previewMoveTrack } from "@/lib/playlistCoordination";

export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ preview: await previewMoveTrack(userId, params.playlistId, await request.json()) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to preview track move" }, { status: 400 }); }
}
