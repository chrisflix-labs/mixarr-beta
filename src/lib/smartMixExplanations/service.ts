import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { redactVersionSettings } from "../playlists/versions/playlist-version-snapshot";
import { buildGenerationInsights, compareDecisionExplanations } from "./collector";
import { linkRecommendationExplanationToGeneration } from "../recommendationExplanations/service";
import type { SmartMixDecisionExplanation, SmartMixExplanationDetailLevel, SmartMixGenerationInsights } from "./types";

export const DEFAULT_REJECTED_CANDIDATE_LIMIT = 100;
export const DEFAULT_REJECTED_RETENTION_DAYS = 30;

export async function getExplanationPreference(userId: string) {
  const preference = await prisma.smartMixExplanationPreference.findUnique({ where: { userId } });
  return preference || { userId, enabled: true, detailLevel: "SIMPLE" as const, rejectedCandidateLimit: DEFAULT_REJECTED_CANDIDATE_LIMIT, rejectedRetentionDays: DEFAULT_REJECTED_RETENTION_DAYS };
}

export async function updateExplanationPreference(userId: string, input: { enabled?: boolean; detailLevel?: SmartMixExplanationDetailLevel; rejectedCandidateLimit?: number; rejectedRetentionDays?: number }, isAdmin: boolean) {
  const detailLevel = input.detailLevel === "DEVELOPER" && !isAdmin ? "DETAILED" : input.detailLevel;
  return prisma.smartMixExplanationPreference.upsert({
    where: { userId },
    create: { userId, enabled: input.enabled ?? true, detailLevel: detailLevel || "SIMPLE", rejectedCandidateLimit: Math.max(0, Math.min(500, input.rejectedCandidateLimit ?? DEFAULT_REJECTED_CANDIDATE_LIMIT)), rejectedRetentionDays: Math.max(1, Math.min(365, input.rejectedRetentionDays ?? DEFAULT_REJECTED_RETENTION_DAYS)) },
    update: { ...(input.enabled != null ? { enabled: input.enabled } : {}), ...(detailLevel ? { detailLevel } : {}), ...(input.rejectedCandidateLimit != null ? { rejectedCandidateLimit: Math.max(0, Math.min(500, input.rejectedCandidateLimit)) } : {}), ...(input.rejectedRetentionDays != null ? { rejectedRetentionDays: Math.max(1, Math.min(365, input.rejectedRetentionDays)) } : {}) },
  });
}

