import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPersonalizationDashboardSummary } from "@/lib/personalization/dashboard";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json((await getPersonalizationDashboardSummary(userId, { refresh: true })).health); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Health check failed" }, { status: 500 }); }
}
