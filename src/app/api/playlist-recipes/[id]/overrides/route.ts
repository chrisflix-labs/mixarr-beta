import { NextResponse } from "next/server";
import { inheritanceApiError, inheritanceSession, inheritanceUnauthorized } from "@/lib/recipeInheritance/api";
import { resetRecipeOverrides, saveRecipeOverride } from "@/lib/recipeInheritance/service";

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized();
  try { const body = await request.json(); if (!body.fieldPath) throw new Error("A validated field path is required."); return NextResponse.json(await saveRecipeOverride(userId, params.id, body.fieldPath, body.value, body.reason)); }
  catch (error) { return inheritanceApiError(error); }
}
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const userId = inheritanceSession(); if (!userId) return inheritanceUnauthorized();
  try { const body = await request.json().catch(() => ({})); const paths = Array.isArray(body.fieldPaths) ? body.fieldPaths : body.fieldPath ? [body.fieldPath] : []; return NextResponse.json(await resetRecipeOverrides(userId, params.id, paths)); }
  catch (error) { return inheritanceApiError(error); }
}
