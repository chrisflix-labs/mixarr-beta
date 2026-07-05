import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { parsePlaylistRecipe, playlistRecipeSchema, updatePlaylistRecipeData } from "@/lib/playlistRecipes";

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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const existing = await prisma.playlistRecipe.findFirst({
      where: { id: params.id, userId, isArchived: false },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = playlistRecipeSchema.parse(body);
    const recipe = await prisma.playlistRecipe.update({
      where: { id: existing.id },
      data: updatePlaylistRecipeData(parsed),
    });

    return NextResponse.json({ recipe: parsePlaylistRecipe(recipe) });
  } catch (error: any) {
    const status = error.name === "ZodError" ? 400 : 500;
    const message = error.issues?.[0]?.message || (status === 400 ? "Invalid playlist recipe" : "Failed to update playlist recipe");
    if (status === 500) console.error("Update playlist recipe error:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
