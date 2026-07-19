import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { RECIPE_CATEGORY_LABELS } from "@/lib/builtInRecipes/catalog";
import { listBuiltInRecipesWithCompatibility } from "@/lib/builtInRecipes/service";

export async function GET(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const search = (url.searchParams.get("search") || "").trim().toLowerCase().slice(0, 120);
    const categories = new Set((url.searchParams.get("categories") || "").split(",").filter(Boolean));
    const difficulties = new Set((url.searchParams.get("difficulties") || "").split(",").filter(Boolean));
    const compatibility = new Set((url.searchParams.get("compatibility") || "").split(",").filter(Boolean));
    const favoritesOnly = url.searchParams.get("favorites") === "true";
    const hiddenOnly = url.searchParams.get("hidden") === "true";
    const sort = url.searchParams.get("sort") || "recommended";
    const all = await listBuiltInRecipesWithCompatibility(userId);
    const visible = all.filter((item) => hiddenOnly ? item.preference.hidden : !item.preference.hidden)
      .filter((item) => !search || `${item.name} ${item.shortDescription} ${item.tags.join(" ")} ${RECIPE_CATEGORY_LABELS[item.category]}`.toLowerCase().includes(search))
      .filter((item) => !categories.size || categories.has(item.category))
      .filter((item) => !difficulties.size || difficulties.has(item.difficulty))
      .filter((item) => !compatibility.size || compatibility.has(item.compatibility.level))
      .filter((item) => !favoritesOnly || item.preference.favorite)
      .sort((left, right) => sort === "name" ? left.name.localeCompare(right.name)
        : sort === "compatibility" ? right.compatibility.score - left.compatibility.score || left.name.localeCompare(right.name)
        : sort === "recently_used" ? new Date(right.preference.lastUsedAt || 0).getTime() - new Date(left.preference.lastUsedAt || 0).getTime()
        : sort === "most_used" ? right.preference.useCount - left.preference.useCount || left.name.localeCompare(right.name)
        : sort === "difficulty" ? ["beginner", "intermediate", "advanced"].indexOf(left.difficulty) - ["beginner", "intermediate", "advanced"].indexOf(right.difficulty) || left.name.localeCompare(right.name)
        : Number(Boolean(right.preference.favorite)) - Number(Boolean(left.preference.favorite)) || right.compatibility.score - left.compatibility.score || left.name.localeCompare(right.name));
    const recentlyUsed = all.filter((item) => item.preference.lastUsedAt && !item.preference.hidden)
      .sort((left, right) => new Date(right.preference.lastUsedAt!).getTime() - new Date(left.preference.lastUsedAt!).getTime()).slice(0, 8);
    return NextResponse.json({
      recipes: visible,
      recentlyUsed,
      categories: Object.entries(RECIPE_CATEGORY_LABELS).map(([id, label]) => ({ id, label, count: all.filter((item) => item.category === id).length })),
      summary: { total: all.length, visible: visible.length, favorites: all.filter((item) => item.preference.favorite).length, hidden: all.filter((item) => item.preference.hidden).length, installed: all.filter((item) => item.installedRecipe).length },
    });
  } catch (error) {
    console.error("[BuiltInRecipes] Library list failed", error);
    return NextResponse.json({ error: "Recipe Library could not be loaded." }, { status: 500 });
  }
}
