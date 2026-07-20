import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { playlistRecipeSchema } from "@/lib/playlistRecipes";
import { analyzeRecipeDraft } from "@/lib/recipeStudioService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "RECIPE_STUDIO_UNAUTHORIZED" }, { status: 401 });
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > 512 * 1024) return NextResponse.json({ error: "Recipe analysis input exceeds the 512 KB limit.", code: "RECIPE_STUDIO_INPUT_TOO_LARGE" }, { status: 413 });
  try {
    const body = await request.json();
    const parsed = playlistRecipeSchema.parse(body.recipe || body);
    const analysis = await analyzeRecipeDraft(userId, { ...parsed, governance: body.recipe?.governance });
    return NextResponse.json(analysis, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
  } catch (error: any) {
    const invalid = error?.name === "ZodError";
    if (!invalid) console.error("[RecipeStudio] Live analysis failed", { reason: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: invalid ? error.issues?.[0]?.message || "The recipe draft is invalid." : "Live recipe analysis is temporarily unavailable. Your draft was not changed.", code: invalid ? "RECIPE_STUDIO_INVALID" : "RECIPE_STUDIO_ANALYSIS_UNAVAILABLE" }, { status: invalid ? 400 : 503 });
  }
}
