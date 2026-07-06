import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getGeneratedPlaylistHistory } from "@/lib/playlistHistory";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const history = await getGeneratedPlaylistHistory(userId, params.id, Number(url.searchParams.get("limit") || 50));

  if (!history) {
    return NextResponse.json({ error: "Generated playlist not found" }, { status: 404 });
  }

  return NextResponse.json({ history });
}
