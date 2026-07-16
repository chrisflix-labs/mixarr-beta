import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listPlaybackProfileTracks } from "@/lib/playbackAwareness";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    return NextResponse.json(await listPlaybackProfileTracks({
      userId,
      category: params.get("category") || undefined,
      page: Number(params.get("page") || 1),
      pageSize: Number(params.get("pageSize") || 25),
      sort: params.get("sort") || undefined,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Playback tracks are unavailable" }, { status: 500 });
  }
}
