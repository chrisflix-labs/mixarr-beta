import type { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import prisma from "../prisma";
import { isUserAdmin } from "../auth";
import { requireAiPermission } from "../../ai/governance/permissions";
import { analyzeRecipeDraft } from "../recipeStudioService";
import { defaultRecipeStudioDraft } from "../recipeStudio";
import {
  parsePlaylistRecipe,
  playlistRecipeSchema,
  updatePlaylistRecipeData,
  validatePlaylistRecipeDraft,
} from "../playlistRecipes";
import { approveRecipe, writeRecipeAudit } from "../mixRecipes/governanceService";
import { createExplanationFromRecipeProposal, recordRecommendationExplanationAudit } from "../recommendationExplanations/service";
import { aiRequestCoordinator } from "@/ai/request-coordinator";
import { previewAiRequest } from "@/ai/governance/service";
import { assertAiExecutionPolicy } from "@/ai/governance/executionPolicy";
import { resolveAiProvider } from "@/ai/services/providerService";
import { AiError } from "@/ai/errors";
import { aiFailureStatus } from "@/ai/audit/status";
import { describeRequestLimitFromDetails } from "@/ai/governance/requestLimits";
import { describeCostLimitFromDetails } from "@/ai/governance/costLimits";
import { recipeCopilotSettingsUrl } from "./readiness";
import { RECIPE_COPILOT_SYSTEM_PROMPT, recipeCopilotUserPrompt } from "@/ai/recipeCopilot/prompts";
import {
  AI_RECIPE_STATUSES, RECIPE_COPILOT_FEATURE_KEY, RECIPE_COPILOT_PROMPT_VERSION,
  recipeCopilotJsonSchema, recipeCopilotRequestSchema, recipeCopilotResponseSchema, type AiRecipeStatus,
} from "./contracts";
import {
  assertAiRecipeStatusTransition, buildPrivacyAwareRecipeContext, deriveRecipePurpose,
  detectRecipeIntentConflicts, localSafetyRecommendations,
  logicalRecipeChanges, mergeRecipeCopilotPatch, recipeFingerprint, recommendBuiltInParents,
  statusForProposal,
} from "./core";
import {
  applyRecipeProposalChanges, canonicalRecipeValue, canonicalRecipeValueEqual,
  findRecipeProposalConflictDetails, getRecipeProposalPath, hasSurroundingJsonQuotes,
  normalizeLegacyProposalValue, stableRecipeProposalChangeId, type RecipeProposalChange,
  type RecipeProposalConflictResolution,
} from "./proposalApply";
import { canonicalRecipeDraftSnapshot } from "./canonicalDraft";
import { SCORING_MODELS } from "../scoringModelCatalog";

export const RECIPE_AI_PERMISSIONS = [
  "recipe.ai.use", "recipe.ai.create", "recipe.ai.refine", "recipe.ai.explain", "recipe.ai.diagnose",
  "recipe.ai.optimize", "recipe.ai.view_history", "recipe.ai.review", "recipe.ai.approve",
  "recipe.ai.quarantine", "recipe.ai.configure",
] as const;
export type RecipeAiPermission = typeof RECIPE_AI_PERMISSIONS[number];

const adminPermissions = new Set<RecipeAiPermission>(["recipe.ai.approve", "recipe.ai.quarantine", "recipe.ai.configure"]);
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const failure = (code: string, message: string, status = 400) => Object.assign(new Error(message), { code, status });

async function auditAiRecipe(input: { requestId: string; proposalId?: string | null; recipeId?: string | null; actorId?: string | null; eventType: string; action: string; provider?: string | null; model?: string | null; privacyMode?: string | null; remote?: boolean; statusBefore?: string | null; statusAfter?: string | null; reason?: string | null; estimatedCost?: number | null; actualCost?: number | null; inputTokens?: number | null; outputTokens?: number | null; metadata?: unknown }, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  return tx.aiRecipeAuditEvent.create({ data: { requestId: input.requestId, proposalId: input.proposalId, recipeId: input.recipeId, actorId: input.actorId, eventType: input.eventType, action: input.action, provider: input.provider, model: input.model, privacyMode: input.privacyMode, remote: input.remote === true, statusBefore: input.statusBefore, statusAfter: input.statusAfter, reason: input.reason?.slice(0, 1000), estimatedCost: input.estimatedCost, actualCost: input.actualCost, inputTokens: input.inputTokens, outputTokens: input.outputTokens, metadataJson: input.metadata == null ? undefined : json(input.metadata) } });
}

export async function requireRecipeAiPermission(userId: string, permission: RecipeAiPermission, ownerId?: string | null) {
  if (!userId) throw failure("UNAUTHORIZED", "Authentication is required.", 401);
  const admin = await isUserAdmin(userId);
  if (ownerId && ownerId !== userId && !admin) throw failure("PERMISSION_DENIED", "This AI recipe artifact is not accessible to the current user.", 403);
  const granular = permission === "recipe.ai.review" || permission === "recipe.ai.approve" || permission === "recipe.ai.quarantine" ? "ai.recipe.review" : permission === "recipe.ai.configure" ? "ai.provider.manage" : permission === "recipe.ai.create" || permission === "recipe.ai.refine" || permission === "recipe.ai.optimize" ? "ai.recipe.create" : "ai.use";
  await requireAiPermission(userId, "ai.use");
  if (!admin) await requireAiPermission(userId, granular);
  if (adminPermissions.has(permission) && !admin && granular === "ai.provider.manage") throw failure("PERMISSION_DENIED", "Administrator permission is required for this AI recipe action.", 403);
  return { userId, admin };
}

const permissionForAction = (action: string): RecipeAiPermission => action === "create" || action === "from_playlist" ? "recipe.ai.create" : action === "refine" ? "recipe.ai.refine" : action === "explain" ? "recipe.ai.explain" : action === "diagnose" ? "recipe.ai.diagnose" : action === "optimize" ? "recipe.ai.optimize" : "recipe.ai.use";

function publicProposal(row: any) {
  return {
    id: row.id, requestId: row.requestId, recipeId: row.recipeId, status: row.status, schemaVersion: row.schemaVersion,
    proposedRecipe: row.proposedConfigurationJson, analysis: row.analysisJson, intent: row.intentJson,
    recommendations: row.recommendationsJson, changes: row.changesJson, validation: row.validationJson,
    candidateEstimate: row.candidateEstimateJson, compatibility: row.compatibilityJson,
    safetyWarnings: row.safetyWarningsJson, unsupportedRequests: row.unsupportedRequestsJson,
    confidence: row.confidenceScore, previousRecipeVersion: row.previousRecipeVersion,
    baseDraft: row.previousConfigurationJson,
    baseRevision: row.previousConfigurationJson ? recipeFingerprint(row.previousConfigurationJson) : null,
    manuallyEdited: row.manuallyEdited, differsFromAiProposal: row.differsFromAiProposal,
    appliedAt: row.appliedAt, approvedAt: row.approvedAt, rejectedAt: row.rejectedAt,
    supersededAt: row.supersededAt, quarantinedAt: row.quarantinedAt, statusReason: row.statusReason,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    request: row.request ? {
      id: row.request.id, action: row.request.action, sourceRequest: row.request.sourceRequest,
      providerId: row.request.providerConfigId, provider: row.request.providerDisplayName, model: row.request.model,
      privacyMode: row.request.privacyMode, status: row.request.status, inputTokenCount: row.request.inputTokenCount,
      outputTokenCount: row.request.outputTokenCount, estimatedCost: row.request.estimatedCost,
      actualCost: row.request.actualCost, aiResponseIdentifier: row.request.aiResponseIdentifier,
      remote: row.request.remote, createdAt: row.request.createdAt, completedAt: row.request.completedAt,
    } : undefined,
    originalProposal: row.originalProposalJson,
  };
}

async function ownedRecipe(userId: string, recipeId: string) {
  const row = await prisma.playlistRecipe.findFirst({ where: { id: recipeId, userId, isArchived: false, deletedAt: null } });
  if (!row) throw failure("RECIPE_NOT_FOUND", "Playlist recipe not found.", 404);
  return row;
}

async function ownedProposal(userId: string, proposalId: string) {
  const row = await prisma.aiRecipeProposal.findUnique({ where: { id: proposalId }, include: { request: true, recipe: true } });
  if (!row) throw failure("AI_RECIPE_PROPOSAL_NOT_FOUND", "AI recipe proposal not found.", 404);
  await requireRecipeAiPermission(userId, "recipe.ai.review", row.request.ownerId);
  return row;
}

async function playlistExampleContext(userId: string, playlistId?: string) {
  if (!playlistId) return null;
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, userId }, select: { id: true, trackCount: true, filtersJson: true, discoveryConfigJson: true, tracks: { select: { artist: true, album: true, position: true }, orderBy: { position: "asc" }, take: 5000 } } });
  if (!playlist) throw failure("PLAYLIST_NOT_FOUND", "Example playlist not found.", 404);
  const artists = new Map<string, number>(), albums = new Map<string, number>();
  for (const track of playlist.tracks) { if (track.artist) artists.set(track.artist, (artists.get(track.artist) || 0) + 1); if (track.album) albums.set(track.album, (albums.get(track.album) || 0) + 1); }
  const filters = (playlist.filtersJson || {}) as Record<string, unknown>;
  const discovery = (playlist.discoveryConfigJson || {}) as Record<string, unknown>;
  const reusableFilterShape = Object.fromEntries(["rules", "limit", "duplicateStrategy", "negativeFilters", "safetyRules"].filter((key) => filters[key] !== undefined).map((key) => [key, filters[key]]));
  const discoveryShape = Object.fromEntries(["level", "deepCutPercentage", "familiarityBalance", "artistDiversity", "albumDiversity", "eraBalance", "popularityRange"].filter((key) => discovery[key] !== undefined).map((key) => [key, discovery[key]]));
  return { playlistSize: playlist.trackCount || playlist.tracks.length, uniqueArtists: artists.size, uniqueAlbums: albums.size, maximumArtistFrequency: Math.max(0, ...Array.from(artists.values())), maximumAlbumFrequency: Math.max(0, ...Array.from(albums.values())), reusableFilterShape, discoveryShape, trackLevelDataSent: false };
}

