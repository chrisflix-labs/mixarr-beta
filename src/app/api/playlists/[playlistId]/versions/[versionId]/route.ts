import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { deletePlaylistVersion, getPlaylistVersion, updatePlaylistVersion } from "@/lib/playlists/versions/playlist-version-service";

const patchSchema = z.object({ label: z.string().trim().max(100).nullable().optional(), isPinned: z.boolean().optional() }).refine((value) => value.label !== undefined || value.isPinned !== undefined, "No changes supplied");

export async function GET(_request: Request, { params }: { params: { playlistId: string; versionId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const version = await getPlaylistVersion(userId, params.playlistId, params.versionId);
  return version ? NextResponse.json(version) : NextResponse.json({ error: "Version no longer exists" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: { playlistId: string; versionId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid version update" }, { status: 400 });
  const version = await updatePlaylistVersion(userId, params.playlistId, params.versionId, parsed.data);
  return version ? NextResponse.json({ version }) : NextResponse.json({ error: "Version no longer exists" }, { status: 404 });
}

export async function DELETE(_request: Request, { params }: { params: { playlistId: string; versionId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await deletePlaylistVersion(userId, params.playlistId, params.versionId);
    return result ? NextResponse.json(result) : NextResponse.json({ error: "Version no longer exists" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Version could not be deleted" }, { status: 409 });
  }
}

