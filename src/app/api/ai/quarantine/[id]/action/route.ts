import { NextResponse } from "next/server";
import { z } from "zod";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { resolveAiQuarantine } from "@/ai/quarantine/service";
export const dynamic = "force-dynamic";
const schema = z.object({ action: z.enum(["REJECT", "DISMISS_WARNING"]), notes: z.string().max(1000).optional() }).strict();
export async function POST(request: Request, { params }: { params: { id: string } }) { try { const actorId = await requireAiPermission("ai.audit.view"), input = schema.parse(await request.json()); return NextResponse.json({ record: await resolveAiQuarantine({ id: params.id, actorId, ...input }) }); } catch (error) { return aiRouteError(error); } }
