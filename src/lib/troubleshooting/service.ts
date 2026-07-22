import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { APP_VERSION_NUMBER } from "../appVersion";
import { isUserAdmin } from "../auth";
import { aiRequestCoordinator } from "@/ai/request-coordinator";
import { previewAiRequest } from "@/ai/governance/service";
import { resolveAiProvider } from "@/ai/services/providerService";
import { playlistConfigSchema, previewPlaylistTracks } from "../playlistService";
import { portableRecipeFromRecord } from "../playlistRecipes";
import { resolveRecipeGenerationConfig } from "../mixRecipes/schema";
import {
  ACTION_TYPES, CATEGORY_DETAILS, DIAGNOSTIC_BUNDLE_VERSION, DIAGNOSTIC_ENGINE_VERSION,
  PRIVACY_CATEGORIES, SAFE_DEFAULT_CATEGORIES, SANITIZATION_VERSION, TROUBLESHOOTING_FEATURE_KEY,
  aiTroubleshootingResponseSchema, createSessionSchema, suggestionApplySchema,
  suggestionDecisionSchema, updateSessionSchema, type AiTroubleshootingResponse,
  type DiagnosticBundle, type DiagnosticFinding, type PrivacyCategory,
} from "./contracts";
import { buildCandidateFunnel, runDeterministicChecks } from "./diagnostics";
import { DiagnosticSanitizer, containsLikelySecret } from "./sanitizer";

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue;
const fail = (code: string, message: string, status = 400) => Object.assign(new Error(message), { code, status });
const terminal = new Set(["COMPLETE", "PARTIALLY_COMPLETE", "FAILED", "CANCELLED", "DELETED"]);
const allowedRecipePaths = new Set(["limit", "negativeFilters.excludePlayedWithinDays", "rules", "ruleTree", "safetyRules.maxTracksPerArtist", "safetyRules.avoidSameArtistBackToBack"]);

function safeError(error: unknown) {
  const sanitizer = new DiagnosticSanitizer();
  return sanitizer.sanitizeText(error instanceof Error ? error.message : String(error)).slice(0, 1200);
}

function targetVersion(recipe: { recipeVersion: number; updatedAt: Date }) { return `${recipe.recipeVersion}:${recipe.updatedAt.toISOString()}`; }
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function getPath(value: any, path: string) { return path.split(".").reduce((current, key) => current == null ? undefined : current[key], value); }
function setPath(value: any, path: string, next: unknown) { const keys = path.split("."); let cursor = value; for (const key of keys.slice(0, -1)) cursor = cursor[key] ||= {}; cursor[keys.at(-1)!] = next; }

async function settingFor(userId: string) {
  return prisma.troubleshootingSetting.upsert({ where: { userId }, update: {}, create: { userId, defaultPrivacyCategoriesJson: json(SAFE_DEFAULT_CATEGORIES) } });
}

async function audit(sessionId: string, actorId: string | null, eventType: string, summary?: string, metadata?: unknown, objectType = "TROUBLESHOOTING_SESSION", objectId = sessionId, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  return tx.troubleshootingAuditEvent.create({ data: { sessionId, actorId, eventType, objectType, objectId, summary, safeMetadataJson: metadata == null ? undefined : json(new DiagnosticSanitizer().sanitize(metadata)) } });
}

async function assertHouseholdAccess(userId: string, householdId?: string | null, manage = false) {
  if (!householdId) return;
  const household = await prisma.household.findFirst({ where: { id: householdId, status: "ACTIVE", OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true, ...(manage ? { memberType: { in: ["OWNER", "ADMIN"] } } : {}) } } }] }, select: { ownerId: true } });
  if (!household) throw fail("HOUSEHOLD_ACCESS_DENIED", "This household is unavailable or outside your permitted scope.", 403);
  if (manage && household.ownerId !== userId && !(await isUserAdmin(userId))) throw fail("HOUSEHOLD_POLICY_PERMISSION_REQUIRED", "Household owner or administrator permission is required.", 403);
}

async function ownedSession(userId: string, sessionId: string, details = false) {
  const row = await prisma.troubleshootingSession.findFirst({ where: { id: sessionId, userId, deletedAt: null }, include: details ? { findings: { orderBy: [{ severity: "desc" }, { createdAt: "asc" }] }, suggestions: { orderBy: { createdAt: "asc" } }, auditEvents: { orderBy: { createdAt: "desc" }, take: 100 } } : undefined });
  if (!row) throw fail("SESSION_NOT_FOUND", "Troubleshooting session not found or outside your permitted scope.", 404);
  return row as any;
}

async function assertResourceAccess(userId: string, type?: string | null, id?: string | null) {
  if (!type || !id) return;
  const normalized = type.toUpperCase();
  let exists = false;
  if (normalized === "RECIPE") exists = !!await prisma.playlistRecipe.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } });
  else if (["PLAYLIST", "GENERATED_PLAYLIST"].includes(normalized)) exists = !!await prisma.generatedPlaylist.findFirst({ where: { id, userId }, select: { id: true } });
  else if (normalized === "JOB") exists = !!await prisma.jobHistory.findFirst({ where: { id, userId }, select: { id: true } });
  else if (normalized === "LIBRARY") exists = !!await prisma.library.findFirst({ where: { id, server: { userId } }, select: { id: true } });
  else if (normalized === "AI_PROVIDER" || normalized === "PROVIDER" || normalized === "INTEGRATION") exists = await isUserAdmin(userId);
  else throw fail("UNSUPPORTED_RESOURCE_TYPE", "This resource type cannot be attached to troubleshooting.", 400);
  if (!exists) throw fail("RESOURCE_ACCESS_DENIED", "The related resource is unavailable or outside your permitted scope.", 403);
}

export async function getTroubleshootingSettings(userId: string) {
  const row = await settingFor(userId);
  return { ...row, defaultPrivacyCategories: row.defaultPrivacyCategoriesJson, categories: CATEGORY_DETAILS };
}

