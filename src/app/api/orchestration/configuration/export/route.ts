import { NextResponse } from "next/server";
import { orchestrationApiError, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { exportOrchestrationConfiguration } from "@/lib/orchestration/configuration";
export async function GET() { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); try { const data = await exportOrchestrationConfiguration(userId); return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="mixarr-orchestration-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } }); } catch (error) { return orchestrationApiError(error); } }
