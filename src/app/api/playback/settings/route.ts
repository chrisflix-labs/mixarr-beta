import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPlaybackSettings, updatePlaybackSettings } from "@/lib/playbackAwareness";

function currentUserId() {
  return cookies().get("mixarr_session")?.value;
}

export async function GET() {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getPlaybackSettings(userId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Playback settings are unavailable" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await updatePlaybackSettings(userId, await request.json()));
  } catch (error: any) {
    return NextResponse.json({ error: error?.issues?.[0]?.message || error?.message || "Invalid playback settings" }, { status: error?.issues ? 400 : 500 });
  }
}
