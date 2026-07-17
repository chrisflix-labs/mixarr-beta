import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCoordinationSettings, updateCoordinationSettings } from "@/lib/playlistCoordination";

export async function GET(_request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ settings: await getCoordinationSettings(userId, params.playlistId) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to load coordination settings" }, { status: error.message?.includes("not found") ? 404 : 400 }); }
}

export async function PATCH(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ settings: await updateCoordinationSettings(userId, params.playlistId, await request.json()) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to save coordination settings" }, { status: 400 }); }
}
