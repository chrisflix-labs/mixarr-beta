import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { applyRecentlyAddedChanges, rejectRecentlyAddedChanges } from "@/lib/recentlyAdded";

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const matchIds = Array.isArray(body.matchIds) ? body.matchIds : undefined;
  if (body.action === "reject") {
    if (!body.runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });
    return NextResponse.json(await rejectRecentlyAddedChanges(userId, body.runId, matchIds));
  }
  return NextResponse.json(await applyRecentlyAddedChanges({ userId, runId: body.runId || null, matchIds, automatic: false }));
}

