import type { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import type { AiCapabilityResult, AiProviderType, ResolvedAiProviderConfig } from "../contracts";
import { AI_PROVIDER_TYPES } from "../contracts";
import { AiError } from "../errors";
import { decryptAiCredentialPayload, encryptAiCredentialPayload, isAiSecretEncryptionConfigured, validateNonSecretHeaders, validateSecretHeaders } from "../security";
import { aiProviderRegistry } from "../registry/providerRegistry";
import { normalizeOpenAiBaseUrl } from "../providers/openai";

const jsonObject = z.record(z.unknown()).default({});
export const providerInputSchema = z.object({
  providerType: z.enum(AI_PROVIDER_TYPES).optional(), displayName: z.string().trim().min(1).max(120).optional(), enabled: z.boolean().optional(),
  locationClassification: z.enum(["LOCAL", "REMOTE", "USER_CLASSIFIED", "UNKNOWN"]).optional(), baseUrl: z.string().trim().max(2048).nullable().optional(),
  administratorConfirmedLocal: z.boolean().optional(), trustedNetwork: z.boolean().optional(), externalAccessWarning: z.boolean().optional(),
  authenticationType: z.enum(["NONE", "API_KEY_HEADER", "BEARER", "BASIC", "PROVIDER_SPECIFIC", "OFFICIAL_OAUTH", "CUSTOM_SECRET_HEADERS"]).optional(),
  apiKeyAction: z.enum(["keep", "replace", "remove"]).optional(), apiKey: z.string().max(8192).optional(),
  secretHeadersAction: z.enum(["keep", "replace", "remove"]).optional(), secretHeaders: jsonObject.optional(), nonSecretHeaders: jsonObject.optional(),
  defaultModel: z.string().trim().max(300).nullable().optional(), fastModel: z.string().trim().max(300).nullable().optional(), reasoningModel: z.string().trim().max(300).nullable().optional(),
  maximumContextTokens: z.number().int().min(1).max(10_000_000).nullable().optional(), maximumOutputTokens: z.number().int().min(1).max(1_000_000).nullable().optional(),
  requestTimeoutMs: z.number().int().min(1000).max(300_000).optional(), retryCount: z.number().int().min(0).max(10).optional(), initialRetryDelayMs: z.number().int().min(50).max(60_000).optional(), maximumRetryDelayMs: z.number().int().min(50).max(300_000).optional(), retryBackoffMultiplier: z.number().min(1).max(10).optional(), sslVerification: z.boolean().optional(),
  capabilityOverrides: jsonObject.optional(), modelDiscoveryEnabled: z.boolean().optional(), healthCheckEnabled: z.boolean().optional(), healthCheckIntervalMinutes: z.number().int().min(1).max(10080).optional(), monthlyBudget: z.number().nonnegative().max(1_000_000).nullable().optional(), budgetWarningThreshold: z.number().min(0).max(1).optional(), priority: z.number().int().min(0).max(10000).nullable().optional(), fallbackProviderId: z.string().uuid().nullable().optional(), notes: z.string().max(2000).nullable().optional(), customConfiguration: jsonObject.optional(),
});

function assertLocalSafety(input: z.infer<typeof providerInputSchema>, existing?: any) {
  const location = input.locationClassification ?? existing?.locationClassification;
  if (location !== "LOCAL") return;
  const changedToLocal = input.locationClassification === "LOCAL" && existing?.locationClassification && existing.locationClassification !== "LOCAL";
  const administratorConfirmedLocal = changedToLocal ? input.administratorConfirmedLocal : input.administratorConfirmedLocal ?? existing?.administratorConfirmedLocal;
  const trustedNetwork = changedToLocal ? input.trustedNetwork : input.trustedNetwork ?? existing?.trustedNetwork;
  const issues: z.ZodIssue[] = [];
  if (administratorConfirmedLocal !== true) issues.push({ code: z.ZodIssueCode.custom, path: ["administratorConfirmedLocal"], message: "Confirm that an administrator inspected this local endpoint." });
  if (trustedNetwork !== true) issues.push({ code: z.ZodIssueCode.custom, path: ["trustedNetwork"], message: "Confirm that the endpoint is on an administrator-trusted network." });
  if (issues.length) throw new z.ZodError(issues);
}

function invalidProviderField(field: string, message: string) { return new AiError("INVALID_REQUEST", message, 400, undefined, { issues: [{ path: field, message }] }); }

function validateBaseUrl(value: string | null | undefined) {
  if (!value) return value;
  let url: URL; try { url = new URL(value); } catch { throw invalidProviderField("baseUrl", "Enter a valid provider base URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw invalidProviderField("baseUrl", "Provider URLs must use HTTP(S) and cannot contain credentials, query strings, or fragments.");
  return value.replace(/\/+$/, "");
}
function publicProvider(provider: any) {
  return { id: provider.id, providerType: provider.providerType, displayName: provider.displayName, enabled: provider.enabled, locationClassification: provider.locationClassification, administratorConfirmedLocal: provider.administratorConfirmedLocal, trustedNetwork: provider.trustedNetwork, externalAccessWarning: provider.externalAccessWarning, lastLocalStatusValidationAt: provider.lastLocalStatusValidationAt, baseUrl: provider.baseUrl, authenticationType: provider.authenticationType, apiKeyConfigured: !!provider.encryptedSecretPayload, secretHeadersConfigured: !!provider.encryptedSecretHeaders, secretStatus: provider.encryptedSecretPayload ? "API key configured" : "No API key configured", nonSecretHeaders: provider.nonSecretHeadersJson || {}, defaultModel: provider.defaultModel, fastModel: provider.fastModel, reasoningModel: provider.reasoningModel, maximumContextTokens: provider.maximumContextTokens, maximumOutputTokens: provider.maximumOutputTokens, requestTimeoutMs: provider.requestTimeoutMs, retryCount: provider.retryCount, initialRetryDelayMs: provider.initialRetryDelayMs, maximumRetryDelayMs: provider.maximumRetryDelayMs, retryBackoffMultiplier: provider.retryBackoffMultiplier, sslVerification: provider.sslVerification, capabilityOverrides: provider.capabilityOverridesJson || {}, modelDiscoveryEnabled: provider.modelDiscoveryEnabled, healthCheckEnabled: provider.healthCheckEnabled, healthCheckIntervalMinutes: provider.healthCheckIntervalMinutes, monthlyBudget: provider.monthlyBudget, budgetWarningThreshold: provider.budgetWarningThreshold, priority: provider.priority, fallbackProviderId: provider.fallbackProviderId, notes: provider.notes, customConfiguration: provider.customConfigurationJson || {}, createdAt: provider.createdAt, updatedAt: provider.updatedAt, lastConnectionTestAt: provider.lastConnectionTestAt, lastSuccessfulConnectionAt: provider.lastSuccessfulConnectionAt, health: provider.health, modelCount: provider._count?.models };
}

async function secretUpdates(input: z.infer<typeof providerInputSchema>, existing?: any) {
  let encryptedSecretPayload = existing?.encryptedSecretPayload || null;
  let encryptedSecretHeaders = existing?.encryptedSecretHeaders || null;
  if (input.apiKeyAction === "remove") encryptedSecretPayload = null;
  if (input.apiKeyAction === "replace") { if (!input.apiKey?.trim()) throw invalidProviderField("apiKey", "Enter a replacement API key."); if (!isAiSecretEncryptionConfigured()) throw invalidProviderField("apiKey", "Configure AI_CREDENTIAL_ENCRYPTION_KEY before saving AI credentials."); encryptedSecretPayload = encryptAiCredentialPayload({ apiKey: input.apiKey.trim() }); }
  if (input.secretHeadersAction === "remove") encryptedSecretHeaders = null;
  if (input.secretHeadersAction === "replace") { if (!isAiSecretEncryptionConfigured()) throw invalidProviderField("secretHeaders", "Configure AI_CREDENTIAL_ENCRYPTION_KEY before saving secret headers."); try { encryptedSecretHeaders = encryptAiCredentialPayload(validateSecretHeaders(input.secretHeaders || {})); } catch (error) { if (error instanceof AiError) throw error; throw invalidProviderField("secretHeaders", (error as Error).message || "Invalid secret headers."); } }
  return { encryptedSecretPayload, encryptedSecretHeaders };
}

function dataFromInput(input: z.infer<typeof providerInputSchema>, existingProviderType?: string) {
  const data: any = { ...input };
  for (const key of ["apiKeyAction", "apiKey", "secretHeadersAction", "secretHeaders"]) delete data[key];
  if ("baseUrl" in data) { data.baseUrl = validateBaseUrl(data.baseUrl); if ((input.providerType || existingProviderType) === "openai" && data.baseUrl) { try { data.baseUrl = normalizeOpenAiBaseUrl(data.baseUrl); } catch { throw invalidProviderField("baseUrl", "Enter an OpenAI API root such as https://api.openai.com/v1, without an endpoint path or query string."); } } }
  if ("nonSecretHeaders" in data) { try { data.nonSecretHeadersJson = validateNonSecretHeaders(data.nonSecretHeaders || {}) as Prisma.InputJsonValue; } catch (error) { throw invalidProviderField("nonSecretHeaders", (error as Error).message || "Invalid non-secret headers."); } delete data.nonSecretHeaders; }
  if ("capabilityOverrides" in data) { data.capabilityOverridesJson = data.capabilityOverrides as Prisma.InputJsonValue; delete data.capabilityOverrides; }
  if ("customConfiguration" in data) { data.customConfigurationJson = data.customConfiguration as Prisma.InputJsonValue; delete data.customConfiguration; }
  if (data.locationClassification && data.locationClassification !== "LOCAL") { data.administratorConfirmedLocal = false; data.trustedNetwork = false; }
  return data;
}

export async function listAiProviders() { return (await prisma.aiProviderConfig.findMany({ orderBy: [{ priority: "asc" }, { displayName: "asc" }], include: { health: true, _count: { select: { models: true } } } })).map(publicProvider); }
export async function getAiProvider(id: string) { const row = await prisma.aiProviderConfig.findUnique({ where: { id }, include: { health: true, _count: { select: { models: true } } } }); if (!row) throw new AiError("PROVIDER_NOT_FOUND"); return publicProvider(row); }
export async function createAiProvider(raw: unknown) { const input = providerInputSchema.parse(raw); if (!input.providerType || !input.displayName) throw new AiError("INVALID_REQUEST", "Provider type and display name are required.", 400); if (!aiProviderRegistry.supports(input.providerType)) throw new AiError("PROVIDER_UNSUPPORTED"); assertLocalSafety(input); if (input.providerType === "chatgpt_subscription") input.enabled = false; const secrets = await secretUpdates({ ...input, apiKeyAction: input.apiKey ? "replace" : input.apiKeyAction, secretHeadersAction: input.secretHeaders ? "replace" : input.secretHeadersAction }); const row = await prisma.aiProviderConfig.create({ data: { providerType: input.providerType, displayName: input.displayName, ...dataFromInput(input), ...secrets, ...(input.locationClassification === "LOCAL" ? { lastLocalStatusValidationAt: new Date() } : {}) } }); return publicProvider(row); }
export async function updateAiProvider(id: string, raw: unknown, actorId?: string) { const input = providerInputSchema.parse(raw); const existing = await prisma.aiProviderConfig.findUnique({ where: { id } }); if (!existing) throw new AiError("PROVIDER_NOT_FOUND"); assertLocalSafety(input, existing); if (input.providerType === "chatgpt_subscription" || existing.providerType === "chatgpt_subscription") input.enabled = false; if (input.fallbackProviderId === id) throw new AiError("INVALID_REQUEST", "A provider cannot fall back to itself.", 400); const secrets = await secretUpdates(input, existing); const localValidationChanged = input.administratorConfirmedLocal !== undefined || input.trustedNetwork !== undefined || input.locationClassification !== undefined; const data = { ...dataFromInput(input, existing.providerType), ...secrets, ...(localValidationChanged ? { lastLocalStatusValidationAt: new Date() } : {}) }; const row = localValidationChanged && actorId ? await prisma.$transaction(async (tx) => { const updated = await tx.aiProviderConfig.update({ where: { id }, data }); await tx.aiGovernanceAudit.create({ data: { actorId, action: "PROVIDER_LOCATION_POLICY_UPDATED", entityType: "AiProviderConfig", entityId: id, previousValueJson: { locationClassification: existing.locationClassification, administratorConfirmedLocal: existing.administratorConfirmedLocal, trustedNetwork: existing.trustedNetwork } as any, newValueJson: { locationClassification: updated.locationClassification, administratorConfirmedLocal: updated.administratorConfirmedLocal, trustedNetwork: updated.trustedNetwork } as any } }); return updated; }) : await prisma.aiProviderConfig.update({ where: { id }, data }); return publicProvider(row); }
export async function duplicateAiProvider(id: string) { const source = await prisma.aiProviderConfig.findUnique({ where: { id } }); if (!source) throw new AiError("PROVIDER_NOT_FOUND"); const { id: _id, createdAt: _created, updatedAt: _updated, encryptedSecretPayload: _secret, encryptedSecretHeaders: _headers, lastConnectionTestAt: _test, lastSuccessfulConnectionAt: _success, ...copy } = source; const row = await prisma.aiProviderConfig.create({ data: { ...copy, nonSecretHeadersJson: copy.nonSecretHeadersJson == null ? undefined : copy.nonSecretHeadersJson as Prisma.InputJsonValue, capabilityOverridesJson: copy.capabilityOverridesJson == null ? undefined : copy.capabilityOverridesJson as Prisma.InputJsonValue, customConfigurationJson: copy.customConfigurationJson == null ? undefined : copy.customConfigurationJson as Prisma.InputJsonValue, displayName: `${source.displayName} copy`, enabled: false } }); return publicProvider(row); }
export async function deleteAiProvider(id: string) { const [preferred, fallbackFeature, fallbackProvider, active, globalDefault] = await Promise.all([prisma.aiFeatureSetting.count({ where: { preferredProviderId: id, enabled: true } }), prisma.aiFeatureSetting.count({ where: { fallbackProviderId: id } }), prisma.aiProviderConfig.count({ where: { fallbackProviderId: id } }), prisma.aiRequestAudit.count({ where: { providerConfigId: id, status: { in: ["QUEUED", "RUNNING", "STREAMING", "RETRIED"] } } }), prisma.aiGlobalSetting.count({ where: { defaultProviderId: id } })]); if (preferred || fallbackFeature || fallbackProvider || active || globalDefault) throw new AiError("INVALID_REQUEST", "Reassign global defaults, enabled features, fallback references, and active requests before deleting this provider.", 409); await prisma.aiProviderConfig.delete({ where: { id } }); }

export async function resolveAiProvider(id: string): Promise<ResolvedAiProviderConfig> {
  const row = await prisma.aiProviderConfig.findUnique({ where: { id } }); if (!row) throw new AiError("PROVIDER_NOT_FOUND");
  let credential: Record<string, any> = {}, secretHeaders: Record<string, string> = {};
  if ((row.encryptedSecretPayload || row.encryptedSecretHeaders) && !isAiSecretEncryptionConfigured()) throw new AiError("PROVIDER_SECRET_UNAVAILABLE");
  try { credential = decryptAiCredentialPayload(row.encryptedSecretPayload); secretHeaders = decryptAiCredentialPayload(row.encryptedSecretHeaders) as Record<string, string>; } catch { throw new AiError("PROVIDER_SECRET_UNAVAILABLE"); }
  if (credential.apiKey != null && (typeof credential.apiKey !== "string" || !credential.apiKey.trim() || /^(\*+|configured|stored)$/i.test(credential.apiKey.trim()))) throw new AiError("PROVIDER_SECRET_UNAVAILABLE");
  return { id: row.id, providerType: row.providerType as AiProviderType, displayName: row.displayName, enabled: row.enabled, locationClassification: row.locationClassification as any, baseUrl: row.baseUrl || undefined, authenticationType: row.authenticationType as any, apiKey: credential.apiKey, secretHeaders, nonSecretHeaders: (row.nonSecretHeadersJson || {}) as Record<string, string>, defaultModel: row.defaultModel || undefined, fastModel: row.fastModel || undefined, reasoningModel: row.reasoningModel || undefined, fallbackProviderId: row.fallbackProviderId || undefined, maximumContextTokens: row.maximumContextTokens || undefined, maximumOutputTokens: row.maximumOutputTokens || undefined, requestTimeoutMs: row.requestTimeoutMs, retryCount: row.retryCount, initialRetryDelayMs: row.initialRetryDelayMs, maximumRetryDelayMs: row.maximumRetryDelayMs, retryBackoffMultiplier: row.retryBackoffMultiplier, sslVerification: row.sslVerification, capabilityOverrides: (row.capabilityOverridesJson || {}) as AiCapabilityResult, customConfiguration: (row.customConfigurationJson || {}) as Record<string, unknown> };
}
