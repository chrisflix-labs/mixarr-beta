import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { aiProviderRegistry } from "../registry/providerRegistry";
import { resolveAiProvider } from "../services/providerService";
import { AiError, normalizeProviderError } from "../errors";
import { sanitizeAiError } from "../security";
import { createAiRequestSignal } from "../utilities/cancellation";
import { beginAdministrativeAiOperation, finishAdministrativeAiOperation } from "../governance/service";

const activeProviderTests = new Set<string>();

export async function testAiProviderConnection(providerId: string, signal?: AbortSignal, userId?: string, background = false) {
  const config = await resolveAiProvider(providerId); const adapter = aiProviderRegistry.get(config.providerType); if (!adapter.available) throw new AiError("PROVIDER_UNSUPPORTED");
  if (activeProviderTests.has(providerId)) throw new AiError("PROVIDER_UNAVAILABLE", "A connection test is already running for this provider.", 409);
  const governanceOperation = await beginAdministrativeAiOperation({ provider: config, source: "CONNECTION_TEST", userId, signal, background });
  activeProviderTests.add(providerId);
  const timed = createAiRequestSignal(signal, Math.min(config.requestTimeoutMs, 30_000)); const started = Date.now();
  try {
    const result = await adapter.testConnection(config, timed.signal);
    await prisma.$transaction([
      prisma.aiProviderConfig.update({ where: { id: providerId }, data: { lastConnectionTestAt: new Date(), lastSuccessfulConnectionAt: new Date() } }),
      prisma.aiProviderHealth.upsert({ where: { providerConfigId: providerId }, create: { providerConfigId: providerId, healthState: "HEALTHY", lastCheckAt: new Date(), lastSuccessfulCheckAt: new Date(), latencyMs: result.latencyMs, discoveredModelCount: result.availableModelCount }, update: { healthState: "HEALTHY", lastCheckAt: new Date(), lastSuccessfulCheckAt: new Date(), latencyMs: result.latencyMs, discoveredModelCount: result.availableModelCount, consecutiveFailureCount: 0, errorCategory: null, sanitizedMessage: result.message, nextEligibleCheckAt: null } }),
    ]);
    await finishAdministrativeAiOperation(governanceOperation, { success: true });
    return { ...result, success: true, provider: config.displayName, model: config.defaultModel || null, classification: governanceOperation.classification.classification, classificationReason: governanceOperation.classification.reason, effectivePolicy: governanceOperation.resolvedPolicy, latency_ms: result.latencyMs, correlation_id: governanceOperation.requestId };
  } catch (error) {
    let normalized = normalizeProviderError(error); if (timed.timedOut()) normalized = new AiError("REQUEST_TIMEOUT"); else if (timed.signal.aborted && ["CONNECTION_FAILED", "REQUEST_CANCELLED"].includes(normalized.category)) normalized = new AiError("REQUEST_CANCELLED");
    if (normalized.category === "REQUEST_TIMEOUT") normalized = new AiError("PROVIDER_TIMEOUT", undefined, 504, undefined, { correlation_id: governanceOperation.requestId, provider_classification: governanceOperation.classification.classification });
    else if (["CONNECTION_FAILED", "PROVIDER_OVERLOADED"].includes(normalized.category)) normalized = new AiError("PROVIDER_CONNECTION_FAILED", undefined, 502, undefined, { correlation_id: governanceOperation.requestId, provider_classification: governanceOperation.classification.classification });
    await finishAdministrativeAiOperation(governanceOperation, { success: false, error: normalized });
    if (normalized.category === "REQUEST_CANCELLED") throw normalized; const current = await prisma.aiProviderHealth.findUnique({ where: { providerConfigId: providerId } }); const failures = (current?.consecutiveFailureCount || 0) + 1; const next = new Date(Date.now() + Math.min(24 * 60, config.requestTimeoutMs / 1000 + 2 ** failures) * 60_000);
    await prisma.$transaction([prisma.aiProviderConfig.update({ where: { id: providerId }, data: { lastConnectionTestAt: new Date() } }), prisma.aiProviderHealth.upsert({ where: { providerConfigId: providerId }, create: { providerConfigId: providerId, healthState: "UNAVAILABLE", lastCheckAt: new Date(), latencyMs: Date.now() - started, errorCategory: normalized.category, sanitizedMessage: sanitizeAiError(error), consecutiveFailureCount: failures, nextEligibleCheckAt: next }, update: { healthState: failures >= 3 ? "UNAVAILABLE" : "DEGRADED", lastCheckAt: new Date(), latencyMs: Date.now() - started, errorCategory: normalized.category, sanitizedMessage: sanitizeAiError(error), consecutiveFailureCount: failures, nextEligibleCheckAt: next } })]);
    throw normalized;
  } finally { timed.close(); activeProviderTests.delete(providerId); }
}

