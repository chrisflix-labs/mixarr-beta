import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { createPlaylistRecipeData, parsePlaylistRecipe, playlistRecipeSchema } from "@/lib/playlistRecipes";
import { safeRecordJobHistory } from "@/lib/jobHistory";
import { writeRecipeAudit } from "@/lib/mixRecipes/governanceService";

export async function GET(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const search = (url.searchParams.get("search") || "").trim().slice(0, 120);
  const category = (url.searchParams.get("category") || "").trim().slice(0, 80);
  const enabled = url.searchParams.get("enabled");
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 24));
  const sort = url.searchParams.get("sort") || "updated";
  const where = {
    userId, isArchived: false, deletedAt: null,
    ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { description: { contains: search, mode: "insensitive" as const } }] } : {}),
    ...(category && category !== "all" ? { category } : {}),
    ...(enabled === "true" || enabled === "false" ? { enabled: enabled === "true" } : {}),
  };
  const orderBy = sort === "name" ? [{ name: "asc" as const }]
    : sort === "used" ? [{ lastUsedAt: "desc" as const }, { updatedAt: "desc" as const }]
    : [{ updatedAt: "desc" as const }, { createdAt: "desc" as const }];
  const [recipes, total] = await Promise.all([
    prisma.playlistRecipe.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: { baseRecipe: { select: { id: true, name: true, recipeVersion: true } }, _count: { select: { generatedPlaylists: true, childRecipes: true } } } }),
    prisma.playlistRecipe.count({ where }),
  ]);

  return NextResponse.json({ recipes: recipes.map(parsePlaylistRecipe), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}

export async function POST(req: Request) {
  const userId = cookies().get("mixarr_session")?.value;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = playlistRecipeSchema.parse(body);
    const aiProposal = body.aiProposalId ? await prisma.aiRecipeProposal.findFirst({ where: { id: String(body.aiProposalId), request: { ownerId: userId } }, include: { request: true } }) : null;
    if (body.aiProposalId && !aiProposal) return NextResponse.json({ error: "AI recipe proposal not found." }, { status: 404 });
    if (aiProposal && ["REJECTED", "SUPERSEDED"].includes(aiProposal.status)) return NextResponse.json({ error: "This AI recipe proposal can no longer be saved." }, { status: 409 });
    const recipe = await prisma.$transaction(async (tx) => {
      const created = await tx.playlistRecipe.create({
        data: {
          ...createPlaylistRecipeData(userId, aiProposal ? { ...parsed, enabled: false } : parsed),
          ...(aiProposal ? {
            aiGenerated: true, aiRecipeStatus: aiProposal.status, lastAiProposalId: aiProposal.id,
            manuallyEditedAfterAi: JSON.stringify(parsed) !== JSON.stringify(aiProposal.proposedConfigurationJson),
            approvalState: "PENDING_REVIEW", enabled: false,
            aiProvenanceJson: {
              originalRequest: aiProposal.request.sourceRequest, originalProposal: aiProposal.originalProposalJson,
              action: aiProposal.request.action, provider: aiProposal.request.providerDisplayName, model: aiProposal.request.model,
              creationTimestamp: aiProposal.createdAt, lastAiModificationTimestamp: aiProposal.createdAt,
              confidence: aiProposal.confidenceScore, assumptions: (aiProposal.analysisJson as any)?.assumptions || [],
              safetyWarnings: aiProposal.safetyWarningsJson, unsupportedRequests: aiProposal.unsupportedRequestsJson,
              expectedBehavioralChanges: (aiProposal.analysisJson as any)?.expectedBehavioralChanges || [],
              candidateEstimate: aiProposal.candidateEstimateJson, compatibility: aiProposal.compatibilityJson,
              approvalStatus: aiProposal.status, parentRecommendations: (aiProposal.recommendationsJson as any)?.parentRecipes || [],
              inheritanceRecommendations: (aiProposal.recommendationsJson as any)?.inheritance || [],
              detectedIntentConflicts: (aiProposal.intentJson as any)?.conflicts || [], validation: aiProposal.validationJson,
              schemaVersion: aiProposal.schemaVersion, promptTemplateVersion: aiProposal.request.promptTemplateVersion,
              aiResponseIdentifier: aiProposal.request.aiResponseIdentifier, initiatedBy: userId,
              manuallyEdited: JSON.stringify(parsed) !== JSON.stringify(aiProposal.proposedConfigurationJson),
              differsFromAiProposal: JSON.stringify(parsed) !== JSON.stringify(aiProposal.proposedConfigurationJson),
              previousRecipeVersion: null,
            },
          } : {}),
        } as any,
      });
      if (aiProposal) await tx.aiRecipeProposal.update({ where: { id: aiProposal.id }, data: { recipeId: created.id, appliedById: userId, appliedAt: new Date(), manuallyEdited: JSON.stringify(parsed) !== JSON.stringify(aiProposal.proposedConfigurationJson), differsFromAiProposal: JSON.stringify(parsed) !== JSON.stringify(aiProposal.proposedConfigurationJson) } });
      return created;
    });
    await safeRecordJobHistory({ userId, type: "mix_recipe", name: "Recipe created", status: "completed", trigger: "manual", summary: `Created recipe "${recipe.name}".`, counts: { attempted: 1, processed: 1 }, metadata: { recipeId: recipe.id, schemaVersion: recipe.schemaVersion, recipeVersion: recipe.recipeVersion } });
    await writeRecipeAudit({ recipeId: recipe.id, recipeVersion: recipe.recipeVersion, eventType: aiProposal ? "AI_GENERATED_RECIPE_SAVED" : "RECIPE_CREATED", actorId: userId, correlationId: aiProposal?.requestId, description: aiProposal ? `AI-generated recipe "${recipe.name}" was explicitly saved as an inactive review draft.` : `Recipe "${recipe.name}" was created in Recipe Studio.`, newState: { enabled: recipe.enabled, category: recipe.category, aiRecipeStatus: aiProposal?.status }, trustState: recipe.trustState, riskLevel: recipe.riskLevel, metadata: aiProposal ? { proposalId: aiProposal.id, automaticActivation: false } : undefined }).catch((auditError) => console.warn("[RecipeStudio] Create audit failed", { recipeId: recipe.id, reason: auditError instanceof Error ? auditError.message : "unknown" }));

    return NextResponse.json({ recipe: parsePlaylistRecipe(recipe) }, { status: 201 });
  } catch (error: any) {
    const status = error.name === "ZodError" || /recipe|BPM|energy|automation/i.test(error.message || "") ? 400 : 500;
    const message = error.issues?.[0]?.message || (status === 400 ? "Invalid playlist recipe" : "Failed to save playlist recipe");
    if (status === 500) console.error("Save playlist recipe error:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