export async function getRecipeCopilotAvailability(userId: string, raw: unknown = {}) {
  const permission = await requireRecipeAiPermission(userId, "recipe.ai.use");
  const input = recipeCopilotRequestSchema.partial().parse(raw);
  const [global, feature, governance] = await Promise.all([
    prisma.aiGlobalSetting.findUnique({ where: { id: "global" } }),
    prisma.aiFeatureSetting.findUnique({ where: { featureKey: RECIPE_COPILOT_FEATURE_KEY } }),
    prisma.aiGovernanceSetting.findUnique({ where: { id: "global" } }),
  ]);
  const privacyMode = input.privacyMode || governance?.privacyMode || "METADATA_LIMITED";
  const disabled = (code: string, reason: string, target: { providerId?: string | null; providerName?: string | null; modelId?: string | null; modelName?: string | null; failedCheck?: string | null; requestLimit?: Record<string, unknown> | null } = {}) => ({
    available: false as const,
    providerId: target.providerId || null,
    providerName: target.providerName || null,
    modelId: target.modelId || null,
    modelName: target.modelName || target.modelId || null,
    privacyMode,
    remoteOperationAllowed: false,
    blockedReasonCode: code,
    blockedReasonMessage: reason,
    // Canonical feature and the exact authorization check that failed, so the
    // administrator sees precisely which control blocked the request.
    requestedFeature: RECIPE_COPILOT_FEATURE_KEY,
    failedCheck: target.failedCheck || null,
    // A request-count limit is administrator configuration, so the link opens the
    // exact control instead of the top of the AI settings page.
    requestLimit: target.requestLimit || null,
    canConfigure: permission.admin,
    settingsUrl: permission.admin ? recipeCopilotSettingsUrl(code) : null,
    // Backward-compatible fields retained for existing drawer/API consumers.
    code,
    reason,
    provider: target.providerName || null,
    model: target.modelName || target.modelId || null,
  });
  if (!global?.enabled) return disabled("AI_DISABLED", "AI is disabled in global settings.");
  if (!feature?.implemented || !feature.enabled) return disabled("FEATURE_DISABLED", "Recipe Copilot is disabled. An administrator must enable it after reviewing provider and governance settings.");
  const providerId = input.providerId || feature.preferredProviderId || global.defaultProviderId;
  if (!providerId) return disabled("AI_PROVIDER_UNAVAILABLE", "No enabled AI provider is available.");
  const providerRow = await prisma.aiProviderConfig.findUnique({ where: { id: providerId }, include: { models: { select: { modelIdentifier: true, displayName: true, availabilityStatus: true, enabled: true, approved: true, deprecated: true } } } });
  if (!providerRow || providerRow.deletedAt || !providerRow.enabled) return disabled("AI_PROVIDER_UNAVAILABLE", "No enabled AI provider is available.", { providerId, providerName: providerRow?.displayName });
  const model = input.model || feature.preferredModel || providerRow.defaultModel;
  if (!model) return disabled("AI_MODEL_UNAVAILABLE", "No usable AI model is configured for Recipe Copilot.", { providerId, providerName: providerRow.displayName });
  const modelRow = providerRow.models.find((item) => item.modelIdentifier === model);
  if (!modelRow || modelRow.availabilityStatus !== "AVAILABLE" || !modelRow.enabled || !modelRow.approved || modelRow.deprecated) return disabled("AI_MODEL_UNAVAILABLE", "No usable AI model is configured for Recipe Copilot.", { providerId, providerName: providerRow.displayName, modelId: model, modelName: modelRow?.displayName });
  try {
    const provider = await resolveAiProvider(providerId);
    const context = buildPrivacyAwareRecipeContext(input.recipe as Record<string, any> | undefined, privacyMode);
    const request = { featureKey: RECIPE_COPILOT_FEATURE_KEY, systemInstructions: RECIPE_COPILOT_SYSTEM_PROMPT, messages: [{ role: "user" as const, content: recipeCopilotUserPrompt({ action: input.action || "create", instruction: input.instruction || "", purpose: input.purpose, context: context.recipe }) }], responseFormat: { type: "json" as const, name: "mixarr_recipe_copilot", schema: recipeCopilotResponseSchema, jsonSchema: recipeCopilotJsonSchema, unknownFields: "reject" as const, allowEmbeddedJson: true, knownRootWrappers: ["recipe", "draft", "result", "recipeDraft"] }, privacyMode: privacyMode as any, estimatedOutputTokens: 2_500, thinkingMode: "disabled" as const, requestSource: "FOREGROUND" as const, allowFallback: true, requiredCapabilities: ["structured_json" as const], externalConfirmation: true };
    await assertAiExecutionPolicy({ request, provider, model, requiredCapabilities: ["chat_messages", "structured_json"] });
    const preview = await previewAiRequest({ request, provider, model, userId });
    const dailyRequests = preview.remainingBudgets?.dailyRequests;
    return { available: true as const, providerId, providerName: providerRow.displayName, modelId: model, modelName: modelRow.displayName, privacyMode: preview.privacyMode, remoteOperationAllowed: preview.provider.location !== "LOCAL", blockedReasonCode: null, blockedReasonMessage: null, canConfigure: permission.admin, settingsUrl: permission.admin ? "/settings/ai" : null, dailyRequestLimit: { effectiveMode: dailyRequests?.effective?.effectiveMode || "UNLIMITED", scope: dailyRequests?.effective?.scope || null, limit: dailyRequests?.limit ?? null, usage: dailyRequests?.usage ?? null, remaining: dailyRequests?.remaining ?? null, resetAt: dailyRequests?.resetAt ?? null }, provider: providerRow.displayName, model, local: preview.provider.location === "LOCAL", estimatedInputTokens: preview.limits.estimatedInputTokens, outputLengthManagedByProvider: true, structuredOutputMode: preview.modelCapabilities.structuredOutputMode, modelReasoning: preview.modelCapabilities.supportsReasoning, reasoningDisabledForStructuredOutput: true, estimatedCost: preview.cost.expectedEstimatedCost, maximumEstimatedCost: preview.cost.maximumEstimatedCost, currency: preview.cost.currency, costDecision: preview.costDecision, contextSummary: { blockedFields: context.blockedFields, recipeIncluded: !!input.recipe, trackLevelLibraryMetadata: false }, previewRequired: preview.privacyMode === "FULL_METADATA" || preview.provider.location !== "LOCAL", warnings: [] as string[] };
  } catch (error) {
    const value = error as any;
    const originalCode = String(value?.category || value?.code || "GOVERNANCE_BLOCKED");
    const mappedCode =
      ["PROVIDER_NOT_CONFIGURED", "PROVIDER_DISABLED", "PROVIDER_NOT_FOUND", "PROVIDER_UNAVAILABLE"].includes(originalCode) ? "AI_PROVIDER_UNAVAILABLE"
      : ["MODEL_NOT_CONFIGURED", "MODEL_NOT_FOUND", "MODEL_NOT_AVAILABLE", "AI_MODEL_DISABLED", "AI_MODEL_NOT_APPROVED", "AI_MODEL_FEATURE_BLOCKED"].includes(originalCode) ? "AI_MODEL_UNAVAILABLE"
      : ["MODEL_UNPRICED", "AI_MODEL_PRICING_MISSING"].includes(originalCode) ? "AI_MODEL_PRICING_UNAVAILABLE"
      : ["AI_GLOBAL_BUDGET_EXCEEDED", "MONTHLY_COST_LIMIT_REACHED"].includes(originalCode) ? "AI_MONTHLY_BUDGET_EXCEEDED"
      : ["MONTHLY_REQUEST_LIMIT_REACHED"].includes(originalCode) ? "AI_MONTHLY_REQUEST_LIMIT_EXCEEDED"
      : ["DAILY_REQUEST_LIMIT_REACHED", "AI_DAILY_REQUEST_LIMIT_EXCEEDED", "DAILY_COST_LIMIT_REACHED"].includes(originalCode) ? "AI_DAILY_LIMIT_EXCEEDED"
      : originalCode;
    const details = error instanceof AiError ? error.details : undefined;
    const requestLimitReason = ["DAILY_REQUEST_LIMIT_REACHED", "MONTHLY_REQUEST_LIMIT_REACHED"].includes(originalCode) ? describeRequestLimitFromDetails(details) : null;
    const costLimitReason = mappedCode === "AI_REQUEST_COST_LIMIT_EXCEEDED" ? describeCostLimitFromDetails({ currency: governance?.currency, ...details }) : null;
    const reason = requestLimitReason || costLimitReason
      || (error instanceof Error ? error.message : "AI governance blocked this request.");
    const failedCheck = typeof details?.failedCheck === "string" ? details.failedCheck : null;
    return disabled(mappedCode, reason, { providerId, providerName: providerRow.displayName, modelId: model, modelName: modelRow.displayName, failedCheck, requestLimit: details?.limit == null ? null : { period: originalCode === "MONTHLY_REQUEST_LIMIT_REACHED" ? "MONTHLY" : "DAILY", scope: details.scope ?? null, limit: Number(details.limit), usage: Number(details.current_usage ?? 0), remaining: Number(details.remaining ?? 0), resetAt: details.reset_at ?? null } });
  }
}

