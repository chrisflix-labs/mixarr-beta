import { NextResponse } from "next/server";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { getAiUsage } from "@/ai/services/usageService";
export const dynamic = "force-dynamic";
export async function GET() { try { await requireAiAdmin(); return NextResponse.json(await getAiUsage()); } catch (error) { return aiRouteError(error); } }
