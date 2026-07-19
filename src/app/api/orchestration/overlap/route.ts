import { NextResponse } from "next/server";
import { z } from "zod";
import { orchestrationApiError, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { getOrchestrationOverlap } from "@/lib/orchestration/ecosystem";
const querySchema = z.object({ metric: z.enum(["track", "shared_tracks", "artist", "album", "identity"]).optional(), groupId: z.string().uuid().optional(), search: z.string().max(100).optional(), excludePaused: z.coerce.boolean().optional(), excludeExperimentVariants: z.coerce.boolean().optional(), problematicOnly: z.coerce.boolean().optional(), minimum: z.coerce.number().min(0).max(100).optional(), sort: z.enum(["name", "group", "highest_overlap"]).optional() });
export async function GET(request: Request) { const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized(); try { const url = new URL(request.url); const input = querySchema.parse(Object.fromEntries(url.searchParams)); return NextResponse.json(await getOrchestrationOverlap(userId, input)); } catch (error) { return orchestrationApiError(error); } }
