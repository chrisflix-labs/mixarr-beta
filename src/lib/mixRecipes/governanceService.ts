import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { isUserAdmin } from "../auth";
import { sanitizePayload } from "../integrations/core";
import { highRiskRecipesTotal, recipeMigrationsTotal, recipeRestoresTotal, recipeSignatureVerificationsTotal, recipeValidationDurationSeconds, recipesQuarantinedTotal } from "../metrics";
import type { MixRecipeDocument } from "./schema";
import { validateRecipe } from "./validation";
import {
  analyzeImpossibleRequirements, analyzeRecipeRisk, applyRecipeSafetyLimits, canonicalRecipeSignaturePayload,
  evaluateRecipeCompatibility, inferRecipePermissions, normalizeSafetyLimits, scanForbiddenRecipeActions, verifyRecipeSignature,
  type PermissionDecision, type RecipePermission, type RecipeSafetyLimits,
} from "./governance";

export type RecipeImportMode = "suggest_only" | "approval_required" | "automatic_with_limits" | "use_recipe_settings";
export type RecipeGovernancePlan = {
  planVersion: 1;
  planHash: string;
  generatedAt: string;
  source: string;
  normalizedRecipe: MixRecipeDocument;
  signature: ReturnType<typeof verifyRecipeSignature>;
  official: boolean;
  trustState: "LOCAL" | "TRUSTED" | "OFFICIAL" | "UNTRUSTED" | "QUARANTINED" | "SIGNATURE_INVALID" | "SIGNATURE_UNKNOWN" | "REVOKED";
  approvalState: "PENDING_REVIEW" | "APPROVED" | "APPROVED_WITH_RESTRICTIONS" | "QUARANTINED";
  quarantine: { required: boolean; reasons: string[] };
  permissions: PermissionDecision[];
  grantedPermissions: RecipePermission[];
  restrictedPermissions: RecipePermission[];
  compatibility: ReturnType<typeof evaluateRecipeCompatibility>;
  dependencies: Array<{ type: string; name: string; required: boolean; status: "AVAILABLE" | "MISSING" | "DISABLED" | "UNSUPPORTED" | "OPTIONAL_UNAVAILABLE"; fallback: unknown; message: string }>;
  risk: ReturnType<typeof analyzeRecipeRisk>;
  findings: ReturnType<typeof scanForbiddenRecipeActions>;
  safetyAdjustments: ReturnType<typeof applyRecipeSafetyLimits>["adjustments"];
  recommendedImportMode: RecipeImportMode;
  availableImportModes: RecipeImportMode[];
  immediateExecutionRequested: boolean;
};

function json(value: unknown): Prisma.InputJsonValue { return sanitizePayload(value) as Prisma.InputJsonValue; }
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function sourceIsExternal(source: string) { return !["local", "editor", "migration", "built_in"].includes(source.toLowerCase()); }
async function emitGovernanceEvent(event: string, userId: string, recipeId: string | null, payload: Record<string, unknown>, correlationId: string) {
  try { const { emitIntegrationEvent } = await import("../integrations/service"); await emitIntegrationEvent(event as any, { recipe: { id: recipeId, ...payload }, correlationId }, { actorType: "user", actorId: userId }, `${event}:${correlationId}`); }
  catch (error) { console.warn("[RecipeGovernance] Notification delivery failed", { event, correlationId, reason: error instanceof Error ? error.message : "unknown" }); }
}

async function dependencyEnvironment(userId: string) {
  const [libraries, integrations, recipes] = await Promise.all([
    prisma.library.findMany({ where: { server: { userId } }, select: { id: true, name: true } }),
    prisma.integrationConfiguration.findMany({ select: { key: true, enabled: true, status: true } }),
    prisma.playlistRecipe.findMany({ where: { userId, deletedAt: null }, select: { id: true, slug: true, name: true, enabled: true, normalizedPayloadJson: true } }),
  ]);
  return { libraries, integrations, recipes };
}

