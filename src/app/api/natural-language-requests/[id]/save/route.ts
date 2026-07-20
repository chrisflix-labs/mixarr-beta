import { NextResponse } from "next/server";
import { naturalLanguageApiError, naturalLanguageUserId } from "@/lib/naturalLanguageRequests/api";
import { saveApprovedNaturalLanguageRecipe } from "@/lib/naturalLanguageRequests/service";
export async function POST(_request: Request, { params }: { params: { id: string } }) { try { return NextResponse.json({ recipe: await saveApprovedNaturalLanguageRecipe(naturalLanguageUserId(), params.id) }, { status: 201 }); } catch (error) { return naturalLanguageApiError(error); } }