export async function runRecipeCopilot(userId: string, recipeId: string | null, raw: unknown, signal?: AbortSignal) {
  const operationStarted = Date.now();
  const input = recipeCopilotRequestSchema.parse(raw);
  await requireRecipeAiPermission(userId, permissionForAction(input.action));
  if (["create", "refine", "optimize", "compare_intent"].includes(input.action) && !input.instruction.trim()) throw failure("INSTRUCTION_REQUIRED", "Describe the recipe behavior or change you want.");
  const stored = recipeId ? await ownedRecipe(userId, recipeId) : null;
  const savedDraft = stored ? parsePlaylistRecipe(stored) : null;
  // The active Recipe Studio snapshot is captured by the client immediately
  // before generation and is authoritative. The AI response never supplies it.
  const source = canonicalRecipeDraftSnapshot(input.baseDraft || input.recipe || savedDraft || defaultRecipeStudioDraft());
  const availability = await getRecipeCopilotAvailability(userId, { ...input, recipe: source });
  if (availability.available !== true) {
    const blocked = await prisma.aiRecipeRequest.create({ data: { ownerId: userId, recipeId: stored?.id, recipeVersion: stored?.recipeVersion, action: input.action.toUpperCase(), sourceRequest: input.instruction, privacyMode: availability.privacyMode, status: "BLOCKED", contextFingerprint: recipeFingerprint({ action: input.action, recipe: buildPrivacyAwareRecipeContext(source, availability.privacyMode).recipe }), sourceUpdatedAt: stored?.updatedAt, promptTemplateVersion: RECIPE_COPILOT_PROMPT_VERSION, errorCategory: availability.code, errorMessage: availability.reason, completedAt: new Date() } });
    await auditAiRecipe({ requestId: blocked.id, recipeId: stored?.id, actorId: userId, eventType: "AI_REQUEST_BLOCKED", action: input.action, privacyMode: availability.privacyMode, statusAfter: "BLOCKED", reason: availability.reason, metadata: { code: availability.code } }).catch(() => null);
    throw failure(availability.code, availability.reason, 409);
  }
  const localAnalysis = await analyzeRecipeDraft(userId, source);
  const playlistContext = await playlistExampleContext(userId, input.playlistId);
  const privacy = buildPrivacyAwareRecipeContext(source, availability.privacyMode);
  const contextFingerprint = recipeFingerprint({ recipe: privacy.recipe, playlistContext, action: input.action });
  const requestRow = await prisma.aiRecipeRequest.create({ data: { ownerId: userId, recipeId: stored?.id, recipeVersion: stored?.recipeVersion, action: input.action.toUpperCase(), sourceRequest: input.instruction, providerConfigId: availability.providerId, providerDisplayName: availability.provider, model: availability.model, privacyMode: availability.privacyMode, status: "WAITING_FOR_PROVIDER", contextFingerprint, sourceUpdatedAt: stored?.updatedAt, promptTemplateVersion: RECIPE_COPILOT_PROMPT_VERSION, remote: !availability.local } });
  await auditAiRecipe({ requestId: requestRow.id, recipeId: stored?.id, actorId: userId, eventType: "AI_REQUEST_INITIATED", action: input.action, provider: availability.provider, model: availability.model, privacyMode: availability.privacyMode, remote: !availability.local, statusAfter: "WAITING_FOR_PROVIDER" }).catch(() => null);
  if (stored) await writeRecipeAudit({ recipeId: stored.id, recipeVersion: stored.recipeVersion, eventType: "AI_RECIPE_REQUEST_INITIATED", actorId: userId, correlationId: requestRow.id, description: `Recipe Copilot ${input.action} request initiated.`, metadata: { action: input.action, provider: availability.provider, model: availability.model, privacyMode: availability.privacyMode, remote: !availability.local } }).catch(() => null);
  try {
    await prisma.aiRecipeRequest.update({ where: { id: requestRow.id }, data: { status: "GENERATING_PROPOSAL" } });
    const response = await aiRequestCoordinator.complete({
      featureKey: RECIPE_COPILOT_FEATURE_KEY, providerId: availability.providerId, model: availability.model,
      systemInstructions: RECIPE_COPILOT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: recipeCopilotUserPrompt({ action: input.action, instruction: input.instruction, purpose: input.purpose, context: privacy.recipe, localAnalysis: { candidateEstimate: localAnalysis.candidateEstimate, compatibility: localAnalysis.compatibility, playlistExample: playlistContext } }) }],
      responseFormat: { type: "json", name: "mixarr_recipe_copilot", schema: recipeCopilotResponseSchema, jsonSchema: recipeCopilotJsonSchema, unknownFields: "reject", allowEmbeddedJson: true, knownRootWrappers: ["recipe", "draft", "result", "recipeDraft"] },
      estimatedOutputTokens: 2_500,
      privacyMode: availability.privacyMode as any, maxResponseBytes: 512_000,
      thinkingMode: "disabled", requestSource: "FOREGROUND", allowFallback: true, requiredCapabilities: ["structured_json"],
      contextTrimmingStrategy: "REMOVE_LOWEST_PRIORITY", signal, correlationId: requestRow.id,
      externalConfirmation: input.externalConfirmation, idempotencyKey: input.idempotencyKey,
      promptTemplateVersion: RECIPE_COPILOT_PROMPT_VERSION,
      metadata: { workflow: "recipe_copilot", action: input.action, advisory_only: true, automatic_activation: false },
    }, userId);
    const output = recipeCopilotResponseSchema.parse(response.data);
    if (output.action !== input.action) throw failure("AI_ACTION_MISMATCH", "The provider returned a different Recipe Copilot action.", 422);
    const readOnly = new Set(["explain", "diagnose", "compare_intent", "suggest_names", "onboarding"]);
    if (readOnly.has(input.action) && output.proposedPatch) throw failure("READ_ONLY_ACTION_MODIFIED_RECIPE", "A read-only Copilot action attempted to modify the recipe.", 422);
    const proposedCandidate = output.proposedPatch ? mergeRecipeCopilotPatch(source, output.proposedPatch) : null;
    const proposedValidation = proposedCandidate ? validatePlaylistRecipeDraft(proposedCandidate) : null;
    if (proposedValidation && !proposedValidation.success) {
      const first = proposedValidation.issues[0];
      const category = first?.code === "RECIPE_SCORING_MODEL_UNSUPPORTED"
        ? "AI_RECIPE_PROPOSAL_UNSUPPORTED_ENUM"
        : "AI_RECIPE_PROPOSAL_DRAFT_INVALID";
      throw new AiError(category, undefined, 422, undefined, {
        failure_stage: "RECIPE_DRAFT_VALIDATION",
        issues: proposedValidation.issues,
      });
    }
    const proposed = proposedValidation?.success ? proposedValidation.data : null;
    const proposedAnalysis = proposed ? await analyzeRecipeDraft(userId, proposed) : localAnalysis;
    const conflicts = detectRecipeIntentConflicts(input.instruction, proposed || source, proposedAnalysis.candidateEstimate);
    const combinedConflicts = [...output.intent.conflicts, ...conflicts.filter((local) => !output.intent.conflicts.some((remote) => remote.code === local.code))];
    const safety = proposed ? localSafetyRecommendations(proposed) : [];
    const parents = proposed ? recommendBuiltInParents(proposed, output.intent.summary || input.instruction) : [];
    const recommendations = { ...output.recommendations, parentRecipes: output.recommendations.parentRecipes.length ? output.recommendations.parentRecipes : parents, saferSettings: [...output.recommendations.saferSettings, ...safety.filter((item) => !output.recommendations.saferSettings.some((remote) => remote.path === item.path))] };
    const errors = (proposedAnalysis.compatibility?.findings || []).filter((item: any) => item.severity === "error");
    const warnings = [...output.analysis.warnings, ...(proposedAnalysis.compatibility?.findings || []).filter((item: any) => item.severity === "warning").map((item: any) => item.message), ...response.warnings];
    const unsafe = proposed ? proposed.enabled !== false || proposed.automationPolicy?.enabled === true : false;
    const status = statusForProposal({ errors: errors.length, warnings: warnings.length, conflicts: combinedConflicts.filter((item) => !item.resolved).length, assumptions: output.analysis.assumptions.length, unsupported: output.analysis.unsupportedRequests.length, confidence: output.analysis.confidence, unsafe });
    const changes = proposed ? logicalRecipeChanges(source, proposed, output) : [];
    const validation = {
      proposalSchemaValid: true,
      patchValid: true,
      draftSchemaValid: !proposedValidation || proposedValidation.success,
      saveSemanticValidationValid: !proposedValidation || proposedValidation.success,
      executionCompatibilityValid: !proposedValidation || proposedValidation.success,
      schema: { valid: true, version: "1.0" },
      recipe: { valid: errors.length === 0, errors },
      safety: { valid: !unsafe, warnings: safety },
      conflicts: combinedConflicts,
      finalStatus: status,
      validatedAt: new Date().toISOString(),
    };
    const proposal = await prisma.aiRecipeProposal.create({ data: { requestId: requestRow.id, recipeId: stored?.id, status, schemaVersion: "1.0", originalProposalJson: json(output), proposedConfigurationJson: proposed ? json(proposed) : undefined, analysisJson: json({ ...output.analysis, warnings, explanation: output.explanation, diagnoses: output.diagnoses, behaviorComparison: output.behaviorComparison, nameSuggestions: output.nameSuggestions, onboarding: output.onboarding, presumedPurpose: deriveRecipePurpose(source) }), intentJson: json({ ...output.intent, conflicts: combinedConflicts }), recommendationsJson: json(recommendations), changesJson: json(changes), validationJson: json(validation), candidateEstimateJson: json(proposedAnalysis.candidateEstimate), compatibilityJson: json(proposedAnalysis.compatibility), safetyWarningsJson: json([...warnings, ...safety.map((item) => item.reason)]), unsupportedRequestsJson: json(output.analysis.unsupportedRequests), confidenceScore: output.analysis.confidence, previousConfigurationJson: json(source), previousRecipeVersion: stored?.recipeVersion } });
    await prisma.aiRecipeRequest.update({ where: { id: requestRow.id }, data: { status: "SUCCESS", providerConfigId: response.providerId, model: response.model, inputTokenCount: response.usage?.inputTokens, outputTokenCount: response.usage?.outputTokens, estimatedCost: response.estimatedCost, actualCost: response.actualCost, aiResponseIdentifier: response.usage?.providerRequestId, completedAt: new Date() } });
    await createExplanationFromRecipeProposal({ ownerId: userId, requestId: requestRow.id, proposalId: proposal.id, recipeId: stored?.id, recipeVersion: stored?.recipeVersion, originalRequest: input.instruction, intent: { ...output.intent, conflicts: combinedConflicts }, analysis: { ...output.analysis, warnings }, proposedConfiguration: proposed || source, previousConfiguration: source, changes, validation, compatibility: proposedAnalysis.compatibility, provider: availability.provider, model: response.model, privacyMode: availability.privacyMode, engineVersion: "v2", recipeSchemaVersion: String(stored?.schemaVersion || "current"), cost: response.actualCost ?? response.estimatedCost, createdAt: requestRow.createdAt });
    await auditAiRecipe({ requestId: requestRow.id, proposalId: proposal.id, recipeId: stored?.id, actorId: userId, eventType: "AI_REQUEST_COMPLETED", action: input.action, provider: availability.provider, model: response.model, privacyMode: availability.privacyMode, remote: !availability.local, statusAfter: status, estimatedCost: response.estimatedCost, actualCost: response.actualCost, inputTokens: response.usage?.inputTokens, outputTokens: response.usage?.outputTokens, metadata: { changes: changes.length, warnings: warnings.length, conflicts: combinedConflicts.length } }).catch(() => null);
    await auditAiRecipe({ requestId: requestRow.id, proposalId: proposal.id, recipeId: stored?.id, actorId: userId, eventType: "GENERATED_DRAFT_CREATED", action: input.action, provider: availability.provider, model: response.model, privacyMode: availability.privacyMode, remote: !availability.local, statusAfter: status }).catch(() => null);
    if (stored) await writeRecipeAudit({ recipeId: stored.id, recipeVersion: stored.recipeVersion, eventType: "AI_RECIPE_PROPOSAL_CREATED", actorId: userId, correlationId: requestRow.id, description: `Recipe Copilot ${input.action} proposal is ready for review.`, validation, newState: { aiRecipeStatus: status, proposalId: proposal.id }, metadata: { changes: changes.length, automaticActivation: false } }).catch(() => null);
    return publicProposal(await prisma.aiRecipeProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { request: true } }));
  } catch (error) {
    const normalized = error instanceof AiError ? error : error instanceof ZodError ? new AiError("AI_FEATURE_INVALID_STRUCTURED_OUTPUT") : Object.assign(new AiError("AI_RECIPE_REQUEST_FAILED"), { cause: error });
    normalized.details = { request_id: requestRow.id, provider: availability.provider, model: availability.model, stage: normalized.details?.stage || normalized.details?.failure_stage || "RECIPE_GENERATION", elapsed_ms: Date.now() - operationStarted, ...normalized.details };
    const cancelled = normalized.category === "REQUEST_CANCELLED";
    const requestStatus = aiFailureStatus(normalized.category);
    await prisma.aiRecipeRequest.update({ where: { id: requestRow.id }, data: { status: requestStatus, errorCategory: normalized.category, errorMessage: normalized.message.slice(0, 1000), inputTokenCount: typeof normalized.details.usage_input_tokens === "number" ? normalized.details.usage_input_tokens : undefined, outputTokenCount: typeof normalized.details.usage_output_tokens === "number" ? normalized.details.usage_output_tokens : undefined, estimatedCost: typeof normalized.details.estimated_cost === "number" ? normalized.details.estimated_cost : undefined, actualCost: typeof normalized.details.actual_cost === "number" ? normalized.details.actual_cost : undefined, ...(cancelled ? { cancelledAt: new Date() } : {}), completedAt: new Date() } }).catch(() => null);
    await auditAiRecipe({ requestId: requestRow.id, recipeId: stored?.id, actorId: userId, eventType: cancelled ? "AI_REQUEST_CANCELLED" : "AI_REQUEST_FAILED", action: input.action, provider: availability.provider, model: availability.model, privacyMode: availability.privacyMode, remote: !availability.local, statusAfter: requestStatus, reason: normalized.category, metadata: { stage: normalized.details.stage, elapsedMs: normalized.details.elapsed_ms } }).catch(() => null);
    if (stored) await writeRecipeAudit({ recipeId: stored.id, recipeVersion: stored.recipeVersion, eventType: "AI_RECIPE_REQUEST_FAILED", actorId: userId, correlationId: requestRow.id, description: "Recipe Copilot request failed without changing the recipe.", result: "FAILED", metadata: { errorCategory: normalized.category } }).catch(() => null);
    throw normalized;
  }
}

