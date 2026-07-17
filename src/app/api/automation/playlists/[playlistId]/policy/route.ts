import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getEffectivePlaylistPolicy, resetPlaylistPolicyOverride, savePlaylistPolicyOverride } from "@/lib/automation";

export async function GET(_request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const effective = await getEffectivePlaylistPolicy(userId, params.playlistId);
  return effective ? NextResponse.json(effective) : NextResponse.json({ error: "Playlist not found." }, { status: 404 });
}

export async function PUT(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const settings = await savePlaylistPolicyOverride(userId, params.playlistId, await request.json());
    return settings ? NextResponse.json({ settings, effective: await getEffectivePlaylistPolicy(userId, params.playlistId) }) : NextResponse.json({ error: "Playlist not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Invalid playlist policy." }, { status: 400 });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await resetPlaylistPolicyOverride(userId, params.playlistId);
  return settings ? NextResponse.json({ settings, effective: await getEffectivePlaylistPolicy(userId, params.playlistId) }) : NextResponse.json({ error: "Playlist not found." }, { status: 404 });
}
