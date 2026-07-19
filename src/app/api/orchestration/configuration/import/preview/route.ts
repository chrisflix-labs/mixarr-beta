import { NextResponse } from "next/server";
import { z } from "zod";
import { orchestrationAdmin, orchestrationApiError, orchestrationForbidden, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { previewOrchestrationImport } from "@/lib/orchestration/configuration";
const schema = z.object({ configuration: z.unknown(), mode: z.enum(["merge", "replace", "preview"]).default("preview") });
export async function POST(request: Request) { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); if (!(await orchestrationAdmin(userId))) return orchestrationForbidden(); try { const input = schema.parse(await request.json()); const result = await previewOrchestrationImport(userId, input.configuration, input.mode); const { document: _document, ...safe } = result; return NextResponse.json(safe); } catch (error) { return orchestrationApiError(error); } }