export async function applyRecipeCopilotProposal(userId: string, proposalId: string, raw: any = {}) {
  const startedAt = Date.now();
  const proposal = await ownedProposal(userId, proposalId);
  const storedChanges = Array.isArray(proposal.changesJson) ? proposal.changesJson as any[] : [];
  const selectedPaths = new Set(Array.isArray(raw.selectedPaths) ? raw.selectedPaths.filter((item: unknown): item is string => typeof item === "string") : []);
  const requestedChanges = Array.isArray(raw.changes) ? raw.changes : null;
  const storedByPath = new Map(storedChanges.map((change) => [String(change.path), change]));
  const selectedChanges: RecipeProposalChange[] = requestedChanges
    ? requestedChanges.filter((change: any) => change?.selected === true).map((change: any) => ({
        id: String(change.id || ""),
        path: String(change.path || ""),
        currentValue: change.currentValue,
        proposedValue: change.proposedValue,
        selected: true,
        confidence: typeof change.confidence === "number" ? change.confidence : undefined,
        explanation: typeof change.explanation === "string" ? change.explanation : undefined,
      }))
    : storedChanges.filter((change) => selectedPaths.has(String(change.path))).map((change) => ({
        id: stableRecipeProposalChangeId(proposal.id, String(change.path)),
        path: String(change.path),
        currentValue: change.before,
        proposedValue: raw.recipe ? getRecipeProposalPath(raw.recipe, String(change.path)) : change.after,
        selected: true,
        confidence: typeof change.confidence === "number" ? change.confidence : undefined,
        explanation: typeof change.reason === "string" ? change.reason : undefined,
      }));
  const selectedFieldPaths = selectedChanges.map((change) => change.path);
  const conflictResolutions = raw.conflictResolutions && typeof raw.conflictResolutions === "object"
    ? Object.fromEntries(Object.entries(raw.conflictResolutions).filter((entry): entry is [string, RecipeProposalConflictResolution] => entry[1] === "keep_current" || entry[1] === "use_proposed"))
    : {};

  console.info("[Recipe Copilot] Applying selected changes", {
    proposalId: proposal.id,
    recipeMode: proposal.recipeId ? "existing" : "new",
    selectedCount: selectedChanges.length,
    selectedPaths: selectedFieldPaths,
    formAvailable: Boolean(raw.currentRecipe),
    currentRecipeRevision: raw.currentRecipe?.updatedAt || null,
  });

  try {
    if (["REJECTED", "SUPERSEDED", "QUARANTINED"].includes(proposal.status)) {
      throw failure("AI_RECIPE_PROPOSAL_UNAVAILABLE", `A ${proposal.status.toLowerCase()} proposal cannot be applied.`, 409);
    }
    if (!proposal.proposedConfigurationJson) {
      throw failure("AI_RECIPE_PROPOSAL_NOT_FOUND", "This Recipe Copilot proposal is unavailable or has expired.", 404);
    }
    if (!proposal.previousConfigurationJson) {
      throw failure("AI_RECIPE_PROPOSAL_BASE_SNAPSHOT_MISSING", "The proposal does not contain an authoritative Recipe Studio base snapshot. Regenerate it before applying.", 409);
    }
    let base: Record<string, unknown>;
    try {
      base = canonicalRecipeDraftSnapshot(proposal.previousConfigurationJson);
    } catch {
      throw failure("AI_RECIPE_PROPOSAL_BASE_SNAPSHOT_INVALID", "The proposal base snapshot is invalid. Regenerate it before applying.", 409);
    }
    const storedBaseRevision = recipeFingerprint(proposal.previousConfigurationJson);
    if (raw.baseRevision && raw.baseRevision !== storedBaseRevision) {
      throw failure("AI_RECIPE_PROPOSAL_BASE_SNAPSHOT_INVALID", "The proposal revision does not match its authoritative base snapshot. Regenerate it before applying.", 409);
    }
    if (!raw.currentRecipe) throw failure("AI_RECIPE_PROPOSAL_FORM_UNAVAILABLE", "Recipe Studio is unavailable. Reopen the recipe and try again.", 409);
    if (selectedChanges.length === 0) throw failure("AI_RECIPE_PROPOSAL_NO_CHANGES_SELECTED", "Select at least one Recipe Copilot change.", 400);
    for (const change of selectedChanges) {
      const stored = storedByPath.get(change.path);
      if (!stored || change.id !== stableRecipeProposalChangeId(proposal.id, change.path)) {
        throw failure("AI_RECIPE_PROPOSAL_PATH_NOT_ALLOWED", `Unknown recipe field: ${change.path || "(missing path)"}`, 400);
      }
    }
    let current: Record<string, unknown>;
    try {
      current = canonicalRecipeDraftSnapshot(raw.currentRecipe);
    } catch (error) {
      const issue = error instanceof ZodError ? error.issues[0] : (error as any)?.issues?.[0] || null;
      const path = Array.isArray(issue?.path) ? issue.path.join(".") : String(issue?.path || "recipe");
      throw failure("AI_RECIPE_PROPOSAL_DRAFT_INVALID", `Recipe Studio has an invalid current value at ${path}. Correct it before applying the proposal.`, 422);
    }

    const conflicts = findRecipeProposalConflictDetails(base, current, selectedChanges);
    if (process.env.NODE_ENV !== "production") {
      for (const change of selectedChanges) {
        const baseValue = getRecipeProposalPath(base, change.path);
        const currentValue = getRecipeProposalPath(current, change.path);
        const proposedValue = normalizeLegacyProposalValue(change.path, change.proposedValue);
        const baseCanonical = canonicalRecipeValue(change.path, baseValue);
        const currentCanonical = canonicalRecipeValue(change.path, currentValue);
        const proposedCanonical = canonicalRecipeValue(change.path, proposedValue);
        const valueType = (value: unknown) => Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
        const stringDiagnostics = (value: unknown, original: unknown) => typeof value === "string" ? {
          characterLength: value.length,
          hasSurroundingJsonQuotes: hasSurroundingJsonQuotes(original),
          normalizationApplied: original !== value,
        } : undefined;
        console.debug("[Recipe Copilot] Conflict comparison", {
          proposalId: proposal.id,
          path: change.path,
          baseType: valueType(baseValue),
          currentType: valueType(currentValue),
          proposedType: valueType(change.proposedValue),
          baseCanonicalHash: recipeFingerprint(baseCanonical),
          currentCanonicalHash: recipeFingerprint(currentCanonical),
          proposedCanonicalHash: recipeFingerprint(proposedCanonical),
          baseEqualsCurrent: canonicalRecipeValueEqual(change.path, baseValue, currentValue),
          currentEqualsProposed: canonicalRecipeValueEqual(change.path, currentValue, proposedValue),
          conflict: conflicts.some((item) => item.path === change.path),
          baseString: stringDiagnostics(baseCanonical, baseValue),
          currentString: stringDiagnostics(currentCanonical, currentValue),
          proposedString: stringDiagnostics(proposedCanonical, change.proposedValue),
        });
      }
    }
    const unresolvedConflicts = conflicts.filter((conflict) => !conflictResolutions[conflict.path]);
    if (unresolvedConflicts.length > 0) {
      return {
        success: false,
        persisted: false,
        appliedCount: 0,
        alreadyAppliedCount: 0,
        conflictCount: unresolvedConflicts.length,
        appliedPaths: [],
        conflicts: unresolvedConflicts,
        errorCode: "AI_RECIPE_PROPOSAL_CONFLICT",
        errorMessage: "Some recipe fields changed after this proposal was created. Review the conflicting fields and choose whether to keep your edits or use the Recipe Copilot values.",
      };
    }

    const applicableChanges = selectedChanges.filter((change) => {
      const conflict = conflicts.some((item) => item.path === change.path);
      return !conflict || conflictResolutions[change.path] === "use_proposed";
    });
    const patched = applicableChanges.length > 0
      ? applyRecipeProposalChanges(current, applicableChanges)
      : {
          success: true as const,
          draft: current,
          appliedCount: 0,
          alreadyAppliedCount: 0,
          appliedPaths: [] as string[],
          alreadyAppliedPaths: [] as string[],
        };
    if (!patched.success) {
      const first = patched.failures[0];
      if (first.code === "AI_RECIPE_PROPOSAL_UNSUPPORTED_ENUM") {
        const change = selectedChanges.find((item) => item.path === first.path);
        console.warn("[Recipe Copilot] Unsupported proposal enum", {
          proposalId: proposal.id,
          path: first.path,
          receivedValue: change?.proposedValue,
          supportedValues: SCORING_MODELS,
          normalizationAttempted: false,
          repairAttempted: false,
        });
      }
      return {
        success: false,
        persisted: false,
        appliedCount: 0,
        alreadyAppliedCount: 0,
        conflictCount: 0,
        appliedPaths: [],
        validationIssues: [{
          path: first.path,
          code: first.code,
          message: first.message,
          ...(first.code === "AI_RECIPE_PROPOSAL_UNSUPPORTED_ENUM" ? {
            receivedValue: selectedChanges.find((item) => item.path === first.path)?.proposedValue,
            supportedValues: SCORING_MODELS,
          } : {}),
        }],
        errorCode: first.code,
        errorMessage: first.message,
        proposalSchemaValid: true,
        patchValid: false,
        draftSchemaValid: false,
        saveSemanticValidationValid: false,
        executionCompatibilityValid: false,
      };
    }
    const validation = validatePlaylistRecipeDraft(patched.draft);
    if (!validation.success) {
      const issue = validation.issues[0];
      if (issue?.code === "RECIPE_SCORING_MODEL_UNSUPPORTED") {
        console.warn("[Recipe Copilot] Unsupported proposal enum", {
          proposalId: proposal.id,
          path: issue.path,
          receivedValue: issue.receivedValue,
          supportedValues: issue.supportedValues,
          normalizationAttempted: false,
          repairAttempted: false,
        });
      }
      return {
        success: false,
        persisted: false,
        appliedCount: 0,
        alreadyAppliedCount: 0,
        conflictCount: 0,
        appliedPaths: [],
        validationIssues: validation.issues,
        errorCode: issue?.code === "RECIPE_SCORING_MODEL_UNSUPPORTED"
          ? "AI_RECIPE_PROPOSAL_UNSUPPORTED_ENUM"
          : "AI_RECIPE_PROPOSAL_DRAFT_INVALID",
        errorMessage: issue
          ? `Could not apply ${issue.path || selectedFieldPaths[0] || "recipe"}: ${issue.message}`
          : "The resulting recipe draft is invalid.",
        proposalSchemaValid: true,
        patchValid: true,
        draftSchemaValid: false,
        saveSemanticValidationValid: false,
        executionCompatibilityValid: false,
      };
    }

    const differs = selectedChanges.length !== storedChanges.length
      || selectedChanges.some((change) => !canonicalRecipeValueEqual(change.path, change.proposedValue, storedByPath.get(change.path)?.after))
      || conflicts.some((conflict) => conflictResolutions[conflict.path] === "keep_current");
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.aiRecipeProposal.update({
        where: { id: proposal.id },
        data: { appliedById: userId, appliedAt: new Date(), manuallyEdited: differs, differsFromAiProposal: differs },
      });
      await auditAiRecipe({
        requestId: proposal.requestId,
        proposalId: proposal.id,
        recipeId: proposal.recipeId,
        actorId: userId,
        eventType: "AI_RECIPE_PROPOSAL_APPLIED_TO_DRAFT",
        action: proposal.request.action,
        provider: proposal.request.providerDisplayName,
        model: proposal.request.model,
        privacyMode: proposal.request.privacyMode,
        remote: proposal.request.remote,
        statusBefore: proposal.status,
        statusAfter: proposal.status,
        metadata: {
          selectedPaths: selectedFieldPaths,
          appliedPaths: patched.appliedPaths,
          alreadyAppliedPaths: patched.alreadyAppliedPaths,
          appliedCount: patched.appliedCount,
          alreadyAppliedCount: patched.alreadyAppliedCount,
          conflictResolutions,
          manuallyEdited: differs,
          persisted: false,
        },
      }, tx);
      return row;
    });
    try {
      await recordRecommendationExplanationAudit(userId, proposal.id, "RECIPE_DIFF_APPROVED", {
        selectedPaths: selectedFieldPaths,
        appliedPaths: patched.appliedPaths,
        alreadyAppliedPaths: patched.alreadyAppliedPaths,
        conflictResolutions,
        persisted: false,
        manuallyEdited: differs,
      });
    } catch (auditError) {
      console.warn("[Recipe Copilot] Recommendation explanation audit failed", {
        proposalId: proposal.id,
        exceptionClass: auditError instanceof Error ? auditError.name : "Unknown",
      });
    }

    const draft = {
      ...raw.currentRecipe,
      ...validation.data,
      aiProposalId: proposal.id,
      aiRecipeStatus: proposal.status,
    };
    console.info("[Recipe Copilot] Selected changes applied", {
      proposalId: proposal.id,
      selectedCount: selectedChanges.length,
      appliedCount: patched.appliedCount,
      alreadyAppliedCount: patched.alreadyAppliedCount,
      conflictCount: 0,
      appliedPaths: patched.appliedPaths,
      dirtyAfterApply: patched.appliedCount > 0 || raw.dirty === true,
      proposalSchemaValid: true,
      patchValid: true,
      draftSchemaValid: true,
      saveSemanticValidationValid: true,
      executionCompatibilityValid: true,
      elapsedMs: Date.now() - startedAt,
    });
    return {
      proposal: publicProposal({ ...updated, request: proposal.request }),
      draft,
      persisted: false,
      success: true,
      appliedCount: patched.appliedCount,
      alreadyAppliedCount: patched.alreadyAppliedCount,
      conflictCount: 0,
      appliedPaths: patched.appliedPaths,
      alreadyAppliedPaths: patched.alreadyAppliedPaths,
      validationSucceeded: true,
      proposalSchemaValid: true,
      patchValid: true,
      draftSchemaValid: true,
      saveSemanticValidationValid: true,
      executionCompatibilityValid: true,
    };
  } catch (error) {
    const original = error as any;
    const value = original?.code
      ? original
      : failure("AI_RECIPE_PROPOSAL_APPLY_FAILED", "An unexpected error prevented Recipe Copilot from updating the draft. No recipe fields were changed.", 500);
    console.error("[Recipe Copilot] Failed to apply selected changes", {
      proposalId: proposal.id,
      selectedCount: selectedChanges.length,
      failedPaths: selectedFieldPaths,
      errorCode: String(value?.code || "AI_RECIPE_PROPOSAL_APPLY_FAILED"),
      exceptionClass: error instanceof Error ? error.name : "Unknown",
      sanitizedMessage: error instanceof Error ? error.message.slice(0, 500) : "Recipe proposal apply failed.",
      elapsedMs: Date.now() - startedAt,
    });
    throw value;
  }
}

