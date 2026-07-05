import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { markPlaylistRecipeUsed } from "@/lib/playlistRecipes";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recipe = await prisma.playlistRecipe.findFirst({
    where: { id: params.id, userId, isArchived: false },
    select: { id: true },
  });

  if (!recipe) {
    return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
  }

  await markPlaylistRecipeUsed(userId, recipe.id);
  return NextResponse.json({ success: true });
}