export async function updateTroubleshootingSettings(userId: string, raw: unknown) {
  const current = await settingFor(userId);
  const schema = createSessionSchema.pick({ deterministicOnly: true, privacyCategories: true }).partial().extend({
    enabled: createSessionSchema.shape.deterministicOnly.optional(), aiAssistedEnabled: createSessionSchema.shape.deterministicOnly.optional(),
    maximumLogWindowMinutes: createSessionSchema.shape.timeWindowMinutes.optional(), maximumBundleBytes: z.number().int().min(64_000).max(5_000_000).optional(),
    retentionDays: z.number().int().min(1).max(365).optional(), permitTrackMetadata: createSessionSchema.shape.deterministicOnly.optional(),
    permitSanitizedLogs: createSessionSchema.shape.deterministicOnly.optional(), requireAdminApprovalForChanges: createSessionSchema.shape.deterministicOnly.optional(),
    whatIfSimulationsEnabled: createSessionSchema.shape.deterministicOnly.optional(), allowExport: createSessionSchema.shape.deterministicOnly.optional(),
    maximumAiRequestsPerDay: z.number().int().min(0).max(100).optional(), advancedDetailsByDefault: createSessionSchema.shape.deterministicOnly.optional(),
  }).strict();
  const input: any = schema.parse(raw);
  if (input.aiAssistedEnabled || input.permitSanitizedLogs || input.permitTrackMetadata || input.allowExport === true) if (!(await isUserAdmin(userId))) throw fail("ADMIN_REQUIRED", "Administrator permission is required to expand troubleshooting data sharing.", 403);
  const { privacyCategories, deterministicOnly, ...data } = input;
  return prisma.troubleshootingSetting.update({ where: { id: current.id }, data: { ...data, ...(deterministicOnly == null ? {} : { defaultDeterministicOnly: deterministicOnly }), ...(privacyCategories ? { defaultPrivacyCategoriesJson: json(privacyCategories) } : {}) } });
}

export async function createTroubleshootingSession(userId: string, raw: unknown) {
  const input = createSessionSchema.parse(raw); const setting = await settingFor(userId);
  if (!setting.enabled) throw fail("TROUBLESHOOTING_DISABLED", "Troubleshooting is disabled in settings.", 403);
  await assertHouseholdAccess(userId, input.householdId); await assertResourceAccess(userId, input.relatedResourceType, input.relatedResourceId);
  const categories = enforceCategories(input.privacyCategories, setting);
  if (!input.deterministicOnly && !setting.aiAssistedEnabled) throw fail("AI_TROUBLESHOOTING_DISABLED", "AI-assisted troubleshooting is disabled. Deterministic diagnostics remain available.", 403);
  const expiresAt = new Date(Date.now() + setting.retentionDays * 86_400_000);
  const row = await prisma.troubleshootingSession.create({ data: { userId, householdId: input.householdId, status: "AWAITING_APPROVAL", problemCategory: input.problemCategory, problemDescription: input.problemDescription, relatedResourceType: input.relatedResourceType?.toUpperCase(), relatedResourceId: input.relatedResourceId, privacySelectionsJson: json(categories), deterministicOnly: input.deterministicOnly, diagnosticTimeWindowMinutes: Math.min(input.timeWindowMinutes, setting.maximumLogWindowMinutes), bundleVersion: DIAGNOSTIC_BUNDLE_VERSION, sanitizationVersion: SANITIZATION_VERSION, diagnosticVersion: DIAGNOSTIC_ENGINE_VERSION, targetVersion: APP_VERSION_NUMBER, expiresAt, progressJson: json({ stage: "AWAITING_APPROVAL", percent: 0 }) } });
  await audit(row.id, userId, "SESSION_CREATED", "Troubleshooting session created.", { category: row.problemCategory, deterministicOnly: row.deterministicOnly, privacyCategories: categories });
  return row;
}

function enforceCategories(raw: readonly string[], setting: Awaited<ReturnType<typeof settingFor>>) {
  const selected = Array.from(new Set(raw.filter((item): item is PrivacyCategory => (PRIVACY_CATEGORIES as readonly string[]).includes(item))));
  if (!setting.permitSanitizedLogs && selected.includes("SANITIZED_LOGS")) throw fail("LOG_SHARING_RESTRICTED", "Sanitized log sharing is restricted by policy.", 403);
  if (!setting.permitTrackMetadata && selected.includes("TRACK_METADATA")) throw fail("TRACK_METADATA_RESTRICTED", "Track-level metadata sharing is restricted by policy.", 403);
  return selected;
}

export async function updateTroubleshootingSession(userId: string, sessionId: string, raw: unknown) {
  const input = updateSessionSchema.parse(raw), session = await ownedSession(userId, sessionId), setting = await settingFor(userId);
  if (!(["DRAFT", "AWAITING_APPROVAL", "READY_FOR_ANALYSIS", "COMPLETE", "PARTIALLY_COMPLETE", "FAILED"].includes(session.status))) throw fail("SESSION_BUSY", "Wait for the active troubleshooting step to finish.", 409);
  const categories = input.privacyCategories ? enforceCategories(input.privacyCategories, setting) : undefined;
  if (input.deterministicOnly === false && !setting.aiAssistedEnabled) throw fail("AI_TROUBLESHOOTING_DISABLED", "AI-assisted troubleshooting is disabled.", 403);
  const row = await prisma.troubleshootingSession.update({ where: { id: sessionId }, data: { problemCategory: input.problemCategory, problemDescription: input.problemDescription, privacySelectionsJson: categories ? json(categories) : undefined, deterministicOnly: input.deterministicOnly, diagnosticTimeWindowMinutes: input.timeWindowMinutes ? Math.min(input.timeWindowMinutes, setting.maximumLogWindowMinutes) : undefined, status: "AWAITING_APPROVAL", sanitizedBundleJson: undefined, completedAt: null, errorCode: null, errorMessage: null } });
  await audit(sessionId, userId, "PRIVACY_SELECTIONS_APPROVED", "Diagnostic privacy selections updated.", { categories: categories || session.privacySelectionsJson, deterministicOnly: input.deterministicOnly ?? session.deterministicOnly });
  return row;
}

