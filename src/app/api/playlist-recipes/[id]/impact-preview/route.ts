import { NextResponse } from "next/server";
import { inheritanceApiError, inheritanceSession, inheritanceUnauthorized } from "@/lib/recipeInheritance/api";
import { previewRecipeImpact } from "@/lib/recipeInheritance/service";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized();
  try { const body = await request.json(); return NextResponse.json(await previewRecipeImpact(userId, params.id, body.proposedChanges || body)); }
  catch (error) { return inheritanceApiError(error); }
}
