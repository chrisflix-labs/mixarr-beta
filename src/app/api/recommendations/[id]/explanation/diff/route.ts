import { NextResponse } from "next/server";
import { getRecommendationExplanation } from "@/lib/recommendationExplanations/service";
import { recommendationExplanationApiError, recommendationExplanationUserId } from "@/lib/recommendationExplanations/api";
export async function GET(_: Request, { params }: { params: { id: string } }) { try { const value = await getRecommendationExplanation(recommendationExplanationUserId(), params.id); return NextResponse.json({ semanticDiff: value.semanticDiff, generatedSettings: value.generatedSettings, validationResults: value.validationResults }); } catch (error) { return recommendationExplanationApiError(error); } }
