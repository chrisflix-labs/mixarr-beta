import { NextResponse } from "next/server";
import { orchestrationAdmin, orchestrationApiError, orchestrationForbidden, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { runV22MigrationChecks } from "@/lib/orchestration/operations";
export async function GET() { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); if (!(await orchestrationAdmin(userId))) return orchestrationForbidden(); try { return NextResponse.json(await runV22MigrationChecks(userId)); } catch (error) { return orchestrationApiError(error); } }