async function evaluateDependencies(userId: string, recipe: MixRecipeDocument) {
  const environment = await dependencyEnvironment(userId);
  const features = new Set(["mix_recipes", "approval_workflow", "smart_actions", "webhook_support", "plex"]);
  const rootAliases = new Set([recipe.metadata.slug, recipe.metadata.name].filter(Boolean).map((value) => String(value).toLowerCase()));
  const storedByAlias = new Map<string, (typeof environment.recipes)[number]>();
  for (const stored of environment.recipes) for (const alias of [stored.id, stored.slug, stored.name]) if (alias) storedByAlias.set(String(alias).toLowerCase(), stored);
  const reachesCandidate = (name: string, visited = new Set<string>()): boolean => {
    const key = name.toLowerCase();
    if (rootAliases.has(key)) return true;
    if (visited.has(key)) return false;
    visited.add(key);
    const stored = storedByAlias.get(key);
    const dependencies = Array.isArray((stored?.normalizedPayloadJson as any)?.dependencies) ? (stored!.normalizedPayloadJson as any).dependencies : [];
    return dependencies.filter((item: any) => item?.type === "recipe" && item?.required !== false).some((item: any) => reachesCandidate(String(item.name || ""), visited));
  };
  return recipe.dependencies.map((dependency) => {
    let available = false;
    let disabled = false;
    const circular = dependency.type === "recipe" && reachesCandidate(dependency.name);
    if (dependency.type === "feature" || dependency.type === "capability" || dependency.type === "approval_workflow" || dependency.type === "smart_actions") available = features.has(dependency.name.toLowerCase());
    else if (dependency.type === "plex_library") available = environment.libraries.some((item) => item.id === dependency.name || item.name.toLowerCase() === dependency.name.toLowerCase());
    else if (dependency.type === "recipe") { const match = environment.recipes.find((item) => item.id === dependency.name || item.slug === dependency.name); available = Boolean(match?.enabled); disabled = Boolean(match && !match.enabled); }
    else if (["integration", "plex_integration", "metadata_provider"].includes(dependency.type)) { const match = environment.integrations.find((item) => item.key.toLowerCase() === dependency.name.toLowerCase()); available = Boolean(match?.enabled); disabled = Boolean(match && !match.enabled); }
    else if (dependency.type === "api_scope") available = false;
    else available = false;
    if (circular) return { type: dependency.type, name: dependency.name, required: dependency.required, status: "UNSUPPORTED" as const, fallback: dependency.fallback || null, message: `Recipe dependency "${dependency.name}" creates a circular dependency.` };
    const status = available ? "AVAILABLE" : disabled ? "DISABLED" : dependency.required ? "MISSING" : "OPTIONAL_UNAVAILABLE";
    return { type: dependency.type, name: dependency.name, required: dependency.required, status: status as "AVAILABLE" | "MISSING" | "DISABLED" | "UNSUPPORTED" | "OPTIONAL_UNAVAILABLE", fallback: dependency.fallback || null, message: available ? "Available." : dependency.required ? `Required dependency “${dependency.name}” is unavailable.` : `Optional dependency “${dependency.name}” is unavailable.` };
  });
}

