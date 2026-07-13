import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearRecentlyAddedHistory, getRecentlyAddedHistory } from "@/lib/recentlyAdded";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  return NextResponse.json(await getRecentlyAddedHistory(userId, { cursor: url.searchParams.get("cursor"), limit: Number(url.searchParams.get("limit")) || 25 }));
}

export async function DELETE(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== "CLEAR RECENTLY ADDED HISTORY") return NextResponse.json({ error: "Confirmation phrase is required. Playlist versions are never removed by this action." }, { status: 400 });
  return NextResponse.json(await clearRecentlyAddedHistory(userId));
}

