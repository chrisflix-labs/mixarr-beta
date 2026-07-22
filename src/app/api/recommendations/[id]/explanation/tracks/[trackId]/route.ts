import { NextResponse } from "next/server";
import { getTrackEvaluation } from "@/lib/recommendationExplanations/service";
import { recommendationExplanationApiError, recommendationExplanationUserId } from "@/lib/recommendationExplanations/api";
export async function GET(_: Request, { params }: { params: { id: string; trackId: string } }) { try { return NextResponse.json(await getTrackEvaluation(recommendationExplanationUserId(), params.id, params.trackId)); } catch (error) { return recommendationExplanationApiError(error); } }