export async function buildRecipeGovernancePlan(input: { userId: string; recipe: MixRecipeDocument; source: string; rawPayload?: unknown; configuredLimits?: Partial<RecipeSafetyLimits> | null }) {
  const validationStarted = performance.now();
  const [keys, policy, dependencies] = await Promise.all([
    prisma.recipeSigningKey.findMany({ select: { keyId: true, algorithm: true, publicKey: true, identity: true, official: true, trusted: true, expiresAt: true, revokedAt: true } }),
    prisma.recipeSafetyPolicy.findUnique({ where: { userId: input.userId }, select: { limitsJson: true } }),
    evaluateDependencies(input.userId, input.recipe),
  ]);
  const safety = applyRecipeSafetyLimits(input.recipe, input.configuredLimits || (policy?.limitsJson as Partial<RecipeSafetyLimits> | null));
  const signature = verifyRecipeSignature(safety.recipe, keys);
  const permissions = inferRecipePermissions(safety.recipe);
  const compatibility = evaluateRecipeCompatibility(safety.recipe);
  const risk = analyzeRecipeRisk(safety.recipe, permissions);
  const forbidden = scanForbiddenRecipeActions(input.rawPayload ?? input.recipe);
  const impossible = analyzeImpossibleRequirements(safety.recipe);
  const dependencyFindings = dependencies.filter((item) => item.required && item.status !== "AVAILABLE").map((item) => ({ code: "recipe.dependency.required_unavailable", path: "dependencies", severity: "error" as const, message: item.message }));
  const findings = [...forbidden, ...impossible, ...dependencyFindings, ...compatibility.findings];
  const external = sourceIsExternal(input.source);
  const highRisk = permissions.some((item) => ["high", "destructive"].includes(item.riskLevel)) || ["high", "destructive"].includes(risk.riskLevel);
  const signatureUnsafe = ["INVALID", "UNKNOWN_KEY", "REVOKED_KEY", "UNSUPPORTED_ALGORITHM", "EXPIRED"].includes(signature.status);
  const policyBlocked = findings.some((item) => ["error", "destructive"].includes(item.severity)) || permissions.some((item) => item.decision === "deny");
  const quarantineReasons = [
    ...(external && signature.status === "MISSING" ? ["Unsigned external recipe"] : []),
    ...(signatureUnsafe ? [signature.message] : []),
    ...findings.filter((item) => ["error", "destructive"].includes(item.severity)).map((item) => item.message),
    ...(permissions.some((item) => item.decision === "deny") ? ["Forbidden destructive permission request"] : []),
  ];
  const quarantineRequired = (external && !(signature.status === "VALID" && signature.trusted)) || signatureUnsafe || policyBlocked;
  const official = signature.status === "VALID" && signature.official && compatibility.compatible && !policyBlocked && !dependencies.some((item) => item.required && item.status !== "AVAILABLE");
  const trustState: RecipeGovernancePlan["trustState"] = official ? "OFFICIAL" : signature.status === "INVALID" ? "SIGNATURE_INVALID" : signature.status === "UNKNOWN_KEY" ? "SIGNATURE_UNKNOWN" : signature.status === "REVOKED_KEY" ? "REVOKED" : quarantineRequired ? "QUARANTINED" : signature.status === "VALID" && signature.trusted ? "TRUSTED" : external ? "UNTRUSTED" : "LOCAL";
  const grantedPermissions = permissions.filter((item) => item.decision === "allow").map((item) => item.permission);
  const restrictedPermissions = permissions.filter((item) => item.decision !== "allow").map((item) => item.permission);
  const recommendedImportMode: RecipeImportMode = external || highRisk ? "suggest_only" : risk.recommendedImportMode as RecipeImportMode;
  const availableImportModes: RecipeImportMode[] = highRisk ? ["suggest_only", "approval_required", "automatic_with_limits"] : ["suggest_only", "approval_required", "automatic_with_limits", "use_recipe_settings"];
  const unsignedPlan = {
    planVersion: 1 as const, generatedAt: new Date().toISOString(), source: input.source, normalizedRecipe: safety.recipe,
    signature, official, trustState, approvalState: quarantineRequired ? "QUARANTINED" as const : external ? "PENDING_REVIEW" as const : "APPROVED" as const,
    quarantine: { required: quarantineRequired, reasons: Array.from(new Set(quarantineReasons)) }, permissions, grantedPermissions, restrictedPermissions,
    compatibility, dependencies, risk, findings, safetyAdjustments: safety.adjustments, recommendedImportMode, availableImportModes,
    immediateExecutionRequested: Boolean((input.rawPayload as any)?.executeImmediately || (input.rawPayload as any)?.runImmediately),
  };
  recipeSignatureVerificationsTotal.inc({ result: signature.status.toLowerCase() });
  if (["high", "destructive"].includes(risk.riskLevel)) highRiskRecipesTotal.inc({ risk: risk.riskLevel });
  if (quarantineRequired) recipesQuarantinedTotal.inc({ reason: signatureUnsafe ? "signature" : external && signature.status === "MISSING" ? "external_unsigned" : "policy" });
  recipeValidationDurationSeconds.observe((performance.now() - validationStarted) / 1000);
  return { ...unsignedPlan, planHash: hash({ ...unsignedPlan, generatedAt: undefined }) } satisfies RecipeGovernancePlan;
}

export function recipeGovernanceData(plan: RecipeGovernancePlan, input: { source: string; originalPayload: unknown; approvedById?: string | null }) {
  const approved = plan.approvalState === "APPROVED";
  return {
    governanceSchemaVersion: 3, recipeSource: input.source.toUpperCase().slice(0, 80), originalPayloadJson: json(input.originalPayload), normalizedPayloadJson: json(plan.normalizedRecipe),
    trustState: plan.trustState, approvalState: plan.approvalState, quarantineState: plan.quarantine.required ? "QUARANTINED" : "NONE", quarantineReason: plan.quarantine.reasons.join(" ").slice(0, 2000) || null,
    signatureStatus: plan.signature.status, signatureAlgorithm: plan.normalizedRecipe.signature?.algorithm || null, signatureKeyId: plan.signature.keyId, signerIdentity: plan.signature.signerIdentity,
    signatureSignedAt: plan.signature.signedAt ? new Date(plan.signature.signedAt) : null,
    requestedPermissionsJson: json(plan.permissions), grantedPermissionsJson: json(plan.grantedPermissions), restrictedPermissionsJson: json(plan.restrictedPermissions),
    compatibilityStatus: plan.compatibility.status, compatibilityJson: json(plan.compatibility), riskLevel: plan.risk.riskLevel.toUpperCase(), riskScore: plan.risk.score,
    riskFindingsJson: json([...plan.risk.findings, ...plan.findings]), dependencyStatusJson: json(plan.dependencies), migrationHistoryJson: json([]),
    approvedAt: approved ? new Date() : null, lastValidatedAt: new Date(), enabled: approved && !plan.quarantine.required,
  };
}

