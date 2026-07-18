import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPlaylistHealthDashboard } from "@/lib/playlistHealth";

export const dynamic = "force-dynamic";
export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  try { return NextResponse.json(await getPlaylistHealthDashboard(userId), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load playlist health" }, { status: 400 }); }
}
