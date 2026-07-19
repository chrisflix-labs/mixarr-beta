import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { updateBuiltInPreference } from "@/lib/builtInRecipes/service";

async function update(recipeId: string, favorite: boolean) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ preference: await updateBuiltInPreference(userId, recipeId, { favorite }) }); }
  catch (error: any) { return NextResponse.json({ error: error?.message || "Favorite could not be updated." }, { status: error?.status || 500 }); }
}
export async function POST(_req: Request, { params }: { params: { recipeId: string } }) { return update(params.recipeId, true); }
export async function DELETE(_req: Request, { params }: { params: { recipeId: string } }) { return update(params.recipeId, false); }
