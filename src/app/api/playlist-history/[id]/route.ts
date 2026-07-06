import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPlaylistHistoryEntry } from "@/lib/playlistHistory";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entry = await getPlaylistHistoryEntry(userId, params.id);

  if (!entry) {
    return NextResponse.json({ error: "Playlist history entry not found" }, { status: 404 });
  }

  return NextResponse.json({ entry });
}
