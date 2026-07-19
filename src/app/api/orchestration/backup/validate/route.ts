import { NextResponse } from "next/server";
import { z } from "zod";
import { orchestrationAdmin, orchestrationApiError, orchestrationForbidden, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { getLastBackupValidation, validateOrchestrationBackup } from "@/lib/orchestration/operations";
const schema = z.object({ backup: z.unknown(), sourceName: z.string().max(255).optional() });
export async function GET() { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); if (!(await orchestrationAdmin(userId))) return orchestrationForbidden(); try { return NextResponse.json({ lastValidation: await getLastBackupValidation(userId) }); } catch (error) { return orchestrationApiError(error); } }
export async function POST(request: Request) { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); if (!(await orchestrationAdmin(userId))) return orchestrationForbidden(); try { const input = schema.parse(await request.json()); return NextResponse.json(await validateOrchestrationBackup(userId, input.backup, input.sourceName)); } catch (error) { return orchestrationApiError(error); } }
