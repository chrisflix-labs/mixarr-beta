import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPlaylistPreferenceProfile, resetPlaylistLearnedProfile, updatePlaylistPreferenceProfile } from "@/lib/personalization";

function statusFor(message: string) {
  return /not found/i.test(message) ? 404 : 500;
}

export async function GET(_request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getPlaylistPreferenceProfile(userId, params.playlistId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Playlist preference profile is unavailable";
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

export async function PATCH(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await updatePlaylistPreferenceProfile(userId, params.playlistId, await request.json());
    return NextResponse.json(await getPlaylistPreferenceProfile(userId, params.playlistId));
  } catch (error: any) {
    const message = error?.issues?.[0]?.message || error?.message || "Invalid playlist preference profile";
    return NextResponse.json({ error: message }, { status: error?.issues ? 400 : statusFor(message) });
  }
}

export async function DELETE(_request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await resetPlaylistLearnedProfile(userId, params.playlistId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Playlist preference reset failed";
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
