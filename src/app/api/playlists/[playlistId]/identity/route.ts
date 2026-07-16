import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPlaylistIdentity, updatePlaylistIdentity } from "@/lib/playlistIdentity";

export async function GET(_request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getPlaylistIdentity(userId, params.playlistId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load playlist identity";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await updatePlaylistIdentity(userId, params.playlistId, await request.json()));
  } catch (error: any) {
    const message = error?.issues?.[0]?.message || error?.message || "Unable to update playlist identity";
    return NextResponse.json({ error: message }, { status: error?.issues ? 400 : message.includes("not found") ? 404 : 500 });
  }
}
