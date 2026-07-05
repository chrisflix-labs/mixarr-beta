import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { createPlaylistRecipeData, parsePlaylistRecipe, playlistRecipeSchema } from "@/lib/playlistRecipes";

export async function GET() {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recipes = await prisma.playlistRecipe.findMany({
    where: { userId, isArchived: false },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ recipes: recipes.map(parsePlaylistRecipe) });
}

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = playlistRecipeSchema.parse(body);
    const recipe = await prisma.playlistRecipe.create({
      data: createPlaylistRecipeData(userId, parsed),
    });

    return NextResponse.json({ recipe: parsePlaylistRecipe(recipe) }, { status: 201 });
  } catch (error: any) {
    const status = error.name === "ZodError" ? 400 : 500;
    const message = error.issues?.[0]?.message || (status === 400 ? "Invalid playlist recipe" : "Failed to save playlist recipe");
    if (status === 500) console.error("Save playlist recipe error:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