export async function listTroubleshootingSessions(userId: string, options: { page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, options.page || 1), pageSize = Math.min(50, Math.max(1, options.pageSize || 20));
  const where = { userId, deletedAt: null }; const [sessions, total] = await Promise.all([prisma.troubleshootingSession.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { findings: true, suggestions: true } } } }), prisma.troubleshootingSession.count({ where })]);
  return { sessions, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export async function getTroubleshootingSession(userId: string, sessionId: string) { return ownedSession(userId, sessionId, true); }

async function collectRawBundle(userId: string, session: any): Promise<Omit<DiagnosticBundle, "redaction_summary">> {
  const selected = session.privacySelectionsJson as PrivacyCategory[], approved = (category: PrivacyCategory) => selected.includes(category);
  const notApproved = { availability: "Not approved" }; const now = new Date(); const since = new Date(now.getTime() - session.diagnosticTimeWindowMinutes * 60_000);
  const warnings: string[] = [];
  const base: Omit<DiagnosticBundle, "redaction_summary"> = { bundle_version: "1", generated_at: now.toISOString(), session: { id: session.id, createdAt: session.createdAt, deterministicOnly: session.deterministicOnly }, problem: { category: session.problemCategory, description: session.problemDescription, relatedResourceType: session.relatedResourceType, relatedResourceId: session.relatedResourceId }, system_summary: { mixarrVersion: APP_VERSION_NUMBER, collectedAt: now.toISOString() }, selected_privacy_categories: selected, recipe_context: notApproved, evaluation_context: { availability: "Not available" }, provider_status: notApproved, plex_status: notApproved, library_statistics: notApproved, track_metadata_summary: notApproved, integration_status: notApproved, recent_jobs: notApproved, sanitized_logs: notApproved, deterministic_findings: [], collection_warnings: warnings };
  if (approved("RECIPE_CONFIGURATION") && session.relatedResourceType === "RECIPE" && session.relatedResourceId) {
    const recipe = await prisma.playlistRecipe.findFirst({ where: { id: session.relatedResourceId, userId, deletedAt: null } });
    base.recipe_context = recipe ? { id: recipe.id, name: recipe.name, schemaVersion: recipe.schemaVersion, recipeVersion: recipe.recipeVersion, filters: recipe.filtersJson, targets: recipe.targetsJson, variety: recipe.varietyJson, updatedAt: recipe.updatedAt } : { availability: "Not available" };
  }
  if (approved("PROVIDER_STATUS")) base.provider_status = await prisma.aiProviderConfig.findMany({ where: { enabled: true }, select: { id: true, displayName: true, providerType: true, locationClassification: true, updatedAt: true, health: { select: { healthState: true, authenticationState: true, latencyMs: true, errorCategory: true, sanitizedMessage: true, lastCheckAt: true } } }, take: 50 }).then((rows) => rows.map((row) => ({ id: row.id, displayName: row.displayName, providerType: row.providerType, location: row.locationClassification, updatedAt: row.updatedAt, ...row.health })));
  if (approved("PLEX_STATUS")) {
    const servers = await prisma.server.findMany({ where: { userId }, select: { id: true, name: true, enabled: true, availabilityState: true, failureCount: true, lastSuccessAt: true, lastFailureAt: true, lastFailureReason: true, responseLatencyMs: true }, take: 20 });
    base.plex_status = { configuredServers: servers.length, unavailableServers: servers.filter((row) => row.enabled && !["AVAILABLE", "HEALTHY", "UNKNOWN"].includes(row.availabilityState)).length, servers, collectedAt: now.toISOString() };
  }
  if (approved("LIBRARY_STATISTICS")) {
    const scope = session.relatedResourceType === "LIBRARY" ? { id: session.relatedResourceId } : {};
    const libraries = await prisma.library.findMany({ where: { ...scope, server: { userId } }, select: { id: true, name: true, scanState: true, lastScanCompletedAt: true }, take: 100 }); const ids = libraries.map((row) => row.id);
    if (ids.length) { const where = { libraryId: { in: ids }, syncStatus: "active" }; const [totalTracks, missingBpm, missingGenres, missingEnergy] = await Promise.all([prisma.track.count({ where }), prisma.track.count({ where: { ...where, effectiveBpm: null, bpm: null } }), prisma.track.count({ where: { ...where, tags: { none: { type: { in: ["genre", "style"] } } } } }), prisma.track.count({ where: { ...where, audioFeature: null } })]); base.library_statistics = { libraries, totalTracks, missingBpm, missingGenres, missingEnergy, collectedAt: now.toISOString() }; } else base.library_statistics = { availability: "Not available" };
  }
  if (approved("RECENT_JOB_HISTORY")) base.recent_jobs = await prisma.jobHistory.findMany({ where: { userId, startedAt: { gte: since }, ...(session.relatedResourceType === "JOB" ? { id: session.relatedResourceId } : {}) }, orderBy: { startedAt: "desc" }, take: 100, select: { id: true, type: true, name: true, status: true, trigger: true, summary: true, error: true, startedAt: true, finishedAt: true, durationMs: true, attempted: true, processed: true, skipped: true, failed: true } });
  if (approved("SANITIZED_LOGS")) base.sanitized_logs = await prisma.jobHistory.findMany({ where: { userId, startedAt: { gte: since }, OR: [{ error: { not: null } }, { status: "failed" }] }, orderBy: { startedAt: "desc" }, take: 100, select: { id: true, type: true, status: true, error: true, startedAt: true } });
  if (approved("INTEGRATION_CONFIGURATION")) base.integration_status = await prisma.integrationConfiguration.findMany({ select: { id: true, key: true, displayName: true, enabled: true, status: true, lastSuccessAt: true, lastFailureAt: true, lastFailureReason: true, failureCount: true, updatedAt: true }, take: 100 });
  if (approved("TRACK_METADATA")) base.track_metadata_summary = { availability: "Not applicable", note: "Track-level rows are collected only by a resource-specific evaluator; broad library samples are prohibited." };
  await addEvaluationContext(userId, session, base);
  return base;
}

async function addEvaluationContext(userId: string, session: any, base: Omit<DiagnosticBundle, "redaction_summary">) {
  if (!["PLAYLIST", "GENERATED_PLAYLIST"].includes(session.relatedResourceType || "")) return;
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: session.relatedResourceId, userId }, select: { id: true, plexPlaylistTitle: true, trackCount: true, filtersJson: true, betaMetadataJson: true, qualityScoreJson: true, updatedAt: true } });
  if (!playlist) return;
  const metadata: any = playlist.betaMetadataJson || {}; const trace: any = metadata.candidateFunnel || metadata.rejectionFunnel || (playlist.qualityScoreJson as any)?.candidateFunnel;
  if (trace && Number.isFinite(Number(trace.totalScanned)) && trace.firstRejectionCounts) {
    base.evaluation_context = { resource: { type: "GENERATED_PLAYLIST", id: playlist.id, label: playlist.plexPlaylistTitle }, candidateFunnel: buildCandidateFunnel({ totalScanned: Number(trace.totalScanned), requested: Number(trace.requested || getPath(playlist.filtersJson, "limit") || playlist.trackCount), selected: Number(trace.selected ?? playlist.trackCount), firstRejectionCounts: trace.firstRejectionCounts, overlapCounts: trace.overlapCounts }), observedAt: playlist.updatedAt };
  } else base.evaluation_context = { resource: { type: "GENERATED_PLAYLIST", id: playlist.id, label: playlist.plexPlaylistTitle }, selectedTracks: playlist.trackCount, availability: "Detailed rejection funnel was not retained for this historical generation" };
}

