import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermissionedUser } from "@/ai/intelligence/api";
import { getAiIntelligenceDashboard } from "@/ai/intelligence/service";
export const dynamic = "force-dynamic";
export async function GET() { try { const userId = await requireAiPermissionedUser(); return NextResponse.json(await getAiIntelligenceDashboard(userId)); } catch (error) { return aiRouteError(error); } }
