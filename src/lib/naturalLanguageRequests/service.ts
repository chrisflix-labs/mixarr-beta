import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { isUserAdmin } from "../auth";
import { analyzeRecipeDraft } from "../recipeStudioService";
import { compareRecipeDocuments } from "../recipeStudio";
import { createPlaylistRecipeData, parsePlaylistRecipe, playlistRecipeSchema } from "../playlistRecipes";
import { createPlaylistFromRecipe } from "../mixRecipes/service";
import { resolveRecipeGenerationConfig, mixRecipeDocumentSchema, type MixRecipeDocument } from "../mixRecipes/schema";
import { validateRecipe } from "../mixRecipes/validation";
import { previewPlaylistTracks } from "../playlistService";
import { writeRecipeAudit } from "../mixRecipes/governanceService";
import { previewAiRequest } from "@/ai/governance/service";
import { resolveAiProvider } from "@/ai/services/providerService";
import { ambiguityResolutionSchema, createNaturalLanguageRequestSchema, naturalLanguageInterpretationSchema, revisionRequestSchema, type NaturalLanguageInterpretation } from "./contracts";
import { interpretNaturalLanguage, interpretationRequiresClarification } from "./interpreter";

export const NATURAL_LANGUAGE_PERMISSIONS = [
  "SUBMIT_NATURAL_LANGUAGE_REQUESTS", "VIEW_PERSONAL_REQUESTS", "VIEW_HOUSEHOLD_REQUESTS",
  "EDIT_REQUEST_INTERPRETATIONS", "APPROVE_PERSONAL_REQUESTS", "APPROVE_OTHER_USERS_REQUESTS",
  "EXECUTE_APPROVED_RECIPES", "VIEW_AI_COST_INFORMATION", "VIEW_PROVIDER_DETAILS",
  "VIEW_AI_AUDIT_HISTORY", "MANAGE_NATURAL_LANGUAGE_DEFAULTS",
] as const;
export type NaturalLanguagePermission = typeof NATURAL_LANGUAGE_PERMISSIONS[number];

const terminalStatuses = new Set(["COMPLETED", "CANCELLED", "EXPIRED"]);
const transitions: Record<string, string[]> = {
  DRAFT: ["ANALYZING", "CANCELLED", "EXPIRED"], ANALYZING: ["NEEDS_REVIEW", "NEEDS_CLARIFICATION", "READY_FOR_APPROVAL", "FAILED", "CANCELLED"],
  NEEDS_REVIEW: ["ANALYZING", "NEEDS_CLARIFICATION", "READY_FOR_APPROVAL", "CANCELLED", "EXPIRED"], NEEDS_CLARIFICATION: ["ANALYZING", "NEEDS_REVIEW", "READY_FOR_APPROVAL", "CANCELLED", "EXPIRED"],
  READY_FOR_APPROVAL: ["ANALYZING", "NEEDS_REVIEW", "APPROVED", "CANCELLED", "EXPIRED"], APPROVED: ["ANALYZING", "NEEDS_REVIEW", "EXECUTING", "COMPLETED", "CANCELLED"],
  EXECUTING: ["COMPLETED", "FAILED"], FAILED: ["ANALYZING", "NEEDS_REVIEW", "CANCELLED"],
};