async function buildBundle(userId: string, session: any) {
  const raw = await collectRawBundle(userId, session); const sanitizer = new DiagnosticSanitizer(); const sanitized = sanitizer.sanitize(raw) as Omit<DiagnosticBundle, "redaction_summary">;
  const bundle: DiagnosticBundle = { ...sanitized, redaction_summary: sanitizer.summary }; const setting = await settingFor(userId); const size = Buffer.byteLength(JSON.stringify(bundle), "utf8");
  if (size > setting.maximumBundleBytes) throw fail("DIAGNOSTIC_BUNDLE_TOO_LARGE", `The sanitized diagnostic bundle is ${size} bytes and exceeds the configured ${setting.maximumBundleBytes}-byte limit. Remove a category or shorten the time window.`, 413);
  if (containsLikelySecret(bundle)) throw fail("SANITIZATION_VALIDATION_FAILED", "The diagnostic bundle did not pass the final credential scan. Nothing was stored or shared.", 500);
  return bundle;
}

export async function previewDiagnosticBundle(userId: string, sessionId: string) {
  const session = await ownedSession(userId, sessionId); const bundle = await buildBundle(userId, session);
  await audit(sessionId, userId, "DIAGNOSTIC_PREVIEW_CREATED", "Sanitized diagnostic preview created.", { redactionSummary: bundle.redaction_summary, categories: bundle.selected_privacy_categories });
  return { bundle, estimatedBytes: Buffer.byteLength(JSON.stringify(bundle), "utf8"), persisted: false, aiSubmitted: false };
}

export async function diagnoseTroubleshootingSession(userId: string, sessionId: string) {
  const session = await ownedSession(userId, sessionId); if (terminal.has(session.status) && session.status !== "FAILED") throw fail("SESSION_ALREADY_FINAL", "This session has already completed.", 409);
  await prisma.troubleshootingSession.update({ where: { id: sessionId }, data: { status: "COLLECTING", progressJson: json({ stage: "COLLECTING", percent: 15 }), errorCode: null, errorMessage: null } });
  try {
    const bundle = await buildBundle(userId, session); await prisma.troubleshootingSession.update({ where: { id: sessionId }, data: { status: "RUNNING_CHECKS", sanitizedBundleJson: json(bundle), redactionSummaryJson: json(bundle.redaction_summary), progressJson: json({ stage: "RUNNING_CHECKS", percent: 65 }) } });
    const findings = runDeterministicChecks(bundle); bundle.deterministic_findings = findings;
    await prisma.$transaction(async (tx) => { await tx.troubleshootingFinding.deleteMany({ where: { sessionId } }); await tx.troubleshootingSuggestion.deleteMany({ where: { sessionId, status: { in: ["PROPOSED", "AWAITING_REVIEW"] } } }); for (const item of findings) await tx.troubleshootingFinding.create({ data: findingData(sessionId, item) }); await tx.troubleshootingSession.update({ where: { id: sessionId }, data: { status: session.deterministicOnly ? "COMPLETE" : "READY_FOR_ANALYSIS", sanitizedBundleJson: json(bundle), completedAt: session.deterministicOnly ? new Date() : null, summary: findings[0]?.summary, evidenceStrengthSummary: strongestEvidence(findings), progressJson: json({ stage: session.deterministicOnly ? "COMPLETE" : "READY_FOR_ANALYSIS", percent: session.deterministicOnly ? 100 : 80 }) } }); await audit(sessionId, userId, "DIAGNOSTIC_CHECK_COMPLETED", `${findings.length} deterministic finding${findings.length === 1 ? "" : "s"} produced.`, { findingIds: findings.map((item) => item.checkId), redactionSummary: bundle.redaction_summary }, "TROUBLESHOOTING_SESSION", sessionId, tx); });
    await createDeterministicSuggestions(userId, sessionId);
    return ownedSession(userId, sessionId, true);
  } catch (error) { await prisma.troubleshootingSession.update({ where: { id: sessionId }, data: { status: "FAILED", errorCode: String((error as any)?.code || "DIAGNOSTIC_FAILED"), errorMessage: safeError(error), progressJson: json({ stage: "FAILED", percent: 100 }), completedAt: new Date() } }); await audit(sessionId, userId, "DIAGNOSTIC_COLLECTION_FAILED", "Diagnostic collection failed.", { code: (error as any)?.code || "DIAGNOSTIC_FAILED" }); throw error; }
}

function findingData(sessionId: string, item: DiagnosticFinding) { return { sessionId, checkId: item.checkId, checkVersion: item.checkVersion, category: item.category, title: item.title, severity: item.severity, evidenceStrength: item.evidenceStrength, summary: item.summary, observedValuesJson: json(item.observedValues), expectedValuesJson: json(item.expectedValues), evidenceJson: json(item.evidence), affectedResourcesJson: json(item.affectedResources), possibleActionsJson: json(item.possibleActions), limitationsJson: json(item.limitations), dataFreshness: item.dataFreshness }; }
function strongestEvidence(findings: DiagnosticFinding[]) { for (const level of ["CONFIRMED", "STRONG", "MODERATE", "WEAK", "INSUFFICIENT_DATA"]) if (findings.some((item) => item.evidenceStrength === level)) return level; return "INSUFFICIENT_DATA"; }

