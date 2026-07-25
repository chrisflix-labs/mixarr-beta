import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { isUserAdmin } from "../auth";
import { requireAiPermission } from "../../ai/governance/permissions";
import { analyzeRecipeDraft } from "../recipeStudioService";
import { defaultRecipeStudioDraft } from "../recipeStudio";
import { parsePlaylistRecipe, playlistRecipeSchema, updatePlaylistRecipeData } from "../playlistRecipes";
import { approveRecipe, writeRecipeAudit } from "../mixRecipes/governanceService";
import { createExplanationFromRecipeProposal, recordRecommendationExplanationAudit } from "../recommendationExplanations/service";
import { aiRequestCoordinator } from "@/ai/request-coordinator";
import { previewAiRequest } from "@/ai/governance/service";
import { assertAiExecutionPolicy } from "@/ai/governance/executionPolicy";
import { resolveAiProvider } from "@/ai/services/providerService";
import { AiError } from "@/ai/errors";
import { describeRequestLimitFromDetails } from "@/ai/governance/requestLimits";
import { describeCostLimitFromDetails } from "@/ai/governance/costLimits";
import { recipeCopilotSettingsUrl } from "./readiness";
import { RECIPE_COPILOT_SYSTEM_PROMPT, recipeCopilotUserPrompt } from "@/ai/recipeCopilot/prompts";
import {
  AI_RECIPE_STATUSES, RECIPE_COPILOT_FEATURE_KEY, RECIPE_COPILOT_PROMPT_VERSION,
  recipeCopilotRequestSchema, recipeCopilotResponseSchema, type AiRecipeStatus,
} from "./contracts";
import {
  assertAiRecipeStatusTransition, buildPrivacyAwareRecipeContext, deriveRecipePurpose,
  detectRecipeIntentConflicts, isStaleRecipeResult, localSafetyRecommendations,
  logicalRecipeChanges, mergeRecipeCopilotPatch, recipeFingerprint, recommendBuiltInParents,
  statusForProposal,
} from "./core";

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
    const request = { featureKey: RECIPE_COPILOT_FEATURE_KEY, systemInstructions: RECIPE_COPILOT_SYSTEM_PROMPT, messages: [{ role: "user" as const, content: recipeCopilotUserPrompt({ action: input.action || "create", instruction: input.instruction || "", purpose: input.purpose, context: context.recipe }) }], responseFormat: { type: "json" as const, name: "mixarr_recipe_copilot", schema: recipeCopilotResponseSchema, unknownFields: "reject" as const }, privacyMode: privacyMode as any, maxOutputTokens: 4000, requestSource: "FOREGROUND" as const, allowFallback: false, requiredCapabilities: ["structured_json" as const], externalConfirmation: true };
    await assertAiExecutionPolicy({ request, provider, model, requiredCapabilities: ["chat_messages", "structured_json"] });
    const preview = await previewAiRequest({ request, provider, model, userId });
    const dailyRequests = preview.remainingBudgets?.dailyRequests;
    return { available: true as const, providerId, providerName: providerRow.displayName, modelId: model, modelName: modelRow.displayName, privacyMode: preview.privacyMode, remoteOperationAllowed: preview.provider.location !== "LOCAL", blockedReasonCode: null, blockedReasonMessage: null, canConfigure: permission.admin, settingsUrl: permission.admin ? "/settings/ai" : null, dailyRequestLimit: { effectiveMode: dailyRequests?.effective?.effectiveMode || "UNLIMITED", scope: dailyRequests?.effective?.scope || null, limit: dailyRequests?.limit ?? null, usage: dailyRequests?.usage ?? null, remaining: dailyRequests?.remaining ?? null, resetAt: dailyRequests?.resetAt ?? null }, provider: providerRow.displayName, model, local: preview.provider.location === "LOCAL", estimatedInputTokens: preview.limits.estimatedInputTokens, maximumOutputTokens: preview.limits.maxOutputTokens, estimatedCost: preview.cost.expectedEstimatedCost, maximumEstimatedCost: preview.cost.maximumEstimatedCost, currency: preview.cost.currency, costDecision: preview.costDecision, contextSummary: { blockedFields: context.blockedFields, recipeIncluded: !!input.recipe, trackLevelLibraryMetadata: false }, previewRequired: preview.privacyMode === "FULL_METADATA" || preview.provider.location !== "LOCAL", warnings: [] as string[] };
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
  const input = recipeCopilotRequestSchema.parse(raw);
  await requireRecipeAiPermission(userId, permissionForAction(input.action));
  if (["create", "refine", "optimize", "compare_intent"].includes(input.action) && !input.instruction.trim()) throw failure("INSTRUCTION_REQUIRED", "Describe the recipe behavior or change you want.");
  const stored = recipeId ? await ownedRecipe(userId, recipeId) : null;
  const savedDraft = stored ? parsePlaylistRecipe(stored) : null;
  const source = playlistRecipeSchema.parse(input.recipe || savedDraft || defaultRecipeStudioDraft());
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
      responseFormat: { type: "json", name: "mixarr_recipe_copilot", schema: recipeCopilotResponseSchema, unknownFields: "reject" },
      privacyMode: availability.privacyMode as any, maxOutputTokens: 4000, maxResponseBytes: 512_000,
      temperature: 0.1, requestSource: "FOREGROUND", allowFallback: false, requiredCapabilities: ["structured_json"],
      contextTrimmingStrategy: "REMOVE_LOWEST_PRIORITY", signal,
      externalConfirmation: input.externalConfirmation, idempotencyKey: input.idempotencyKey,
      promptTemplateVersion: RECIPE_COPILOT_PROMPT_VERSION,
      metadata: { workflow: "recipe_copilot", action: input.action, advisory_only: true, automatic_activation: false },
    }, userId);
    const output = recipeCopilotResponseSchema.parse(response.data);
    if (output.action !== input.action) throw failure("AI_ACTION_MISMATCH", "The provider returned a different Recipe Copilot action.", 422);
    const readOnly = new Set(["explain", "diagnose", "compare_intent", "suggest_names", "onboarding"]);
    if (readOnly.has(input.action) && output.proposedPatch) throw failure("READ_ONLY_ACTION_MODIFIED_RECIPE", "A read-only Copilot action attempted to modify the recipe.", 422);
    const proposed = output.proposedPatch ? mergeRecipeCopilotPatch(source, output.proposedPatch) : null;
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
    const validation = { schema: { valid: true, version: "1.0" }, recipe: { valid: errors.length === 0, errors }, safety: { valid: !unsafe, warnings: safety }, conflicts: combinedConflicts, finalStatus: status, validatedAt: new Date().toISOString() };
    const proposal = await prisma.aiRecipeProposal.create({ data: { requestId: requestRow.id, recipeId: stored?.id, status, schemaVersion: "1.0", originalProposalJson: json(output), proposedConfigurationJson: proposed ? json(proposed) : undefined, analysisJson: json({ ...output.analysis, warnings, explanation: output.explanation, diagnoses: output.diagnoses, behaviorComparison: output.behaviorComparison, nameSuggestions: output.nameSuggestions, onboarding: output.onboarding, presumedPurpose: deriveRecipePurpose(source) }), intentJson: json({ ...output.intent, conflicts: combinedConflicts }), recommendationsJson: json(recommendations), changesJson: json(changes), validationJson: json(validation), candidateEstimateJson: json(proposedAnalysis.candidateEstimate), compatibilityJson: json(proposedAnalysis.compatibility), safetyWarningsJson: json([...warnings, ...safety.map((item) => item.reason)]), unsupportedRequestsJson: json(output.analysis.unsupportedRequests), confidenceScore: output.analysis.confidence, previousConfigurationJson: json(source), previousRecipeVersion: stored?.recipeVersion } });
    await prisma.aiRecipeRequest.update({ where: { id: requestRow.id }, data: { status: "READY_FOR_REVIEW", providerConfigId: response.providerId, model: response.model, inputTokenCount: response.usage?.inputTokens, outputTokenCount: response.usage?.outputTokens, estimatedCost: response.estimatedCost, actualCost: response.actualCost, aiResponseIdentifier: response.usage?.providerRequestId, completedAt: new Date() } });
    await createExplanationFromRecipeProposal({ ownerId: userId, requestId: requestRow.id, proposalId: proposal.id, recipeId: stored?.id, recipeVersion: stored?.recipeVersion, originalRequest: input.instruction, intent: { ...output.intent, conflicts: combinedConflicts }, analysis: { ...output.analysis, warnings }, proposedConfiguration: proposed || source, previousConfiguration: source, changes, validation, compatibility: proposedAnalysis.compatibility, provider: availability.provider, model: response.model, privacyMode: availability.privacyMode, engineVersion: "v2", recipeSchemaVersion: String(stored?.schemaVersion || "current"), cost: response.actualCost ?? response.estimatedCost, createdAt: requestRow.createdAt });
    await auditAiRecipe({ requestId: requestRow.id, proposalId: proposal.id, recipeId: stored?.id, actorId: userId, eventType: "AI_REQUEST_COMPLETED", action: input.action, provider: availability.provider, model: response.model, privacyMode: availability.privacyMode, remote: !availability.local, statusAfter: status, estimatedCost: response.estimatedCost, actualCost: response.actualCost, inputTokens: response.usage?.inputTokens, outputTokens: response.usage?.outputTokens, metadata: { changes: changes.length, warnings: warnings.length, conflicts: combinedConflicts.length } }).catch(() => null);
    await auditAiRecipe({ requestId: requestRow.id, proposalId: proposal.id, recipeId: stored?.id, actorId: userId, eventType: "GENERATED_DRAFT_CREATED", action: input.action, provider: availability.provider, model: response.model, privacyMode: availability.privacyMode, remote: !availability.local, statusAfter: status }).catch(() => null);
    if (stored) await writeRecipeAudit({ recipeId: stored.id, recipeVersion: stored.recipeVersion, eventType: "AI_RECIPE_PROPOSAL_CREATED", actorId: userId, correlationId: requestRow.id, description: `Recipe Copilot ${input.action} proposal is ready for review.`, validation, newState: { aiRecipeStatus: status, proposalId: proposal.id }, metadata: { changes: changes.length, automaticActivation: false } }).catch(() => null);
    return publicProposal(await prisma.aiRecipeProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { request: true } }));
  } catch (error) {
    const value = error as any;
    await prisma.aiRecipeRequest.update({ where: { id: requestRow.id }, data: { status: value?.category === "REQUEST_CANCELLED" ? "CANCELLED" : "FAILED", errorCategory: String(value?.category || value?.code || "AI_RECIPE_REQUEST_FAILED"), errorMessage: (error instanceof Error ? error.message : "Recipe Copilot request failed.").slice(0, 1000), ...(value?.category === "REQUEST_CANCELLED" ? { cancelledAt: new Date() } : {}), completedAt: new Date() } }).catch(() => null);
    await auditAiRecipe({ requestId: requestRow.id, recipeId: stored?.id, actorId: userId, eventType: value?.category === "REQUEST_CANCELLED" ? "AI_REQUEST_CANCELLED" : "AI_REQUEST_FAILED", action: input.action, provider: availability.provider, model: availability.model, privacyMode: availability.privacyMode, remote: !availability.local, statusAfter: value?.category === "REQUEST_CANCELLED" ? "CANCELLED" : "FAILED", reason: String(value?.category || value?.code || "FAILED") }).catch(() => null);
    if (stored) await writeRecipeAudit({ recipeId: stored.id, recipeVersion: stored.recipeVersion, eventType: "AI_RECIPE_REQUEST_FAILED", actorId: userId, correlationId: requestRow.id, description: "Recipe Copilot request failed without changing the recipe.", result: "FAILED", metadata: { errorCategory: String(value?.category || value?.code || "FAILED") } }).catch(() => null);
    throw error;
  }
}

