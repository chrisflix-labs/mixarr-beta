import { NextResponse } from "next/server";
import { inheritanceApiError, inheritanceSession, inheritanceUnauthorized } from "@/lib/recipeInheritance/api";
import { assignBaseRecipe } from "@/lib/recipeInheritance/service";

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized();
  try { const body = await request.json(); return NextResponse.json(await assignBaseRecipe(userId, params.id, body.baseRecipeId || null)); }
  catch (error) { return inheritanceApiError(error); }
}
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized();
  try { return NextResponse.json(await assignBaseRecipe(userId, params.id, null)); }
  catch (error) { return inheritanceApiError(error); }
}
