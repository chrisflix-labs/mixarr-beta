import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listPlaylistTrackDesignations, setPlaylistTrackDesignations } from "@/lib/playlistCoordination";

export async function GET(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ designations: await listPlaylistTrackDesignations(userId, params.playlistId, new URL(request.url).searchParams.get("coreOnly") === "true") }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to load designations" }, { status: 400 }); }
}

export async function PATCH(request: Request, { params }: { params: { playlistId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ designations: await setPlaylistTrackDesignations(userId, params.playlistId, await request.json()) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to update designations" }, { status: 400 }); }
}

