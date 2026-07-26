import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isUserAdmin } from "@/lib/auth";
import { AiError } from "../errors";
import { aiFeatureByKey } from "../features/registry";
import { FULL_METADATA_POLICY_VERSION, getAiGovernanceSettings, setFullMetadataAcknowledgment, updateAiGovernanceSettings } from "../governance/service";
import { getAiGlobalSettings, listAiFeatures, updateAiFeature, updateAiGlobalSettings } from "../services/settingsService";
import { templateVariables } from "./templates";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const dayStart = (value = new Date()) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
const monthStart = (value = new Date()) => new Date(value.getFullYear(), value.getMonth(), 1);
const cost = (row: { actualCost?: unknown; estimatedCost?: unknown }) => Number(row.actualCost ?? row.estimatedCost ?? 0);

export async function getAiIntelligenceDashboard(userId: string) {
  const admin = await isUserAdmin(userId);
  const now = new Date();
  const requestWhere = admin ? {} : { userId };
  const [global, governance, providers, features, audits, jobs, approvals, naturalRequests, warningCount, governanceEvents, templates, feedback] = await Promise.all([
    getAiGlobalSettings(),
    getAiGovernanceSettings(),
    prisma.aiProviderConfig.findMany({
      where: { deletedAt: null, ...(admin ? {} : { enabled: true, approved: true }) },
      select: { id: true, providerType: true, displayName: true, enabled: true, approved: true, locationClassification: true, defaultModel: true, fallbackProviderId: true, baseUrl: true, lastSuccessfulConnectionAt: true, health: true, models: { where: { enabled: true, approved: true }, select: { modelIdentifier: true, displayName: true, contextSize: true, structuredOutput: true, toolCalling: true, availabilityStatus: true, lastSuccessfulUseAt: true }, take: 100 } },
      orderBy: [{ priority: "asc" }, { displayName: "asc" }],
    }),
    listAiFeatures(),
    prisma.aiRequestAudit.findMany({ where: { ...requestWhere, createdAt: { gte: monthStart(now) } }, orderBy: { createdAt: "desc" }, take: 1000, select: { id: true, requestId: true, correlationId: true, featureKey: true, providerConfigId: true, providerDisplayName: true, model: true, status: true, createdAt: true, completedAt: true, inputTokenCount: true, outputTokenCount: true, cachedTokenCount: true, estimatedCost: true, actualCost: true, locationClassification: true, privacyMode: true, queueWaitMs: true, providerDurationMs: true, timeToFirstTokenMs: true, retryCount: true, fallbackReason: true, errorCategory: true, sanitizedErrorCode: true, approvalStatus: true, contentFingerprint: true } }),
    prisma.aiJob.groupBy({ by: ["status"], where: admin ? {} : { userId }, _count: { _all: true } }),
    prisma.naturalLanguageRequest.count({ where: { ...(admin ? {} : { ownerId: userId }), status: "READY_FOR_APPROVAL" } }),
    prisma.naturalLanguageRequest.findMany({ where: admin ? {} : { ownerId: userId }, orderBy: { updatedAt: "desc" }, take: 12, select: { id: true, ownerId: true, originalRequest: true, originalRequestRetained: true, status: true, providerDisplayName: true, model: true, privacyMode: true, estimatedCost: true, actualCost: true, inputTokenCount: true, outputTokenCount: true, finalRecipeId: true, approvedAt: true, createdAt: true, updatedAt: true, errorCode: true, errorMessage: true, owner: { select: { username: true } } } }),
    prisma.aiAlertEvent.count({ where: { acknowledgedAt: null } }),
    prisma.aiGovernanceAudit.findMany({ orderBy: { createdAt: "desc" }, take: admin ? 20 : 0 }),
    prisma.aiRequestTemplate.count({ where: { OR: [{ ownerId: userId }, { visibility: "HOUSEHOLD", householdId: { in: await accessibleHouseholdIds(userId) } }] } }),
    prisma.aiQualityFeedback.groupBy({ by: ["rating"], where: admin ? {} : { authorId: userId }, _count: { _all: true } }),
  ]);

  const today = dayStart(now);
  const todayRows = audits.filter((row) => row.createdAt >= today);
  const external = audits.filter((row) => row.locationClassification === "EXTERNAL" || row.locationClassification === "REMOTE");
  const externalToday = external.filter((row) => row.createdAt >= today);
  const successful = audits.filter((row) => row.status === "COMPLETED");
  const failed = audits.filter((row) => ["FAILED", "BLOCKED", "TIMED_OUT"].includes(row.status));
  const tokens = audits.reduce((total, row) => total + Number(row.inputTokenCount || 0) + Number(row.outputTokenCount || 0), 0);
  const queueCounts = Object.fromEntries(jobs.map((row) => [row.status.toLowerCase(), row._count._all]));
  const monthlyBudget = governance.monthlyBudget == null ? null : Number(governance.monthlyBudget);
  const externalMonthCost = external.reduce((total, row) => total + cost(row), 0);
  const activeProvider = providers.find((provider) => provider.id === global.defaultProviderId) || null;
  const fallbackProvider = activeProvider?.fallbackProviderId ? providers.find((provider) => provider.id === activeProvider.fallbackProviderId) || null : null;
  const ollamaProviders = providers.filter((provider) => provider.providerType === "ollama");

  return {
    viewer: { userId, admin },
    configuration: {
      enabled: global.enabled && !(global as any).emergencyShutdown,
      configured: Boolean(global.defaultProviderId || providers.length),
      emergencyShutdown: Boolean((global as any).emergencyShutdown),
      privacyMode: governance.privacyMode,
      activeProvider: activeProvider ? providerSummary(activeProvider) : null,
      fallbackProvider: fallbackProvider ? providerSummary(fallbackProvider) : null,
      activeModel: activeProvider?.defaultModel || null,
      policyReviewed: governance.reviewed,
      onboardingRequired: admin && (!global.enabled || !governance.reviewed || !global.defaultProviderId),
    },
    metrics: {
      requestsToday: todayRows.length,
      requestsMonth: audits.length,
      externalCostToday: externalToday.reduce((total, row) => total + cost(row), 0),
      externalCostMonth: externalMonthCost,
      monthlyBudget,
      monthlyBudgetUtilization: monthlyBudget && monthlyBudget > 0 ? externalMonthCost / monthlyBudget : null,
      inputTokens: audits.reduce((total, row) => total + Number(row.inputTokenCount || 0), 0),
      outputTokens: audits.reduce((total, row) => total + Number(row.outputTokenCount || 0), 0),
      tokens,
      cachedTokens: audits.reduce((total, row) => total + Number(row.cachedTokenCount || 0), 0),
      approvalsWaiting: approvals,
      activeJobs: Number(queueCounts.running || 0) + Number(queueCounts.retrying || 0),
      queuedJobs: Number(queueCounts.pending || 0) + Number(queueCounts.queued || 0),
      recentFailures: failed.length,
      providerWarnings: warningCount,
      successRate: audits.length ? successful.length / audits.length : null,
      templates: templates,
      feedback: Object.fromEntries(feedback.map((row) => [row.rating.toLowerCase(), row._count._all])),
    },
    providers: providers.map(providerSummary),
    ollama: {
      configured: ollamaProviders.length > 0,
      available: ollamaProviders.some((provider) => provider.health?.healthState === "HEALTHY" || provider.health?.healthState === "AVAILABLE"),
      providers: ollamaProviders.map(providerSummary),
    },
    features: features.filter((feature) => feature.implemented),
    queue: queueCounts,
    recentRequests: naturalRequests.map((row) => ({ ...row, originalRequest: row.originalRequestRetained ? row.originalRequest : null })),
    recentActivity: audits.slice(0, 12),
    recentFailures: failed.slice(0, 8),
    lastSuccessfulRequest: successful[0] || null,
    lastFailedRequest: failed[0] || null,
    audit: governanceEvents,
  };
}

