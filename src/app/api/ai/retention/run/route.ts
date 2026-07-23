import { NextResponse } from "next/server";
import { aiRouteError, requireAiPermission } from "@/ai/services/api";
import { enqueueAiJob } from "@/ai/queue/service";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { try { const actorId = await requireAiPermission("ai.provider.manage"); const body = await request.json().catch(() => ({})); const queued = await enqueueAiJob({ userId: actorId, featureKey: "administrative_retention", jobType: "AI_RETENTION_CLEANUP", payload: { requestedAt: new Date().toISOString() }, maximumAttempts: 1, idempotencyKey: request.headers.get("idempotency-key") || `ai-retention:${new Date().toISOString().slice(0, 10)}`, forceNew: body.forceNew === true }); return NextResponse.json(queued, { status: queued.duplicate ? 200 : 202 }); } catch (error) { return aiRouteError(error); } }
