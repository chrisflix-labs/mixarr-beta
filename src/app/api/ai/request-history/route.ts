import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermissionedUser } from "@/ai/intelligence/api";
import { getAiNaturalLanguageHistory } from "@/ai/intelligence/service";
export const dynamic = "force-dynamic";
function date(value: string | null) { if (!value) return undefined; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? undefined : parsed; }
function number(value: string | null) { if (value == null || value === "") return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
export async function GET(request: Request) { try { const userId = await requireAiPermissionedUser(); const q = new URL(request.url).searchParams; return NextResponse.json(await getAiNaturalLanguageHistory(userId, { page: number(q.get("page")), pageSize: number(q.get("pageSize")), userId: q.get("userId") || undefined, provider: q.get("provider") || undefined, model: q.get("model") || undefined, status: q.get("status") || undefined, approval: q.get("approval") || undefined, from: date(q.get("from")), to: date(q.get("to")), local: q.has("local") ? q.get("local") === "true" : undefined, minimumCost: number(q.get("minimumCost")), maximumCost: number(q.get("maximumCost")) })); } catch (error) { return aiRouteError(error); } }
