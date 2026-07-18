import { NextResponse } from "next/server";
import { createExperimentSchema } from "@/lib/experiments/schemas";
import { createExperiment, listExperiments } from "@/lib/experiments/service";
import { experimentApiError, experimentUnauthorized, experimentUserId } from "@/lib/experiments/api";

export async function GET(request: Request) { const userId = experimentUserId(); if (!userId) return experimentUnauthorized(); try { const url = new URL(request.url); return NextResponse.json(await listExperiments(userId, { status: url.searchParams.get("status") || undefined, playlistId: url.searchParams.get("playlistId") || undefined, type: url.searchParams.get("type") || undefined, winner: url.searchParams.get("winner") || undefined, confidence: url.searchParams.get("confidence") || undefined, cursor: url.searchParams.get("cursor") || undefined, limit: Number(url.searchParams.get("limit") || 20), sort: url.searchParams.get("sort") || undefined })); } catch (error) { return experimentApiError(error); } }
export async function POST(request: Request) { const userId = experimentUserId(); if (!userId) return experimentUnauthorized(); try { return NextResponse.json(await createExperiment(userId, createExperimentSchema.parse(await request.json())), { status: 201 }); } catch (error) { return experimentApiError(error); } }
