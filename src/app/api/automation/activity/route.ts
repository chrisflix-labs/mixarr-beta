import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listAutomationActivity } from "@/lib/automation";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  return NextResponse.json({ activity: await listAutomationActivity(userId, { status: url.searchParams.get("status") || undefined, source: url.searchParams.get("source") || undefined, playlistId: url.searchParams.get("playlistId") || undefined, limit: Number(url.searchParams.get("limit") || 50) }) });
}