export async function writeRecipeAudit(input: { recipeId?: string | null; recipeVersion?: number | null; eventType: string; actorType?: string; actorId?: string | null; correlationId?: string; description: string; previousState?: unknown; newState?: unknown; validation?: unknown; risk?: unknown; permissions?: unknown; trustState?: string | null; riskLevel?: string | null; result?: string; metadata?: unknown }, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  return tx.recipeAuditEvent.create({ data: {
    recipeId: input.recipeId || null, recipeVersion: input.recipeVersion || null, eventType: input.eventType, actorType: input.actorType || (input.actorId ? "USER" : "SERVICE"), actorId: input.actorId || null,
    correlationId: input.correlationId || randomUUID(), description: input.description.slice(0, 1000), previousStateJson: input.previousState == null ? undefined : json(input.previousState), newStateJson: input.newState == null ? undefined : json(input.newState),
    validationJson: input.validation == null ? undefined : json(input.validation), riskJson: input.risk == null ? undefined : json(input.risk), permissionsJson: input.permissions == null ? undefined : json(input.permissions),
    trustState: input.trustState || null, riskLevel: input.riskLevel || null, result: input.result || "SUCCESS", metadataJson: input.metadata == null ? undefined : json(input.metadata),
  } });
}

const snapshotFields = { name: true, description: true, category: true, artworkUrl: true, enabled: true, filtersJson: true, scoringJson: true, targetsJson: true, bpmFlowJson: true, discoveryJson: true, varietyJson: true, identityDefaultsJson: true, refreshPolicyJson: true, automationPolicyJson: true, trustState: true, approvalState: true, quarantineState: true, quarantineReason: true, requestedPermissionsJson: true, grantedPermissionsJson: true, restrictedPermissionsJson: true, compatibilityStatus: true, compatibilityJson: true, riskLevel: true, riskScore: true, riskFindingsJson: true, dependencyStatusJson: true, updatedAt: true } as const;

export async function createRecipeSnapshot(input: { userId: string; recipeId?: string | null; correlationId: string; reason: string }) {
  const recipe = input.recipeId ? await prisma.playlistRecipe.findFirst({ where: { id: input.recipeId, userId: input.userId }, select: snapshotFields }) : null;
  return prisma.recipeImportSnapshot.create({ data: { userId: input.userId, recipeId: input.recipeId || null, correlationId: input.correlationId, reason: input.reason, snapshotJson: json(recipe || { newRecipe: true }), resourceVersions: json(recipe ? { recipeUpdatedAt: recipe.updatedAt.toISOString() } : {}) } });
}

export async function listRecipeSnapshots(userId: string, recipeId: string) {
  return prisma.recipeImportSnapshot.findMany({
    where: { userId, recipeId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, correlationId: true, reason: true, status: true, createdAt: true, restoredAt: true, resourceVersions: true },
  });
}

export async function listQuarantinedRecipes(userId: string) {
  return prisma.playlistRecipe.findMany({ where: { userId, quarantineState: { not: "NONE" }, deletedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, recipeSource: true, trustState: true, approvalState: true, quarantineState: true, quarantineReason: true, signatureStatus: true, compatibilityStatus: true, riskLevel: true, riskScore: true, riskFindingsJson: true, dependencyStatusJson: true, requestedPermissionsJson: true, lastValidatedAt: true, originalPayloadJson: true } });
}

