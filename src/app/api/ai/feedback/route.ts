import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermissionedUser } from "@/ai/intelligence/api";
import { saveAiQualityFeedback } from "@/ai/intelligence/service";
export async function POST(request: Request) { try { const userId = await requireAiPermissionedUser(); return NextResponse.json(await saveAiQualityFeedback(userId, await request.json())); } catch (error) { return aiRouteError(error); } }
