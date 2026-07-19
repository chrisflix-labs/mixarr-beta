import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { recordBuiltInRecipeUse } from "@/lib/builtInRecipes/service";

export async function POST(_req: Request, { params }: { params: { recipeId: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await recordBuiltInRecipeUse(userId, params.recipeId)); }
  catch (error: any) { return NextResponse.json({ error: error?.message || "Recipe use could not be recorded." }, { status: error?.status || 500 }); }
}
