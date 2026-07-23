import { NextResponse } from "next/server";
import { z } from "zod";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { currentEmergencyShutdown, setEmergencyShutdown } from "@/ai/governance/executionPolicy";

export const dynamic = "force-dynamic";
const schema = z.object({ active: z.boolean(), confirm: z.literal(true), reason: z.string().trim().max(1000).optional() }).strict();
export async function GET() { try { await requireAiPermission("ai.provider.view"); return NextResponse.json(await currentEmergencyShutdown()); } catch (error) { return aiRouteError(error); } }
export async function PUT(request: Request) { try { const actorId = await requireAiPermission("ai.provider.manage"); const input = schema.parse(await request.json()); return NextResponse.json(await setEmergencyShutdown({ active: input.active, actorId, reason: input.reason })); } catch (error) { return aiRouteError(error); } }
