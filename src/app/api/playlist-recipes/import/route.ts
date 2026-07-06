import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { APP_VERSION } from "@/lib/appVersion";
import { parsePlaylistRecipe } from "@/lib/playlistRecipes";
import {
  INVALID_RECIPE_EXPORT_MESSAGE,
  prepareImportedRecipes,
  type RecipeConflictStrategy,
  UNSUPPORTED_RECIPE_EXPORT_VERSION_MESSAGE,
} from "@/lib/playlistRecipeImportExport";

const maxImportBytes = 5 * 1024 * 1024;
const conflictStrategies: RecipeConflictStrategy[] = ["rename", "skip"];

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const content = typeof body.content === "string" ? body.content : JSON.stringify(body.content);
    if (Buffer.byteLength(content, "utf8") > maxImportBytes) {
      return NextResponse.json({ error: "Recipe import file is too large." }, { status: 413 });
    }

    const conflictStrategy = conflictStrategies.includes(body.conflictStrategy)
      ? body.conflictStrategy
      : "rename";
    const existingRecipes = await prisma.playlistRecipe.findMany({
      where: { userId, isArchived: false },
      select: { name: true },
    });
    const prepared = prepareImportedRecipes(
      content,
      existingRecipes.map((recipe) => recipe.name),
      conflictStrategy,
    );

    const createdRecipes = [];
    for (const recipe of prepared.recipes) {
      const created = await prisma.playlistRecipe.create({
        data: {
          user: { connect: { id: userId } },
          name: recipe.name,
          description: recipe.description || null,
          filtersJson: recipe.filters as Prisma.InputJsonValue,
          createdFromVersion: APP_VERSION,
          useCount: 0,
          lastUsedAt: null,
        },
      });
      createdRecipes.push(parsePlaylistRecipe(created));
    }

    return NextResponse.json({
      summary: {
        imported: prepared.imported,
        renamed: prepared.renamed,
        skipped: prepared.skipped,
        failed: prepared.failed,
        failures: prepared.failures,
      },
      recipes: createdRecipes,
    }, { status: 201 });
  } catch (error: any) {
    const message = error.message === UNSUPPORTED_RECIPE_EXPORT_VERSION_MESSAGE
      ? UNSUPPORTED_RECIPE_EXPORT_VERSION_MESSAGE
      : INVALID_RECIPE_EXPORT_MESSAGE;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
