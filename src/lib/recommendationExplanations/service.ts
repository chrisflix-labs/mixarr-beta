import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { isUserAdmin } from "../auth";
import { requireAiPermission } from "../../ai/governance/permissions";
import type { SmartMixDecisionExplanation } from "../smartMixExplanations/types";
import { buildReproducibilitySnapshot, calculateReproducibilityStatus, confidenceCategory, explanationHash, redactExplanationExport, semanticDiff, trackEvaluationsFromDecision, validationResultsFromProposal } from "./core";
import { RECOMMENDATION_EXPLANATION_SCHEMA_VERSION, type FieldInterpretation, type GeneratedSetting } from "./types";

export const RECOMMENDATION_EXPLANATION_PERMISSIONS = [
  "recommendations.explanation.view", "recommendations.explanation.export", "recommendations.explanation.modify_assumptions",
  "recommendations.explanation.apply_alternative", "recommendations.explanation.regenerate", "recommendations.explanation.view_raw",
  "recommendations.explanation.approve", "recommendations.explanation.add_notes",
] as const;

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
const failure = (code: string, message: string, status = 400) => Object.assign(new Error(message), { code, status });
const words = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter((item) => item.length > 2);
const explicitRequestFor = (request: string, path: string, value: unknown) => {
  const haystack = request.toLowerCase();
  const terms = [...words(path), ...words(typeof value === "string" ? value : "")];
  return terms.some((term) => haystack.includes(term));
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function setPath(value: any, path: string, next: unknown) {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length || parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) {
    throw failure("INVALID_ASSUMPTION_PATH", "The assumption does not reference a safe configuration path.");
  }
  let current = value;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== "object") current[part] = {};
    current = current[part];
  }
  current[parts.at(-1)!] = next;
}

function validateAssumptionOverride(expected: unknown, next: unknown) {
  if (next === undefined || typeof next === "function" || typeof next === "symbol" || typeof next === "bigint") {
    return { success: false, message: "The override must be a JSON value." };
  }
  if (next === null || expected === null || expected === undefined) return { success: true, message: "The override is a valid optional JSON value." };
  const compatible = Array.isArray(expected)
    ? Array.isArray(next)
    : typeof expected === "object"
      ? typeof next === "object" && !Array.isArray(next)
      : typeof expected === typeof next && (typeof next !== "number" || Number.isFinite(next));
  return compatible
    ? { success: true, message: "The reviewed override has the same value shape as the interpreted setting." }
    : { success: false, message: "The reviewed override must use the same value type as the interpreted setting." };
}

async function canAccessExplanation(userId: string, row: any, modify = false) {
  if (row.ownerId === userId || await isUserAdmin(userId)) return true;
  if (modify) return false;
  const playlistId = row.generatedPlaylistId;
  if (!playlistId) return false;
  return Boolean(await prisma.householdPlaylistConfiguration.findFirst({ where: { generatedPlaylistId: playlistId, household: { OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }] } }, select: { id: true } }));
}

async function explanationRow(userId: string, resourceId: string, modify = false) {
  await requireAiPermission(userId, "ai.use");
  const row = await prisma.recommendationExplanation.findFirst({ where: { OR: [
    { id: resourceId }, { aiProposalId: resourceId }, { aiRequestId: resourceId }, { recipeId: resourceId },
    { generatedPlaylistId: resourceId }, { generation: { generationId: resourceId } },
  ] }, orderBy: { createdAt: "desc" } });
  if (!row || !(await canAccessExplanation(userId, row, modify))) throw failure("EXPLANATION_NOT_FOUND", "Recommendation explanation not found or access denied.", 404);
  return row;
}

function fieldInterpretations(input: { request: string; intent: any; changes: any[]; confidence: number }): FieldInterpretation[] {
  const rows: FieldInterpretation[] = [];
  const goals = [...(input.intent?.primaryGoals || []), ...(input.intent?.secondaryGoals || [])];
  goals.forEach((goal, index) => rows.push({ id: `goal-${index + 1}`, fieldPath: `intent.goals.${index}`, value: goal, sourcePhrase: input.request || null, explicitlyRequested: true, inferred: false, confidence: input.confidence, confidenceCategory: confidenceCategory(input.confidence), responsibility: "ai_interpretation" }));
  input.changes.forEach((change, index) => {
    const explicit = explicitRequestFor(input.request, change.path, change.after);
    rows.push({ id: `setting-${index + 1}`, fieldPath: change.path, value: change.after, sourcePhrase: explicit ? input.request : null, explicitlyRequested: explicit, inferred: !explicit, confidence: Number(change.confidence ?? input.confidence), confidenceCategory: confidenceCategory(Number(change.confidence ?? input.confidence)), responsibility: "ai_interpretation" });
  });
  return rows;
}

