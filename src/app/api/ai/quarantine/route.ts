import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { listAiQuarantine } from "@/ai/quarantine/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { await requireAiPermission("ai.audit.view"); const p = new URL(request.url).searchParams; return NextResponse.json(await listAiQuarantine({ status: p.get("status") || undefined, severity: p.get("severity") || undefined, featureKey: p.get("feature") || undefined, cursor: p.get("cursor") || undefined, limit: Number(p.get("limit") || 25) })); } catch (error) { return aiRouteError(error); } }
