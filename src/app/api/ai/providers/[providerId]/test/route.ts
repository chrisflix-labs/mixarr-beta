import { NextResponse } from "next/server";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { testAiProviderConnection } from "@/ai/health/service";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { providerId: string } }) { try { await requireAiAdmin(); return NextResponse.json(await testAiProviderConnection(params.providerId, request.signal)); } catch (error) { return aiRouteError(error); } }
