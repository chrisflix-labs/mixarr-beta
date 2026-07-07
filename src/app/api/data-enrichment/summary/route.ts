import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDataEnrichmentSummary } from "@/lib/dataEnrichment";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const libraryId = new URL(request.url).searchParams.get("libraryId") || undefined;
    const summary = await getDataEnrichmentSummary(userId, libraryId);
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[DataEnrichment] Failed to load summary", error);
    return NextResponse.json({ error: "Unable to load Data Enrichment summary. Check logs or try again." }, { status: 500 });
  }
}
