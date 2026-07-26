import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { duplicateRecipeName, parsePlaylistRecipe } from "@/lib/playlistRecipes";
import { slugifyRecipeName } from "@/lib/mixRecipes/schema";
import { APP_VERSION } from "@/lib/appVersion";
import { safeRecordJobHistory } from "@/lib/jobHistory";
import { resolveOwnedRecipe } from "@/lib/recipeInheritance/service";
import { normalizeScoringModel, scoringModelValidationIssue } from "@/lib/scoringModelCatalog";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const source = await prisma.playlistRecipe.findFirst({
      where: { id: params.id, userId, isArchived: false, deletedAt: null },
      include: { recipeOverrides: true },
    });

    if (!source) {
      return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
    }
    const storedScoring = source.scoringJson && typeof source.scoringJson === "object" && !Array.isArray(source.scoringJson)
      ? source.scoringJson as Record<string, unknown>
      : {};
    const storedFilters = source.filtersJson && typeof source.filtersJson === "object" && !Array.isArray(source.filtersJson)
      ? source.filtersJson as Record<string, unknown>
      : {};
    const receivedScoringModel = storedScoring.scoringModel ?? storedFilters.scoringModel;
    if (receivedScoringModel !== undefined && normalizeScoringModel(receivedScoringModel).status === "unsupported") {
      const issue = scoringModelValidationIssue(receivedScoringModel);
      return NextResponse.json({ error: {
        code: "RECIPE_LEGACY_SCORING_MODEL_REVIEW_REQUIRED",
        message: "This recipe contains an unsupported scoring model and must be reviewed before it can be duplicated.",
        field: issue.path,
        receivedValue: issue.receivedValue,
        supportedValues: issue.supportedValues,
      } }, { status: 422 });
    }

    const existingRecipes = await prisma.playlistRecipe.findMany({
      where: { userId, isArchived: false },
      select: { name: true },
    });
    const newName = duplicateRecipeName(source.name, existingRecipes.map((recipe) => recipe.name));
    const body = await req.json().catch(() => ({}));
    const cloneMode = ["linked", "child", "independent", "structure_only"].includes(body.mode) ? body.mode : "independent";
    const resolution = await resolveOwnedRecipe(userId, source.id);
    if (!resolution.valid) {
      const finding = resolution.errors[0];
      return NextResponse.json({ error: {
        code: finding?.code || "RECIPE_DRAFT_INVALID",
        message: finding?.message || "This recipe must be repaired before it can be duplicated.",
        field: finding?.fields?.[0] || "recipe",
      } }, { status: 422 });
    }
    const snapshot = resolution.normalizedRecipe;
    const independent = cloneMode === "independent";
    const child = cloneMode === "child";
    const retainStructure = cloneMode === "linked" || cloneMode === "structure_only";
    const copyOverrides = cloneMode === "linked";
    const cloneBaseRecipeId = child ? source.id : retainStructure ? source.baseRecipeId : null;

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
        filtersJson: (independent ? snapshot.generation : source.filtersJson) as Prisma.InputJsonValue,
        scoringJson: (independent ? snapshot.scoring : source.scoringJson) as Prisma.InputJsonValue,
        targetsJson: (independent ? snapshot.targets : source.targetsJson) as Prisma.InputJsonValue,
        bpmFlowJson: (independent ? snapshot.bpmFlow : source.bpmFlowJson) as Prisma.InputJsonValue,
        discoveryJson: (independent ? snapshot.discovery : source.discoveryJson) as Prisma.InputJsonValue,
        varietyJson: (independent ? snapshot.variety : source.varietyJson) as Prisma.InputJsonValue,
        identityDefaultsJson: (independent ? snapshot.playlistIdentity : source.identityDefaultsJson) as Prisma.InputJsonValue,
        refreshPolicyJson: (independent ? snapshot.refreshPolicy : source.refreshPolicyJson) as Prisma.InputJsonValue,
        automationPolicyJson: (independent ? snapshot.automationPolicy : source.automationPolicyJson) as Prisma.InputJsonValue,
        inheritanceEnabled: !independent,
        ...(cloneBaseRecipeId ? { baseRecipe: { connect: { id: cloneBaseRecipeId } } } : {}),
        ...(retainStructure && source.recipeCategoryId ? { recipeCategory: { connect: { id: source.recipeCategoryId } } } : {}),
        ...(retainStructure && source.transitionPresetId ? { transitionPreset: { connect: { id: source.transitionPresetId } } } : {}),
        ...(retainStructure && source.discoveryPresetId ? { discoveryPreset: { connect: { id: source.discoveryPresetId } } } : {}),
        ...(retainStructure && source.varietyPresetId ? { varietyPreset: { connect: { id: source.varietyPresetId } } } : {}),
        ...(retainStructure && source.automationPresetId ? { automationPreset: { connect: { id: source.automationPresetId } } } : {}),
        ...(copyOverrides && source.recipeOverrides.length ? { recipeOverrides: { create: source.recipeOverrides.map((override) => ({ fieldPath: override.fieldPath, valueJson: override.valueJson as Prisma.InputJsonValue, schemaVersion: override.schemaVersion, reason: override.reason, createdById: userId, updatedById: userId })) } } : {}),
        createdFromVersion: APP_VERSION,
        useCount: 0,
        lastUsedAt: null,
        revisions: { create: { recipeVersion: 1, schemaVersion: source.schemaVersion, changeType: `CLONED_${cloneMode.toUpperCase()}`, portableSnapshotJson: { ...snapshot, recipeVersion: 1, metadata: { ...snapshot.metadata, name: newName, slug: slugifyRecipeName(newName) } } as Prisma.InputJsonValue, inheritanceSnapshotJson: { mode: cloneMode, baseRecipeId: cloneBaseRecipeId, fingerprint: resolution.fingerprint, chain: resolution.inheritanceChain } as Prisma.InputJsonValue, resolverVersion: resolution.resolverVersion, configurationFingerprint: resolution.fingerprint } },
      },
    });
    await safeRecordJobHistory({ userId, type: "mix_recipe", name: "Recipe cloned", status: "completed", trigger: "manual", summary: `Cloned recipe "${source.name}" as "${recipe.name}" using ${cloneMode.replaceAll("_", " ")} mode.`, counts: { attempted: 1, processed: 1 }, metadata: { sourceRecipeId: source.id, recipeId: recipe.id, cloneMode, schemaVersion: recipe.schemaVersion, recipeVersion: recipe.recipeVersion, configurationFingerprint: resolution.fingerprint } });

    return NextResponse.json({
      recipe: parsePlaylistRecipe(recipe),
      message: `Cloned recipe "${source.name}" as "${newName}" (${cloneMode.replaceAll("_", " ")}).`,
    }, { status: 201 });
  } catch (error) {
    console.error("Duplicate playlist recipe error:", error);
    return NextResponse.json({ error: "Failed to duplicate playlist recipe" }, { status: 500 });
  }
}
