import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { parsePlaylistRecipe } from "@/lib/playlistRecipes";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recipe = await prisma.playlistRecipe.findFirst({
    where: { id: params.id, userId, isArchived: false },
  });

  if (!recipe) {
    return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
  }

  return NextResponse.json({ recipe: parsePlaylistRecipe(recipe) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await prisma.playlistRecipe.deleteMany({
    where: { id: params.id, userId },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
