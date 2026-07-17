import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listPlaylistIdentities } from "@/lib/personalization/dashboard";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  try {
    return NextResponse.json(await listPlaylistIdentities(userId, { page: Number(url.searchParams.get("page")), pageSize: Number(url.searchParams.get("pageSize")), query: url.searchParams.get("query") || undefined, filter: url.searchParams.get("filter") || undefined, sort: url.searchParams.get("sort") || undefined }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Playlist identities are unavailable" }, { status: 500 });
  }
}
