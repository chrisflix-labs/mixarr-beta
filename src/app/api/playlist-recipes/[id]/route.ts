import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { parsePlaylistRecipe, playlistRecipeSchema, updatePlaylistRecipeData } from "@/lib/playlistRecipes";
import { safeRecordJobHistory } from "@/lib/jobHistory";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recipe = await prisma.playlistRecipe.findFirst({
    where: { userId, isArchived: false, deletedAt: null, OR: [{ id: params.id }, { slug: params.id }] },
    include: { _count: { select: { generatedPlaylists: true } }, revisions: { orderBy: { recipeVersion: "desc" }, take: 20 } },
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

  const recipe = await prisma.playlistRecipe.findFirst({ where: { id: params.id, userId, deletedAt: null }, include: { _count: { select: { generatedPlaylists: true } } } });
  if (!recipe) {
    return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
  }
  await prisma.playlistRecipe.update({ where: { id: recipe.id }, data: { isArchived: true, enabled: false, deletedAt: new Date() } });
  await safeRecordJobHistory({ userId, type: "mix_recipe", name: "Recipe deleted", status: "completed", trigger: "manual", summary: `Deleted recipe "${recipe.name}"; ${recipe._count.generatedPlaylists} generated playlist(s) were retained.`, counts: { attempted: 1, processed: 1 }, metadata: { recipeId: recipe.id, schemaVersion: recipe.schemaVersion, recipeVersion: recipe.recipeVersion, retainedPlaylistCount: recipe._count.generatedPlaylists } });
  return NextResponse.json({ success: true, retainedPlaylistCount: recipe._count.generatedPlaylists });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const existing = await prisma.playlistRecipe.findFirst({
      where: { id: params.id, userId, isArchived: false, deletedAt: null },
    });

    if (!existing) {
      return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = playlistRecipeSchema.parse({
      name: existing.name, description: existing.description, category: existing.category, artworkUrl: existing.artworkUrl,
      enabled: existing.enabled, sourcePlaylistId: existing.sourcePlaylistId, filters: existing.filtersJson,
      scoring: existing.scoringJson, targets: existing.targetsJson, bpmFlow: existing.bpmFlowJson,
      discovery: existing.discoveryJson, variety: existing.varietyJson, playlistIdentity: existing.identityDefaultsJson,
      refreshPolicy: existing.refreshPolicyJson, automationPolicy: existing.automationPolicyJson,
      ...body,
    });
    const recipe = await prisma.playlistRecipe.update({
      where: { id: existing.id },
      data: updatePlaylistRecipeData(parsed, existing),
    });
    await safeRecordJobHistory({ userId, type: "mix_recipe", name: "Recipe updated", status: "completed", trigger: "manual", summary: `Updated recipe "${recipe.name}".`, counts: { attempted: 1, processed: 1 }, metadata: { recipeId: recipe.id, schemaVersion: recipe.schemaVersion, recipeVersion: recipe.recipeVersion } });

    return NextResponse.json({ recipe: parsePlaylistRecipe(recipe) });
  } catch (error: any) {
    const status = error.name === "ZodError" || /recipe|BPM|energy|automation/i.test(error.message || "") ? 400 : 500;
    const message = error.issues?.[0]?.message || (status === 400 ? "Invalid playlist recipe" : "Failed to update playlist recipe");
    if (status === 500) console.error("Update playlist recipe error:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