function generatedSettings(input: { request: string; changes: any[]; confidence: number; validationResults: any[] }): GeneratedSetting[] {
  return input.changes.map((change, index) => {
    const validation = input.validationResults.find((item) => item.path === change.path || item.id === "recipe-schema");
    const explicit = explicitRequestFor(input.request, change.path, change.after);
    const confidence = Number(change.confidence ?? input.confidence);
    return { path: change.path, value: change.after, previousValue: change.before, sourceInterpretationId: `setting-${index + 1}`, confidence, confidenceCategory: confidenceCategory(confidence), explicitlyRequested: explicit, inferred: !explicit, userModified: false, validationStatus: validation?.result === "failed" ? "failed" : "passed", responsibility: "mixarr_configuration" };
  });
}

export async function createExplanationFromRecipeProposal(input: {
  ownerId: string; requestId: string; proposalId: string; recipeId?: string | null; recipeVersion?: number | null;
  originalRequest: string; intent: any; analysis: any; proposedConfiguration: unknown; previousConfiguration: unknown;
  changes: any[]; validation: any; compatibility: any; provider?: string | null; model?: string | null;
  privacyMode?: string | null; engineVersion?: string; recipeSchemaVersion?: string; cost?: number | null; createdAt?: Date;
}) {
  const confidence = Number(input.analysis?.confidence ?? 0);
  const validationResults = validationResultsFromProposal(input.validation, input.compatibility);
  const interpretations = fieldInterpretations({ request: input.originalRequest, intent: input.intent, changes: input.changes, confidence });
  const structuredInterpretation = { summary: input.intent?.summary || input.originalRequest, primaryGoals: input.intent?.primaryGoals || [], secondaryGoals: input.intent?.secondaryGoals || [], conflicts: input.intent?.conflicts || [], fields: interpretations, responsibility: "ai_interpretation" };
  const generatedConfiguration = input.proposedConfiguration || input.previousConfiguration || {};
  const settings = generatedSettings({ request: input.originalRequest, changes: input.changes, confidence, validationResults });
  const assumptions: any[] = (input.analysis?.assumptions || []).map((description: string, index: number) => ({ description, sourceText: input.originalRequest, fieldPath: settings[index]?.path || null, inferredValue: settings[index]?.value ?? null, confidence: settings[index]?.confidence ?? confidence, confidenceCategory: settings[index]?.confidenceCategory ?? confidenceCategory(confidence), relatedRuleIds: settings[index]?.path ? [settings[index].path] : [] }));
  const alternatives: any[] = (input.intent?.conflicts || []).filter((item: any) => !item.resolved).map((conflict: any, index: number) => ({ label: `Alternative ${index + 1}: ${conflict.resolution}`, structuredInterpretation: { ...structuredInterpretation, selectedConflictResolution: { code: conflict.code, resolution: conflict.resolution } }, confidence: Math.max(0, confidence - 0.15), differenceSummary: [{ path: `conflicts.${conflict.code}`, before: conflict.description, after: conflict.resolution, changeType: "changed" }], expectedRuleImpact: [conflict.resolution] }));
  const status = calculateReproducibilityStatus({ originalRequest: input.originalRequest, structuredInterpretation, generatedConfiguration, engineVersion: input.engineVersion || "v2", currentEngineVersion: input.engineVersion || "v2", metadataPolicy: "reference-or-snapshot", configurationHashValid: true });
  const snapshot = buildReproducibilitySnapshot({ recipe_schema_version: input.recipeSchemaVersion || "current", engine_version: input.engineVersion || "v2", original_request: input.originalRequest, structured_interpretation: structuredInterpretation, generated_configuration: generatedConfiguration as Record<string, unknown>, assumptions, alternatives, validation_results: validationResults, metadata_snapshot_policy: "reference-or-snapshot", random_seed: null, provider_context: { provider: input.provider || null, model: input.model || null, privacyMode: input.privacyMode || null }, created_at: (input.createdAt || new Date()).toISOString() });
  return prisma.$transaction(async (tx) => {
    const row = await tx.recommendationExplanation.upsert({ where: { aiProposalId: input.proposalId }, create: {
      ownerId: input.ownerId, recipeId: input.recipeId, recipeVersion: input.recipeVersion, aiRequestId: input.requestId, aiProposalId: input.proposalId,
      originalRequest: input.originalRequest, originalRequestHash: explanationHash(input.originalRequest), originalRequestCreatedAt: input.createdAt || new Date(),
      structuredInterpretationJson: json(structuredInterpretation), generatedConfigurationJson: json(generatedConfiguration), generatedSettingsJson: json(settings),
      validationResultsJson: json(validationResults), uncertaintyWarningsJson: json([...(input.analysis?.warnings || []), ...(input.intent?.conflicts || []).filter((item: any) => !item.resolved).map((item: any) => item.description)]),
      semanticDiffJson: json(semanticDiff(input.previousConfiguration, generatedConfiguration)), overallConfidence: confidence, overallConfidenceCategory: confidenceCategory(confidence),
      recipeSchemaVersion: input.recipeSchemaVersion || "current", engineVersion: input.engineVersion || "v2", modelProvider: input.provider, modelIdentifier: input.model,
      privacyMode: input.privacyMode, interpretationCost: input.cost, interpretationHash: snapshot.interpretation_hash, configurationHash: snapshot.configuration_hash,
      reproducibilityStatus: status.status, reproducibilityReason: status.reason, reproducibilitySnapshotJson: json(snapshot),
    }, update: { recipeId: input.recipeId, recipeVersion: input.recipeVersion } });
    if (assumptions.length) await tx.explanationAssumption.createMany({ data: assumptions.map((item) => ({ explanationId: row.id, sourceText: item.sourceText, description: item.description, fieldPath: item.fieldPath, inferredValueJson: json(item.inferredValue), confidence: item.confidence, confidenceCategory: item.confidenceCategory, relatedRuleIdsJson: json(item.relatedRuleIds) })) });
    if (alternatives.length) await tx.explanationAlternative.createMany({ data: alternatives.map((item) => ({ explanationId: row.id, label: item.label, structuredInterpretationJson: json(item.structuredInterpretation), generatedConfigurationJson: json(generatedConfiguration), confidence: item.confidence, confidenceCategory: confidenceCategory(item.confidence), differenceSummaryJson: json(item.differenceSummary), expectedRuleImpactJson: json(item.expectedRuleImpact) })) });
    const requestNode = "request-original";
    await tx.recommendationRuleTrace.create({ data: { explanationId: row.id, nodeType: "user_request", nodeIdentifier: requestNode, inputValueJson: json(input.originalRequest), outputValueJson: json(structuredInterpretation.summary), responsibility: "user", confidence: 1, validationStatus: "passed", childNodeIdsJson: json(interpretations.map((item) => item.id)) } });
    if (interpretations.length) await tx.recommendationRuleTrace.createMany({ data: interpretations.map((item) => ({ explanationId: row.id, nodeType: "ai_interpretation", nodeIdentifier: item.id, sourceNodeId: requestNode, targetRuleId: item.fieldPath.startsWith("intent.") ? null : item.fieldPath, fieldPath: item.fieldPath, inputValueJson: json(item.sourcePhrase), outputValueJson: json(item.value), responsibility: "ai_interpretation", confidence: item.confidence, validationStatus: settings.find((setting) => setting.sourceInterpretationId === item.id)?.validationStatus || "not_evaluated", parentNodeIdsJson: json([requestNode]), childNodeIdsJson: json(item.fieldPath.startsWith("intent.") ? [] : [item.fieldPath]) })) });
    await tx.recommendationExplanationAudit.create({ data: { explanationId: row.id, actorId: input.ownerId, eventType: "AI_INTERPRETATION_CREATED", detailsJson: json({ provider: input.provider || null, model: input.model || null, aiCallRequired: true }) } });
    await tx.recommendationExplanationAudit.create({ data: { explanationId: row.id, actorId: input.ownerId, eventType: "INTERPRETATION_VALIDATED", detailsJson: json({ validationResults }) } });
    return row;
  });
}

