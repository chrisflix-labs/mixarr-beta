import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isUserAdmin } from "@/lib/auth";
import { getPlaybackDashboardSummary } from "@/lib/playbackAwareness";

export async function GET(request: Request) {
  const actorUserId = cookies().get("mixarr_session")?.value;
  if (!actorUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requestedUserId = new URL(request.url).searchParams.get("userId");
  const targetUserId = requestedUserId || actorUserId;
  if (targetUserId !== actorUserId && !(await isUserAdmin(actorUserId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await getPlaybackDashboardSummary(targetUserId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Playback summary is unavailable" }, { status: 500 });
  }
}
