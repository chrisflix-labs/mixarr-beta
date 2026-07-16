import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isUserAdmin } from "@/lib/auth";
import { listUnmatchedPlaybackEvents } from "@/lib/playbackAwareness";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isUserAdmin(userId))) return NextResponse.json({ error: "Admin permission required" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  return NextResponse.json(await listUnmatchedPlaybackEvents({
    page: Number(params.get("page") || 1),
    pageSize: Number(params.get("pageSize") || 25),
  }));
}
