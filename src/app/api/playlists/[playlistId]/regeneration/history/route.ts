import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAdvancedPlaylistRegenerationHistory } from "@/lib/playlistService";

export async function GET(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = Number(new URL(request.url).searchParams.get("limit") || 25);
  const history = await getAdvancedPlaylistRegenerationHistory(userId, params.playlistId, limit);
  if (!history) return NextResponse.json({ error: "Generated playlist not found" }, { status: 404 });
  return NextResponse.json({ history });
}

