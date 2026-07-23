import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { startMetadataScan } from "@/lib/aiAdvisory/service";
import { enqueueAiJob } from "@/ai/queue/service";

export const dynamic = "force-dynamic";
export async function POST(request: Request) { try { const userId = advisoryUserId(), body = await request.json(), result = await startMetadataScan(userId, body); const queued = await enqueueAiJob({ userId, featureKey: "metadata_suggestions", jobType: "METADATA_SUGGESTION_SCAN", payload: { metadataJobId: result.job.id, input: body }, providerConfigId: body.providerId, model: body.model, maximumAttempts: 3, idempotencyKey: request.headers.get("idempotency-key") || `metadata-scan:${result.job.id}` }); return NextResponse.json({ job: result.job, aiJob: queued.job, duplicate: queued.duplicate, advisoryOnly: true, metadataWritesEnabled: false }, { status: 202 }); } catch (error) { return advisoryRouteError(error); } }
