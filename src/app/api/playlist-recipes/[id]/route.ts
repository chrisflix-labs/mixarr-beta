import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { parsePlaylistRecipe, updatePlaylistRecipeData, validatePlaylistRecipeDraft } from "@/lib/playlistRecipes";
import { safeRecordJobHistory } from "@/lib/jobHistory";
import { legacyRecipeOverrideRows, resolveOwnedRecipe } from "@/lib/recipeInheritance/service";
import { flattenRecipeValues } from "@/lib/recipeInheritance/resolver";
import { writeRecipeAudit } from "@/lib/mixRecipes/governanceService";
import {
  playlistRecipeCorrelationId,
  playlistRecipeValidationErrorResponse,
  playlistRecipeValidationResponse,
} from "@/lib/playlistRecipeApiValidation";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recipe = await prisma.playlistRecipe.findFirst({
    where: { userId, isArchived: false, deletedAt: null, OR: [{ id: params.id }, { slug: params.id }] },
    include: { _count: { select: { generatedPlaylists: true, childRecipes: true } }, baseRecipe: { select: { id: true, name: true, recipeVersion: true } }, recipeCategory: { include: { preset: true } }, transitionPreset: true, discoveryPreset: true, varietyPreset: true, automationPreset: true, recipeOverrides: { orderBy: { fieldPath: "asc" } }, revisions: { orderBy: { recipeVersion: "desc" }, take: 20 }, importAnalysis: { include: { mappings: { orderBy: [{ mappingType: "asc" }, { createdAt: "asc" }] }, library: { select: { id: true, name: true } } } } },
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

  const recipe = await prisma.playlistRecipe.findFirst({ where: { id: params.id, userId, deletedAt: null }, include: { _count: { select: { generatedPlaylists: true, childRecipes: true } } } });
  if (!recipe) {
    return NextResponse.json({ error: "Playlist recipe not found" }, { status: 404 });
  }
  if (recipe._count.childRecipes > 0) {
    return NextResponse.json({ error: "This recipe is a base recipe. Reassign, detach, or convert its child recipes before deletion.", dependencyCheck: { childRecipeCount: recipe._count.childRecipes, strategies: ["reassign", "detach", "convert_to_explicit"] } }, { status: 409 });
  }
  await prisma.playlistRecipe.update({ where: { id: recipe.id }, data: { isArchived: true, enabled: false, deletedAt: new Date() } });
  await safeRecordJobHistory({ userId, type: "mix_recipe", name: "Recipe deleted", status: "completed", trigger: "manual", summary: `Deleted recipe "${recipe.name}"; ${recipe._count.generatedPlaylists} generated playlist(s) were retained.`, counts: { attempted: 1, processed: 1 }, metadata: { recipeId: recipe.id, schemaVersion: recipe.schemaVersion, recipeVersion: recipe.recipeVersion, retainedPlaylistCount: recipe._count.generatedPlaylists } });
  await writeRecipeAudit({ recipeId: recipe.id, recipeVersion: recipe.recipeVersion, eventType: "RECIPE_ARCHIVED", actorId: userId, description: `Recipe "${recipe.name}" was archived; generated playlists were retained.`, previousState: { enabled: recipe.enabled, archived: recipe.isArchived }, newState: { enabled: false, archived: true }, trustState: recipe.trustState, riskLevel: recipe.riskLevel }).catch((auditError) => console.warn("[RecipeStudio] Archive audit failed", { recipeId: recipe.id, reason: auditError instanceof Error ? auditError.message : "unknown" }));
  return NextResponse.json({ success: true, retainedPlaylistCount: recipe._count.generatedPlaylists });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const correlationId = playlistRecipeCorrelationId(req);
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
    if (body.expectedUpdatedAt) {
      const expected = new Date(body.expectedUpdatedAt);
      if (!Number.isFinite(expected.getTime())) return NextResponse.json({ error: "The expected recipe revision is invalid.", code: "RECIPE_REVISION_INVALID" }, { status: 400 });
      if (expected.getTime() !== existing.updatedAt.getTime()) return NextResponse.json({ error: "This recipe changed while you were editing it.", code: "RECIPE_SAVE_CONFLICT", currentRevision: existing.updatedAt.toISOString(), recipeId: existing.id, remediation: "Reload or compare the current recipe before saving again." }, { status: 409 });
    }
    const validation = validatePlaylistRecipeDraft({
      name: existing.name, description: existing.description, category: existing.category, artworkUrl: existing.artworkUrl,
      enabled: existing.enabled, sourcePlaylistId: existing.sourcePlaylistId, filters: existing.filtersJson,
      scoring: existing.scoringJson, targets: existing.targetsJson, bpmFlow: existing.bpmFlowJson,
      discovery: existing.discoveryJson, variety: existing.varietyJson, playlistIdentity: existing.identityDefaultsJson,
      refreshPolicy: existing.refreshPolicyJson, automationPolicy: existing.automationPolicyJson,
      ...body,
    }, { recipeVersion: existing.recipeVersion + 1 });
    if (!validation.success) return playlistRecipeValidationResponse(validation.issues, correlationId);
    const parsed = validation.data;
    if (existing.aiGenerated && parsed.enabled && (existing.aiRecipeStatus !== "APPROVED" || existing.quarantineState !== "NONE")) {
      return NextResponse.json({ error: "AI-generated recipes must be validated and explicitly approved before a separate activation action.", code: "AI_RECIPE_ACTIVATION_BLOCKED" }, { status: 409 });
    }
    const inheritanceKeys = ["baseRecipeId", "recipeCategoryId", "transitionPresetId", "discoveryPresetId", "varietyPresetId", "automationPresetId"];
    const inheritanceChanged = inheritanceKeys.some((key) => Object.prototype.hasOwnProperty.call(body, key));
    if (inheritanceChanged) {
      await resolveOwnedRecipe(userId, existing.id, { proposedChanges: Object.fromEntries(inheritanceKeys.filter((key) => Object.prototype.hasOwnProperty.call(body, key)).map((key) => [key, body[key]])) });
    }
    const overrideUpdates: Array<{ fieldPath: string; value: unknown }> = [];
    if (existing.inheritanceEnabled) {
      const current = await resolveOwnedRecipe(userId, existing.id);
      const effective = flattenRecipeValues(current.effectiveConfiguration);
      const incoming = { scoring: parsed.scoring, targets: parsed.targets, bpmFlow: parsed.bpmFlow, discovery: parsed.discovery, variety: parsed.variety, playlistIdentity: parsed.playlistIdentity, refreshPolicy: parsed.refreshPolicy, automationPolicy: parsed.automationPolicy, generation: parsed.filters };
      for (const [fieldPath, value] of Array.from(flattenRecipeValues(incoming).entries())) {
        if (JSON.stringify(effective.get(fieldPath)) !== JSON.stringify(value)) overrideUpdates.push({ fieldPath, value });
      }
    }
    const recipe = await prisma.$transaction(async (tx) => {
      if (!existing.inheritanceEnabled && inheritanceChanged) await tx.recipeOverride.createMany({ data: legacyRecipeOverrideRows(existing, userId), skipDuplicates: true });
      for (const override of overrideUpdates) await tx.recipeOverride.upsert({ where: { recipeId_fieldPath: { recipeId: existing.id, fieldPath: override.fieldPath } }, create: { recipeId: existing.id, fieldPath: override.fieldPath, valueJson: override.value as any, createdById: userId, updatedById: userId }, update: { valueJson: override.value as any, updatedById: userId } });
      return tx.playlistRecipe.update({
        where: { id: existing.id },
        data: {
          ...updatePlaylistRecipeData(parsed, existing),
          ...(existing.aiGenerated ? {
            manuallyEditedAfterAi: true,
            aiProvenanceJson: { ...((existing.aiProvenanceJson || {}) as Record<string, unknown>), manuallyEdited: true, differsFromAiProposal: true, lastManualEditAt: new Date().toISOString() },
          } : {}),
        },
      });
    });
    await safeRecordJobHistory({ userId, type: "mix_recipe", name: "Recipe updated", status: "completed", trigger: "manual", summary: `Updated recipe "${recipe.name}".`, counts: { attempted: 1, processed: 1 }, metadata: { recipeId: recipe.id, schemaVersion: recipe.schemaVersion, recipeVersion: recipe.recipeVersion } });
    await writeRecipeAudit({ recipeId: recipe.id, recipeVersion: recipe.recipeVersion, eventType: "RECIPE_EDITED", actorId: userId, description: `Recipe "${recipe.name}" was edited.`, previousState: { recipeVersion: existing.recipeVersion, updatedAt: existing.updatedAt.toISOString() }, newState: { recipeVersion: recipe.recipeVersion, updatedAt: recipe.updatedAt.toISOString() }, trustState: recipe.trustState, riskLevel: recipe.riskLevel }).catch((auditError) => console.warn("[RecipeStudio] Edit audit failed", { recipeId: recipe.id, reason: auditError instanceof Error ? auditError.message : "unknown" }));

    return NextResponse.json({ recipe: parsePlaylistRecipe(recipe) });
  } catch (error: any) {
    const validationResponse = playlistRecipeValidationErrorResponse(error, correlationId);
    if (validationResponse) return validationResponse;
    const status = error.name === "ZodError" || /recipe|BPM|energy|automation/i.test(error.message || "") ? 400 : 500;
    const message = error.issues?.[0]?.message || (status === 400 ? "Invalid playlist recipe" : "Failed to update playlist recipe");
    if (status === 500) console.error("[Playlist Recipe] Update failed", { correlationId, exceptionClass: error instanceof Error ? error.name : "Unknown" });
    return NextResponse.json({ error: { code: status === 400 ? "RECIPE_DRAFT_INVALID" : "RECIPE_SAVE_FAILED", message, correlationId } }, { status, headers: { "x-correlation-id": correlationId } });
  }
}