export type AiHistoryFilters = { page?: number; pageSize?: number; userId?: string; provider?: string; model?: string; status?: string; approval?: string; from?: Date; to?: Date; local?: boolean; minimumCost?: number; maximumCost?: number };
export async function getAiNaturalLanguageHistory(userId: string, filters: AiHistoryFilters) {
  const admin = await isUserAdmin(userId); const page = Math.max(1, filters.page || 1); const pageSize = Math.min(100, Math.max(1, filters.pageSize || 25));
  const where: Prisma.NaturalLanguageRequestWhereInput = {
    ...(admin && filters.userId ? { ownerId: filters.userId } : admin ? {} : { ownerId: userId }),
    ...(filters.provider ? { providerDisplayName: { contains: filters.provider, mode: "insensitive" } } : {}),
    ...(filters.model ? { model: { contains: filters.model, mode: "insensitive" } } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.approval === "WAITING" ? { status: "READY_FOR_APPROVAL" } : filters.approval === "APPROVED" ? { approvedAt: { not: null } } : {}),
    ...(filters.from || filters.to ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {}),
    ...(filters.minimumCost != null || filters.maximumCost != null ? { estimatedCost: { ...(filters.minimumCost != null ? { gte: filters.minimumCost } : {}), ...(filters.maximumCost != null ? { lte: filters.maximumCost } : {}) } } : {}),
    ...(filters.local == null ? {} : filters.local ? { privacyMode: "LOCAL_ONLY" } : { NOT: { privacyMode: "LOCAL_ONLY" } }),
  };
  const [total, rows] = await Promise.all([
    prisma.naturalLanguageRequest.count({ where }),
    prisma.naturalLanguageRequest.findMany({ where, include: { owner: { select: { id: true, username: true } }, revisions: { select: { revision: true, revisionText: true, createdAt: true, changeSummaryJson: true }, orderBy: { revision: "desc" }, take: 20 }, auditEvents: { select: { action: true, result: true, createdAt: true, detailsJson: true }, orderBy: { createdAt: "desc" }, take: 30 } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize), records: rows.map((row) => ({
    id: row.id, requestedAt: row.createdAt, requestingUser: row.owner, originalRequest: row.originalRequestRetained ? row.originalRequest : null,
    sanitizedPrompt: null, provider: row.providerDisplayName, model: row.model, privacyMode: row.privacyMode, status: row.status,
    queueDurationMs: null, providerDurationMs: null, inputTokens: row.inputTokenCount, outputTokens: row.outputTokenCount,
    estimatedCost: row.estimatedCost, actualCost: row.actualCost, cacheStatus: "NOT_RECORDED", deduplicationStatus: row.executionIdempotencyKey ? "PROTECTED" : "NOT_RECORDED",
    resultType: row.finalRecipeId ? "RECIPE" : row.interpretationJson ? "INTERPRETATION" : null, linkedRecipeId: row.finalRecipeId,
    linkedPlaylistId: row.executionId, approvalStatus: row.approvedAt ? "APPROVED" : row.status === "READY_FOR_APPROVAL" ? "WAITING" : "NOT_APPROVED",
    errorSummary: row.errorCode ? { code: row.errorCode, message: row.errorMessage } : null, correlationId: null, updatedAt: row.updatedAt,
    revisions: row.revisions, auditEvents: row.auditEvents,
  })) };
}

function providerSummary(provider: any) {
  return {
    id: provider.id,
    providerType: provider.providerType,
    displayName: provider.displayName,
    enabled: provider.enabled,
    approved: provider.approved,
    locationClassification: provider.locationClassification,
    defaultModel: provider.defaultModel,
    fallbackProviderId: provider.fallbackProviderId,
    baseUrl: null,
    health: provider.health,
    models: provider.models || [],
    lastSuccessfulConnectionAt: provider.lastSuccessfulConnectionAt,
  };
}

async function accessibleHouseholdIds(userId: string) {
  const rows = await prisma.household.findMany({ where: { status: "ACTIVE", OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }] }, select: { id: true } });
  return rows.map((row) => row.id);
}

const onboardingConfigurationSchema = z.object({
  mode: z.enum(["LOCAL_ONLY", "EXTERNAL_PROVIDER"]).default("LOCAL_ONLY"),
  providerId: z.string().uuid().nullable().optional(),
  model: z.string().trim().max(300).nullable().optional(),
  privacyMode: z.enum(["LOCAL_ONLY", "METADATA_LIMITED", "ANONYMOUS_METADATA", "FULL_METADATA"]).default("LOCAL_ONLY"),
  monthlyBudget: z.number().min(0).max(1_000_000).nullable().default(0),
  // Unlimited by default. An administrator opts into a cap explicitly, and the
  // wizard can no longer persist a number that the settings page cannot change.
  dailyRequestLimitMode: z.enum(["UNLIMITED", "LIMITED"]).default("UNLIMITED"),
  dailyRequestLimit: z.number().int().positive().max(1_000_000).nullable().default(null),
  monthlyRequestLimit: z.number().int().positive().max(10_000_000).nullable().default(null),
  maximumInputTokens: z.number().int().min(128).max(2_000_000).default(16000),
  maximumOutputTokens: z.number().int().min(64).max(2_000_000).default(7000),
  // Unlimited by default. A zero ceiling is still expressible, but only by
  // choosing Limited explicitly, so the default can never block priced requests.
  perRequestCostLimitMode: z.enum(["UNLIMITED", "LIMITED"]).default("UNLIMITED"),
  maximumEstimatedRequestCost: z.number().min(0).max(100_000).nullable().default(null),
  allowPaidFallback: z.boolean().default(false),
  features: z.array(z.string().max(120)).max(20).default([]),
  privacyAccepted: z.boolean().default(false),
  externalCostAccepted: z.boolean().default(false),
  approvalRequirementsConfirmed: z.boolean().default(false),
  summaryReviewed: z.boolean().default(false),
  testCompleted: z.boolean().default(false),
  reviewedRecipeRequestId: z.string().uuid().nullable().optional(),
}).strict();

const onboardingPatchSchema = z.object({
  currentStep: z.number().int().min(1).max(10),
  completedStep: z.number().int().min(1).max(10).optional(),
  configuration: onboardingConfigurationSchema.partial(),
}).strict();

const defaultOnboardingConfiguration = onboardingConfigurationSchema.parse({});

export async function getAiOnboarding(userId: string) {
  const [row, global, governance, providers, features, recipeCandidates] = await Promise.all([
    prisma.aiOnboardingProgress.findUnique({ where: { userId } }), getAiGlobalSettings(), getAiGovernanceSettings(),
    prisma.aiProviderConfig.findMany({ where: { deletedAt: null }, select: { id: true, displayName: true, providerType: true, locationClassification: true, enabled: true, approved: true, defaultModel: true, lastSuccessfulConnectionAt: true, health: true, models: { where: { availabilityStatus: "AVAILABLE" }, select: { modelIdentifier: true, displayName: true, enabled: true, approved: true, contextSize: true, structuredOutput: true }, orderBy: { displayName: "asc" }, take: 200 } }, orderBy: { displayName: "asc" } }),
    listAiFeatures(),
    prisma.naturalLanguageRequest.findMany({ where: { ownerId: userId, draftRecipeJson: { not: Prisma.DbNull } }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, originalRequest: true, status: true, providerDisplayName: true, model: true, currentRevision: true, updatedAt: true } }),
  ]);
  return {
    progress: row ? { ...row, configuration: onboardingConfigurationSchema.partial().parse(row.configurationJson), completedSteps: row.completedStepsJson } : { currentStep: 1, completedSteps: [], configuration: { ...defaultOnboardingConfiguration, privacyMode: governance.privacyMode }, status: "NOT_STARTED" },
    current: { enabled: global.enabled, defaultProviderId: global.defaultProviderId, governance },
    providers: providers.map(providerSummary),
    features: features.filter((feature) => feature.implemented),
    recipeCandidates,
    policyVersion: FULL_METADATA_POLICY_VERSION,
  };
}

