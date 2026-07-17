import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { deletePlaylistRelationship, updatePlaylistRelationship } from "@/lib/playlistCoordination";

export async function PATCH(request: Request, { params }: { params: { playlistId: string; relationshipId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ relationship: await updatePlaylistRelationship(userId, params.playlistId, params.relationshipId, await request.json()) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to update relationship" }, { status: error.message?.includes("not found") ? 404 : 400 }); }
}

export async function DELETE(_request: Request, { params }: { params: { playlistId: string; relationshipId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await deletePlaylistRelationship(userId, params.playlistId, params.relationshipId)); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to delete relationship" }, { status: error.message?.includes("not found") ? 404 : 400 }); }
}
