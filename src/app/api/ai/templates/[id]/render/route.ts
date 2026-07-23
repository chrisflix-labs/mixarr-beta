import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermissionedUser } from "@/ai/intelligence/api";
import { renderAiRequestTemplate } from "@/ai/intelligence/service";
export async function POST(request: Request, { params }: { params: { id: string } }) { try { const userId = await requireAiPermissionedUser(); return NextResponse.json(await renderAiRequestTemplate(userId, params.id, await request.json())); } catch (error) { return aiRouteError(error); } }