export async function saveAiOnboarding(userId: string, raw: unknown) {
  const input = onboardingPatchSchema.parse(raw);
  const previous = await prisma.aiOnboardingProgress.findUnique({ where: { userId } });
  const currentConfiguration = onboardingConfigurationSchema.parse({ ...defaultOnboardingConfiguration, ...((previous?.configurationJson as object) || {}), ...input.configuration });
  const completed = new Set<number>(Array.isArray(previous?.completedStepsJson) ? previous!.completedStepsJson.map(Number) : []);
  if (input.completedStep) completed.add(input.completedStep);
  const now = new Date();
  return prisma.aiOnboardingProgress.upsert({
    where: { userId },
    create: { userId, currentStep: input.currentStep, completedStepsJson: json(Array.from(completed).sort((a, b) => a - b)), configurationJson: json(currentConfiguration), privacyAcceptedAt: currentConfiguration.privacyAccepted ? now : null, privacyPolicyVersion: currentConfiguration.privacyAccepted ? FULL_METADATA_POLICY_VERSION : null, externalCostAcceptedAt: currentConfiguration.externalCostAccepted ? now : null },
    update: { currentStep: input.currentStep, completedStepsJson: json(Array.from(completed).sort((a, b) => a - b)), configurationJson: json(currentConfiguration), privacyAcceptedAt: currentConfiguration.privacyAccepted ? previous?.privacyAcceptedAt || now : null, privacyPolicyVersion: currentConfiguration.privacyAccepted ? FULL_METADATA_POLICY_VERSION : null, externalCostAcceptedAt: currentConfiguration.externalCostAccepted ? previous?.externalCostAcceptedAt || now : null, status: previous?.status === "COMPLETED" ? "IN_PROGRESS" : previous?.status },
  });
}