export async function persistGenerationExplanations({ userId, generationId, engineVersion, selected, rejected, counts, rejectionCounts, settingsSnapshot, identitySnapshot, personalizationSnapshot, traceDurationMs = 0 }: { userId: string; generationId: string; engineVersion: string; selected: SmartMixDecisionExplanation[]; rejected: SmartMixDecisionExplanation[]; counts: { evaluated: number; eligible: number; hardRejected: number }; rejectionCounts?: Record<string, number>; settingsSnapshot?: unknown; identitySnapshot?: unknown; personalizationSnapshot?: unknown; traceDurationMs?: number }) {
  const preference = await getExplanationPreference(userId);
  if (!preference.enabled || engineVersion !== "v2") return null;
  const retainedRejected = rejected.slice(0, preference.rejectedCandidateLimit);
  const all = [...selected, ...retainedRejected];
  const insights = buildGenerationInsights(generationId, [...selected, ...rejected], counts);
  const expiresAt = new Date(Date.now() + preference.rejectedRetentionDays * 86_400_000);
  const detailedRejectionSummary = rejected.reduce<Record<string, number>>((summary, item) => { const code = item.rejectionCode || "RANKED_BELOW_CUTOFF"; summary[code] = (summary[code] || 0) + 1; return summary; }, {});
  const rejectionSummary = { ...detailedRejectionSummary, ...(rejectionCounts || {}) };
  insights.rejectionReasons = Object.entries(rejectionSummary).map(([code, count]) => ({ code, count })).sort((left, right) => right.count - left.count);
  const generation = await prisma.$transaction(async (tx) => {
    const record = await tx.smartMixExplanationGeneration.upsert({
      where: { generationId },
      create: { generationId, userId, engineVersion, status: "complete", settingsSnapshotJson: redactVersionSettings(settingsSnapshot) as Prisma.InputJsonValue, identitySnapshotJson: redactVersionSettings(identitySnapshot) as Prisma.InputJsonValue, personalizationSnapshotJson: redactVersionSettings(personalizationSnapshot) as Prisma.InputJsonValue, insightsJson: insights as unknown as Prisma.InputJsonValue, rejectionSummaryJson: rejectionSummary as Prisma.InputJsonValue, evaluatedCount: counts.evaluated, eligibleCount: counts.eligible, selectedCount: selected.length, hardRejectedCount: counts.hardRejected, rankedRejectedCount: Math.max(0, counts.eligible - selected.length), traceDurationMs, fullTraceExpiresAt: expiresAt },
      update: { engineVersion, status: "complete", settingsSnapshotJson: redactVersionSettings(settingsSnapshot) as Prisma.InputJsonValue, identitySnapshotJson: redactVersionSettings(identitySnapshot) as Prisma.InputJsonValue, personalizationSnapshotJson: redactVersionSettings(personalizationSnapshot) as Prisma.InputJsonValue, insightsJson: insights as unknown as Prisma.InputJsonValue, rejectionSummaryJson: rejectionSummary as Prisma.InputJsonValue, evaluatedCount: counts.evaluated, eligibleCount: counts.eligible, selectedCount: selected.length, hardRejectedCount: counts.hardRejected, rankedRejectedCount: Math.max(0, counts.eligible - selected.length), traceDurationMs, fullTraceExpiresAt: expiresAt },
    });
    await tx.smartMixDecisionTrace.deleteMany({ where: { generationRecordId: record.id } });
    if (all.length) await tx.smartMixDecisionTrace.createMany({ data: all.map((item) => ({ generationRecordId: record.id, generationId, userId, trackId: item.trackId, trackTitle: item.trackTitle, artistName: item.artistName, albumName: item.albumName, decision: item.decision, rank: item.rank, rejectionStage: item.rejectionStage, rejectionCode: item.rejectionCode, finalScore: item.scores.finalScore, confidenceScore: item.confidence.score, confidenceLabel: item.confidence.label, explanationJson: item as unknown as Prisma.InputJsonValue, expiresAt: item.decision === "selected" ? null : expiresAt })) });
    return record;
  });
  console.info("[SmartMixInsights]", { generationId, evaluated: counts.evaluated, eligible: counts.eligible, selected: selected.length, hardRejected: counts.hardRejected, fallbacks: insights.fallbackTrackCount, lowConfidence: insights.lowConfidenceSelectedCount, traceDurationMs });
  if (process.env.SMART_MIX_EXPLANATION_DEBUG === "true") {
    console.debug("[SmartMixInsights:debug]", { generationId, retainedSelected: selected.map((item) => ({ trackId: item.trackId, score: item.scores.finalScore, confidence: item.confidence.score, factorCodes: item.factors.map((factor) => factor.code) })), retainedRejected: retainedRejected.map((item) => ({ trackId: item.trackId, rejectionCode: item.rejectionCode, score: item.scores.finalScore })) });
  }
  return { generation, insights, retainedRejectedCount: retainedRejected.length };
}

export async function attachGenerationExplanationsToPlaylist(userId: string, generationId: string, generatedPlaylistId: string) {
  const generation = await prisma.smartMixExplanationGeneration.findFirst({ where: { userId, generationId }, include: { traces: { where: { decision: "selected" } } } });
  if (!generation) return null;
  await prisma.$transaction(async (tx) => {
    await tx.smartMixExplanationGeneration.update({ where: { id: generation.id }, data: { generatedPlaylistId, fullTraceExpiresAt: generation.fullTraceExpiresAt } });
    await tx.smartMixDecisionTrace.updateMany({ where: { generationRecordId: generation.id }, data: { generatedPlaylistId } });
    for (const trace of generation.traces) {
      const explanation = { ...(trace.explanationJson as unknown as SmartMixDecisionExplanation), playlistId: generatedPlaylistId };
      await tx.smartMixDecisionTrace.update({ where: { id: trace.id }, data: { explanationJson: explanation as unknown as Prisma.InputJsonValue, expiresAt: null } });
      if (trace.trackId) await tx.generatedPlaylistTrack.updateMany({ where: { generatedPlaylistId, trackId: trace.trackId }, data: { explanationJson: explanation as unknown as Prisma.InputJsonValue } });
    }
  });
  await linkRecommendationExplanationToGeneration(userId, generationId, generatedPlaylistId);
  return generation;
}