export async function validateRecipeCopilotProposal(userId: string, proposalId: string) {
  const proposal = await ownedProposal(userId, proposalId);
  if (["REJECTED", "SUPERSEDED", "APPROVED"].includes(proposal.status)) throw failure("AI_RECIPE_PROPOSAL_FINAL", "This proposal can no longer be revalidated.", 409);
  const recipe = proposal.proposedConfigurationJson as Record<string, any> | null;
  if (!recipe) throw failure("AI_RECIPE_PROPOSAL_HAS_NO_RECIPE", "This advisory result does not contain a recipe proposal.", 409);
  const parsed = validatePlaylistRecipeDraft(recipe);
  const analysis = parsed.success ? await analyzeRecipeDraft(userId, parsed.data) : null;
  const errors = parsed.success ? (analysis?.compatibility?.findings || []).filter((item: any) => item.severity === "error") : parsed.issues;
  const warnings = parsed.success ? (analysis?.compatibility?.findings || []).filter((item: any) => item.severity === "warning") : [];
  const conflicts = detectRecipeIntentConflicts(proposal.request.sourceRequest, recipe, analysis?.candidateEstimate);
  const next = statusForProposal({ errors: errors.length, warnings: warnings.length, conflicts: conflicts.length, assumptions: ((proposal.analysisJson as any)?.assumptions || []).length, unsupported: (proposal.unsupportedRequestsJson as any[]).length, confidence: proposal.confidenceScore, unsafe: recipe.enabled !== false || recipe.automationPolicy?.enabled === true });
  assertAiRecipeStatusTransition(proposal.status as AiRecipeStatus, next);
  const validation = {
    proposalSchemaValid: true,
    patchValid: true,
    draftSchemaValid: parsed.success,
    saveSemanticValidationValid: parsed.success,
    executionCompatibilityValid: parsed.success,
    schema: { valid: parsed.success },
    recipe: { valid: errors.length === 0, errors },
    conflicts,
    finalStatus: next,
    validatedAt: new Date().toISOString(),
  };
  const updated = await prisma.aiRecipeProposal.update({ where: { id: proposal.id }, data: { status: next, validationJson: json(validation), candidateEstimateJson: analysis ? json(analysis.candidateEstimate) : undefined, compatibilityJson: analysis ? json(analysis.compatibility) : undefined, statusReason: next === "QUARANTINED" ? "Validation found a blocking issue." : null } });
  await auditAiRecipe({ requestId: proposal.requestId, proposalId: proposal.id, recipeId: proposal.recipeId, actorId: userId, eventType: "AI_RECIPE_VALIDATED", action: proposal.request.action, provider: proposal.request.providerDisplayName, model: proposal.request.model, privacyMode: proposal.request.privacyMode, remote: proposal.request.remote, statusBefore: proposal.status, statusAfter: next, metadata: validation });
  if (proposal.recipeId) await prisma.playlistRecipe.updateMany({ where: { id: proposal.recipeId, userId, lastAiProposalId: proposal.id }, data: { aiRecipeStatus: next, enabled: false, ...(next === "QUARANTINED" ? { quarantineState: "QUARANTINED", quarantineReason: "AI proposal validation found a blocking issue." } : {}) } });
  return publicProposal({ ...updated, request: proposal.request });
}

