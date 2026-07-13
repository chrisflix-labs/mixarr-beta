import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { runRecentlyAddedAutomation } from "@/lib/recentlyAdded";

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const result = await runRecentlyAddedAutomation({ userId, triggerType: "manual", libraryId: body.libraryId || null, scan: body.scan !== false });
  return NextResponse.json(result, { status: result.reason === "already_running" ? 409 : 200 });
}

