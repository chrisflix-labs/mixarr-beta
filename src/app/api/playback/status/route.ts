import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPlaybackSyncStatus } from "@/lib/playbackAwareness";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ states: await getPlaybackSyncStatus(userId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Playback sync status is unavailable" }, { status: 500 });
  }
}