export async function activateAiOnboarding(userId: string) {
  const progress = await prisma.aiOnboardingProgress.findUnique({ where: { userId } });
  if (!progress) throw new AiError("INVALID_REQUEST", "Start AI setup before activation.", 409);
  const configuration = onboardingConfigurationSchema.parse(progress.configurationJson);
  if (!configuration.privacyAccepted || !configuration.approvalRequirementsConfirmed || !configuration.summaryReviewed) throw new AiError("INVALID_REQUEST", "Review privacy, approval requirements, and the final summary before activation.", 409);
  if (configuration.mode === "EXTERNAL_PROVIDER" && !configuration.externalCostAccepted) throw new AiError("INVALID_REQUEST", "Accept the external-provider cost notice before activation.", 409);
  if (configuration.mode === "LOCAL_ONLY" && configuration.privacyMode !== "LOCAL_ONLY") throw new AiError("INVALID_REQUEST", "Local-only setup must use Local Only privacy mode.", 409);
  if (configuration.mode === "EXTERNAL_PROVIDER" && configuration.privacyMode === "LOCAL_ONLY") throw new AiError("INVALID_REQUEST", "Choose an external-compatible privacy mode or switch to local-only setup.", 409);
  if (!configuration.providerId) throw new AiError("AI_PROVIDER_NOT_FOUND", "Choose and test an available provider before activation.", 409);
  const provider = await prisma.aiProviderConfig.findFirst({ where: { id: configuration.providerId, deletedAt: null }, include: { health: true, models: true } });
  if (!provider || !provider.enabled || !provider.approved) throw new AiError("AI_PROVIDER_NOT_APPROVED", "The selected provider must be saved, enabled, and approved.", 409);
  if (configuration.mode === "LOCAL_ONLY" && provider.locationClassification !== "LOCAL") throw new AiError("AI_PRIVACY_POLICY_BLOCKED", "Local-only setup requires an administrator-confirmed local provider.", 409);
  if (!provider.lastSuccessfulConnectionAt && !provider.health?.lastSuccessfulInferenceAt) throw new AiError("PROVIDER_UNAVAILABLE", "Run a successful provider test before activation.", 409);
  if (!configuration.reviewedRecipeRequestId || !(await prisma.naturalLanguageRequest.count({ where: { id: configuration.reviewedRecipeRequestId, ownerId: userId, draftRecipeJson: { not: Prisma.DbNull } } }))) throw new AiError("INVALID_REQUEST", "Generate and review a recipe draft before activation.", 409);
  const model = configuration.model || provider.defaultModel;
  if (!model || !provider.models.some((item) => item.modelIdentifier === model && item.availabilityStatus === "AVAILABLE")) throw new AiError("MODEL_NOT_FOUND", "Choose a currently available model before activation.", 409);
  const selectedFeatures = configuration.features.filter((key) => aiFeatureByKey.get(key)?.implemented);

  if (configuration.privacyMode === "FULL_METADATA") await setFullMetadataAcknowledgment(true, userId);
  await updateAiGovernanceSettings({
    privacyMode: configuration.privacyMode,
    reviewed: true,
    monthlyBudget: configuration.mode === "LOCAL_ONLY" ? 0 : configuration.monthlyBudget,
    dailyRequestLimitMode: configuration.dailyRequestLimitMode,
    dailyRequestLimit: configuration.dailyRequestLimitMode === "LIMITED" ? configuration.dailyRequestLimit : null,
    monthlyRequestLimit: configuration.monthlyRequestLimit,
    maximumInputTokens: configuration.maximumInputTokens,
    maximumOutputTokens: configuration.maximumOutputTokens,
    maximumCombinedTokens: configuration.maximumInputTokens + configuration.maximumOutputTokens,
    // The per-request ceiling has its own column; writing it into the cumulative
    // retry ceiling is what previously blocked every priced external request.
    // A local-only setup keeps its explicit zero-cost admission policy.
    ...(configuration.mode === "LOCAL_ONLY"
      ? { perRequestCostLimitMode: "LIMITED" as const, maximumEstimatedRequestCost: 0 }
      : { perRequestCostLimitMode: configuration.perRequestCostLimitMode, maximumEstimatedRequestCost: configuration.perRequestCostLimitMode === "LIMITED" ? configuration.maximumEstimatedRequestCost : null }),
    allowPaidProviderFallback: configuration.mode === "EXTERNAL_PROVIDER" && configuration.allowPaidFallback,
    paidProvidersAllowed: configuration.mode === "EXTERNAL_PROVIDER",
    externalProvidersAllowed: configuration.mode === "EXTERNAL_PROVIDER",
    allowedExternalFeaturesJson: configuration.mode === "EXTERNAL_PROVIDER" ? selectedFeatures : [],
    requireExternalConfirmation: true,
    reason: "AI onboarding activation",
  }, userId);
  for (const feature of Array.from(aiFeatureByKey.keys())) await updateAiFeature(feature, { enabled: selectedFeatures.includes(feature), preferredProviderId: selectedFeatures.includes(feature) ? provider.id : null, preferredModel: selectedFeatures.includes(feature) ? model : null, fallbackBehavior: "NONE", fallbackProviderId: null }, userId);
  await updateAiGlobalSettings({ enabled: true, defaultProviderId: provider.id, defaultFallbackPolicy: "NONE", privacyWarningAcknowledged: true }, userId);
  const activatedAt = new Date();
  await prisma.aiOnboardingProgress.update({ where: { userId }, data: { status: "COMPLETED", currentStep: 10, activatedAt, completedStepsJson: json([1,2,3,4,5,6,7,8,9,10]) } });
  await prisma.aiGovernanceAudit.create({ data: { actorId: userId, action: "AI_ONBOARDING_COMPLETED", entityType: "AiOnboardingProgress", entityId: progress.id, newValueJson: json({ mode: configuration.mode, providerId: provider.id, model, privacyMode: configuration.privacyMode, features: selectedFeatures, paidFallback: configuration.mode === "EXTERNAL_PROVIDER" && configuration.allowPaidFallback }) } });
  return { activated: true, activatedAt, provider: provider.displayName, model, features: selectedFeatures };
}

