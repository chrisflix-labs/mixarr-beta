import { NextResponse } from "next/server";
import { z } from "zod";
import { orchestrationAdmin, orchestrationApiError, orchestrationForbidden, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { getJobCleanupPreview, maintainOrchestrationJobs } from "@/lib/orchestration/operations";
const schema = z.object({ action: z.enum(["clear_completed", "clear_failed", "retry_failed", "cancel_queued", "remove_stale", "requeue_interrupted"]), confirm: z.literal(true) });
export async function GET() { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); if (!(await orchestrationAdmin(userId))) return orchestrationForbidden(); try { return NextResponse.json(await getJobCleanupPreview(userId)); } catch (error) { return orchestrationApiError(error); } }
export async function POST(request: Request) { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); if (!(await orchestrationAdmin(userId))) return orchestrationForbidden(); try { const input = schema.parse(await request.json()); return NextResponse.json(await maintainOrchestrationJobs(userId, input.action)); } catch (error) { return orchestrationApiError(error); } }
