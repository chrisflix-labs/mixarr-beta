import { NextResponse } from "next/server";
import { getRecommendationExplanation } from "@/lib/recommendationExplanations/service";
import { recommendationExplanationApiError, recommendationExplanationUserId } from "@/lib/recommendationExplanations/api";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try { const url = new URL(request.url); return NextResponse.json(await getRecommendationExplanation(recommendationExplanationUserId(), params.id, url.searchParams.get("raw") === "true")); }
  catch (error) { return recommendationExplanationApiError(error); }
}
