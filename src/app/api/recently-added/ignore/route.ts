import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { addRecentlyAddedExclusion, updateRecentlyAddedTrackDisposition } from "@/lib/recentlyAdded";

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  if (["artist", "album", "library", "genre"].includes(body.type) && typeof body.value === "string" && body.value) {
    return NextResponse.json(await addRecentlyAddedExclusion(userId, body.type, body.value));
  }
  if (!Array.isArray(body.trackIds) || !body.trackIds.length) return NextResponse.json({ error: "Select at least one track" }, { status: 400 });
  return NextResponse.json(await updateRecentlyAddedTrackDisposition(userId, body.trackIds, body.action || "ignore"));
}
