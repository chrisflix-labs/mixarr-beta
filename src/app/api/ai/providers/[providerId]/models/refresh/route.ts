import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { refreshAiProviderModels } from "@/ai/health/service";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { providerId: string } }) { try { const userId = await requireAiPermission("ai.provider.manage"); return NextResponse.json(await refreshAiProviderModels(params.providerId, request.signal, userId)); } catch (error) { return aiRouteError(error); } }
