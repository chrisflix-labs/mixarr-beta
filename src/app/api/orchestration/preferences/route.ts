import { NextResponse } from "next/server";
import { orchestrationApiError, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { getOrchestrationPreference, updateOrchestrationPreference } from "@/lib/orchestration/dashboard";
export async function GET() { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); try { return NextResponse.json(await getOrchestrationPreference(userId)); } catch (error) { return orchestrationApiError(error); } }
export async function PATCH(request: Request) { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); try { return NextResponse.json(await updateOrchestrationPreference(userId, await request.json())); } catch (error) { return orchestrationApiError(error); } }
