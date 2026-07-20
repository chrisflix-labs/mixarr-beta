import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { listProviderComparison } from "@/ai/governance/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { await requireAiPermission("VIEW_AI_USAGE"); const url = new URL(request.url); return NextResponse.json({ comparisons: await listProviderComparison(Math.max(1, Number(url.searchParams.get("inputTokens") || 1000)), Math.max(1, Number(url.searchParams.get("outputTokens") || 500)), (url.searchParams.get("privacyMode") || "METADATA_LIMITED") as any) }); } catch (error) { return aiRouteError(error); } }
