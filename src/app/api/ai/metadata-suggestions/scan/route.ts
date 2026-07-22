import { NextResponse } from "next/server";
import { advisoryRouteError, advisoryUserId } from "@/lib/aiAdvisory/api";
import { runMetadataScanJob, startMetadataScan } from "@/lib/aiAdvisory/service";
export async function POST(request: Request) { try { const userId = advisoryUserId(), body = await request.json(), result = await startMetadataScan(userId, body); setImmediate(() => { void runMetadataScanJob(userId, result.job.id, body).catch(() => undefined); }); return NextResponse.json({ job: result.job, advisoryOnly: true, metadataWritesEnabled: false }, { status: 202 }); } catch (error) { return advisoryRouteError(error); } }

