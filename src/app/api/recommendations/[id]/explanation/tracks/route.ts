import { NextResponse } from "next/server";
import { listTrackEvaluations } from "@/lib/recommendationExplanations/service";
import { recommendationExplanationApiError, recommendationExplanationUserId } from "@/lib/recommendationExplanations/api";
export async function GET(request: Request, { params }: { params: { id: string } }) { try { const url = new URL(request.url); return NextResponse.json(await listTrackEvaluations(recommendationExplanationUserId(), params.id, Object.fromEntries(url.searchParams.entries()))); } catch (error) { return recommendationExplanationApiError(error); } }
