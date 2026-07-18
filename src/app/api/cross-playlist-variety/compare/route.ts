import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { comparePlaylists } from "@/lib/playlistCoordination";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  try { return NextResponse.json({ comparison: await comparePlaylists(userId, url.searchParams.get("playlistAId") || "", url.searchParams.get("playlistBId") || "") }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to compare playlists" }, { status: 400 }); }
}

