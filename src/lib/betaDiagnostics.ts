import os from "node:os";
import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { APP_VERSION } from "./appVersion";
import { DEFAULT_SCORING_MODEL } from "./scoringModelCatalog";
import { getBetaStatus } from "./featureFlagService";
import { sanitizeDiagnostics, sanitizeErrorText } from "./supportRedaction";
import { getSupportLinks } from "./support";

const forbiddenKey = /(token|secret|password|credential|authorization|api[-_]?key|access[-_]?key|session|cookie|filesystem|path)/i;

export function sanitizeBetaReport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeBetaReport);
  if (!value || typeof value !== "object") return typeof value === "string" ? sanitizeErrorText(value, 1000) : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !forbiddenKey.test(key))
    .map(([key, child]) => [key, sanitizeBetaReport(child)]));
}

export async function buildBetaFeedbackReport(input: { userId: string; featureKey?: string | null; playlistId?: string | null; scoringModel?: string | null; action?: string | null; fallbackUsed?: boolean; warnings?: unknown; errors?: unknown; jobId?: string | null; scoreSummary?: unknown; generationSettings?: unknown }) {
  const [status, playlist, job] = await Promise.all([
    getBetaStatus({ userId: input.userId }),
    input.playlistId ? prisma.generatedPlaylist.findFirst({ where: { id: input.playlistId, userId: input.userId }, select: { id: true, engineVersion: true, scoringModel: true, scoringModelVersion: true, betaMetadataJson: true } }) : null,
    input.jobId ? prisma.jobHistory.findFirst({ where: { id: input.jobId, userId: input.userId }, select: { id: true, type: true, status: true, error: true, durationMs: true } }) : null,
  ]);
  const raw = {
    title: "Mixarr Beta Feedback Report",
    applicationVersion: APP_VERSION,
    smartMixEngineVersion: playlist?.engineVersion || "v2",
    feature: input.featureKey || null,
    scoringModel: input.scoringModel || playlist?.scoringModel || DEFAULT_SCORING_MODEL,
    scoringModelVersion: playlist?.scoringModelVersion || "2",
    accessLevel: status.accessLevel,
    enabledFeatureFlags: status.enabledFeatures,
    playlistAction: input.action || null,
    playlistId: playlist?.id || null,
    stableFallbackUsed: input.fallbackUsed || false,
    timestamp: new Date().toISOString(),
    databaseProvider: "postgresql",
    runtimeEnvironment: process.env.NODE_ENV || "unknown",
    runtimeVersion: process.version,
    platform: os.platform(),
    generationSettings: input.generationSettings || null,
    warnings: input.warnings || null,
    errors: input.errors || job?.error || null,
    recentJob: job,
    playlistScoreSummary: input.scoreSummary || null,
  };
  return sanitizeDiagnostics(sanitizeBetaReport(raw)) as Record<string, unknown>;
}

export async function saveBetaFeedbackReport(userId: string, input: Parameters<typeof buildBetaFeedbackReport>[0]) {
  const report = await buildBetaFeedbackReport({ ...input, userId });
  const row = await prisma.betaFeedbackReport.create({ data: { userId, featureKey: input.featureKey || null, playlistId: input.playlistId || null, scoringModel: input.scoringModel || null, action: input.action || null, sanitizedReport: report as Prisma.InputJsonValue } });
  return { id: row.id, report, links: getSupportLinks() };
}
