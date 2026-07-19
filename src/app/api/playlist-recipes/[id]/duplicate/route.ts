import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { duplicateRecipeName, parsePlaylistRecipe, portableRecipeFromRecord } from "@/lib/playlistRecipes";
import { slugifyRecipeName } from "@/lib/mixRecipes/schema";
import { APP_VERSION } from "@/lib/appVersion";
import { safeRecordJobHistory } from "@/lib/jobHistory";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const source = await prisma.playlistRecipe.findFirst({
      where: { id: params.id, userId, isArchived: false, deletedAt: null },
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
        slug: `${slugifyRecipeName(newName)}-${crypto.randomUUID().slice(0, 8)}`,
        description: source.description,
        category: source.category,
        artworkUrl: source.artworkUrl,
        schemaVersion: source.schemaVersion,
        recipeVersion: 1,
        enabled: source.enabled,
        filtersJson: source.filtersJson as Prisma.InputJsonValue,
        scoringJson: source.scoringJson as Prisma.InputJsonValue,
        targetsJson: source.targetsJson as Prisma.InputJsonValue,
        bpmFlowJson: source.bpmFlowJson as Prisma.InputJsonValue,
        discoveryJson: source.discoveryJson as Prisma.InputJsonValue,
        varietyJson: source.varietyJson as Prisma.InputJsonValue,
        identityDefaultsJson: source.identityDefaultsJson as Prisma.InputJsonValue,
        refreshPolicyJson: source.refreshPolicyJson as Prisma.InputJsonValue,
        automationPolicyJson: source.automationPolicyJson as Prisma.InputJsonValue,
        createdFromVersion: APP_VERSION,
        useCount: 0,
        lastUsedAt: null,
        revisions: { create: { recipeVersion: 1, schemaVersion: source.schemaVersion, changeType: "DUPLICATED", portableSnapshotJson: { ...portableRecipeFromRecord(source), recipeVersion: 1, metadata: { ...portableRecipeFromRecord(source).metadata, name: newName, slug: slugifyRecipeName(newName) } } as Prisma.InputJsonValue } },
      },
    });
    await safeRecordJobHistory({ userId, type: "mix_recipe", name: "Recipe duplicated", status: "completed", trigger: "manual", summary: `Duplicated recipe "${source.name}" as "${recipe.name}".`, counts: { attempted: 1, processed: 1 }, metadata: { sourceRecipeId: source.id, recipeId: recipe.id, schemaVersion: recipe.schemaVersion, recipeVersion: recipe.recipeVersion } });

    return NextResponse.json({
      recipe: parsePlaylistRecipe(recipe),
      message: `Duplicated recipe "${source.name}" as "${newName}".`,
    }, { status: 201 });
  } catch (error) {
    console.error("Duplicate playlist recipe error:", error);
    return NextResponse.json({ error: "Failed to duplicate playlist recipe" }, { status: 500 });
  }
}
