import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createPlaylistRelationship, listPlaylistRelationships } from "@/lib/playlistCoordination";

export async function GET(_request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ relationships: await listPlaylistRelationships(userId, params.playlistId) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to load relationships" }, { status: error.message?.includes("not found") ? 404 : 400 }); }
}

export async function POST(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ relationship: await createPlaylistRelationship(userId, params.playlistId, await request.json()) }, { status: 201 }); }
  catch (error: any) { return NextResponse.json({ error: error instanceof ZodError ? error.issues[0]?.message : error.message || "Failed to create relationship" }, { status: error instanceof ZodError ? 400 : error.message?.includes("not found") ? 404 : 409 }); }
}