function getPath(value: any, path: string) { return path.split(".").reduce((current, part) => current?.[part], value); }
function setPath(value: any, path: string, next: unknown) { const parts = path.split("."); let current = value; parts.slice(0, -1).forEach((part) => { if (!current[part] || typeof current[part] !== "object") current[part] = {}; current = current[part]; }); current[parts.at(-1)!] = clone(next); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

export async function applyRecipeCopilotProposal(userId: string, proposalId: string, raw: any = {}) {
  const proposal = await ownedProposal(userId, proposalId);
  if (["REJECTED", "SUPERSEDED", "QUARANTINED"].includes(proposal.status)) throw failure("AI_RECIPE_PROPOSAL_NOT_APPLICABLE", `A ${proposal.status.toLowerCase()} proposal cannot be applied.`, 409);
  if (!proposal.proposedConfigurationJson) throw failure("AI_RECIPE_PROPOSAL_HAS_NO_CHANGES", "This Copilot result is advisory and has no recipe changes.", 409);
  if (proposal.recipe && isStaleRecipeResult(proposal.request.sourceUpdatedAt, proposal.recipe.updatedAt)) throw failure("AI_RECIPE_RESULT_STALE", "The recipe changed while the AI request was running. Review the current recipe and generate a new proposal.", 409);
  if (raw.currentRecipe) {
    const current = playlistRecipeSchema.parse(raw.currentRecipe);
    if (JSON.stringify(current) !== JSON.stringify(proposal.previousConfigurationJson)) throw failure("AI_RECIPE_RESULT_STALE", "The unsaved recipe changed after this AI request began. Compare the proposal with the current draft before applying it.", 409);
  }
  const original = clone(proposal.originalProposalJson as any);
  let next = raw.recipe ? playlistRecipeSchema.parse(raw.recipe) : clone(proposal.proposedConfigurationJson as any);
  if (Array.isArray(raw.selectedPaths)) {
    const base = clone(proposal.previousConfigurationJson as any);
    const allowed = new Set((proposal.changesJson as any[]).map((item) => item.path));
    for (const path of raw.selectedPaths.filter((item: unknown) => typeof item === "string" && allowed.has(item as string))) setPath(base, path as string, getPath(next, path as string));
    next = playlistRecipeSchema.parse(base);
  }
  next = playlistRecipeSchema.parse({ ...next, enabled: false, automationPolicy: { ...next.automationPolicy, enabled: false, requireExplicitConfirmation: true } });
  const differs = JSON.stringify(next) !== JSON.stringify(proposal.proposedConfigurationJson);
  if (!proposal.recipeId) {
    const updated = await prisma.aiRecipeProposal.update({ where: { id: proposal.id }, data: { appliedById: userId, appliedAt: new Date(), manuallyEdited: differs, differsFromAiProposal: differs } });
    await auditAiRecipe({ requestId: proposal.requestId, proposalId: proposal.id, actorId: userId, eventType: "AI_RECIPE_PROPOSAL_APPLIED_TO_DRAFT", action: proposal.request.action, provider: proposal.request.providerDisplayName, model: proposal.request.model, privacyMode: proposal.request.privacyMode, remote: proposal.request.remote, statusBefore: proposal.status, statusAfter: proposal.status, metadata: { selectedPaths: raw.selectedPaths || null, manuallyEdited: differs, persisted: false } });
    await recordRecommendationExplanationAudit(userId, proposal.id, "RECIPE_DIFF_APPROVED", { selectedPaths: raw.selectedPaths || null, persisted: false, manuallyEdited: differs }).catch(() => null);
    return { proposal: publicProposal({ ...updated, request: proposal.request }), draft: { ...next, aiProposalId: proposal.id, aiRecipeStatus: proposal.status, aiProvenance: { originalRequest: proposal.request.sourceRequest, originalProposal: original, provider: proposal.request.providerDisplayName, model: proposal.request.model, createdAt: proposal.createdAt, promptTemplateVersion: proposal.request.promptTemplateVersion } }, persisted: false };
  }
  const existing = await ownedRecipe(userId, proposal.recipeId);
  const update = updatePlaylistRecipeData(next, existing) as any;
  const changes = proposal.changesJson as any[];
  const updated = await prisma.$transaction(async (tx) => {
    const recipe = await tx.playlistRecipe.update({ where: { id: existing.id }, data: { ...update, enabled: false, approvalState: "PENDING_REVIEW", approvedById: null, approvedAt: null, aiGenerated: true, aiRecipeStatus: proposal.status, lastAiProposalId: proposal.id, manuallyEditedAfterAi: differs, aiProvenanceJson: json({ originalRequest: proposal.request.sourceRequest, originalProposal: original, action: proposal.request.action, provider: proposal.request.providerDisplayName, model: proposal.request.model, createdAt: proposal.createdAt, lastAiModificationAt: new Date(), confidence: proposal.confidenceScore, assumptions: (proposal.analysisJson as any)?.assumptions || [], warnings: proposal.safetyWarningsJson, unsupportedRequests: proposal.unsupportedRequestsJson, candidateEstimate: proposal.candidateEstimateJson, compatibility: proposal.compatibilityJson, promptTemplateVersion: proposal.request.promptTemplateVersion, aiResponseIdentifier: proposal.request.aiResponseIdentifier, initiatedBy: proposal.request.ownerId, manuallyEdited: differs, differsFromAiProposal: differs, previousRecipeVersion: existing.recipeVersion }) } });
    await tx.playlistRecipeRevision.updateMany({ where: { recipeId: existing.id, recipeVersion: recipe.recipeVersion }, data: { aiRequestId: proposal.requestId, aiProposalId: proposal.id, structuredDiffJson: json(changes) } });
    await tx.aiRecipeProposal.update({ where: { id: proposal.id }, data: { appliedById: userId, appliedAt: new Date(), manuallyEdited: differs, differsFromAiProposal: differs } });
    await tx.aiRecipeProposal.updateMany({ where: { recipeId: existing.id, id: { not: proposal.id }, status: { in: ["DRAFT", "NEEDS_REVIEW", "VALIDATED", "APPROVED"] } }, data: { status: "SUPERSEDED", supersededAt: new Date(), statusReason: "Replaced by a newer applied AI proposal." } });
    await auditAiRecipe({ requestId: proposal.requestId, proposalId: proposal.id, recipeId: existing.id, actorId: userId, eventType: "SUGGESTED_MODIFICATION_APPLIED", action: proposal.request.action, provider: proposal.request.providerDisplayName, model: proposal.request.model, privacyMode: proposal.request.privacyMode, remote: proposal.request.remote, statusBefore: proposal.status, statusAfter: proposal.status, metadata: { selectedPaths: raw.selectedPaths || null, manuallyEdited: differs, recipeVersion: recipe.recipeVersion } }, tx);
    return recipe;
  });
  await writeRecipeAudit({ recipeId: updated.id, recipeVersion: updated.recipeVersion, eventType: "AI_RECIPE_PROPOSAL_APPLIED", actorId: userId, correlationId: proposal.requestId, description: `Applied ${raw.selectedPaths?.length ?? changes.length} reviewed AI recipe change(s); the recipe remains disabled pending normal approval and activation.`, previousState: { recipeVersion: existing.recipeVersion }, newState: { recipeVersion: updated.recipeVersion, aiRecipeStatus: proposal.status, enabled: false }, metadata: { proposalId: proposal.id, selectedPaths: raw.selectedPaths || null, manuallyEdited: differs, automaticActivation: false } });
  await recordRecommendationExplanationAudit(userId, proposal.id, "RECIPE_DIFF_APPROVED", { selectedPaths: raw.selectedPaths || null, persisted: true, recipeVersion: updated.recipeVersion, manuallyEdited: differs }).catch(() => null);
  return { proposal: publicProposal(await prisma.aiRecipeProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { request: true } })), recipe: parsePlaylistRecipe(updated), persisted: true };
}