const variableName = /^[a-z][a-z0-9_]{0,39}$/;
const templateSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).nullable().optional(), requestText: z.string().trim().min(3).max(10000), defaultFeature: z.string().trim().max(120).default("natural_language_playlist_requests"), defaultProviderId: z.string().uuid().nullable().optional(), defaultModel: z.string().trim().max(300).nullable().optional(), visibility: z.enum(["PRIVATE", "HOUSEHOLD"]).default("PRIVATE"), householdId: z.string().uuid().nullable().optional() }).strict();

async function assertHouseholdAccess(userId: string, householdId?: string | null) {
  if (!householdId) throw new AiError("INVALID_REQUEST", "Choose a household before sharing this template.", 400);
  const allowed = await prisma.household.count({ where: { id: householdId, status: "ACTIVE", OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }] } });
  if (!allowed) throw new AiError("PERMISSION_DENIED", "You cannot share templates with this household.", 403);
}

export async function listAiRequestTemplates(userId: string, search = "") {
  const householdIds = await accessibleHouseholdIds(userId);
  const rows = await prisma.aiRequestTemplate.findMany({ where: { AND: [{ OR: [{ ownerId: userId }, { visibility: "HOUSEHOLD", householdId: { in: householdIds } }] }, ...(search ? [{ OR: [{ name: { contains: search, mode: "insensitive" as const } }, { description: { contains: search, mode: "insensitive" as const } }, { requestText: { contains: search, mode: "insensitive" as const } }] }] : [])] }, include: { owner: { select: { username: true } } }, orderBy: [{ lastUsedAt: "desc" }, { updatedAt: "desc" }], take: 200 });
  return { templates: rows.map((row) => ({ ...row, variables: row.variablesJson, canEdit: row.ownerId === userId })) };
}

