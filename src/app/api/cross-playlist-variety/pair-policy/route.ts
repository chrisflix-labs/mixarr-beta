import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPlaylistPairPolicy, upsertPlaylistPairPolicy } from "@/lib/playlistCoordination";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  try { return NextResponse.json({ policy: await getPlaylistPairPolicy(userId, url.searchParams.get("playlistAId") || "", url.searchParams.get("playlistBId") || "") }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to load pair policy" }, { status: 400 }); }
}

export async function PUT(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ policy: await upsertPlaylistPairPolicy(userId, await request.json()) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to save pair policy" }, { status: 400 }); }
}

