import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { duplicateRecipeName, parsePlaylistRecipe } from "@/lib/playlistRecipes";
import { APP_VERSION } from "@/lib/appVersion";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const source = await prisma.playlistRecipe.findFirst({
      where: { id: params.id, userId, isArchived: false },
    });

    if (!source) {
      return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
    }

    const existingRecipes = await prisma.playlistRecipe.findMany({
      where: { userId, isArchived: false },
      select: { name: true },
    });
    const newName = duplicateRecipeName(source.name, existingRecipes.map((recipe) => recipe.name));

    const recipe = await prisma.playlistRecipe.create({
      data: {
        user: { connect: { id: userId } },
        name: newName,
        description: source.description,
        filtersJson: source.filtersJson as Prisma.InputJsonValue,
        createdFromVersion: APP_VERSION,
        useCount: 0,
        lastUsedAt: null,
      },
    });

    return NextResponse.json({
      recipe: parsePlaylistRecipe(recipe),
      message: `Duplicated recipe "${source.name}" as "${newName}".`,
    }, { status: 201 });
  } catch (error) {
    console.error("Duplicate playlist recipe error:", error);
    return NextResponse.json({ error: "Failed to duplicate playlist recipe" }, { status: 500 });
  }
}
