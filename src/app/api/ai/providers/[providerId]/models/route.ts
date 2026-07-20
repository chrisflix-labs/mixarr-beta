import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { providerId: string } }) { try { await requireAiAdmin(); const models = await prisma.aiProviderModel.findMany({ where: { providerConfigId: params.providerId }, orderBy: [{ availabilityStatus: "asc" }, { displayName: "asc" }] }); return NextResponse.json({ models }); } catch (error) { return aiRouteError(error); } }
