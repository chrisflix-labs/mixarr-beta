import { NextResponse } from "next/server";
import { orchestrationApiError, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { getOrchestrationGroups } from "@/lib/orchestration/ecosystem";
export async function GET() { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); try { return NextResponse.json(await getOrchestrationGroups(userId)); } catch (error) { return orchestrationApiError(error); } }
