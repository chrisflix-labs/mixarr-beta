import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { importDiscoveredPricingProfiles, listAiPricingProfiles, saveAiPricingProfile } from "@/ai/governance/service";
export const dynamic = "force-dynamic";
export async function GET() { try { await requireAiPermission("MANAGE_AI_PRICING"); return NextResponse.json({ profiles: await listAiPricingProfiles() }); } catch (error) { return aiRouteError(error); } }
export async function POST(request: Request) { try { const actorId = await requireAiPermission("MANAGE_AI_PRICING"); const body = await request.json(); return NextResponse.json(body.importProviderModels ? await importDiscoveredPricingProfiles(String(body.importProviderModels), actorId) : await saveAiPricingProfile(body, actorId), { status: 201 }); } catch (error) { return aiRouteError(error); } }
