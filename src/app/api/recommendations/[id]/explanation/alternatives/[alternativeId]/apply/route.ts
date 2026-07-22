import { NextResponse } from "next/server";
import { applyAlternative } from "@/lib/recommendationExplanations/service";
import { recommendationExplanationApiError, recommendationExplanationUserId } from "@/lib/recommendationExplanations/api";
export async function POST(_: Request, { params }: { params: { id: string; alternativeId: string } }) { try { return NextResponse.json(await applyAlternative(recommendationExplanationUserId(), params.id, params.alternativeId)); } catch (error) { return recommendationExplanationApiError(error); } }