export async function approveRecipe(userId: string, recipeId: string, input: { mode?: RecipeImportMode; grantedPermissions?: string[]; confirmConsequences?: string[]; aiReviewConfirmation?: string }) {
  const recipe = await prisma.playlistRecipe.findFirst({ where: { id: recipeId, userId, deletedAt: null } });
  if (!recipe) throw Object.assign(new Error("Recipe not found."), { code: "RECIPE_NOT_FOUND", status: 404 });
  if (recipe.aiGenerated) {
    if (!(await isUserAdmin(userId))) throw Object.assign(new Error("Administrator permission is required to approve an AI-generated recipe."), { code: "ADMIN_REQUIRED", status: 403 });
    if (recipe.aiRecipeStatus !== "VALIDATED") throw Object.assign(new Error("An AI-generated recipe must be validated before approval."), { code: "AI_RECIPE_NOT_VALIDATED", status: 409 });
    if (input.aiReviewConfirmation !== "I reviewed this AI-generated recipe and understand that its behavior may differ from the original request.") throw Object.assign(new Error("Enter the required AI recipe review confirmation."), { code: "AI_RECIPE_APPROVAL_CONFIRMATION_REQUIRED", status: 409 });
  }
  const requested = Array.isArray(recipe.requestedPermissionsJson) ? (recipe.requestedPermissionsJson as any[]).map((item) => typeof item === "string" ? item : item.permission).filter(Boolean) : [];
  const desired = (input.grantedPermissions || requested).filter((permission) => requested.includes(permission) && permission !== "playlist.delete" && permission !== "playlist.protected_update");
  const high = requested.filter((permission) => ["automation.fully_automatic", "automation.remove_tracks", "approval.disable", "plex.collection.write", "webhook.create", "external_integration.use"].includes(permission));
  if ((input.mode === "use_recipe_settings" || high.some((item) => desired.includes(item))) && !(await isUserAdmin(userId))) throw Object.assign(new Error("Administrator approval is required for unrestricted or high-risk recipe permissions."), { code: "ADMIN_REQUIRED", status: 403 });
  if (high.some((item) => desired.includes(item)) && (!Array.isArray(input.confirmConsequences) || !high.every((item) => input.confirmConsequences!.includes(item)))) throw Object.assign(new Error("Confirm each high-risk consequence explicitly."), { code: "EXPLICIT_CONFIRMATION_REQUIRED", status: 409, consequences: high });
  const restricted = requested.filter((permission) => !desired.includes(permission));
  const approvalState = restricted.length ? "APPROVED_WITH_RESTRICTIONS" : "APPROVED";
  const mode = input.mode || "suggest_only";
  const automationPolicy = { ...((recipe.automationPolicyJson as Record<string, unknown>) || {}) };
  const refreshPolicy = { ...((recipe.refreshPolicyJson as Record<string, unknown>) || {}) };
  if (["suggest_only", "approval_required"].includes(mode)) { automationPolicy.enabled = false; refreshPolicy.mode = "manual"; refreshPolicy.frequencyDays = null; }
  const correlationId = randomUUID();
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.playlistRecipe.update({ where: { id: recipe.id }, data: { approvalState, quarantineState: "NONE", quarantineReason: null, enabled: recipe.aiGenerated ? false : true, ...(recipe.aiGenerated ? { aiRecipeStatus: "APPROVED" } : {}), automationPolicyJson: json(automationPolicy), refreshPolicyJson: json(refreshPolicy), grantedPermissionsJson: json(desired), restrictedPermissionsJson: json(restricted), approvedById: userId, approvedAt: new Date(), revokedLocallyAt: null } });
    await writeRecipeAudit({ recipeId, recipeVersion: updated.recipeVersion, eventType: restricted.length ? "RECIPE_APPROVED_WITH_RESTRICTIONS" : "RECIPE_APPROVED", actorId: userId, correlationId, description: recipe.aiGenerated ? "AI-generated recipe approved after explicit review; it remains inactive pending a separate activation action." : restricted.length ? `Recipe approved with ${restricted.length} restricted permission(s).` : "Recipe approved after local review.", previousState: { approvalState: recipe.approvalState, quarantineState: recipe.quarantineState }, newState: { approvalState, quarantineState: "NONE", mode, enabled: updated.enabled, aiRecipeStatus: updated.aiRecipeStatus }, permissions: { granted: desired, restricted }, trustState: updated.trustState, riskLevel: updated.riskLevel, metadata: recipe.aiGenerated ? { automaticActivation: false } : undefined }, tx);
    return updated;
  });
  await emitGovernanceEvent(restricted.length ? "recipe.approved_with_restrictions" : "recipe.approved", userId, recipeId, { approvalState, riskLevel: updated.riskLevel }, correlationId);
  return updated;
}

export async function rejectRecipe(userId: string, recipeId: string, reason: string) {
  const recipe = await prisma.playlistRecipe.findFirst({ where: { id: recipeId, userId, deletedAt: null } });
  if (!recipe) throw Object.assign(new Error("Recipe not found."), { code: "RECIPE_NOT_FOUND", status: 404 });
  const correlationId = randomUUID();
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.playlistRecipe.update({ where: { id: recipeId }, data: { approvalState: "REJECTED", enabled: false, grantedPermissionsJson: json([]), quarantineState: "QUARANTINED", quarantineReason: reason.slice(0, 1000) } });
    await writeRecipeAudit({ recipeId, recipeVersion: updated.recipeVersion, eventType: "RECIPE_REJECTED", actorId: userId, correlationId, description: `Recipe rejected: ${reason.slice(0, 500)}`, previousState: { approvalState: recipe.approvalState }, newState: { approvalState: "REJECTED", enabled: false }, trustState: updated.trustState, riskLevel: updated.riskLevel }, tx);
    return updated;
  });
  await emitGovernanceEvent("recipe.rejected", userId, recipeId, { reason: reason.slice(0, 500) }, correlationId);
  return updated;
}

export async function revokeRecipeApproval(userId: string, recipeId: string) {
  const recipe = await prisma.playlistRecipe.findFirst({ where: { id: recipeId, userId, deletedAt: null } });
  if (!recipe) throw Object.assign(new Error("Recipe not found."), { code: "RECIPE_NOT_FOUND", status: 404 });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.playlistRecipe.update({ where: { id: recipeId }, data: { approvalState: "REVOKED_LOCALLY", trustState: "REVOKED", enabled: false, grantedPermissionsJson: json([]), revokedLocallyAt: new Date() } });
    await writeRecipeAudit({ recipeId, recipeVersion: updated.recipeVersion, eventType: "RECIPE_LOCAL_APPROVAL_REVOKED", actorId: userId, description: "Local recipe approval was revoked; execution was disabled.", previousState: { approvalState: recipe.approvalState }, newState: { approvalState: "REVOKED_LOCALLY", enabled: false }, trustState: "REVOKED", riskLevel: updated.riskLevel }, tx);
    return updated;
  });
}