export async function createAiRequestTemplate(userId: string, raw: unknown) {
  const input = templateSchema.parse(raw); const variables = templateVariables(input.requestText);
  if (variables.some((name) => !variableName.test(name))) throw new AiError("INVALID_REQUEST", "Template variable names must use lowercase letters, numbers, and underscores.", 400);
  if (input.visibility === "HOUSEHOLD") await assertHouseholdAccess(userId, input.householdId);
  if (input.defaultFeature !== "natural_language_playlist_requests") throw new AiError("FEATURE_DISABLED", "Only natural-language playlist templates can be run in this release.", 400);
  return prisma.aiRequestTemplate.create({ data: { ownerId: userId, name: input.name, description: input.description, requestText: input.requestText, variablesJson: json(variables), defaultFeature: input.defaultFeature, defaultProviderId: input.defaultProviderId, defaultModel: input.defaultModel, visibility: input.visibility, householdId: input.visibility === "HOUSEHOLD" ? input.householdId : null } });
}

async function ownedTemplate(userId: string, id: string) {
  const row = await prisma.aiRequestTemplate.findUnique({ where: { id } });
  if (!row) throw new AiError("INVALID_REQUEST", "Template not found.", 404);
  if (row.ownerId !== userId && !(await isUserAdmin(userId))) throw new AiError("PERMISSION_DENIED", "Only the owner can change this template.", 403);
  return row;
}

