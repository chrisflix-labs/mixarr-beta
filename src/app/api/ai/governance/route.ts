import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { getAiGovernanceSettings, setFullMetadataAcknowledgment, updateAiGovernanceSettings } from "@/ai/governance/service";
export const dynamic = "force-dynamic";
export async function GET() { try { await requireAiPermission("VIEW_AI_USAGE"); return NextResponse.json(await getAiGovernanceSettings()); } catch (error) { return aiRouteError(error); } }
export async function PATCH(request: Request) { try { const actorId = await requireAiPermission("MANAGE_AI_PRIVACY"); return NextResponse.json(await updateAiGovernanceSettings(await request.json(), actorId)); } catch (error) { return aiRouteError(error); } }
export async function POST(request: Request) { try { const actorId = await requireAiPermission("ACCEPT_FULL_METADATA_WARNING"); const body = await request.json(); return NextResponse.json(await setFullMetadataAcknowledgment(body.accepted === true, actorId)); } catch (error) { return aiRouteError(error); } }
