import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listRecentlyAddedTracks } from "@/lib/recentlyAdded";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  return NextResponse.json(await listRecentlyAddedTracks(userId, { status: url.searchParams.get("status"), cursor: url.searchParams.get("cursor"), limit: Number(url.searchParams.get("limit")) || 50 }));
}