export async function retryRecipeValidation(userId: string, recipeId: string, fallbackPayload?: unknown) {
  const recipe = await prisma.playlistRecipe.findFirst({ where: { id: recipeId, userId, deletedAt: null } });
  if (!recipe) throw Object.assign(new Error("Recipe not found."), { code: "RECIPE_NOT_FOUND", status: 404 });
  const payload = recipe.normalizedPayloadJson || recipe.originalPayloadJson || fallbackPayload;
  const validation = validateRecipe(payload);
  if (!validation.normalizedRecipe) { const correlationId = randomUUID(); await emitGovernanceEvent("recipe.validation_failed", userId, recipeId, { errorCodes: validation.errors.map((item) => item.code).slice(0, 20) }, correlationId); return { valid: false, validation }; }
  const plan = await buildRecipeGovernancePlan({ userId, recipe: validation.normalizedRecipe, source: recipe.recipeSource, rawPayload: recipe.originalPayloadJson });
  await prisma.playlistRecipe.update({ where: { id: recipeId }, data: recipeGovernanceData(plan, { source: recipe.recipeSource, originalPayload: recipe.originalPayloadJson || payload, approvedById: recipe.approvedById }) });
  await writeRecipeAudit({ recipeId, recipeVersion: recipe.recipeVersion, eventType: "RECIPE_VALIDATION_COMPLETED", actorId: userId, description: plan.quarantine.required ? "Recipe revalidation kept the recipe in quarantine." : "Recipe revalidation completed.", validation, risk: plan.risk, permissions: plan.permissions, trustState: plan.trustState, riskLevel: plan.risk.riskLevel });
  const correlationId = randomUUID();
  await emitGovernanceEvent(plan.quarantine.required ? "recipe.quarantined" : "recipe.approval_required", userId, recipeId, { trustState: plan.trustState, signatureStatus: plan.signature.status, riskLevel: plan.risk.riskLevel }, correlationId);
  return { valid: true, validation, plan };
}

export async function recipeAuditHistory(userId: string, filters: { recipeId?: string; eventType?: string; actorId?: string; trustState?: string; riskLevel?: string; from?: Date; to?: Date } = {}) {
  return prisma.recipeAuditEvent.findMany({ where: { recipe: { userId }, ...(filters.recipeId ? { recipeId: filters.recipeId } : {}), ...(filters.eventType ? { eventType: filters.eventType } : {}), ...(filters.actorId ? { actorId: filters.actorId } : {}), ...(filters.trustState ? { trustState: filters.trustState } : {}), ...(filters.riskLevel ? { riskLevel: filters.riskLevel } : {}), ...(filters.from || filters.to ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {}) }, orderBy: { createdAt: "desc" }, take: 500 });
}

export async function previewRestore(userId: string, snapshotId: string) {
  const snapshot = await prisma.recipeImportSnapshot.findFirst({ where: { id: snapshotId, userId }, include: { recipe: { select: snapshotFields } } });
  if (!snapshot) throw Object.assign(new Error("Restore snapshot not found."), { code: "RESTORE_SNAPSHOT_NOT_FOUND", status: 404 });
  const before = snapshot.snapshotJson as any;
  const current = snapshot.recipe;
  const expectedUpdatedAt = (snapshot.resourceVersions as any)?.recipeUpdatedAt;
  const conflicts = current && expectedUpdatedAt && new Date(current.updatedAt).getTime() !== new Date(expectedUpdatedAt).getTime() ? [{ code: "RECIPE_CHANGED_AFTER_IMPORT", message: "The recipe changed after this import completed." }] : [];
  return { snapshot: { id: snapshot.id, correlationId: snapshot.correlationId, reason: snapshot.reason, createdAt: snapshot.createdAt, status: snapshot.status }, before, current, conflicts, restorable: Boolean(current && snapshot.status === "AVAILABLE"), restoreAction: before?.newRecipe ? "REMOVE_IMPORTED_RECIPE" : "RESTORE_CONFIGURATION" };
}

