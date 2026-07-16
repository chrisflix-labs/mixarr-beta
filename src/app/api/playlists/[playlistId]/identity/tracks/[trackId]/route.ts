import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { updatePlaylistTrackMemory } from "@/lib/playlistIdentity";

export async function PATCH(request: Request, { params }: { params: { playlistId: string; trackId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await updatePlaylistTrackMemory(userId, params.playlistId, params.trackId, await request.json()));
  } catch (error: any) {
    const message = error?.issues?.[0]?.message || error?.message || "Unable to update playlist track memory";
    return NextResponse.json({ error: message }, { status: error?.issues ? 400 : message.includes("not found") ? 404 : 500 });
  }
}
