import { NextResponse } from "next/server";
import { integrationApiError, requireIntegrationAdmin } from "@/lib/integrations/api";
import { listPlexCollections } from "@/lib/integrations/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { await requireIntegrationAdmin(); const url = new URL(request.url); return NextResponse.json({ collections: await listPlexCollections(String(url.searchParams.get("serverId") || ""), url.searchParams.get("libraryId") || undefined) }); } catch (error) { return integrationApiError(error); } }
