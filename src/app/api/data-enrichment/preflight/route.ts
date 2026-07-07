import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { preflightDataEnrichmentAction, dataEnrichmentActionConfigs, type DataEnrichmentAction } from "@/lib/dataEnrichment";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  action: z.string(),
  libraryId: z.string().uuid().optional(),
});

function isDataEnrichmentAction(value: string): value is DataEnrichmentAction {
  return Object.prototype.hasOwnProperty.call(dataEnrichmentActionConfigs, value);
}

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success || !isDataEnrichmentAction(parsed.data.action)) {
      return NextResponse.json({ error: "A valid Data Enrichment action is required" }, { status: 400 });
    }
    const result = await preflightDataEnrichmentAction(userId, parsed.data.action, { libraryId: parsed.data.libraryId });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[DataEnrichment] Failed to preflight action", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to preflight enrichment action" }, { status: 500 });
  }
}
