import { NextResponse } from "next/server";
import { z } from "zod";
import { orchestrationAdmin, orchestrationApiError, orchestrationForbidden, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { applyOrchestrationImport } from "@/lib/orchestration/configuration";
const schema = z.object({ configuration: z.unknown(), mode: z.enum(["merge", "replace"]), confirm: z.literal(true) });
export async function POST(request: Request) { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); if (!(await orchestrationAdmin(userId))) return orchestrationForbidden(); try { const input = schema.parse(await request.json()); return NextResponse.json(await applyOrchestrationImport(userId, input.configuration, input.mode, input.confirm)); } catch (error) { return orchestrationApiError(error); } }