export async function restoreSnapshot(userId: string, snapshotId: string, confirmConflicts = false) {
  const preview = await previewRestore(userId, snapshotId);
  if (!preview.restorable) throw Object.assign(new Error("This snapshot does not contain a previous recipe configuration."), { code: "RESTORE_NOT_AVAILABLE", status: 409 });
  if (preview.conflicts.length && !confirmConflicts) throw Object.assign(new Error("The recipe changed after import. Review and confirm the restore conflict."), { code: "RESTORE_CONFLICT", status: 409, conflicts: preview.conflicts });
  const snapshot = await prisma.recipeImportSnapshot.findFirstOrThrow({ where: { id: snapshotId, userId } });
  const before = snapshot.snapshotJson as Record<string, unknown>;
  const recipeId = snapshot.recipeId!;
  try { const result = await prisma.$transaction(async (tx) => {
    const restored = before.newRecipe
      ? await tx.playlistRecipe.update({ where: { id: recipeId }, data: { enabled: false, isArchived: true, deletedAt: new Date(), approvalState: "REVOKED_LOCALLY", grantedPermissionsJson: json([]) } })
      : await tx.playlistRecipe.update({ where: { id: recipeId }, data: Object.fromEntries(Object.entries(before).filter(([key]) => key !== "updatedAt")) as any });
    await tx.recipeImportSnapshot.update({ where: { id: snapshot.id }, data: { status: "RESTORED", restoredAt: new Date(), restoredById: userId, restoreResultJson: json({ recipeId, conflictsAccepted: preview.conflicts.length }) } });
    await writeRecipeAudit({ recipeId, recipeVersion: restored.recipeVersion, eventType: "RECIPE_RESTORED", actorId: userId, correlationId: snapshot.correlationId, description: before.newRecipe ? "The newly imported recipe was removed atomically." : "The pre-import recipe configuration was restored atomically.", previousState: preview.current, newState: before.newRecipe ? { removedImportedRecipe: true } : before }, tx);
    return { restored, conflicts: preview.conflicts };
  }); recipeRestoresTotal.inc({ result: "success" }); await emitGovernanceEvent("recipe.restore_completed", userId, recipeId, { snapshotId, conflictsAccepted: preview.conflicts.length }, snapshot.correlationId); return result; } catch (error) { recipeRestoresTotal.inc({ result: "failed" }); await emitGovernanceEvent("recipe.restore_failed", userId, recipeId, { snapshotId, code: (error as any)?.code || "RESTORE_FAILED" }, snapshot.correlationId); throw error; }
}

export function migrationPreview(original: unknown) {
  const validation = validateRecipe(original);
  return { original, normalized: validation.normalizedRecipe, valid: validation.valid, changes: validation.warnings.filter((item) => item.code.includes("migrat") || item.code.includes("inferred")), errors: validation.errors, diffHash: hash({ original, normalized: validation.normalizedRecipe }) };
}

export async function previewStoredRecipeMigration(userId: string, recipeId: string) {
  const recipe = await prisma.playlistRecipe.findFirst({ where: { id: recipeId, userId, deletedAt: null }, select: { originalPayloadJson: true, normalizedPayloadJson: true } });
  if (!recipe) throw Object.assign(new Error("Recipe not found."), { code: "RECIPE_NOT_FOUND", status: 404 });
  return migrationPreview(recipe.originalPayloadJson || recipe.normalizedPayloadJson);
}

export function canonicalPayloadForSigning(recipe: MixRecipeDocument) { return canonicalRecipeSignaturePayload(recipe); }

export async function listSigningKeys() {
  return prisma.recipeSigningKey.findMany({ select: { id: true, keyId: true, name: true, identity: true, algorithm: true, official: true, trusted: true, expiresAt: true, revokedAt: true, createdAt: true, updatedAt: true }, orderBy: [{ official: "desc" }, { name: "asc" }] });
}

export async function addSigningKey(userId: string, input: { keyId: string; name: string; identity: string; algorithm?: string; publicKey: string; official?: boolean; trusted?: boolean; expiresAt?: string | null }) {
  if (!(await isUserAdmin(userId))) throw Object.assign(new Error("ADMIN_REQUIRED"), { code: "ADMIN_REQUIRED", status: 403 });
  if ((input.algorithm || "ed25519") !== "ed25519") throw Object.assign(new Error("Only Ed25519 signing keys are supported."), { code: "UNSUPPORTED_SIGNATURE_ALGORITHM", status: 400 });
  if (/PRIVATE KEY/i.test(input.publicKey)) throw Object.assign(new Error("Private signing keys must never be stored in Mixarr."), { code: "PRIVATE_KEY_FORBIDDEN", status: 400 });
  return prisma.recipeSigningKey.create({ data: { keyId: input.keyId.trim(), name: input.name.trim(), identity: input.identity.trim(), algorithm: "ed25519", publicKey: input.publicKey.trim(), official: input.official === true, trusted: input.trusted !== false, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } });
}

