import { NextResponse } from "next/server";
import { orchestrationApiError, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { retryOrchestrationJob } from "@/lib/orchestration/service";
export async function POST(_: Request, { params }: { params: { id: string } }) { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); try { return NextResponse.json(await retryOrchestrationJob(userId, params.id, userId), { status: 201 }); } catch (error) { return orchestrationApiError(error); } }
