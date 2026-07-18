import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { applyOverlapRepair } from "@/lib/playlistCoordination";

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await applyOverlapRepair(userId, await request.json())); }
  catch (error: any) {
    const message = error.message || "Failed to apply repair";
    return NextResponse.json({ error: message }, { status: /changed|expired|no longer/i.test(message) ? 409 : 400 });
  }
}

