import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getRecipeAnalytics } from "@/lib/recipeStudioService";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized", code: "RECIPE_ANALYTICS_UNAUTHORIZED" }, { status: 401 });
  try {
    return NextResponse.json(await getRecipeAnalytics(userId), { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } });
  } catch (error) {
    console.error("[RecipeAnalytics] Aggregation failed", { reason: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Recipe analytics are temporarily unavailable. No recipe data was changed.", code: "RECIPE_ANALYTICS_UNAVAILABLE" }, { status: 503 });
  }
}
