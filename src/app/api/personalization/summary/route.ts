import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPersonalizationDashboardSummary } from "@/lib/personalization/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const period = url.searchParams.get("period");
  const days = period === "all" ? null : ["7", "30", "90"].includes(period || "") ? Number(period) : 30;
  try {
    return NextResponse.json(await getPersonalizationDashboardSummary(userId, { days, refresh: url.searchParams.get("refresh") === "1" }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Personalization summary is unavailable" }, { status: 500 });
  }
}
