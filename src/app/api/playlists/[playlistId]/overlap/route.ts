import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { comparePlaylists, listPlaylistRelationships } from "@/lib/playlistCoordination";

export async function GET(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const target = new URL(request.url).searchParams.get("targetPlaylistId");
    if (target) return NextResponse.json({ overlap: await comparePlaylists(userId, params.playlistId, target) });
    const relationships = await listPlaylistRelationships(userId, params.playlistId);
    const overlaps = await Promise.all(relationships.map((item) => comparePlaylists(userId, params.playlistId, item.sourcePlaylistId === params.playlistId ? item.targetPlaylistId : item.sourcePlaylistId)));
    return NextResponse.json({ overlaps });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to calculate overlap" }, { status: error.message?.includes("not found") ? 404 : 400 }); }
}