async function createDeterministicSuggestions(userId: string, sessionId: string) {
  const session = await ownedSession(userId, sessionId, true), shortage = session.findings.find((item: any) => item.checkId === "recipe.candidate_pool.exhausted"); if (!shortage) return;
  let recipe: any = null;
  if (session.relatedResourceType === "RECIPE") recipe = await prisma.playlistRecipe.findFirst({ where: { id: session.relatedResourceId, userId, deletedAt: null } });
  if (!recipe && ["PLAYLIST", "GENERATED_PLAYLIST"].includes(session.relatedResourceType || "")) { const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: session.relatedResourceId, userId }, select: { recipeId: true } }); if (playlist?.recipeId) recipe = await prisma.playlistRecipe.findFirst({ where: { id: playlist.recipeId, userId, deletedAt: null } }); }
  if (!recipe) return; const filters: any = recipe.filtersJson; const version = targetVersion(recipe); const funnel: any = (shortage.observedValuesJson as any)?.candidateFunnel; const stages = new Set((funnel?.stages || []).filter((item: any) => item.rejected > 0).map((item: any) => item.id)); const suggestions: any[] = [];
  const recent = getPath(filters, "negativeFilters.excludePlayedWithinDays"); if (stages.has("recent_play") && Number(recent) > 1) suggestions.push({ settingPath: "negativeFilters.excludePlayedWithinDays", title: "Reduce the recent-play exclusion", current: recent, proposed: Math.max(1, Math.floor(Number(recent) / 2)), explanation: "The deterministic funnel shows that recent-play exclusions removed candidates.", effect: "May allow recently played tracks back into the candidate pool." });
  const yearRules = Array.isArray(filters.rules) ? filters.rules.filter((rule: any) => ["year", "release_year"].includes(rule.field)) : []; if (stages.has("release_year") && yearRules.length) { const proposed = filters.rules.map((rule: any) => !["year", "release_year"].includes(rule.field) ? rule : { ...rule, value: String(Math.max(1900, Number(rule.value) + (["gte", "gt"].includes(rule.operator) ? -5 : 4))) }); suggestions.push({ settingPath: "rules", title: "Expand the release period", current: filters.rules, proposed, explanation: "Release-year requirements are a major deterministic rejection stage.", effect: "Widens the years eligible for evaluation." }); }
  const genreRules = Array.isArray(filters.rules) ? filters.rules.filter((rule: any) => rule.field === "genre") : []; if (stages.has("genre") && genreRules.length > 1) suggestions.push({ settingPath: "rules", title: "Treat the secondary genre as a preference", current: filters.rules, proposed: filters.rules.filter((rule: any) => rule !== genreRules[1]), explanation: "Genre requirements account for the largest first-rejection stage. Mixarr cannot represent a soft preference in this legacy rule list, so this suggestion removes only the secondary hard requirement for review.", effect: "Leaves the primary genre requirement in place while broadening eligibility." });
  if (!suggestions.length && Number(filters.limit) > funnel?.eligible) suggestions.push({ settingPath: "limit", title: "Reduce requested playlist size", current: filters.limit, proposed: Math.max(1, Number(funnel.eligible)), explanation: "The requested playlist size exceeds the eligible deterministic candidate pool.", effect: "Aligns the request with the currently eligible pool." });
  for (const item of suggestions) await prisma.troubleshootingSuggestion.create({ data: { sessionId, source: "DETERMINISTIC", supportingFindingIdsJson: json([shortage.checkId]), actionType: item.settingPath === "limit" ? "RECIPE_REDUCE_PLAYLIST_SIZE" : "RECIPE_SET_VALUE", targetResourceType: "RECIPE", targetResourceId: recipe.id, settingPath: item.settingPath, title: item.title, currentValueJson: json(item.current), proposedValueJson: json(item.proposed), explanation: item.explanation, expectedEffect: item.effect, possibleSideEffectsJson: json(["Playlist composition may change after a future separately approved generation."]), riskLevel: "LOW", reversible: true, manualOnly: false, backupRecommended: false, requiredPermission: "APPLY_RECIPE_CHANGES", status: "AWAITING_REVIEW", targetVersion: version } });
}

function minimalAiContext(session: any): Record<string, unknown> {
  const bundle = session.sanitizedBundleJson as DiagnosticBundle; const allowed = new Set((session.privacySelectionsJson || []) as string[]);
  return { problem: bundle.problem, findings: session.findings.map((item: any) => ({ id: item.checkId, title: item.title, severity: item.severity, evidenceStrength: item.evidenceStrength, summary: item.summary, observedValues: item.observedValuesJson, limitations: item.limitationsJson })), approvedContext: { recipe: allowed.has("RECIPE_CONFIGURATION") ? bundle.recipe_context : undefined, providers: allowed.has("PROVIDER_STATUS") ? bundle.provider_status : undefined, plex: allowed.has("PLEX_STATUS") ? bundle.plex_status : undefined, library: allowed.has("LIBRARY_STATISTICS") ? bundle.library_statistics : undefined, jobs: allowed.has("RECENT_JOB_HISTORY") ? bundle.recent_jobs : undefined, logs: allowed.has("SANITIZED_LOGS") ? bundle.sanitized_logs : undefined }, collectionWarnings: bundle.collection_warnings };
}

export async function previewTroubleshootingAiRequest(userId: string, sessionId: string) {
  const session = await ownedSession(userId, sessionId, true), setting = await settingFor(userId); if (session.deterministicOnly || !setting.aiAssistedEnabled) throw fail("AI_TROUBLESHOOTING_DISABLED", "This session is deterministic-only or AI troubleshooting is disabled.", 409); if (session.status !== "READY_FOR_ANALYSIS") throw fail("DETERMINISTIC_DIAGNOSTICS_REQUIRED", "Run deterministic diagnostics before previewing an AI explanation.", 409);
  const [global, feature, governance] = await Promise.all([prisma.aiGlobalSetting.findUnique({ where: { id: "global" } }), prisma.aiFeatureSetting.findUnique({ where: { featureKey: TROUBLESHOOTING_FEATURE_KEY } }), prisma.aiGovernanceSetting.findUnique({ where: { id: "global" } })]); if (!global?.enabled || !feature?.enabled) throw fail("AI_DISABLED", "AI is disabled for troubleshooting. Deterministic findings remain available.", 409); const providerId = feature.preferredProviderId || global.defaultProviderId; if (!providerId) throw fail("PROVIDER_NOT_CONFIGURED", "No AI provider is configured for troubleshooting.", 409); const provider = await resolveAiProvider(providerId), model = feature.preferredModel || provider.defaultModel; if (!model) throw fail("MODEL_NOT_CONFIGURED", "No model is configured for troubleshooting.", 409);
  const context = minimalAiContext(session); const request = { featureKey: TROUBLESHOOTING_FEATURE_KEY, messages: [{ role: "user" as const, content: JSON.stringify(context) }], maxOutputTokens: 2000, privacyMode: (governance?.privacyMode || "METADATA_LIMITED") as any, requestSource: "FOREGROUND" as const, metadata: { workflow: "troubleshooting_explanation", sessionId, deterministicFindings: session.findings.length }, contextTrimmingStrategy: "REMOVE_LOWEST_PRIORITY" as const };
  const preview = await previewAiRequest({ request, provider, model, userId }); return { provider: { id: provider.id, name: provider.displayName, location: provider.locationClassification }, model, privacyMode: preview.privacyMode, estimatedInputTokens: preview.limits.estimatedInputTokens, maximumOutputTokens: preview.limits.maxOutputTokens, estimatedCost: preview.cost.expectedEstimatedCost, maximumEstimatedCost: preview.cost.maximumEstimatedCost, currency: preview.cost.currency, approvedCategories: session.privacySelectionsJson, trackLevelIncluded: (session.privacySelectionsJson as string[]).includes("TRACK_METADATA"), omittedByPolicy: preview.privacyReport, localOnly: preview.privacyMode === "LOCAL_ONLY", submitted: false };
}