export async function revokeSigningKey(userId: string, keyId: string) {
  if (!(await isUserAdmin(userId))) throw Object.assign(new Error("ADMIN_REQUIRED"), { code: "ADMIN_REQUIRED", status: 403 });
  const key = await prisma.recipeSigningKey.update({ where: { keyId }, data: { revokedAt: new Date(), revokedById: userId, trusted: false } });
  const affected = await prisma.playlistRecipe.updateMany({ where: { signatureKeyId: keyId }, data: { signatureStatus: "REVOKED_KEY", trustState: "REVOKED", approvalState: "REVOKED_LOCALLY", enabled: false, grantedPermissionsJson: json([]) } });
  await writeRecipeAudit({ eventType: "RECIPE_SIGNING_KEY_REVOKED", actorId: userId, description: `Signing key ${keyId} was revoked; ${affected.count} recipe(s) were disabled.`, metadata: { keyId, affectedRecipes: affected.count } });
  await emitGovernanceEvent("recipe.signing_key_revoked", userId, null, { keyId, affectedRecipes: affected.count }, randomUUID());
  return { key: { id: key.id, keyId: key.keyId, revokedAt: key.revokedAt }, affectedRecipes: affected.count };
}

export async function getRecipeSafetyPolicy(userId: string) {
  const row = await prisma.recipeSafetyPolicy.findUnique({ where: { userId } });
  return { limits: normalizeSafetyLimits(row?.limitsJson as Partial<RecipeSafetyLimits> | null), updatedAt: row?.updatedAt || null };
}

export async function updateRecipeSafetyPolicy(userId: string, limits: Partial<RecipeSafetyLimits>) {
  if (!(await isUserAdmin(userId))) throw Object.assign(new Error("ADMIN_REQUIRED"), { code: "ADMIN_REQUIRED", status: 403 });
  const normalized = normalizeSafetyLimits(limits);
  return prisma.recipeSafetyPolicy.upsert({ where: { userId }, create: { userId, limitsJson: json(normalized) }, update: { limitsJson: json(normalized) } });
}

export async function runStoredRecipeMigration(userId: string, recipeId: string, expectedDiffHash: string) {
  const recipe = await prisma.playlistRecipe.findFirst({ where: { id: recipeId, userId, deletedAt: null } });
  if (!recipe) throw Object.assign(new Error("Recipe not found."), { code: "RECIPE_NOT_FOUND", status: 404 });
  const original = recipe.originalPayloadJson || recipe.normalizedPayloadJson;
  const preview = migrationPreview(original);
  if (preview.diffHash !== expectedDiffHash) throw Object.assign(new Error("The migration preview is stale."), { code: "STALE_MIGRATION_PREVIEW", status: 409 });
  if (!preview.normalized) throw Object.assign(new Error("The recipe cannot be migrated safely."), { code: "MIGRATION_FAILED", status: 422 });
  const plan = await buildRecipeGovernancePlan({ userId, recipe: preview.normalized, source: "migration", rawPayload: original });
  const history = Array.isArray(recipe.migrationHistoryJson) ? recipe.migrationHistoryJson : [];
  const entry = { fromSchemaVersion: (original as any)?.schemaVersion || 0, toSchemaVersion: preview.normalized.schemaVersion, changes: preview.changes, migratedAt: new Date().toISOString(), actorId: userId, didNotIncreasePermissions: true };
  const correlationId = randomUUID();
  await createRecipeSnapshot({ userId, recipeId, correlationId, reason: `Before migrating recipe schema to v${preview.normalized.schemaVersion}` });
  try { const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.playlistRecipe.update({ where: { id: recipeId }, data: { ...recipeGovernanceData(plan, { source: recipe.recipeSource, originalPayload: original, approvedById: recipe.approvedById }), normalizedPayloadJson: json(preview.normalized), migrationHistoryJson: json([...history, entry]), enabled: false, approvalState: plan.quarantine.required ? "QUARANTINED" : "PENDING_REVIEW" } });
    await tx.recipeImportSnapshot.updateMany({ where: { userId, recipeId, correlationId, status: "AVAILABLE" }, data: { resourceVersions: json({ recipeUpdatedAt: updated.updatedAt.toISOString() }) } });
    await writeRecipeAudit({ recipeId, recipeVersion: updated.recipeVersion, eventType: "RECIPE_MIGRATED", actorId: userId, correlationId, description: `Recipe schema migrated to v${preview.normalized!.schemaVersion}; local review is required before execution.`, previousState: { schemaVersion: (original as any)?.schemaVersion || 0 }, newState: entry, validation: { changes: preview.changes }, permissions: plan.permissions, trustState: updated.trustState, riskLevel: updated.riskLevel }, tx);
    return { recipe: updated, migration: entry, plan };
  }); recipeMigrationsTotal.inc({ result: "success" }); await emitGovernanceEvent("recipe.migrated", userId, recipeId, { fromSchemaVersion: entry.fromSchemaVersion, toSchemaVersion: entry.toSchemaVersion }, correlationId); return result; } catch (error) { recipeMigrationsTotal.inc({ result: "failed" }); throw error; }
}
