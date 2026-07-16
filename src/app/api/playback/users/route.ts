import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isUserAdmin } from "@/lib/auth";
import { listPlexPlaybackUsers, mapPlexPlaybackUser } from "@/lib/playbackAwareness";

function currentUserId() {
  return cookies().get("mixarr_session")?.value;
}

export async function GET(request: Request) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const all = new URL(request.url).searchParams.get("all") === "true" && await isUserAdmin(userId);
    return NextResponse.json({ servers: await listPlexPlaybackUsers(userId, all) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Plex users are unavailable" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await mapPlexPlaybackUser(userId, await request.json(), await isUserAdmin(userId)));
  } catch (error: any) {
    const status = error?.message === "ADMIN_REQUIRED" ? 403 : error?.issues ? 400 : 500;
    return NextResponse.json({ error: error?.issues?.[0]?.message || error?.message || "Could not map Plex user" }, { status });
  }
}
