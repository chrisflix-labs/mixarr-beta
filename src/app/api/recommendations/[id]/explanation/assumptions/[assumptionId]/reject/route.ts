import { NextResponse } from "next/server";
import { updateAssumption } from "@/lib/recommendationExplanations/service";
import { recommendationExplanationApiError, recommendationExplanationUserId } from "@/lib/recommendationExplanations/api";
export async function POST(_: Request, { params }: { params: { id: string; assumptionId: string } }) { try { return NextResponse.json(await updateAssumption(recommendationExplanationUserId(), params.id, params.assumptionId, "reject")); } catch (error) { return recommendationExplanationApiError(error); } }