async function publicExplanation(row: any, includeRaw = false): Promise<any> {
  const [assumptions, alternatives, ruleTraces, approvalNotes, counts, generation] = await Promise.all([
    prisma.explanationAssumption.findMany({ where: { explanationId: row.id }, orderBy: { createdAt: "asc" } }),
    prisma.explanationAlternative.findMany({ where: { explanationId: row.id }, orderBy: [{ confidence: "desc" }, { createdAt: "asc" }] }),
    prisma.recommendationRuleTrace.findMany({ where: { explanationId: row.id }, orderBy: { createdAt: "asc" } }),
    prisma.explanationApprovalNote.findMany({ where: { explanationId: row.id }, include: { approver: { select: { id: true, username: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.recommendationTrackEvaluation.groupBy({ by: ["selected", "exclusion"], where: { explanationId: row.id }, _count: { _all: true } }),
    row.generationRecordId ? prisma.smartMixExplanationGeneration.findUnique({ where: { id: row.generationRecordId }, select: { generationId: true } }) : null,
  ]);
  const selectedEvaluations = counts.filter((item) => item.selected).reduce((sum, item) => sum + item._count._all, 0);
  const trackIds = await prisma.recommendationTrackEvaluation.groupBy({ by: ["trackId", "selected"], where: { explanationId: row.id } });
  const payload = {
    id: row.id, recipeId: row.recipeId, recipeVersion: row.recipeVersion, generatedPlaylistId: row.generatedPlaylistId,
    generationRunId: generation?.generationId || null, source: row.source, explanationSchemaVersion: row.explanationSchemaVersion,
    originalRequest: row.originalRequest, originalRequestCreatedAt: row.originalRequestCreatedAt, requestSource: row.requestSource,
    structuredInterpretation: row.structuredInterpretationJson, generatedConfiguration: row.generatedConfigurationJson,
    generatedSettings: row.generatedSettingsJson, validationResults: row.validationResultsJson, uncertaintyWarnings: row.uncertaintyWarningsJson,
    semanticDiff: row.semanticDiffJson, overallConfidence: row.overallConfidence, overallConfidenceCategory: row.overallConfidenceCategory,
    responsibility: { ai: "AI interpreted the request and proposed structured configuration.", deterministic: "Mixarr's deterministic engine validated configuration, evaluated candidates, calculated scores, selected tracks, and assigned positions." },
    assumptions, alternatives, ruleTraces, approvalNotes,
    summary: { selectedTracks: new Set(trackIds.filter((item) => item.selected).map((item) => item.trackId).filter(Boolean)).size, excludedTracks: new Set(trackIds.filter((item) => !item.selected).map((item) => item.trackId).filter(Boolean)).size, evaluationEvents: counts.reduce((sum, item) => sum + item._count._all, 0), selectedEvaluations },
    reproducibility: { status: row.reproducibilityStatus, reason: row.reproducibilityReason, snapshot: row.reproducibilitySnapshotJson, aiCallRequired: row.aiCallRequired, deterministicRenderCost: Number(row.deterministicRenderCost), interpretationCost: row.interpretationCost == null ? null : Number(row.interpretationCost) },
    versions: { engine: row.engineVersion, recipeSchema: row.recipeSchemaVersion, explanationSchema: row.explanationSchemaVersion },
    model: { provider: row.modelProvider, identifier: row.modelIdentifier }, privacyMode: row.privacyMode, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
  return includeRaw ? payload : redactExplanationExport(payload);
}

export async function getRecommendationExplanation(userId: string, resourceId: string, includeRaw = false): Promise<any> {
  try {
    const row = await explanationRow(userId, resourceId);
    if (includeRaw && row.ownerId !== userId && !(await isUserAdmin(userId))) throw failure("RAW_EXPLANATION_FORBIDDEN", "Raw explanation data requires owner or administrator access.", 403);
    return publicExplanation(row, includeRaw);
  } catch (caught: any) {
    if (caught?.code !== "EXPLANATION_NOT_FOUND") throw caught;
    const [playlist, recipe] = await Promise.all([
      prisma.generatedPlaylist.findFirst({ where: { id: resourceId, OR: [{ userId }, { householdConfiguration: { household: { OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }] } } }] }, include: { explanationGenerations: { orderBy: { createdAt: "desc" }, take: 1 } } }),
      prisma.playlistRecipe.findFirst({ where: { id: resourceId, userId } }),
    ]);
    if (!playlist && !recipe) throw caught;
    const generation = playlist?.explanationGenerations[0];
    return { legacy: true, id: resourceId, recipeId: recipe?.id || playlist?.recipeId || null, recipeVersion: recipe?.recipeVersion || playlist?.recipeVersionUsed || null, generatedPlaylistId: playlist?.id || null, generationRunId: generation?.generationId || null, source: "LEGACY", explanationSchemaVersion: "unavailable", originalRequest: null, originalRequestCreatedAt: null, requestSource: "LEGACY", structuredInterpretation: { summary: "Detailed AI interpretation is unavailable because this recipe or generation was created before explainable recommendations were enabled. Mixarr can still display deterministic engine results retained for future generation runs.", fields: [] }, generatedConfiguration: playlist?.resolvedRecipeSnapshotJson || playlist?.filtersJson || {}, generatedSettings: [], validationResults: [], uncertaintyWarnings: ["Historical interpretation data is unavailable and has not been fabricated."], semanticDiff: [], overallConfidence: null, overallConfidenceCategory: "not_applicable", responsibility: { ai: "No retained AI interpretation is available for this historical resource.", deterministic: "Mixarr's retained Smart Mix trace remains the source of truth for deterministic track decisions." }, assumptions: [], alternatives: [], ruleTraces: [], approvalNotes: [], summary: { selectedTracks: playlist?.trackCount || 0, excludedTracks: 0, evaluationEvents: 0, selectedEvaluations: 0 }, reproducibility: { status: "partially_reproducible", reason: "The historical generated configuration may be available, but no versioned structured AI interpretation was retained.", snapshot: null, aiCallRequired: false, deterministicRenderCost: 0, interpretationCost: null }, versions: { engine: playlist?.engineVersion || generation?.engineVersion || "unknown", recipeSchema: String(playlist?.recipeSchemaVersionUsed || recipe?.schemaVersion || "unknown"), explanationSchema: "unavailable" }, model: { provider: null, identifier: null }, privacyMode: null, createdAt: playlist?.createdAt || recipe?.createdAt, updatedAt: playlist?.updatedAt || recipe?.updatedAt };
  }
}

export async function listTrackEvaluations(userId: string, resourceId: string, input: Record<string, string | undefined>) {
  const row = await explanationRow(userId, resourceId);
  const page = Math.max(1, Number(input.page) || 1), pageSize = Math.min(100, Math.max(1, Number(input.pageSize) || 25));
  const where: Prisma.RecommendationTrackEvaluationWhereInput = { explanationId: row.id,
    ...(input.selected != null ? { selected: input.selected === "true" } : {}), ...(input.excluded === "true" ? { exclusion: true } : {}),
    ...(input.ruleId ? { ruleId: input.ruleId } : {}), ...(input.result ? { result: input.result } : {}), ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    ...(input.responsibility ? { responsibility: input.responsibility } : {}), ...(input.artist ? { artistName: { contains: input.artist, mode: "insensitive" } } : {}),
    ...(input.album ? { albumName: { contains: input.album, mode: "insensitive" } } : {}), ...(input.missingMetadata === "true" ? { result: "insufficient_metadata" } : {}),
    ...((input.minScore || input.maxScore) ? { scoreAfter: { ...(input.minScore ? { gte: Number(input.minScore) } : {}), ...(input.maxScore ? { lte: Number(input.maxScore) } : {}) } } : {}),
  };
  const [evaluations, total] = await Promise.all([prisma.recommendationTrackEvaluation.findMany({ where, orderBy: [{ selected: "desc" }, { rank: "asc" }, { trackId: "asc" }, { createdAt: "asc" }], skip: (page - 1) * pageSize, take: pageSize }), prisma.recommendationTrackEvaluation.count({ where })]);
  return { evaluations, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export async function getTrackEvaluation(userId: string, resourceId: string, trackId: string) {
  const row = await explanationRow(userId, resourceId);
  const evaluations = await prisma.recommendationTrackEvaluation.findMany({ where: { explanationId: row.id, trackId }, orderBy: { createdAt: "asc" } });
  if (!evaluations.length) throw failure("TRACK_EXPLANATION_NOT_FOUND", "No retained evaluation trace exists for this track.", 404);
  return { trackId, selected: evaluations.some((item) => item.selected), rank: evaluations.find((item) => item.rank != null)?.rank || null, evaluations };
}

export async function updateAssumption(userId: string, resourceId: string, assumptionId: string, action: "accept" | "reject" | "modify", raw: any = {}) {
  const row = await explanationRow(userId, resourceId, true);
  const assumption = await prisma.explanationAssumption.findFirst({ where: { id: assumptionId, explanationId: row.id } });
  if (!assumption) throw failure("ASSUMPTION_NOT_FOUND", "Explanation assumption not found.", 404);
  const now = new Date();
  if (action === "modify") {
    if (!Object.prototype.hasOwnProperty.call(raw, "value")) throw failure("ASSUMPTION_VALUE_REQUIRED", "A replacement value is required.");
    const configuration = clone(row.generatedConfigurationJson as any), settings = clone(row.generatedSettingsJson as any[]);
    if (assumption.fieldPath) setPath(configuration, assumption.fieldPath, raw.value);
    for (const setting of settings) if (setting.path === assumption.fieldPath) { setting.value = raw.value; setting.userModified = true; setting.responsibility = "user_override"; }
    const parsed = validateAssumptionOverride(assumption.inferredValueJson, raw.value);
    const validationResults = [...(row.validationResultsJson as any[]).filter((item) => item.id !== "user-override-schema"), { id: "user-override-schema", category: "schema", path: assumption.fieldPath, result: parsed.success ? "passed" : "failed", reasonCode: parsed.success ? "USER_OVERRIDE_SHAPE_VALID" : "USER_OVERRIDE_SHAPE_INVALID", message: parsed.message, responsibility: "mixarr_configuration" }];
    const snapshot = { ...(row.reproducibilitySnapshotJson as any), generated_configuration: configuration, configuration_hash: explanationHash(configuration), validation_results: validationResults };
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.explanationAssumption.update({ where: { id: assumption.id }, data: { status: "modified", userOverrideValueJson: json(raw.value), modifiedAt: now } });
      await tx.recommendationExplanation.update({ where: { id: row.id }, data: { generatedConfigurationJson: json(configuration), generatedSettingsJson: json(settings), validationResultsJson: json(validationResults), configurationHash: snapshot.configuration_hash, reproducibilitySnapshotJson: json(snapshot), reproducibilityStatus: parsed.success ? row.reproducibilityStatus : "not_reproducible", reproducibilityReason: parsed.success ? row.reproducibilityReason : "A reviewed assumption override does not match the interpreted setting's deterministic value shape." } });
      await tx.recommendationExplanationAudit.create({ data: { explanationId: row.id, actorId: userId, eventType: "ASSUMPTION_MODIFIED", detailsJson: json({ assumptionId, fieldPath: assumption.fieldPath, validationPassed: parsed.success }) } });
      return result;
    });
    return updated;
  }
  const updated = await prisma.explanationAssumption.update({ where: { id: assumption.id }, data: action === "accept" ? { status: "accepted", acceptedAt: now, rejectedAt: null } : { status: "rejected", rejectedAt: now, acceptedAt: null } });
  await prisma.recommendationExplanationAudit.create({ data: { explanationId: row.id, actorId: userId, eventType: `ASSUMPTION_${action.toUpperCase()}`, detailsJson: json({ assumptionId, fieldPath: assumption.fieldPath }) } });
  return updated;
}

export async function applyAlternative(userId: string, resourceId: string, alternativeId: string) {
  const row = await explanationRow(userId, resourceId, true);
  const alternative = await prisma.explanationAlternative.findFirst({ where: { id: alternativeId, explanationId: row.id } });
  if (!alternative) throw failure("ALTERNATIVE_NOT_FOUND", "Alternative interpretation not found.", 404);
  const interpretation = alternative.structuredInterpretationJson as Record<string, unknown>;
  const configuration = (alternative.generatedConfigurationJson || row.generatedConfigurationJson) as Record<string, unknown>;
  const snapshot = { ...(row.reproducibilitySnapshotJson as any), structured_interpretation: interpretation, generated_configuration: configuration, interpretation_hash: explanationHash(interpretation), configuration_hash: explanationHash(configuration), reapplied_without_ai: true };
  await prisma.$transaction([
    prisma.explanationAlternative.update({ where: { id: alternative.id }, data: { appliedAt: new Date() } }),
    prisma.recommendationExplanation.update({ where: { id: row.id }, data: { structuredInterpretationJson: json(interpretation), generatedConfigurationJson: json(configuration), interpretationHash: snapshot.interpretation_hash, configurationHash: snapshot.configuration_hash, reproducibilitySnapshotJson: json(snapshot), aiCallRequired: false } }),
    prisma.recommendationExplanationAudit.create({ data: { explanationId: row.id, actorId: userId, eventType: "ALTERNATIVE_APPLIED", detailsJson: json({ alternativeId, aiCalled: false, recipeOverwritten: false }) } }),
  ]);
  return { alternativeId, structuredInterpretation: interpretation, generatedConfiguration: configuration, semanticDiff: semanticDiff(row.generatedConfigurationJson, configuration), aiCalled: false, recipeOverwritten: false, reviewRequired: true };
}

export async function addApprovalNote(userId: string, resourceId: string, raw: any) {
  const row = await explanationRow(userId, resourceId);
  const note = String(raw.note || "").trim();
  if (!note || note.length > 4000) throw failure("INVALID_APPROVAL_NOTE", "Approval note must contain 1 to 4000 characters.");
  const allowed = ["approved", "changes_requested", "rejected", "comment"];
  const decision = allowed.includes(raw.decision) ? raw.decision : "comment";
  const generation = row.generationRecordId ? await prisma.smartMixExplanationGeneration.findUnique({ where: { id: row.generationRecordId }, select: { generationId: true } }) : null;
  const created = await prisma.explanationApprovalNote.create({ data: { explanationId: row.id, approverUserId: userId, decision, note, relatedFieldPath: raw.relatedFieldPath || null, relatedRuleId: raw.relatedRuleId || null, recipeVersion: row.recipeVersion, explanationVersion: row.explanationSchemaVersion, generationRunId: generation?.generationId || null, requestedChangeJson: raw.requestedChange == null ? undefined : json(raw.requestedChange) } });
  await prisma.recommendationExplanationAudit.create({ data: { explanationId: row.id, actorId: userId, eventType: "HOUSEHOLD_APPROVAL_NOTE_ADDED", detailsJson: json({ noteId: created.id, decision, relatedFieldPath: raw.relatedFieldPath || null, relatedRuleId: raw.relatedRuleId || null }) } });
  return created;
}

export async function linkRecommendationExplanationToGeneration(userId: string, generationId: string, generatedPlaylistId: string) {
  const generation = await prisma.smartMixExplanationGeneration.findFirst({ where: { userId, generationId }, include: { traces: true } });
  if (!generation) return null;
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, include: { recipe: true } });
  if (!playlist) return null;
  let row = playlist.recipe?.lastAiProposalId ? await prisma.recommendationExplanation.findUnique({ where: { aiProposalId: playlist.recipe.lastAiProposalId } }) : null;
  if (row?.generationRecordId && row.generationRecordId !== generation.id) {
    const base = row;
    const [assumptions, alternatives, traces] = await Promise.all([
      prisma.explanationAssumption.findMany({ where: { explanationId: base.id } }),
      prisma.explanationAlternative.findMany({ where: { explanationId: base.id } }),
      prisma.recommendationRuleTrace.findMany({ where: { explanationId: base.id } }),
    ]);
    row = await prisma.$transaction(async (tx) => {
      const copy = await tx.recommendationExplanation.create({ data: { ownerId: base.ownerId, recipeId: playlist.recipeId, recipeVersion: playlist.recipeVersionUsed, generatedPlaylistId, generationRecordId: generation.id, source: "STORED_AI_INTERPRETATION", originalRequest: base.originalRequest, originalRequestHash: base.originalRequestHash, originalRequestCreatedAt: base.originalRequestCreatedAt, requestSource: base.requestSource, structuredInterpretationJson: json(base.structuredInterpretationJson), generatedConfigurationJson: json(base.generatedConfigurationJson), generatedSettingsJson: json(base.generatedSettingsJson), validationResultsJson: json(base.validationResultsJson), uncertaintyWarningsJson: json(base.uncertaintyWarningsJson), semanticDiffJson: json(base.semanticDiffJson), overallConfidence: base.overallConfidence, overallConfidenceCategory: base.overallConfidenceCategory, explanationSchemaVersion: base.explanationSchemaVersion, recipeSchemaVersion: base.recipeSchemaVersion, engineVersion: generation.engineVersion, modelProvider: base.modelProvider, modelIdentifier: base.modelIdentifier, privacyMode: base.privacyMode, aiCallRequired: false, interpretationCost: base.interpretationCost, deterministicRenderCost: 0, interpretationHash: base.interpretationHash, configurationHash: base.configurationHash, reproducibilityStatus: base.reproducibilityStatus, reproducibilityReason: base.reproducibilityReason, reproducibilitySnapshotJson: json({ ...(base.reproducibilitySnapshotJson as any), reused_without_ai: true, generation_id: generationId }), metadataSnapshotPolicy: base.metadataSnapshotPolicy, randomSeed: base.randomSeed } });
      if (assumptions.length) {
        await tx.explanationAssumption.createMany({
          data: assumptions.map((item) => ({
            explanationId: copy.id,
            sourceText: item.sourceText,
            description: item.description,
            fieldPath: item.fieldPath,
            inferredValueJson: item.inferredValueJson == null ? undefined : json(item.inferredValueJson),
            confidence: item.confidence,
            confidenceCategory: item.confidenceCategory,
            responsibility: item.responsibility,
            effect: item.effect,
            status: item.status,
            userOverrideValueJson: item.userOverrideValueJson == null ? undefined : json(item.userOverrideValueJson),
            relatedRuleIdsJson: json(item.relatedRuleIdsJson),
            alternativeValuesJson: json(item.alternativeValuesJson),
            acceptedAt: item.acceptedAt,
            rejectedAt: item.rejectedAt,
            modifiedAt: item.modifiedAt,
          })),
        });
      }
      if (alternatives.length) {
        await tx.explanationAlternative.createMany({
          data: alternatives.map((item) => ({
            explanationId: copy.id,
            label: item.label,
            structuredInterpretationJson: json(item.structuredInterpretationJson),
            generatedConfigurationJson:
              item.generatedConfigurationJson == null ? undefined : json(item.generatedConfigurationJson),
            confidence: item.confidence,
            confidenceCategory: item.confidenceCategory,
            differenceSummaryJson: json(item.differenceSummaryJson),
            expectedRuleImpactJson: json(item.expectedRuleImpactJson),
          })),
        });
      }
      if (traces.length) {
        await tx.recommendationRuleTrace.createMany({
          data: traces.map((item) => ({
            explanationId: copy.id,
            nodeType: item.nodeType,
            nodeIdentifier: item.nodeIdentifier,
            sourceNodeId: item.sourceNodeId,
            targetRuleId: item.targetRuleId,
            fieldPath: item.fieldPath,
            inputValueJson: item.inputValueJson == null ? undefined : json(item.inputValueJson),
            outputValueJson: item.outputValueJson == null ? undefined : json(item.outputValueJson),
            responsibility: item.responsibility,
            confidence: item.confidence,
            assumptionsJson: json(item.assumptionsJson),
            validationStatus: item.validationStatus,
            parentNodeIdsJson: json(item.parentNodeIdsJson),
            childNodeIdsJson: json(item.childNodeIdsJson),
          })),
        });
      }
      await tx.recommendationExplanationAudit.create({ data: { explanationId: copy.id, actorId: userId, eventType: "STORED_INTERPRETATION_REUSED", detailsJson: json({ sourceExplanationId: base.id, generationId, aiCalled: false }) } });
      return copy;
    });
  }
  if (!row) {
    const structured = { legacy: false, aiInterpretationAvailable: false, message: "This generation used deterministic Mixarr configuration and did not require AI interpretation." };
    const configuration = generation.settingsSnapshotJson || playlist.resolvedRecipeSnapshotJson || playlist.filtersJson;
    const status = calculateReproducibilityStatus({ structuredInterpretation: structured, generatedConfiguration: configuration, engineVersion: generation.engineVersion, currentEngineVersion: generation.engineVersion, metadataPolicy: "reference-or-snapshot" });
    const snapshot = buildReproducibilitySnapshot({ recipe_schema_version: String(playlist.recipeSchemaVersionUsed || "current"), engine_version: generation.engineVersion, original_request: null, structured_interpretation: structured, generated_configuration: configuration as Record<string, unknown>, assumptions: [], alternatives: [], validation_results: [], metadata_snapshot_policy: "reference-or-snapshot", random_seed: null, provider_context: {}, created_at: generation.createdAt.toISOString() });
    row = await prisma.recommendationExplanation.create({ data: { ownerId: userId, recipeId: playlist.recipeId, recipeVersion: playlist.recipeVersionUsed, generatedPlaylistId, generationRecordId: generation.id, source: "DETERMINISTIC_ENGINE", originalRequest: null, structuredInterpretationJson: json(structured), generatedConfigurationJson: json(configuration), overallConfidence: null, overallConfidenceCategory: "not_applicable", recipeSchemaVersion: String(playlist.recipeSchemaVersionUsed || "current"), engineVersion: generation.engineVersion, aiCallRequired: false, interpretationHash: snapshot.interpretation_hash, configurationHash: snapshot.configuration_hash, reproducibilityStatus: status.status, reproducibilityReason: status.reason, reproducibilitySnapshotJson: json(snapshot) } });
  } else if (!row.generationRecordId) {
    row = await prisma.recommendationExplanation.update({ where: { id: row.id }, data: { generatedPlaylistId, generationRecordId: generation.id, engineVersion: generation.engineVersion } });
  }
  await prisma.recommendationTrackEvaluation.deleteMany({ where: { explanationId: row.id, generationId } });
  const records = generation.traces.flatMap((trace) => trackEvaluationsFromDecision(trace.explanationJson as unknown as SmartMixDecisionExplanation).map((evaluation) => ({ explanationId: row!.id, generationId, trackId: trace.trackId, trackTitle: trace.trackTitle, artistName: trace.artistName, albumName: trace.albumName, selected: trace.decision === "selected", rank: trace.rank, ruleId: evaluation.ruleId, ruleType: evaluation.ruleType, result: evaluation.result, reasonCode: evaluation.reasonCode, inputSnapshotJson: json(evaluation.input), scoreDelta: evaluation.scoreDelta, scoreBefore: evaluation.scoreBefore, scoreAfter: evaluation.scoreAfter, exclusion: evaluation.exclusion, responsibility: evaluation.responsibility, metadataQuality: evaluation.metadataQuality, evaluatedAt: new Date(evaluation.evaluatedAt), expiresAt: trace.decision === "selected" ? null : trace.expiresAt })));
  if (records.length) await prisma.recommendationTrackEvaluation.createMany({ data: records });
  await prisma.recommendationExplanationAudit.create({ data: { explanationId: row.id, actorId: userId, eventType: "DETERMINISTIC_GENERATION_LINKED", detailsJson: json({ generationId, generatedPlaylistId, evaluationEvents: records.length, aiCalled: false }) } });
  return row;
}

export async function exportRecommendationExplanation(userId: string, resourceId: string, format: string) {
  const row = await explanationRow(userId, resourceId);
  const payload = await publicExplanation(row, false) as any;
  const evaluations = await prisma.recommendationTrackEvaluation.findMany({ where: { explanationId: row.id }, orderBy: [{ selected: "desc" }, { rank: "asc" }, { createdAt: "asc" }] });
  const safe = redactExplanationExport({ ...payload, trackEvaluations: evaluations, privacyNotice: `Exported under ${row.privacyMode || "the active Mixarr privacy mode"}. Credentials, authentication data, private prompts, and provider secrets are excluded.` }) as any;
  await prisma.recommendationExplanationAudit.create({ data: { explanationId: row.id, actorId: userId, eventType: "EXPLANATION_EXPORTED", detailsJson: json({ format, evaluationCount: evaluations.length }) } });
  if (format === "json") return { contentType: "application/json; charset=utf-8", extension: "json", body: JSON.stringify(safe, null, 2) };
  const md = markdownExport(safe);
  if (format === "markdown" || format === "md") return { contentType: "text/markdown; charset=utf-8", extension: "md", body: md };
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Mixarr recommendation explanation</title><style>body{font:15px system-ui;max-width:1000px;margin:40px auto;padding:0 20px;color:#172033}pre{white-space:pre-wrap;background:#f4f6f8;padding:16px;border-radius:8px}@media print{body{margin:0;max-width:none}}</style></head><body><pre>${escapeHtml(md)}</pre></body></html>`;
  return { contentType: "text/html; charset=utf-8", extension: "html", body: html };
}

export async function recordRecommendationExplanationAudit(userId: string, resourceId: string, eventType: string, details: unknown = {}) {
  const row = await explanationRow(userId, resourceId, true);
  return prisma.recommendationExplanationAudit.create({ data: { explanationId: row.id, actorId: userId, eventType, detailsJson: json(details) } });
}

function markdownExport(value: any) {
  const lines = [`# Mixarr Recommendation Explanation`, "", `Explanation version: ${value.explanationSchemaVersion}`, `Generation run: ${value.generationRunId || "Not linked"}`, "", "## User intent", "", value.originalRequest || "Original AI request unavailable.", "", "## AI interpretation", "", "```json", JSON.stringify(value.structuredInterpretation, null, 2), "```", "", "## Generated configuration", "", "```json", JSON.stringify(value.generatedConfiguration, null, 2), "```", "", "## Responsibility", "", `- AI Interpretation: ${value.responsibility.ai}`, `- Deterministic Engine: ${value.responsibility.deterministic}`, "", "## Reproducibility", "", `${value.reproducibility.status}: ${value.reproducibility.reason}`, "", "## Track evaluations", ""];
  for (const item of value.trackEvaluations || []) lines.push(`- ${item.trackTitle || item.trackId || "Deleted track"}: ${item.ruleId} — ${item.result} (${item.reasonCode}); score ${item.scoreDelta >= 0 ? "+" : ""}${item.scoreDelta}`);
  return lines.join("\n");
}

const escapeHtml = (value: string) => value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[character]!));
