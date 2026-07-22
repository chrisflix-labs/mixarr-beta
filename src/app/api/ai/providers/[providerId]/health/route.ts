import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { getAiProvider } from "@/ai/services/providerService";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { providerId: string } }) { try { await requireAiAdmin(); await getAiProvider(params.providerId); const health = await prisma.aiProviderHealth.findUnique({ where: { providerConfigId: params.providerId } }); return NextResponse.json({ health: health || { healthState: "NOT_TESTED" } }); } catch (error) { return aiRouteError(error); } }