export async function getTrackExplanation(userId: string, input: { generationId?: string | null; generatedPlaylistId?: string | null; trackId: string }) {
  const trace = await prisma.smartMixDecisionTrace.findFirst({
    where: { userId, trackId: input.trackId, ...(input.generationId ? { generationId: input.generationId } : {}), ...(input.generatedPlaylistId ? { generatedPlaylistId: input.generatedPlaylistId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (trace) return { explanation: trace.explanationJson as unknown as SmartMixDecisionExplanation, expired: false };
  if (input.generatedPlaylistId) {
    const row = await prisma.generatedPlaylistTrack.findFirst({ where: { generatedPlaylist: { id: input.generatedPlaylistId, userId }, trackId: input.trackId }, select: { explanationJson: true } });
    if (row?.explanationJson) return { explanation: row.explanationJson as unknown as SmartMixDecisionExplanation, expired: false };
  }
  const generation = input.generationId ? await prisma.smartMixExplanationGeneration.findFirst({ where: { userId, generationId: input.generationId }, select: { fullTraceExpiresAt: true } }) : null;
  return { explanation: null, expired: Boolean(generation?.fullTraceExpiresAt && generation.fullTraceExpiresAt < new Date()) };
}

export async function getGenerationInsights(userId: string, generationId: string) {
  const generation = await prisma.smartMixExplanationGeneration.findFirst({ where: { userId, generationId } });
  return generation ? { ...generation, insights: generation.insightsJson as unknown as SmartMixGenerationInsights, rejectionSummary: generation.rejectionSummaryJson } : null;
}

export async function listGenerationCandidates(userId: string, generationId: string, input: { decision?: string; rejectionCode?: string; factorCode?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.max(1, Math.min(100, input.pageSize || 25));
  const where = { userId, generationId, ...(input.decision ? { decision: input.decision } : {}), ...(input.rejectionCode ? { rejectionCode: input.rejectionCode } : {}) };
  const [rows, total] = await Promise.all([prisma.smartMixDecisionTrace.findMany({ where, orderBy: [{ decision: "asc" }, { rank: "asc" }, { finalScore: "desc" }], skip: (page - 1) * pageSize, take: pageSize }), prisma.smartMixDecisionTrace.count({ where })]);
  const filtered = input.factorCode ? rows.filter((row) => ((row.explanationJson as any)?.factors || []).some((factor: any) => factor.code === input.factorCode)) : rows;
  return { candidates: filtered.map((row) => ({ id: row.id, trackId: row.trackId, title: row.trackTitle, artist: row.artistName, decision: row.decision, rank: row.rank, rejectionStage: row.rejectionStage, rejectionCode: row.rejectionCode, finalScore: row.finalScore, confidence: { score: row.confidenceScore, label: row.confidenceLabel }, explanation: row.explanationJson })), page, pageSize, total };
}

export async function compareCandidates(userId: string, generationId: string, trackIds: string[]) {
  const rows = await prisma.smartMixDecisionTrace.findMany({ where: { userId, generationId, trackId: { in: trackIds.slice(0, 2) } } });
  if (rows.length !== 2) return null;
  const byId = new Map(rows.map((row) => [row.trackId, row.explanationJson as unknown as SmartMixDecisionExplanation]));
  const left = byId.get(trackIds[0]); const right = byId.get(trackIds[1]);
  return left && right ? compareDecisionExplanations(left, right) : null;
}

export async function exportGenerationDebugReport(userId: string, generationId: string) {
  const generation = await prisma.smartMixExplanationGeneration.findFirst({ where: { userId, generationId }, include: { traces: { where: { decision: "selected" }, orderBy: { rank: "asc" } } } });
  if (!generation) return null;
  return redactVersionSettings({ schemaVersion: 1, privacyWarning: "This report contains listening preferences, feedback-derived influences, and track-level decisions. Share it only with people you trust.", generation: { generationId: generation.generationId, generatedPlaylistId: generation.generatedPlaylistId, engineVersion: generation.engineVersion, status: generation.status, createdAt: generation.createdAt, traceDurationMs: generation.traceDurationMs }, settings: generation.settingsSnapshotJson, playlistIdentity: generation.identitySnapshotJson, personalization: generation.personalizationSnapshotJson, insights: generation.insightsJson, rejectionSummary: generation.rejectionSummaryJson, selectedTracks: generation.traces.map((trace) => trace.explanationJson) });
}

export async function cleanupExpiredExplanationTraces(userId?: string) {
  const now = new Date();
  const where = { expiresAt: { lt: now }, ...(userId ? { userId } : {}) };
  const explanationWhere = { expiresAt: { lt: now }, ...(userId ? { explanation: { ownerId: userId } } : {}) };
  const [deleted, deletedEvaluationEvents, expiredGenerations] = await Promise.all([
    prisma.smartMixDecisionTrace.deleteMany({ where }),
    prisma.recommendationTrackEvaluation.deleteMany({ where: explanationWhere }),
    prisma.smartMixExplanationGeneration.count({ where: { fullTraceExpiresAt: { lt: now }, ...(userId ? { userId } : {}) } }),
  ]);
  return { deletedTraces: deleted.count, deletedEvaluationEvents: deletedEvaluationEvents.count, expiredGenerations };
}
