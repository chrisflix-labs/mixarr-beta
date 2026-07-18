import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listPlaylistHealthAlerts } from "@/lib/playlistHealth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  return NextResponse.json(await listPlaylistHealthAlerts(userId, { status: query.get("status") || undefined, severity: query.get("severity") || undefined, playlistId: query.get("playlistId") || undefined }), { headers: { "Cache-Control": "no-store" } });
}
