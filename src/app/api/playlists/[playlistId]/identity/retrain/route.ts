import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { trainPlaylistIdentity } from "@/lib/playlistIdentity";

export async function POST(_request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await trainPlaylistIdentity({ userId, playlistId: params.playlistId, source: "MANUAL_RETRAIN" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to retrain playlist identity";
    return NextResponse.json({ error: message }, { status: message.includes("already running") ? 409 : message.includes("not found") ? 404 : 500 });
  }
}