export async function changeRecipeCopilotProposalStatus(userId: string, proposalId: string, operation: "approve" | "reject" | "quarantine", raw: any = {}) {
  const permission: RecipeAiPermission = operation === "approve" ? "recipe.ai.approve" : operation === "quarantine" ? "recipe.ai.quarantine" : "recipe.ai.review";
  const proposal = await ownedProposal(userId, proposalId);
  await requireRecipeAiPermission(userId, permission, proposal.request.ownerId);
  const target = (operation === "approve" ? "APPROVED" : operation === "reject" ? "REJECTED" : "QUARANTINED") as AiRecipeStatus;
  if (operation === "approve" && raw.confirmation !== "I reviewed this AI-generated recipe and understand that its behavior may differ from the original request.") throw failure("AI_RECIPE_APPROVAL_CONFIRMATION_REQUIRED", "Enter the required review confirmation before approval.", 409);
  if (operation === "approve" && (!proposal.recipeId || !proposal.appliedAt || proposal.recipe?.lastAiProposalId !== proposal.id)) throw failure("AI_RECIPE_PROPOSAL_NOT_APPLIED", "Save or apply this validated proposal before approval.", 409);
  assertAiRecipeStatusTransition(proposal.status as AiRecipeStatus, target);
  const now = new Date();
  if (operation === "approve") await approveRecipe(userId, proposal.recipeId!, { mode: "approval_required", aiReviewConfirmation: raw.confirmation });
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.aiRecipeProposal.update({ where: { id: proposal.id }, data: { status: target, statusReason: String(raw.reason || (operation === "approve" ? "Explicitly approved after review." : operation === "reject" ? "Explicitly rejected." : "Quarantined by an authorized reviewer.")).slice(0, 1000), ...(operation === "approve" ? { approvedById: userId, approvedAt: now } : operation === "reject" ? { rejectedAt: now } : { quarantinedAt: now }) } });
    if (proposal.recipeId) await tx.playlistRecipe.updateMany({
      where: { id: proposal.recipeId, userId },
      data: operation === "approve"
        ? { aiRecipeStatus: "APPROVED", enabled: false }
        : operation === "reject"
          ? { aiRecipeStatus: "REJECTED", approvalState: "REJECTED", enabled: false }
          : { aiRecipeStatus: "QUARANTINED", approvalState: "QUARANTINED", quarantineState: "QUARANTINED", quarantineReason: String(raw.reason || "AI recipe proposal quarantined.").slice(0, 1000), enabled: false },
    });
    await auditAiRecipe({ requestId: proposal.requestId, proposalId: proposal.id, recipeId: proposal.recipeId, actorId: userId, eventType: operation === "approve" ? "RECIPE_APPROVED" : operation === "reject" ? "SUGGESTED_MODIFICATION_REJECTED" : "RECIPE_QUARANTINED", action: proposal.request.action, provider: proposal.request.providerDisplayName, model: proposal.request.model, privacyMode: proposal.request.privacyMode, remote: proposal.request.remote, statusBefore: proposal.status, statusAfter: target, reason: raw.reason || null }, tx);
    await tx.aiApprovalEvent.create({ data: { requestId: proposal.requestId, artifactType: "AI_RECIPE_PROPOSAL", artifactId: proposal.id, reviewerId: userId, decision: target, reviewNotes: String(raw.reason || raw.confirmation || "").slice(0, 2000) || null, artifactHash: recipeFingerprint(proposal.proposedConfigurationJson || proposal.originalProposalJson), validationState: String((proposal.validationJson as any)?.recipe?.valid === false ? "FAILED" : "PASSED"), safetyState: proposal.status === "QUARANTINED" || target === "QUARANTINED" ? "BLOCKED" : "REVIEWED", diffJson: json(proposal.changesJson || []), executionMode: operation === "approve" ? "HUMAN_REVIEW" : "HUMAN_DECISION" } });
    return result;
  });
  if (proposal.recipeId) await writeRecipeAudit({ recipeId: proposal.recipeId, recipeVersion: proposal.recipe?.recipeVersion, eventType: `AI_RECIPE_${target}`, actorId: userId, correlationId: proposal.requestId, description: `AI recipe proposal ${target.toLowerCase()}. The recipe remains inactive.`, previousState: { aiRecipeStatus: proposal.status }, newState: { aiRecipeStatus: target, enabled: false }, metadata: { reason: raw.reason || null, automaticActivation: false } });
  return publicProposal({ ...updated, request: proposal.request });
}

