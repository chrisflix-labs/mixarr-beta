import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { installBuiltInRecipe } from "@/lib/builtInRecipes/service";

export async function POST(_req: Request, { params }: { params: { recipeId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await installBuiltInRecipe(userId, params.recipeId);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Recipe installation failed." }, { status: error?.status || 500 });
  }
}
