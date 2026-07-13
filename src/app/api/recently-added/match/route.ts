import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { findRecentlyAddedPlaylistMatches } from "@/lib/recentlyAdded";

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(await findRecentlyAddedPlaylistMatches({ userId, batchId: body.batchId || null }));
}

