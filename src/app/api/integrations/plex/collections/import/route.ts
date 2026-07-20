import { NextResponse } from "next/server";
import { integrationApiError, requireIntegrationAdmin } from "@/lib/integrations/api";
import { importPlexCollection } from "@/lib/integrations/service";
export async function POST(request: Request) { try { const userId = await requireIntegrationAdmin(); const body = await request.json(); return NextResponse.json(await importPlexCollection({ userId, serverId: String(body.serverId), libraryId: String(body.libraryId), collectionId: String(body.collectionId), name: body.name ? String(body.name) : undefined, sourceMode: ["FIXED", "RECIPE_SEED", "INCLUSION_FILTER", "DISCOVERY_POOL", "AUTOMATION_SOURCE"].includes(body.sourceMode) ? body.sourceMode : "FIXED" })); } catch (error) { return integrationApiError(error); } }
