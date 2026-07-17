import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { applyPlaylistRebalance } from "@/lib/playlistCoordination";

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await applyPlaylistRebalance(userId, await request.json())); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to apply rebalance" }, { status: 400 }); }
}
