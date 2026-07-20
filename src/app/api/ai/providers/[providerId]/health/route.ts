import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { providerId: string } }) { try { await requireAiAdmin(); const health = await prisma.aiProviderHealth.findUnique({ where: { providerConfigId: params.providerId } }); return NextResponse.json({ health: health || { healthState: "NOT_TESTED" } }); } catch (error) { return aiRouteError(error); } }
