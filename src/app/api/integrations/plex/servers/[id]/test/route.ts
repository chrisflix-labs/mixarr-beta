import { NextResponse } from "next/server";
import { integrationApiError, requireIntegrationAdmin } from "@/lib/integrations/api";
import { testPlexServer } from "@/lib/integrations/service";
export async function POST(_: Request, { params }: { params: { id: string } }) { try { const userId = await requireIntegrationAdmin(); return NextResponse.json(await testPlexServer(params.id, userId)); } catch (error) { return integrationApiError(error); } }
