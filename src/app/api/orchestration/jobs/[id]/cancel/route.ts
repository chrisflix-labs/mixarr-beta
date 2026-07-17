import { NextResponse } from "next/server";
import { orchestrationApiError, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { cancelOrchestrationJob } from "@/lib/orchestration/service";
export async function POST(_: Request, { params }: { params: { id: string } }) { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); try { await cancelOrchestrationJob(userId, params.id, userId); return NextResponse.json({ cancelled: true }); } catch (error) { return orchestrationApiError(error); } }
