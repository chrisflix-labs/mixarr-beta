import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { duplicateAiPricingProfile, saveAiPricingProfile } from "@/ai/governance/service";
export async function PATCH(request: Request, { params }: { params: { pricingId: string } }) { try { const actorId = await requireAiPermission("MANAGE_AI_PRICING"); return NextResponse.json(await saveAiPricingProfile(await request.json(), actorId, params.pricingId)); } catch (error) { return aiRouteError(error); } }
export async function POST(_request: Request, { params }: { params: { pricingId: string } }) { try { const actorId = await requireAiPermission("MANAGE_AI_PRICING"); return NextResponse.json(await duplicateAiPricingProfile(params.pricingId, actorId), { status: 201 }); } catch (error) { return aiRouteError(error); } }