function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }
function safeJson<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)); }
function requestError(code: string, message: string, status = 400) { return Object.assign(new Error(message), { code, status }); }
function hashPrompt(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function audit(requestId: string, actorId: string | null, revision: number, action: string, details?: unknown, result = "SUCCESS", tx: Prisma.TransactionClient | typeof prisma = prisma) {
  return tx.naturalLanguageRequestAudit.create({ data: { requestId, actorId, revision, action, result, detailsJson: details == null ? undefined : json(safeJson(details)) } });
}

export async function requireNaturalLanguagePermission(userId: string, permission: NaturalLanguagePermission, ownerId?: string) {
  if (!userId) throw requestError("UNAUTHORIZED", "Unauthorized", 401);
  const admin = await isUserAdmin(userId);
  const personal = !ownerId || ownerId === userId;
  const adminOnly = new Set<NaturalLanguagePermission>(["VIEW_HOUSEHOLD_REQUESTS", "APPROVE_OTHER_USERS_REQUESTS", "VIEW_AI_AUDIT_HISTORY", "MANAGE_NATURAL_LANGUAGE_DEFAULTS"]);
  if (adminOnly.has(permission) && !admin) throw requestError("PERMISSION_DENIED", "Administrator permission is required.", 403);
  if (!personal && !admin) throw requestError("PERMISSION_DENIED", "This request is not accessible to the current user.", 403);
  return { userId, admin, personal };
}

async function ownedRequest(userId: string, requestId: string, includeHistory = false) {
  const row = await prisma.naturalLanguageRequest.findUnique({ where: { id: requestId }, include: { finalRecipe: true, ...(includeHistory ? { revisions: { orderBy: { revision: "desc" as const } }, auditEvents: { orderBy: { createdAt: "desc" as const }, take: 100 } } : {}) } });
  if (!row) throw requestError("REQUEST_NOT_FOUND", "Natural-language request not found.", 404);
  await requireNaturalLanguagePermission(userId, "VIEW_PERSONAL_REQUESTS", row.ownerId);
  return row;
}

function assertTransition(from: string, to: string) {
  if (from === to) return;
  if (!transitions[from]?.includes(to)) throw requestError("INVALID_STATUS_TRANSITION", `Request cannot move from ${from} to ${to}.`, 409);
}

function unresolvedBlocking(interpretation: NaturalLanguageInterpretation) {
  return interpretation.ambiguities.filter((item) => item.requiresConfirmation && !item.resolution);
}

function publicRequest(row: any) {
  const interpretation = row.interpretationJson ? naturalLanguageInterpretationSchema.parse(row.interpretationJson) : null;
  return {
    ...row,
    originalRequest: row.originalRequestRetained ? row.originalRequest : null,
    interpretation,
    draftRecipe: row.draftRecipeJson || null,
    validation: row.validationJson || null,
    candidateEstimate: row.candidateEstimateJson || null,
    compatibility: row.compatibilityJson || null,
    preview: row.previewJson || null,
    blockingAmbiguities: interpretation ? unresolvedBlocking(interpretation).length + interpretation.assumptions.filter((item) => item.blocking && !item.accepted).length : 0,
    approvalCurrent: row.approvedAt != null && row.approvalRevision === row.currentRevision,
    analysisStale: row.analysisRevision !== row.currentRevision,
    previewStale: row.previewRevision !== row.currentRevision,
    originalRequestHash: undefined, interpretationJson: undefined, draftRecipeJson: undefined, validationJson: undefined,
    candidateEstimateJson: undefined, compatibilityJson: undefined, previewJson: undefined,
  };
}

export async function listNaturalLanguageRequests(userId: string, options: { status?: string; page?: number; pageSize?: number } = {}) {
  await requireNaturalLanguagePermission(userId, "VIEW_PERSONAL_REQUESTS", userId);
  const page = Math.max(1, options.page || 1), pageSize = Math.min(100, Math.max(1, options.pageSize || 25));
  const where = { ownerId: userId, ...(options.status ? { status: options.status } : {}) };
  const [rows, total] = await Promise.all([prisma.naturalLanguageRequest.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.naturalLanguageRequest.count({ where })]);
  return { requests: rows.map(publicRequest), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export async function previewNaturalLanguageRequest(userId: string, raw: unknown) {
  await requireNaturalLanguagePermission(userId, "SUBMIT_NATURAL_LANGUAGE_REQUESTS", userId);
  const input = createNaturalLanguageRequestSchema.parse(raw);
  const [global, feature, governance] = await Promise.all([
    prisma.aiGlobalSetting.findUnique({ where: { id: "global" } }),
    prisma.aiFeatureSetting.findUnique({ where: { featureKey: "natural_language_playlist_requests" } }),
    prisma.aiGovernanceSetting.findUnique({ where: { id: "global" } }),
  ]);
  if (!global?.enabled) throw requestError("AI_DISABLED", "AI is disabled in Mixarr settings.", 409);
  if (!feature?.enabled) throw requestError("FEATURE_DISABLED", "Natural-language playlist requests are disabled.", 409);
  const providerId = feature.preferredProviderId || global.defaultProviderId;
  if (!providerId) throw requestError("PROVIDER_NOT_CONFIGURED", "No AI provider is configured for this feature.", 409);
  const provider = await resolveAiProvider(providerId), model = feature.preferredModel || provider.defaultModel;
  if (!model) throw requestError("MODEL_NOT_CONFIGURED", "No model is configured for this feature.", 409);
  const privacyMode = input.privacyMode || governance?.privacyMode || "METADATA_LIMITED";
  const preview = await previewAiRequest({ request: { featureKey: "natural_language_playlist_requests", messages: [{ role: "user", content: input.request }], maxOutputTokens: 2400, privacyMode: privacyMode as any, requestSource: "FOREGROUND", metadata: { workflow: "interpret_only", deterministic_execution: false } }, provider, model, userId });
  return { provider: { id: provider.id, name: provider.displayName, location: provider.locationClassification }, model, privacyMode, cost: preview.cost, limits: preview.limits, privacy: preview.privacyReport, metadataShared: preview.sanitizedMetadata, notShared: ["Plex credentials", "server addresses", "file paths", "complete library inventory", "track lists"], plexMutation: false };
}

export async function getNaturalLanguageRequest(userId: string, requestId: string, includeHistory = true) {
  return publicRequest(await ownedRequest(userId, requestId, includeHistory));
}

async function analyzeCanonicalDraft(userId: string, recipe: MixRecipeDocument) {
  const validation = validateRecipe(recipe);
  if (!validation.normalizedRecipe) return { validation, analysis: null, preview: null, previewError: null };
  const analysis = await analyzeRecipeDraft(userId, recipe);
  try {
    const preview = await previewPlaylistTracks({ userId, config: resolveRecipeGenerationConfig(recipe), displayLimit: 100 });
    return { validation, analysis, preview: safeJson(preview), previewError: null };
  } catch (error) {
    return { validation, analysis, preview: null, previewError: error instanceof Error ? error.message : "Preview generation failed." };
  }
}

function nextReviewStatus(interpretation: NaturalLanguageInterpretation, result: Awaited<ReturnType<typeof analyzeCanonicalDraft>>) {
  if (!result.validation.valid) return "NEEDS_REVIEW";
  if (interpretationRequiresClarification(interpretation)) return "NEEDS_CLARIFICATION";
  if (!result.preview || result.previewError || !result.analysis?.candidateEstimate?.achievable) return "NEEDS_REVIEW";
  return "READY_FOR_APPROVAL";
}

async function persistInterpretation(input: { requestId: string; userId: string; interpretation: NaturalLanguageInterpretation; recipe: MixRecipeDocument; revision: number; revisionText?: string | null; provider: { id?: string; name?: string; model?: string; privacyMode: string; estimatedCost?: number; actualCost?: number; inputTokens?: number; outputTokens?: number }; previousRecipe?: MixRecipeDocument | null }) {
  const result = await analyzeCanonicalDraft(input.userId, input.recipe);
  const status = nextReviewStatus(input.interpretation, result);
  const changeSummary = input.previousRecipe ? compareRecipeDocuments(input.previousRecipe, input.recipe) : [];
  return prisma.$transaction(async (tx) => {
    const current = await tx.naturalLanguageRequest.findUnique({ where: { id: input.requestId } });
    if (!current) throw requestError("REQUEST_NOT_FOUND", "Natural-language request not found.", 404);
    assertTransition(current.status, status);
    const updated = await tx.naturalLanguageRequest.update({ where: { id: input.requestId }, data: {
      status, currentRevision: input.revision, detectedLanguage: input.interpretation.detectedLanguage, intent: input.interpretation.intent,
      providerConfigId: input.provider.id, providerDisplayName: input.provider.name, model: input.provider.model, privacyMode: input.provider.privacyMode,
      interpretationJson: json(input.interpretation), draftRecipeJson: json(input.recipe), validationJson: json(result.validation),
      candidateEstimateJson: result.analysis?.candidateEstimate ? json(result.analysis.candidateEstimate) : undefined,
      compatibilityJson: result.analysis?.compatibility ? json(result.analysis.compatibility) : undefined,
      previewJson: result.preview ? json(result.preview) : undefined, analysisRevision: input.revision, previewRevision: result.preview ? input.revision : null,
      previewGeneratedAt: result.preview ? new Date() : null, approvalRevision: null, approvedById: null, approvedAt: null,
      estimatedCost: input.provider.estimatedCost, actualCost: input.provider.actualCost, inputTokenCount: input.provider.inputTokens, outputTokenCount: input.provider.outputTokens,
      errorCode: result.previewError ? "PREVIEW_GENERATION_FAILED" : null, errorMessage: result.previewError,
    } });
    await tx.naturalLanguageRequestRevision.upsert({ where: { requestId_revision: { requestId: input.requestId, revision: input.revision } }, create: { requestId: input.requestId, revision: input.revision, revisionText: input.revisionText, interpretationJson: json(input.interpretation), draftRecipeJson: json(input.recipe), validationJson: json(result.validation), candidateEstimateJson: result.analysis?.candidateEstimate ? json(result.analysis.candidateEstimate) : undefined, compatibilityJson: result.analysis?.compatibility ? json(result.analysis.compatibility) : undefined, previewJson: result.preview ? json(result.preview) : undefined, changeSummaryJson: json(changeSummary), createdById: input.userId }, update: { interpretationJson: json(input.interpretation), draftRecipeJson: json(input.recipe), validationJson: json(result.validation), candidateEstimateJson: result.analysis?.candidateEstimate ? json(result.analysis.candidateEstimate) : undefined, compatibilityJson: result.analysis?.compatibility ? json(result.analysis.compatibility) : undefined, previewJson: result.preview ? json(result.preview) : undefined, changeSummaryJson: json(changeSummary) } });
    await audit(input.requestId, input.userId, input.revision, input.revisionText ? "REQUEST_REVISED" : "INTERPRETATION_COMPLETED", { status, validationValid: result.validation.valid, candidateEstimate: result.analysis?.candidateEstimate, previewGenerated: !!result.preview, previewError: result.previewError }, "SUCCESS", tx);
    return publicRequest(updated);
  });
}

export async function createNaturalLanguageRequest(userId: string, raw: unknown) {
  await requireNaturalLanguagePermission(userId, "SUBMIT_NATURAL_LANGUAGE_REQUESTS", userId);
  const input = createNaturalLanguageRequestSchema.parse(raw);
  const governance = await prisma.aiGovernanceSetting.findUnique({ where: { id: "global" }, select: { privacyMode: true } });
  const privacyMode = input.privacyMode || governance?.privacyMode || "METADATA_LIMITED";
  const created = await prisma.naturalLanguageRequest.create({ data: { ownerId: userId, originalRequest: input.retainOriginalRequest ? input.request : null, originalRequestHash: hashPrompt(input.request), originalRequestRetained: input.retainOriginalRequest, privacyMode, status: "DRAFT" } });
  await audit(created.id, userId, 1, "REQUEST_SUBMITTED", { privacyMode, promptRetained: input.retainOriginalRequest });
  await prisma.naturalLanguageRequest.update({ where: { id: created.id }, data: { status: "ANALYZING" } });
  try {
    const interpreted = await interpretNaturalLanguage({ userId, requestText: input.request, privacyMode: privacyMode as any });
    return await persistInterpretation({ requestId: created.id, userId, interpretation: interpreted.interpretation, recipe: interpreted.recipe, revision: 1, provider: { id: interpreted.response.providerId, name: interpreted.providerDisplayName, model: interpreted.response.model, privacyMode: interpreted.privacyMode, estimatedCost: interpreted.response.estimatedCost, actualCost: interpreted.response.actualCost, inputTokens: interpreted.response.usage?.inputTokens, outputTokens: interpreted.response.usage?.outputTokens } });
  } catch (error: any) {
    const code = String(error?.category || error?.code || "INTERPRETATION_FAILED");
    const message = error instanceof Error ? error.message : "Interpretation failed.";
    const failed = await prisma.naturalLanguageRequest.update({ where: { id: created.id }, data: { status: "FAILED", errorCode: code, errorMessage: message.slice(0, 1000) } });
    await audit(created.id, userId, 1, "INTERPRETATION_FAILED", { code }, "FAILED");
    return publicRequest(failed);
  }
}

export async function reinterpretNaturalLanguageRequest(userId: string, requestId: string) {
  const row = await ownedRequest(userId, requestId);
  await requireNaturalLanguagePermission(userId, "EDIT_REQUEST_INTERPRETATIONS", row.ownerId);
  if (!row.originalRequest) throw requestError("PROMPT_NOT_RETAINED", "The original request was not retained. Submit a revision to reinterpret it.", 409);
  if (terminalStatuses.has(row.status)) throw requestError("REQUEST_NOT_EDITABLE", "This request can no longer be edited.", 409);
  assertTransition(row.status, "ANALYZING");
  await prisma.naturalLanguageRequest.update({ where: { id: requestId }, data: { status: "ANALYZING", approvalRevision: null, approvedAt: null, approvedById: null } });
  const interpreted = await interpretNaturalLanguage({ userId, requestText: row.originalRequest, privacyMode: row.privacyMode as any });
  return persistInterpretation({ requestId, userId, interpretation: interpreted.interpretation, recipe: interpreted.recipe, revision: row.currentRevision + 1, provider: { id: interpreted.response.providerId, name: interpreted.providerDisplayName, model: interpreted.response.model, privacyMode: interpreted.privacyMode, estimatedCost: interpreted.response.estimatedCost, actualCost: interpreted.response.actualCost, inputTokens: interpreted.response.usage?.inputTokens, outputTokens: interpreted.response.usage?.outputTokens }, previousRecipe: row.draftRecipeJson as unknown as MixRecipeDocument });
}

export async function reviseNaturalLanguageRequest(userId: string, requestId: string, raw: unknown) {
  const input = revisionRequestSchema.parse(raw), row = await ownedRequest(userId, requestId);
  await requireNaturalLanguagePermission(userId, "EDIT_REQUEST_INTERPRETATIONS", row.ownerId);
  if (!row.interpretationJson || !row.draftRecipeJson) throw requestError("DRAFT_UNAVAILABLE", "Interpret the request before revising it.", 409);
  if (terminalStatuses.has(row.status)) throw requestError("REQUEST_NOT_EDITABLE", "This request can no longer be edited.", 409);
  assertTransition(row.status, "ANALYZING");
  await prisma.naturalLanguageRequest.update({ where: { id: requestId }, data: { status: "ANALYZING", approvalRevision: null, approvedAt: null, approvedById: null } });
  const previousRecipe = mixRecipeDocumentSchema.parse(row.draftRecipeJson), previousInterpretation = naturalLanguageInterpretationSchema.parse(row.interpretationJson);
  const interpreted = await interpretNaturalLanguage({ userId, requestText: row.originalRequest || "Revise the current playlist request.", privacyMode: row.privacyMode as any, previous: { interpretation: previousInterpretation, recipe: previousRecipe, revisionText: input.revision } });
  return persistInterpretation({ requestId, userId, interpretation: interpreted.interpretation, recipe: interpreted.recipe, revision: row.currentRevision + 1, revisionText: input.revision, provider: { id: interpreted.response.providerId, name: interpreted.providerDisplayName, model: interpreted.response.model, privacyMode: interpreted.privacyMode, estimatedCost: interpreted.response.estimatedCost, actualCost: interpreted.response.actualCost, inputTokens: interpreted.response.usage?.inputTokens, outputTokens: interpreted.response.usage?.outputTokens }, previousRecipe });
}

function studioDraftToRecipe(raw: any, current: MixRecipeDocument) {
  if (raw?.format === "mixarr-recipe") return mixRecipeDocumentSchema.parse(raw);
  const input = playlistRecipeSchema.parse({ name: raw.name, description: raw.description, category: raw.category, artworkUrl: raw.artworkUrl, enabled: false, filters: raw.filters, scoring: raw.scoring, targets: raw.targets, bpmFlow: raw.bpmFlow, discovery: raw.discovery, variety: raw.variety, playlistIdentity: raw.playlistIdentity, refreshPolicy: raw.refreshPolicy, automationPolicy: { ...raw.automationPolicy, enabled: false, requireExplicitConfirmation: true } });
  return mixRecipeDocumentSchema.parse({ ...current, metadata: { ...current.metadata, name: input.name, description: input.description, category: input.category, artworkUrl: input.artworkUrl }, generation: input.filters, scoring: input.scoring, targets: input.targets, bpmFlow: input.bpmFlow, discovery: input.discovery, variety: input.variety, playlistIdentity: input.playlistIdentity, refreshPolicy: input.refreshPolicy, automationPolicy: { ...input.automationPolicy, enabled: false } });
}

export async function updateNaturalLanguageDraft(userId: string, requestId: string, raw: any) {
  const row = await ownedRequest(userId, requestId);
  await requireNaturalLanguagePermission(userId, "EDIT_REQUEST_INTERPRETATIONS", row.ownerId);
  if (!row.draftRecipeJson || !row.interpretationJson) throw requestError("DRAFT_UNAVAILABLE", "Interpret the request before editing its recipe.", 409);
  if (terminalStatuses.has(row.status) || row.status === "EXECUTING") throw requestError("REQUEST_NOT_EDITABLE", "This request can no longer be edited.", 409);
  const previous = mixRecipeDocumentSchema.parse(row.draftRecipeJson), recipe = studioDraftToRecipe(raw?.recipe || raw?.draft || raw, previous);
  const interpretation = naturalLanguageInterpretationSchema.parse(row.interpretationJson);
  const nextRevision = row.currentRevision + 1;
  assertTransition(row.status, "ANALYZING");
  await prisma.naturalLanguageRequest.update({ where: { id: requestId }, data: { status: "ANALYZING", approvalRevision: null, approvedAt: null, approvedById: null } });
  await audit(requestId, userId, nextRevision, row.approvedAt ? "APPROVAL_INVALIDATED" : "DRAFT_RECIPE_EDITED", { changedFields: compareRecipeDocuments(previous, recipe).map((item) => item.path) });
  return persistInterpretation({ requestId, userId, interpretation, recipe, revision: nextRevision, revisionText: "Recipe Studio edit", provider: { id: row.providerConfigId || undefined, name: row.providerDisplayName || undefined, model: row.model || undefined, privacyMode: row.privacyMode }, previousRecipe: previous });
}

function applyAmbiguityValue(recipe: MixRecipeDocument, fields: string[], value: unknown) {
  const next: any = safeJson(recipe);
  for (const field of fields) {
    if (field === "trackCount" && Number.isFinite(Number(value))) next.generation.limit = Number(value);
    else if (field === "library" && typeof value === "string") { next.generation.libraryId = value; next.automationPolicy.libraryId = value; }
    else if (field === "sourcePlaylist" && typeof value === "string") next.metadata.sourcePlaylistId = value;
    else if (field === "minimumBpm") next.bpmFlow.minimumBpm = value;
    else if (field === "maximumBpm") next.bpmFlow.maximumBpm = value;
    else if (field === "artistSpacing") next.variety.minimumArtistSpacing = value;
    else if (field === "albumSpacing") next.variety.minimumAlbumSpacing = value;
    else if (field === "familiarityBalance") next.discovery.familiarityBalance = value;
    else if (field === "recentlyPlayedExclusionDays") next.variety.recentlyPlayedExclusionDays = value;
  }
  return mixRecipeDocumentSchema.parse(next);
}

export async function resolveNaturalLanguageAmbiguity(userId: string, requestId: string, ambiguityId: string, raw: unknown) {
  const resolution = ambiguityResolutionSchema.parse(raw), row = await ownedRequest(userId, requestId);
  await requireNaturalLanguagePermission(userId, "EDIT_REQUEST_INTERPRETATIONS", row.ownerId);
  const interpretation = naturalLanguageInterpretationSchema.parse(row.interpretationJson), recipe = mixRecipeDocumentSchema.parse(row.draftRecipeJson);
  const ambiguity = interpretation.ambiguities.find((item) => item.id === ambiguityId);
  if (!ambiguity) throw requestError("AMBIGUITY_NOT_FOUND", "Ambiguity not found.", 404);
  const entityId = ambiguityId.startsWith("entity-") ? ambiguityId.slice("entity-".length) : null;
  const selected = resolution.action === "alternative"
    ? ambiguity.alternatives.find((item) => item.id === resolution.alternativeId)?.value
    : resolution.action === "accept" && entityId
      ? ambiguity.alternatives[0]?.value
      : resolution.value;
  if ((resolution.action === "alternative" || resolution.action === "custom") && selected === undefined) {
    throw requestError("INVALID_AMBIGUITY_RESOLUTION", "Choose a valid alternative or provide a custom value.", 400);
  }
  const nextInterpretation = {
    ...interpretation,
    ambiguities: interpretation.ambiguities.map((item) => item.id === ambiguityId ? { ...item, resolution: { action: resolution.action, ...(selected === undefined ? {} : { value: selected }) } } : item),
    unresolvedEntities: entityId ? interpretation.unresolvedEntities.filter((item) => item.id !== entityId) : interpretation.unresolvedEntities,
  };
  const nextRecipe = resolution.action === "remove" || selected === undefined ? recipe : applyAmbiguityValue(recipe, ambiguity.affectedFields, selected);
  const nextRevision = row.currentRevision + 1;
  assertTransition(row.status, "ANALYZING");
  await prisma.naturalLanguageRequest.update({ where: { id: requestId }, data: { status: "ANALYZING", approvalRevision: null, approvedAt: null, approvedById: null } });
  await audit(requestId, userId, nextRevision, "AMBIGUITY_CHANGED", { ambiguityId, action: resolution.action });
  return persistInterpretation({ requestId, userId, interpretation: nextInterpretation, recipe: nextRecipe, revision: nextRevision, revisionText: `Resolved ambiguity: ${ambiguity.originalPhrase}`, provider: { id: row.providerConfigId || undefined, name: row.providerDisplayName || undefined, model: row.model || undefined, privacyMode: row.privacyMode }, previousRecipe: recipe });
}

export async function resolveNaturalLanguageAssumption(userId: string, requestId: string, assumptionId: string, raw: unknown) {
  const resolution = ambiguityResolutionSchema.parse(raw), row = await ownedRequest(userId, requestId);
  await requireNaturalLanguagePermission(userId, "EDIT_REQUEST_INTERPRETATIONS", row.ownerId);
  const interpretation = naturalLanguageInterpretationSchema.parse(row.interpretationJson), recipe = mixRecipeDocumentSchema.parse(row.draftRecipeJson);
  const assumption = interpretation.assumptions.find((item) => item.id === assumptionId);
  if (!assumption) throw requestError("ASSUMPTION_NOT_FOUND", "Assumption not found.", 404);
  const nextInterpretation = { ...interpretation, assumptions: resolution.action === "remove" ? interpretation.assumptions.filter((item) => item.id !== assumptionId) : interpretation.assumptions.map((item) => item.id === assumptionId ? { ...item, accepted: resolution.action === "accept" } : item) };
  const reset: Record<string, unknown> = { trackCount: 100, minimumBpm: null, maximumBpm: null, artistSpacing: 1, albumSpacing: 0, familiarityBalance: 50, recentlyPlayedExclusionDays: 0 };
  const nextRecipe = resolution.action === "accept" ? recipe : applyAmbiguityValue(recipe, [assumption.field], resolution.action === "remove" ? reset[assumption.field] : resolution.value);
  const nextRevision = row.currentRevision + 1;
  assertTransition(row.status, "ANALYZING");
  await prisma.naturalLanguageRequest.update({ where: { id: requestId }, data: { status: "ANALYZING", approvalRevision: null, approvedAt: null, approvedById: null } });
  await audit(requestId, userId, nextRevision, resolution.action === "accept" ? "ASSUMPTION_ACCEPTED" : "ASSUMPTION_CHANGED", { assumptionId, action: resolution.action });
  return persistInterpretation({ requestId, userId, interpretation: nextInterpretation, recipe: nextRecipe, revision: nextRevision, revisionText: `${resolution.action === "remove" ? "Removed" : "Reviewed"} assumption: ${assumption.field}`, provider: { id: row.providerConfigId || undefined, name: row.providerDisplayName || undefined, model: row.model || undefined, privacyMode: row.privacyMode }, previousRecipe: recipe });
}

export async function refreshNaturalLanguageAnalysis(userId: string, requestId: string, previewOnly = false) {
  const row = await ownedRequest(userId, requestId);
  const recipe = mixRecipeDocumentSchema.parse(row.draftRecipeJson), interpretation = naturalLanguageInterpretationSchema.parse(row.interpretationJson);
  if (terminalStatuses.has(row.status) || row.status === "EXECUTING") throw requestError("REQUEST_NOT_EDITABLE", "Analysis cannot be refreshed for this request.", 409);
  const result = await analyzeCanonicalDraft(userId, recipe), status = nextReviewStatus(interpretation, result);
  const updated = await prisma.naturalLanguageRequest.update({ where: { id: requestId }, data: { status, validationJson: json(result.validation), candidateEstimateJson: result.analysis?.candidateEstimate ? json(result.analysis.candidateEstimate) : undefined, compatibilityJson: result.analysis?.compatibility ? json(result.analysis.compatibility) : undefined, previewJson: result.preview ? json(result.preview) : undefined, analysisRevision: row.currentRevision, previewRevision: result.preview ? row.currentRevision : null, previewGeneratedAt: result.preview ? new Date() : null, errorCode: result.previewError ? "PREVIEW_GENERATION_FAILED" : null, errorMessage: result.previewError } });
  await audit(requestId, userId, row.currentRevision, previewOnly ? "PREVIEW_GENERATED" : "ANALYSIS_REFRESHED", { previewGenerated: !!result.preview, previewError: result.previewError });
  return publicRequest(updated);
}

export async function approveNaturalLanguageRequest(userId: string, requestId: string) {
  const row = await ownedRequest(userId, requestId);
  await requireNaturalLanguagePermission(userId, row.ownerId === userId ? "APPROVE_PERSONAL_REQUESTS" : "APPROVE_OTHER_USERS_REQUESTS", row.ownerId);
  if (row.status === "APPROVED" && row.approvalRevision === row.currentRevision) return publicRequest(row);
  if (row.status !== "READY_FOR_APPROVAL") throw requestError("REQUEST_NOT_READY", "Resolve blocking items and refresh validation and preview before approval.", 409);
  if (row.analysisRevision !== row.currentRevision || row.previewRevision !== row.currentRevision) throw requestError("STALE_ANALYSIS", "Analysis and preview must match the current revision.", 409);
  const interpretation = naturalLanguageInterpretationSchema.parse(row.interpretationJson), validation = validateRecipe(row.draftRecipeJson);
  if (unresolvedBlocking(interpretation).length || interpretation.unresolvedEntities.length) throw requestError("BLOCKING_AMBIGUITIES", "All blocking ambiguities and entities must be resolved.", 409);
  if (!validation.valid) throw requestError("INVALID_RECIPE", "The canonical recipe is invalid.", 422);
  assertTransition(row.status, "APPROVED");
  const updated = await prisma.naturalLanguageRequest.update({ where: { id: requestId }, data: { status: "APPROVED", approvalRevision: row.currentRevision, approvedById: userId, approvedAt: new Date() } });
  await audit(requestId, userId, row.currentRevision, "APPROVAL_GRANTED", { revision: row.currentRevision });
  return publicRequest(updated);
}

async function saveApprovedRecipeInternal(userId: string, row: any) {
  if (row.finalRecipeId) return prisma.playlistRecipe.findUniqueOrThrow({ where: { id: row.finalRecipeId } });
  if (row.status !== "APPROVED" || row.approvalRevision !== row.currentRevision) throw requestError("APPROVAL_REQUIRED", "Explicit approval of the current revision is required.", 409);
  const recipe = mixRecipeDocumentSchema.parse(row.draftRecipeJson);
  const parsed = playlistRecipeSchema.parse({ name: recipe.metadata.name, description: recipe.metadata.description, category: recipe.metadata.category, artworkUrl: recipe.metadata.artworkUrl, sourcePlaylistId: recipe.metadata.sourcePlaylistId, enabled: true, filters: recipe.generation, scoring: recipe.scoring, targets: recipe.targets, bpmFlow: recipe.bpmFlow, discovery: recipe.discovery, variety: recipe.variety, playlistIdentity: recipe.playlistIdentity, refreshPolicy: recipe.refreshPolicy, automationPolicy: { ...recipe.automationPolicy, enabled: false } });
  const created = await prisma.playlistRecipe.create({ data: createPlaylistRecipeData(row.ownerId, parsed) });
  await prisma.naturalLanguageRequest.update({ where: { id: row.id }, data: { finalRecipeId: created.id } });
  await writeRecipeAudit({ recipeId: created.id, recipeVersion: created.recipeVersion, eventType: "RECIPE_CREATED_FROM_NATURAL_LANGUAGE_REQUEST", actorId: userId, description: "Approved natural-language draft saved as a canonical recipe.", metadata: { naturalLanguageRequestId: row.id, requestRevision: row.currentRevision } });
  await audit(row.id, userId, row.currentRevision, "RECIPE_SAVED", { recipeId: created.id });
  return created;
}

export async function saveApprovedNaturalLanguageRecipe(userId: string, requestId: string) {
  const row = await ownedRequest(userId, requestId);
  await requireNaturalLanguagePermission(userId, "APPROVE_PERSONAL_REQUESTS", row.ownerId);
  return parsePlaylistRecipe(await saveApprovedRecipeInternal(userId, row));
}

export async function executeApprovedNaturalLanguageRequest(userId: string, requestId: string, raw: any = {}) {
  const row = await ownedRequest(userId, requestId);
  await requireNaturalLanguagePermission(userId, "EXECUTE_APPROVED_RECIPES", row.ownerId);
  if (row.executionId && row.status === "COMPLETED") return { request: publicRequest(row), executionId: row.executionId, duplicate: true };
  if (row.status !== "APPROVED" || row.approvalRevision !== row.currentRevision) throw requestError("APPROVAL_REQUIRED", "Explicit approval of the current revision is required.", 409);
  const key = String(raw.idempotencyKey || `${requestId}:${row.currentRevision}`).slice(0, 200);
  const claimed = await prisma.naturalLanguageRequest.updateMany({ where: { id: requestId, status: "APPROVED", executionId: null, approvalRevision: row.currentRevision }, data: { status: "EXECUTING", executionIdempotencyKey: key } });
  if (claimed.count !== 1) throw requestError("DUPLICATE_EXECUTION", "This request is already executing or completed.", 409);
  await audit(requestId, userId, row.currentRevision, "EXECUTION_STARTED", { idempotencyKey: hashPrompt(key) });
  try {
    const recipe = await saveApprovedRecipeInternal(userId, { ...row, status: "APPROVED" });
    const recipeDocument = mixRecipeDocumentSchema.parse(row.draftRecipeJson);
    const result = await createPlaylistFromRecipe({ userId: row.ownerId, recipeId: recipe.id, playlistName: String(raw.playlistName || recipeDocument.metadata.name), confirmAutomation: false });
    const updated = await prisma.naturalLanguageRequest.update({ where: { id: requestId }, data: { status: "COMPLETED", executionId: result.playlist.id } });
    await audit(requestId, userId, row.currentRevision, "EXECUTION_COMPLETED", { generatedPlaylistId: result.playlist.id, trackCount: result.trackCount });
    return { request: publicRequest(updated), result, duplicate: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution failed.";
    await prisma.naturalLanguageRequest.update({ where: { id: requestId }, data: { status: "FAILED", errorCode: "EXECUTION_FAILED", errorMessage: message.slice(0, 1000) } });
    await audit(requestId, userId, row.currentRevision, "EXECUTION_FAILED", { message: message.slice(0, 300) }, "FAILED");
    throw error;
  }
}

export async function cancelNaturalLanguageRequest(userId: string, requestId: string) {
  const row = await ownedRequest(userId, requestId);
  if (row.status === "CANCELLED") return publicRequest(row);
  if (row.status === "EXECUTING" || row.status === "COMPLETED") throw requestError("REQUEST_NOT_CANCELLABLE", "An executing or completed request cannot be cancelled.", 409);
  assertTransition(row.status, "CANCELLED");
  const updated = await prisma.naturalLanguageRequest.update({ where: { id: requestId }, data: { status: "CANCELLED", cancelledAt: new Date(), approvalRevision: null, approvedAt: null, approvedById: null } });
  await audit(requestId, userId, row.currentRevision, "REQUEST_CANCELLED");
  return publicRequest(updated);
}

export async function deleteNaturalLanguageRequest(userId: string, requestId: string) {
  const row = await ownedRequest(userId, requestId);
  if (!["DRAFT", "FAILED", "CANCELLED", "EXPIRED"].includes(row.status)) throw requestError("REQUEST_NOT_DELETABLE", "Only draft, failed, cancelled, or expired requests may be deleted.", 409);
  await prisma.naturalLanguageRequest.delete({ where: { id: requestId } });
  return { deleted: true, id: requestId };
}