export async function restoreRecipeBeforeAiProposal(userId: string, proposalId: string) {
  const proposal = await ownedProposal(userId, proposalId);
  if (!proposal.recipeId || !proposal.previousConfigurationJson) throw failure("AI_RECIPE_ROLLBACK_UNAVAILABLE", "No saved recipe state is available for this proposal.", 409);
  const existing = await ownedRecipe(userId, proposal.recipeId);
  const previous = playlistRecipeSchema.parse(proposal.previousConfigurationJson);
  const update = updatePlaylistRecipeData({ ...previous, enabled: false }, existing) as any;
  const recipe = await prisma.$transaction(async (tx) => {
    const row = await tx.playlistRecipe.update({ where: { id: existing.id }, data: { ...update, enabled: false, approvalState: "PENDING_REVIEW", aiRecipeStatus: "SUPERSEDED", lastAiProposalId: null, manuallyEditedAfterAi: true } });
    await tx.aiRecipeProposal.update({ where: { id: proposal.id }, data: { status: "SUPERSEDED", supersededAt: new Date(), statusReason: "The pre-AI recipe state was restored." } });
    await auditAiRecipe({ requestId: proposal.requestId, proposalId: proposal.id, recipeId: existing.id, actorId: userId, eventType: "RECIPE_RESTORED", action: proposal.request.action, provider: proposal.request.providerDisplayName, model: proposal.request.model, privacyMode: proposal.request.privacyMode, remote: proposal.request.remote, statusBefore: proposal.status, statusAfter: "SUPERSEDED", metadata: { restoredFromVersion: proposal.previousRecipeVersion, newVersion: row.recipeVersion } }, tx);
    return row;
  });
  await writeRecipeAudit({ recipeId: recipe.id, recipeVersion: recipe.recipeVersion, eventType: "AI_RECIPE_RESTORED", actorId: userId, correlationId: proposal.requestId, description: "Restored the pre-AI recipe configuration as a new disabled revision.", previousState: { recipeVersion: existing.recipeVersion }, newState: { recipeVersion: recipe.recipeVersion, enabled: false } });
  return { recipe: parsePlaylistRecipe(recipe), proposalId, restoredFromVersion: proposal.previousRecipeVersion };
}

