import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAdaptiveScoringSettings, updateAdaptiveScoringSettings } from "@/lib/adaptiveScoring";

function userId() {
  return cookies().get("mixarr_session")?.value;
}

export async function GET(request: Request) {
  const currentUserId = userId();
  if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const playlistId = new URL(request.url).searchParams.get("playlistId");
  try {
    return NextResponse.json(await getAdaptiveScoringSettings(currentUserId, playlistId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Adaptive scoring settings are unavailable" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const currentUserId = userId();
  if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await updateAdaptiveScoringSettings(currentUserId, await request.json()));
  } catch (error: any) {
    return NextResponse.json({ error: error?.issues?.[0]?.message || error?.message || "Invalid adaptive scoring settings" }, { status: error?.issues ? 400 : 500 });
  }
}