export async function explainTroubleshootingSession(userId: string, sessionId: string) {
  const session = await ownedSession(userId, sessionId, true), setting = await settingFor(userId); if (session.status !== "READY_FOR_ANALYSIS") throw fail("DETERMINISTIC_DIAGNOSTICS_REQUIRED", "Complete deterministic diagnostics before requesting an AI explanation.", 409); if (session.deterministicOnly || !setting.aiAssistedEnabled) throw fail("AI_TROUBLESHOOTING_DISABLED", "AI troubleshooting is disabled. Deterministic findings remain available.", 409);
  const today = new Date(); today.setHours(0, 0, 0, 0); const used = await prisma.troubleshootingSession.count({ where: { userId, createdAt: { gte: today }, aiRequestStatus: { in: ["REQUESTING", "COMPLETED", "FAILED"] } } }); if (used >= setting.maximumAiRequestsPerDay) throw fail("AI_DAILY_LIMIT_REACHED", "The troubleshooting AI request limit has been reached. Deterministic findings remain available.", 429);
  await prisma.troubleshootingSession.update({ where: { id: sessionId }, data: { status: "REQUESTING_AI", aiRequestStatus: "REQUESTING", progressJson: json({ stage: "WAITING_FOR_AI_PROVIDER", percent: 88 }) } }); await audit(sessionId, userId, "AI_EXPLANATION_REQUESTED", "AI explanation requested after deterministic diagnostics.", { categories: session.privacySelectionsJson });
  try {
    const context = minimalAiContext(session); const response = await aiRequestCoordinator.complete<AiTroubleshootingResponse>({ featureKey: TROUBLESHOOTING_FEATURE_KEY, systemInstructions: "Explain only the deterministic findings provided. Do not invent facts, metrics, resources, settings, or confidence percentages. Every cause and action must cite provided finding IDs. Use only allowlisted action types. Never recommend automatic destructive actions. State that no settings have been changed.", messages: [{ role: "user", content: JSON.stringify(context) }], responseFormat: { type: "json", name: "mixarr_troubleshooting_explanation_v1", schema: aiTroubleshootingResponseSchema, unknownFields: "reject" }, maxOutputTokens: 2000, maxResponseBytes: 128_000, timeoutMs: 120_000, requestSource: "FOREGROUND", metadata: { workflow: "troubleshooting_explanation", sessionId, findingCount: session.findings.length }, contextTrimmingStrategy: "REMOVE_LOWEST_PRIORITY", allowFallback: true }, userId);
    const explanation = response.data!; validateAiReferences(explanation, session.findings); const sanitized = new DiagnosticSanitizer().sanitize(explanation); if (containsLikelySecret(sanitized)) throw fail("AI_RESPONSE_SANITIZATION_FAILED", "The AI response failed the final privacy scan and was not displayed.", 502);
    await persistAiSuggestions(session, sanitized);
    await prisma.troubleshootingSession.update({ where: { id: sessionId }, data: { status: "COMPLETE", aiRequestStatus: "COMPLETED", aiProviderId: response.providerId, aiProviderName: response.providerType, aiModel: response.model, aiUsageJson: response.usage ? json(response.usage) : undefined, aiCost: response.actualCost ?? response.estimatedCost, aiExplanationJson: json(sanitized), summary: sanitized.summary, completedAt: new Date(), progressJson: json({ stage: "COMPLETE", percent: 100 }) } }); await audit(sessionId, userId, "AI_EXPLANATION_COMPLETED", "AI explanation validated and stored.", { provider: response.providerType, model: response.model, usage: response.usage, cost: response.actualCost ?? response.estimatedCost, responseValidation: "PASSED" }); return ownedSession(userId, sessionId, true);
  } catch (error) { await prisma.troubleshootingSession.update({ where: { id: sessionId }, data: { status: "PARTIALLY_COMPLETE", aiRequestStatus: "FAILED", errorCode: String((error as any)?.category || (error as any)?.code || "AI_EXPLANATION_FAILED"), errorMessage: safeError(error), completedAt: new Date(), progressJson: json({ stage: "PARTIALLY_COMPLETE", percent: 100, deterministicFindingsRetained: true }) } }); await audit(sessionId, userId, "AI_EXPLANATION_FAILED", "AI explanation failed; deterministic findings were retained.", { code: (error as any)?.category || (error as any)?.code || "AI_EXPLANATION_FAILED" }); throw error; }
}

function validateAiReferences(explanation: AiTroubleshootingResponse, findings: any[]) { const ids = new Set(findings.map((item) => item.checkId)); for (const item of [...explanation.most_likely_causes, ...explanation.suggested_actions]) if (item.finding_ids.some((id) => !ids.has(id))) throw fail("AI_RESPONSE_UNSUPPORTED_REFERENCE", "The AI response referred to evidence that was not produced by deterministic diagnostics.", 502); }

