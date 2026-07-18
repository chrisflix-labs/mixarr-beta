import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCrossPlaylistVarietySettings, updateCrossPlaylistVarietySettings } from "@/lib/playlistCoordination";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ settings: await getCrossPlaylistVarietySettings(userId) });
}

export async function PUT(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ settings: await updateCrossPlaylistVarietySettings(userId, await request.json()) }); }
  catch (error: any) { return NextResponse.json({ error: error.message || "Failed to save variety settings" }, { status: 400 }); }
}