export async function validateRecipeCopilotProposal(userId: string, proposalId: string) {
  const proposal = await ownedProposal(userId, proposalId);
  if (["REJECTED", "SUPERSEDED", "APPROVED"].includes(proposal.status)) throw failure("AI_RECIPE_PROPOSAL_FINAL", "This proposal can no longer be revalidated.", 409);
  const recipe = proposal.proposedConfigurationJson as Record<string, any> | null;
  if (!recipe) throw failure("AI_RECIPE_PROPOSAL_HAS_NO_RECIPE", "This advisory result does not contain a recipe proposal.", 409);
  const parsed = playlistRecipeSchema.safeParse(recipe);
  const analysis = parsed.success ? await analyzeRecipeDraft(userId, parsed.data) : null;
  const errors = parsed.success ? (analysis?.compatibility?.findings || []).filter((item: any) => item.severity === "error") : parsed.error.issues;
  const warnings = parsed.success ? (analysis?.compatibility?.findings || []).filter((item: any) => item.severity === "warning") : [];
  const conflicts = detectRecipeIntentConflicts(proposal.request.sourceRequest, recipe, analysis?.candidateEstimate);
  const next = statusForProposal({ errors: errors.length, warnings: warnings.length, conflicts: conflicts.length, assumptions: ((proposal.analysisJson as any)?.assumptions || []).length, unsupported: (proposal.unsupportedRequestsJson as any[]).length, confidence: proposal.confidenceScore, unsafe: recipe.enabled !== false || recipe.automationPolicy?.enabled === true });
  assertAiRecipeStatusTransition(proposal.status as AiRecipeStatus, next);
  const validation = { schema: { valid: parsed.success }, recipe: { valid: errors.length === 0, errors }, conflicts, finalStatus: next, validatedAt: new Date().toISOString() };
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
