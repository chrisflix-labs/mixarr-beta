import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardSummary } from "@/lib/dashboardSummary";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const summary = await getDashboardSummary(userId);
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Dashboard] Summary failed", error);
    return NextResponse.json({
      status: "error",
      error: "Unable to load Dashboard summary.",
      sections: {
        libraryHealth: { status: "error", error: "Unable to load Library Health summary." },
        dataEnrichment: { status: "error", error: "Unable to load Data Enrichment summary." },
      },
    }, { status: 500 });
  }
}
