import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getBuiltInRecipe } from "@/lib/builtInRecipes/catalog";
import { getRecipeCompatibility } from "@/lib/builtInRecipes/compatibility";

export async function GET(_req: Request, { params }: { params: { recipeId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const recipe = getBuiltInRecipe(params.recipeId);
  if (!recipe) return NextResponse.json({ error: "Built-in recipe not found." }, { status: 404 });
  return NextResponse.json({ compatibility: await getRecipeCompatibility(userId, recipe, true) });
}