export async function listRecipeCopilotHistory(userId: string, recipeId?: string | null, page = 1, pageSize = 25) {
  await requireRecipeAiPermission(userId, "recipe.ai.view_history");
  if (recipeId) await ownedRecipe(userId, recipeId);
  const where = { request: { ownerId: userId }, ...(recipeId ? { recipeId } : {}) };
  const [rows, total] = await Promise.all([prisma.aiRecipeProposal.findMany({ where, include: { request: true }, orderBy: { createdAt: "desc" }, skip: (Math.max(1, page) - 1) * Math.min(100, pageSize), take: Math.min(100, pageSize) }), prisma.aiRecipeProposal.count({ where })]);
  return { proposals: rows.map(publicProposal), pagination: { page: Math.max(1, page), pageSize: Math.min(100, pageSize), total, totalPages: Math.ceil(total / Math.min(100, pageSize)) } };
}

export async function getRecipeCopilotRequest(userId: string, requestId: string) {
  const row = await prisma.aiRecipeRequest.findUnique({ where: { id: requestId }, include: { proposal: true } });
  if (!row) throw failure("AI_RECIPE_REQUEST_NOT_FOUND", "AI recipe request not found.", 404);
  await requireRecipeAiPermission(userId, "recipe.ai.view_history", row.ownerId);
  return { request: row, proposal: row.proposal ? publicProposal({ ...row.proposal, request: row }) : null };
}