async function persistAiSuggestions(session: any, explanation: AiTroubleshootingResponse) {
  const findingIds = new Set(session.findings.map((item: any) => item.checkId));
  for (const item of explanation.suggested_actions) {
    let current: unknown = null, targetVersionValue: string | null = null, manualOnly = item.manual_only;
    if (item.target_resource_type === "RECIPE" && item.target_resource_id && item.setting_path && allowedRecipePaths.has(item.setting_path)) { const recipe = await prisma.playlistRecipe.findFirst({ where: { id: item.target_resource_id, userId: session.userId, deletedAt: null } }); if (recipe) { current = getPath(recipe.filtersJson, item.setting_path); targetVersionValue = targetVersion(recipe); } else manualOnly = true; } else if (item.action_type.startsWith("RECIPE_")) manualOnly = true;
    await prisma.troubleshootingSuggestion.create({ data: { sessionId: session.id, source: "AI", supportingFindingIdsJson: json(item.finding_ids.filter((id) => findingIds.has(id))), actionType: item.action_type, targetResourceType: item.target_resource_type, targetResourceId: item.target_resource_id, settingPath: item.setting_path, title: item.title, currentValueJson: current == null ? undefined : json(current), proposedValueJson: item.proposed_value == null ? undefined : json(item.proposed_value), explanation: item.explanation, expectedEffect: item.expected_effect, possibleSideEffectsJson: json(item.possible_side_effects), riskLevel: item.risk_level, reversible: item.reversible, manualOnly, backupRecommended: item.risk_level !== "LOW", requiredPermission: item.action_type.startsWith("RECIPE_") ? "APPLY_RECIPE_CHANGES" : null, status: "AWAITING_REVIEW", targetVersion: targetVersionValue } });
  }
}

async function ownedSuggestion(userId: string, suggestionId: string) { const row = await prisma.troubleshootingSuggestion.findFirst({ where: { id: suggestionId, session: { userId, deletedAt: null } }, include: { session: true } }); if (!row) throw fail("SUGGESTION_NOT_FOUND", "Troubleshooting suggestion not found.", 404); return row; }
export async function decideTroubleshootingSuggestion(userId: string, suggestionId: string, decision: "ACCEPT" | "REJECT" | "DISMISS" | "COMPLETE_MANUALLY", raw: unknown) { const input = suggestionDecisionSchema.parse(raw), row = await ownedSuggestion(userId, suggestionId); if (!["PROPOSED", "AWAITING_REVIEW", "ACCEPTED"].includes(row.status)) throw fail("SUGGESTION_ALREADY_REVIEWED", "This suggestion is no longer awaiting review.", 409); const status = decision === "ACCEPT" ? "ACCEPTED" : decision === "REJECT" ? "REJECTED" : decision === "DISMISS" ? "DISMISSED" : "COMPLETED_MANUALLY"; const updated = await prisma.troubleshootingSuggestion.update({ where: { id: suggestionId }, data: { status, reviewerId: userId, reviewedAt: new Date(), reviewReason: input.reason, appliedAt: status === "COMPLETED_MANUALLY" ? new Date() : undefined } }); await audit(row.sessionId, userId, `SUGGESTION_${decision}`, `Suggestion ${status.toLowerCase().replace(/_/g, " ")}.`, { suggestionId, actionType: row.actionType }, "TROUBLESHOOTING_SUGGESTION", suggestionId); return updated; }

export async function simulateTroubleshootingSuggestion(userId: string, suggestionId: string) {
  const row = await ownedSuggestion(userId, suggestionId), setting = await settingFor(userId); if (!setting.whatIfSimulationsEnabled) throw fail("SIMULATIONS_DISABLED", "What-if simulations are disabled.", 403); if (row.targetResourceType !== "RECIPE" || !row.targetResourceId || !row.settingPath || !allowedRecipePaths.has(row.settingPath) || row.proposedValueJson == null) throw fail("SIMULATION_UNSUPPORTED", "This suggestion requires a manual step and cannot be simulated by Mixarr.", 409);
  const recipe = await prisma.playlistRecipe.findFirst({ where: { id: row.targetResourceId, userId, deletedAt: null } }); if (!recipe) throw fail("RECIPE_NOT_FOUND", "The target recipe no longer exists.", 404); const version = targetVersion(recipe); if (row.targetVersion !== version) { await prisma.troubleshootingSuggestion.update({ where: { id: row.id }, data: { status: "NO_LONGER_APPLICABLE", validationResultJson: json({ valid: false, reason: "STALE_TARGET_VERSION", expected: row.targetVersion, current: version }) } }); throw fail("SUGGESTION_STALE", "The recipe changed after this suggestion was created. Run diagnostics again.", 409); }
  const cacheKey = digest({ version, path: row.settingPath, proposed: row.proposedValueJson }); if (row.simulationInputHash === cacheKey && row.simulationJson) return row.simulationJson;
  const portable = portableRecipeFromRecord(recipe), before = resolveRecipeGenerationConfig(portable), after = structuredClone(before) as any; setPath(after, row.settingPath, row.proposedValueJson); playlistConfigSchema.parse(after); const started = Date.now(); const [baseline, proposed] = await Promise.all([previewPlaylistTracks({ userId, config: before, displayLimit: 1 }), previewPlaylistTracks({ userId, config: after, displayLimit: 1 })]); const result = { simulation: true, persistedChanges: false, exactChange: { path: row.settingPath, before: row.currentValueJson, after: row.proposedValueJson }, candidateCountBefore: baseline.summary.matchingTrackCount, candidateCountAfter: proposed.summary.matchingTrackCount, playlistFillBefore: baseline.summary.finalTrackCount, playlistFillAfter: proposed.summary.finalTrackCount, expectedFillImprovement: proposed.summary.finalTrackCount - baseline.summary.finalTrackCount, performanceCostMs: Date.now() - started, newWarnings: proposed.warnings.filter((warning: string) => !baseline.warnings.includes(warning)), inputVersion: version, sideEffects: { recipeUpdated: false, playlistWritten: false, historyUpdated: false, notificationsTriggered: false, integrationsTriggered: false } };
  await prisma.troubleshootingSuggestion.update({ where: { id: row.id }, data: { simulationJson: json(result), simulationInputHash: cacheKey } }); await audit(row.sessionId, userId, "SUGGESTION_SIMULATED", "A non-persistent deterministic simulation completed.", { suggestionId, candidateCountBefore: result.candidateCountBefore, candidateCountAfter: result.candidateCountAfter }, "TROUBLESHOOTING_SUGGESTION", suggestionId); return result;
}

