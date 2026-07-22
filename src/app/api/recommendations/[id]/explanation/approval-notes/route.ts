import { NextResponse } from "next/server";
import { addApprovalNote } from "@/lib/recommendationExplanations/service";
import { recommendationExplanationApiError, recommendationExplanationUserId } from "@/lib/recommendationExplanations/api";
export async function POST(request: Request, { params }: { params: { id: string } }) { try { return NextResponse.json(await addApprovalNote(recommendationExplanationUserId(), params.id, await request.json()), { status: 201 }); } catch (error) { return recommendationExplanationApiError(error); } }
