import { NextResponse } from "next/server";
import { orchestrationApiError, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { getOrchestrationDashboardSummary } from "@/lib/orchestration/dashboard";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); try { const range = new URL(request.url).searchParams.get("range") || undefined; return NextResponse.json(await getOrchestrationDashboardSummary(userId, range)); } catch (error) { return orchestrationApiError(error); } }