export async function applyTroubleshootingSuggestion(userId: string, suggestionId: string, raw: unknown) {
  const input = suggestionApplySchema.parse(raw), row = await ownedSuggestion(userId, suggestionId); if (row.status !== "ACCEPTED") throw fail("SUGGESTION_NOT_ACCEPTED", "Accept the suggestion before applying it.", 409); if (row.manualOnly || row.riskLevel === "DESTRUCTIVE") throw fail("MANUAL_ACTION_REQUIRED", "This action must be completed through its existing dedicated workflow.", 409); if (row.targetResourceType !== "RECIPE" || !row.targetResourceId || !row.settingPath || !allowedRecipePaths.has(row.settingPath) || row.proposedValueJson == null) throw fail("ACTION_NOT_ALLOWLISTED", "This suggestion is not supported by the allowlisted action handler.", 403);
  const setting = await settingFor(userId); if (setting.requireAdminApprovalForChanges && !(await isUserAdmin(userId))) throw fail("ADMIN_APPROVAL_REQUIRED", "Administrator approval is required for troubleshooting configuration changes.", 403);
  const recipe = await prisma.playlistRecipe.findFirst({ where: { id: row.targetResourceId, userId, deletedAt: null } }); if (!recipe) throw fail("RECIPE_NOT_FOUND", "The target recipe no longer exists.", 404); const version = targetVersion(recipe); if (row.targetVersion !== version || input.expectedTargetVersion !== version) { await prisma.troubleshootingSuggestion.update({ where: { id: row.id }, data: { status: "NO_LONGER_APPLICABLE", validationResultJson: json({ valid: false, reason: "STALE_TARGET_VERSION", expected: row.targetVersion, current: version }) } }); throw fail("SUGGESTION_STALE", "The recipe changed after this suggestion was created. No change was applied.", 409); }
  const filters: any = structuredClone(recipe.filtersJson as any); const current = getPath(filters, row.settingPath); if (JSON.stringify(current) !== JSON.stringify(row.currentValueJson)) throw fail("SUGGESTION_STALE", "The current recipe value no longer matches the reviewed before value.", 409); setPath(filters, row.settingPath, row.proposedValueJson); const validated = playlistConfigSchema.parse(filters); const nextVersion = recipe.recipeVersion + 1;
  await prisma.$transaction(async (tx) => { await tx.troubleshootingSuggestion.update({ where: { id: row.id }, data: { status: "APPLYING" } }); await tx.playlistRecipe.update({ where: { id: recipe.id }, data: { filtersJson: json(validated), recipeVersion: nextVersion, manuallyEditedAfterAi: true } }); await tx.playlistRecipeRevision.create({ data: { recipeId: recipe.id, recipeVersion: nextVersion, schemaVersion: recipe.schemaVersion, changeType: "TROUBLESHOOTING_APPROVED_CHANGE", changedFieldsJson: json([row.settingPath]), portableSnapshotJson: json({ ...portableRecipeFromRecord(recipe), recipeVersion: nextVersion, filters: validated }), structuredDiffJson: json([{ path: row.settingPath, before: current, after: row.proposedValueJson }]) } }); await tx.troubleshootingSuggestion.update({ where: { id: row.id }, data: { status: "APPLIED", appliedAt: new Date(), reviewerId: userId, validationResultJson: json({ valid: true, schema: "playlistConfigSchema", targetVersion: version }), applyResultJson: json({ recipeId: recipe.id, recipeVersion: nextVersion, changedPath: row.settingPath, playlistRegenerated: false }), rollbackReference: `recipe:${recipe.id}:revision:${recipe.recipeVersion}` } }); await audit(row.sessionId, userId, "SUGGESTION_APPLIED", "An explicitly approved recipe setting was applied through validation and revision history.", { suggestionId, recipeId: recipe.id, changedPath: row.settingPath, before: current, after: row.proposedValueJson, recipeVersion: nextVersion, playlistRegenerated: false }, "TROUBLESHOOTING_SUGGESTION", row.id, tx); }); return ownedSuggestion(userId, suggestionId);
}

export async function cancelTroubleshootingSession(userId: string, sessionId: string) { const row = await ownedSession(userId, sessionId); if (terminal.has(row.status)) throw fail("SESSION_ALREADY_FINAL", "This session is already final.", 409); const updated = await prisma.troubleshootingSession.update({ where: { id: sessionId }, data: { status: "CANCELLED", cancelledAt: new Date(), completedAt: new Date(), progressJson: json({ stage: "CANCELLED", percent: 100 }) } }); await audit(sessionId, userId, "SESSION_CANCELLED", "Troubleshooting session cancelled."); return updated; }

export async function exportTroubleshootingSession(userId: string, sessionId: string) { const row = await ownedSession(userId, sessionId, true), setting = await settingFor(userId); if (!setting.allowExport) throw fail("EXPORT_RESTRICTED", "Diagnostic export is restricted by policy.", 403); const report = new DiagnosticSanitizer().sanitize({ schemaVersion: "1", mixarrVersion: APP_VERSION_NUMBER, privacyWarning: "This export contains only approved sanitized diagnostic information. Review it before sharing.", session: { id: row.id, problemCategory: row.problemCategory, problemDescription: row.problemDescription, status: row.status, createdAt: row.createdAt, completedAt: row.completedAt }, privacySelections: row.privacySelectionsJson, redactionSummary: row.redactionSummaryJson, deterministicFindings: row.findings, aiExplanation: row.aiExplanationJson, suggestions: row.suggestions, bundleVersion: row.bundleVersion, diagnosticVersion: row.diagnosticVersion, sanitizationVersion: row.sanitizationVersion }); if (containsLikelySecret(report)) throw fail("EXPORT_SANITIZATION_FAILED", "The export failed its final privacy scan.", 500); await prisma.troubleshootingSession.update({ where: { id: row.id }, data: { exportStatus: "EXPORTED" } }); await audit(row.id, userId, "SESSION_EXPORTED", "Sanitized troubleshooting report exported.", { format: "JSON" }); return { filename: `mixarr-troubleshooting-${row.id}.json`, contentType: "application/json; charset=utf-8", content: JSON.stringify(report, null, 2) }; }

export async function deleteTroubleshootingSession(userId: string, sessionId: string) { const row = await ownedSession(userId, sessionId); const now = new Date(); await prisma.$transaction(async (tx) => { await tx.troubleshootingFinding.deleteMany({ where: { sessionId } }); await tx.troubleshootingSuggestion.deleteMany({ where: { sessionId } }); await tx.troubleshootingSession.update({ where: { id: sessionId }, data: { status: "DELETED", deletedAt: now, sanitizedBundleJson: json({ deleted: true }), aiExplanationJson: undefined, redactionSummaryJson: undefined, problemDescription: "[DELETED]", errorMessage: null, progressJson: json({ stage: "DELETED", percent: 100 }) } }); await audit(sessionId, userId, "SESSION_DELETED", "Troubleshooting session content deleted.", { deletedAt: now.toISOString() }, "TROUBLESHOOTING_SESSION", sessionId, tx); }); return { deleted: true, recoverable: false, sessionId: row.id };
}

export { ACTION_TYPES };