export async function recordAiExecutionHealth(providerId: string, success: boolean, latencyMs: number, error?: unknown) {
  const current = await prisma.aiProviderHealth.findUnique({ where: { providerConfigId: providerId } }).catch(() => null);
  const failures = success ? 0 : (current?.consecutiveFailureCount || 0) + 1;
  const normalized = success ? null : normalizeProviderError(error);
  await prisma.aiProviderHealth.upsert({
    where: { providerConfigId: providerId },
    create: { providerConfigId: providerId, healthState: success ? "HEALTHY" : "DEGRADED", lastCheckAt: new Date(), lastSuccessfulCheckAt: success ? new Date() : undefined, latencyMs, consecutiveFailureCount: failures, errorCategory: normalized?.category, sanitizedMessage: success ? "Request completed successfully." : sanitizeAiError(error) },
    update: { healthState: success ? "HEALTHY" : failures >= 3 ? "UNAVAILABLE" : "DEGRADED", lastCheckAt: new Date(), lastSuccessfulCheckAt: success ? new Date() : undefined, latencyMs, consecutiveFailureCount: failures, errorCategory: normalized?.category || null, sanitizedMessage: success ? "Request completed successfully." : sanitizeAiError(error) },
  }).catch(() => null);
  if (success) await prisma.aiProviderConfig.update({ where: { id: providerId }, data: { lastSuccessfulConnectionAt: new Date() } }).catch(() => null);
}

export async function refreshAiProviderModels(providerId: string, signal?: AbortSignal, userId?: string) {
  const config = await resolveAiProvider(providerId); if (!config.enabled) throw new AiError("PROVIDER_DISABLED");
  const governanceOperation = await beginAdministrativeAiOperation({ provider: config, source: "MODEL_DISCOVERY", userId, signal });
  const adapter = aiProviderRegistry.get(config.providerType); const timed = createAiRequestSignal(signal, Math.min(config.requestTimeoutMs, 60_000));
  try {
    const models = await adapter.discoverModels(config, timed.signal); const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.aiProviderModel.updateMany({ where: { providerConfigId: providerId }, data: { availabilityStatus: "UNAVAILABLE" } });
      for (const model of models) await tx.aiProviderModel.upsert({ where: { providerConfigId_modelIdentifier: { providerConfigId: providerId, modelIdentifier: model.id } }, create: { providerConfigId: providerId, modelIdentifier: model.id, displayName: model.displayName, contextSize: model.contextSize, modelCategory: model.category, capabilityMetadata: model.capabilities as Prisma.InputJsonValue, discoveredAt: now, lastSeenAt: now, availabilityStatus: "AVAILABLE" }, update: { displayName: model.displayName, contextSize: model.contextSize, modelCategory: model.category, capabilityMetadata: model.capabilities as Prisma.InputJsonValue, lastSeenAt: now, availabilityStatus: "AVAILABLE" } });
      await tx.aiProviderHealth.upsert({ where: { providerConfigId: providerId }, create: { providerConfigId: providerId, discoveredModelCount: models.length }, update: { discoveredModelCount: models.length } });
    });
    await finishAdministrativeAiOperation(governanceOperation, { success: true });
    return { models, discoveredAt: now.toISOString() };
  } catch (error) { await finishAdministrativeAiOperation(governanceOperation, { success: false, error }); throw error; } finally { timed.close(); }
}

export async function runDueAiHealthChecks(concurrency = 2) {
  const global = await prisma.aiGlobalSetting.findUnique({ where: { id: "global" } }); if (!global?.enabled) return { tested: 0, skipped: true };
  const now = new Date(); const providers = await prisma.aiProviderConfig.findMany({ where: { enabled: true, healthCheckEnabled: true, OR: [{ health: null }, { health: { nextEligibleCheckAt: { lte: now } } }, { health: { nextEligibleCheckAt: null, lastCheckAt: { lte: new Date(now.getTime() - 60_000) } } }] }, select: { id: true, healthCheckIntervalMinutes: true, health: true } });
  const due = providers.filter((provider) => !provider.health?.lastCheckAt || now.getTime() - provider.health.lastCheckAt.getTime() >= provider.healthCheckIntervalMinutes * 60_000); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, async () => { while (cursor < due.length) { const item = due[cursor++]; await testAiProviderConnection(item.id, undefined, undefined, true).catch(() => null); } }));
  return { tested: due.length, skipped: false };
}
