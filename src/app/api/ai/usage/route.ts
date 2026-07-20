import { NextResponse } from "next/server";
import { aiRouteError, requireAiAdmin } from "@/ai/services/api";
import { getAiUsage, parseUsageFilters } from "@/ai/services/usageService";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { await requireAiAdmin(); return NextResponse.json(await getAiUsage(parseUsageFilters(new URL(request.url)))); } catch (error) { return aiRouteError(error); } }
