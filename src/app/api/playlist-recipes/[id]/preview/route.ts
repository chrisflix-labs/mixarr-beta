import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { markPlaylistRecipeUsed } from "@/lib/playlistRecipes";
import { playlistConfigSchema, previewPlaylistTracks } from "@/lib/playlistService";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const recipe = await prisma.playlistRecipe.findFirst({
      where: { id: params.id, userId, isArchived: false },
    });

    if (!recipe) {
      return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
    }

    const config = playlistConfigSchema.parse(recipe.filtersJson);
    const preview = await previewPlaylistTracks({ userId, config });
    await markPlaylistRecipeUsed(userId, recipe.id);

    return NextResponse.json({
      ...preview,
      recipe: {
        id: recipe.id,
        name: recipe.name,
      },
    });
  } catch (error: any) {
    const status = error.name === "ZodError" ? 400 : 500;
    if (status === 500) console.error("Recipe preview error:", error);
    return NextResponse.json({ error: status === 400 ? "Invalid playlist recipe filters" : "Failed to preview playlist recipe" }, { status });
  }
}