export async function updateAiRequestTemplate(userId: string, id: string, raw: unknown) {
  await ownedTemplate(userId, id); const input = templateSchema.parse(raw); const variables = templateVariables(input.requestText);
  if (input.visibility === "HOUSEHOLD") await assertHouseholdAccess(userId, input.householdId);
  return prisma.aiRequestTemplate.update({ where: { id }, data: { name: input.name, description: input.description, requestText: input.requestText, variablesJson: json(variables), defaultFeature: input.defaultFeature, defaultProviderId: input.defaultProviderId, defaultModel: input.defaultModel, visibility: input.visibility, householdId: input.visibility === "HOUSEHOLD" ? input.householdId : null } });
}

export async function deleteAiRequestTemplate(userId: string, id: string) { await ownedTemplate(userId, id); await prisma.aiRequestTemplate.delete({ where: { id } }); return { deleted: true }; }

const renderSchema = z.object({ variables: z.record(z.string().max(2000)).default({}) }).strict();
export async function renderAiRequestTemplate(userId: string, id: string, raw: unknown) {
  const householdIds = await accessibleHouseholdIds(userId); const input = renderSchema.parse(raw);
  const row = await prisma.aiRequestTemplate.findFirst({ where: { id, OR: [{ ownerId: userId }, { visibility: "HOUSEHOLD", householdId: { in: householdIds } }] } });
  if (!row) throw new AiError("PERMISSION_DENIED", "Template not found or unavailable.", 404);
  const variables = Array.isArray(row.variablesJson) ? row.variablesJson.map(String) : [];
  const missing = variables.filter((name) => !String(input.variables[name] || "").trim());
  const extra = Object.keys(input.variables).filter((name) => !variables.includes(name));
  if (missing.length || extra.length) throw new AiError("INVALID_REQUEST", "Review the template variables.", 400, undefined, { missing, extra });
  const request = row.requestText.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_match, name: string) => input.variables[name.toLowerCase()].trim());
  await prisma.aiRequestTemplate.update({ where: { id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } });
  return { templateId: row.id, request, privacyReviewRequired: true, providerSelection: row.defaultProviderId || "AUTOMATIC", modelSelection: row.defaultModel || "AUTOMATIC" };
}

const feedbackSchema = z.object({ requestId: z.string().trim().min(1).max(200), resultId: z.string().trim().max(200).nullable().optional(), featureKey: z.string().trim().min(1).max(120), providerConfigId: z.string().uuid().nullable().optional(), providerName: z.string().trim().max(120).nullable().optional(), model: z.string().trim().max(300).nullable().optional(), recipeVersion: z.number().int().positive().nullable().optional(), rating: z.enum(["UP", "DOWN"]), reason: z.string().trim().max(120).nullable().optional(), comment: z.string().trim().max(1000).nullable().optional() }).strict();
export async function saveAiQualityFeedback(userId: string, raw: unknown) {
  const input = feedbackSchema.parse(raw);
  const ownsRequest = await prisma.aiRequestAudit.count({ where: { requestId: input.requestId, userId } }) || await prisma.naturalLanguageRequest.count({ where: { id: input.requestId, ownerId: userId } });
  if (!ownsRequest && !(await isUserAdmin(userId))) throw new AiError("PERMISSION_DENIED", "Feedback can only be attached to a result you may view.", 403);
  const existing = await prisma.aiQualityFeedback.findFirst({ where: { authorId: userId, requestId: input.requestId, resultId: input.resultId ?? null } });
  return existing ? prisma.aiQualityFeedback.update({ where: { id: existing.id }, data: input }) : prisma.aiQualityFeedback.create({ data: { authorId: userId, ...input } });
}
