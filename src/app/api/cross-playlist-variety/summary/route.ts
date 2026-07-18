import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCoordinationDashboard } from "@/lib/playlistCoordination";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getCoordinationDashboard(userId));
}

