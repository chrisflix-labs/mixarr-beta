import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSmartRefreshDashboardSummary } from "@/lib/smartRefresh";

export const dynamic = "force-dynamic";
export async function GET() { const userId = cookies().get("mixarr_session")?.value; if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); return NextResponse.json(await getSmartRefreshDashboardSummary(userId), { headers: { "Cache-Control": "no-store" } }); }
