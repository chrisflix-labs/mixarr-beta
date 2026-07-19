import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getBuiltInRecipeDetails } from "@/lib/builtInRecipes/service";

export async function GET(_req: Request, { params }: { params: { recipeId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const recipe = await getBuiltInRecipeDetails(userId, params.recipeId);
  return recipe ? NextResponse.json({ recipe }) : NextResponse.json({ error: "Built-in recipe not found." }, { status: 404 });
}
