import { NextResponse } from "next/server";
import { z } from "zod";
import { orchestrationApiError, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { getOrchestrationTrends } from "@/lib/orchestration/dashboard";
export async function GET(request: Request) { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); try { const range = z.enum(["7d", "30d", "90d", "all"]).catch("30d").parse(new URL(request.url).searchParams.get("range")); return NextResponse.json(await getOrchestrationTrends(userId, range)); } catch (error) { return orchestrationApiError(error); } }
