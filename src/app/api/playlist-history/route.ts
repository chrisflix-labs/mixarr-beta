import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPlaylistHistory } from "@/lib/playlistHistory";

export async function GET(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const result = await getPlaylistHistory({
    userId,
    eventType: url.searchParams.get("eventType"),
    sourceType: url.searchParams.get("sourceType"),
    playlistName: url.searchParams.get("playlistName"),
    recipeName: url.searchParams.get("recipeName"),
    generatedPlaylistId: url.searchParams.get("generatedPlaylistId"),
    limit: Number(url.searchParams.get("limit") || 50),
    offset: Number(url.searchParams.get("offset") || 0),
  });

  return NextResponse.json(result);
}
