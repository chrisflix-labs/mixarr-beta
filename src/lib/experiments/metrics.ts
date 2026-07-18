import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { calculateOutcomeRates, experimentCompletionState, recommendExperimentWinner } from "./core";
import { ExperimentError, getExperimentSettings } from "./service";

const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function recordExperimentFeedback(userId: string, experimentId: string, input: { variant: "A" | "B"; trackId: string; action: string; idempotencyKey?: string }) {
  const row = await prisma.smartExperimentTrack.findFirst({ where: { experimentId, trackId: input.trackId, variant: { variant: input.variant, experiment: { userId } } }, include: { variant: true, experiment: { select: { status: true, sourcePlaylistId: true } } } });
  if (!row) throw new ExperimentError("Experiment track not found for that variant.", 404, "TRACK_NOT_FOUND");
  if (!["RUNNING", "PAUSED", "COMPLETED"].includes(row.experiment.status)) throw new ExperimentError("Feedback can be recorded after the experiment starts.", 409, "INVALID_STATUS");
  if (input.idempotencyKey) {
    const existing = await prisma.trackInteractionEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
    if (existing) return { success: true, duplicate: true };
  }
  const reset = { kept: false, removed: false, replaced: false, liked: false, disliked: false, neverRecommend: false, goodPlaylistFit: false, poorTransition: false, accepted: false, rejected: false, evaluated: false };
  const data: Record<string, boolean | number> = input.action === "CLEAR" ? reset : {
    evaluated: true, accepted: ["KEEP", "LIKE", "GOOD_FIT"].includes(input.action), rejected: ["REMOVE", "REPLACE", "DISLIKE", "NEVER_RECOMMEND"].includes(input.action),
    ...(input.action === "KEEP" ? { kept: true } : {}), ...(input.action === "REMOVE" ? { removed: true } : {}),
    ...(input.action === "REPLACE" ? { replaced: true } : {}), ...(input.action === "LIKE" ? { liked: true } : {}),
    ...(input.action === "DISLIKE" ? { disliked: true } : {}), ...(input.action === "NEVER_RECOMMEND" ? { neverRecommend: true } : {}),
    ...(input.action === "GOOD_FIT" ? { goodPlaylistFit: true } : {}), ...(input.action === "POOR_TRANSITION" ? { poorTransition: true } : {}),
    explicitFeedbackCount: { increment: 1 } as any,
  };
  await prisma.$transaction(async (tx) => {
    await tx.smartExperimentTrack.update({ where: { id: row.id }, data });
    if (input.action !== "CLEAR") await tx.trackInteractionEvent.create({ data: { userId, trackId: input.trackId, playlistId: row.experiment.sourcePlaylistId, eventType: `EXPERIMENT_${input.action}`, eventSource: "SMART_EXPERIMENT", idempotencyKey: input.idempotencyKey, contextJson: json({ experimentId, variant: input.variant }) } });
    await tx.smartExperimentEvent.create({ data: { experimentId, eventType: input.action === "CLEAR" ? "FEEDBACK_CLEARED" : "FEEDBACK_RECORDED", actorUserId: userId, metadata: json({ variant: input.variant, trackId: input.trackId, action: input.action }) } });
  });
  return { success: true, duplicate: false };
}

function sessionKey(event: { plexUserId: string; playedAt: Date }) {
  return `${event.plexUserId}:${Math.floor(event.playedAt.getTime() / 7_200_000)}`;
}

export async function recalculateExperimentMetrics(userId: string, experimentId: string) {
  const [experiment, settings] = await Promise.all([
    prisma.smartExperiment.findFirst({ where: { id: experimentId, userId }, include: { sourcePlaylist: { select: { serverId: true } }, variants: { orderBy: { variant: "asc" }, include: { tracks: true } } } }),
    getExperimentSettings(userId),
  ]);
  if (!experiment) throw new ExperimentError("Experiment not found.", 404, "NOT_FOUND");
  const since = experiment.startAt || experiment.generatedAt || experiment.createdAt;
  if (settings.allowPlaybackMetrics && experiment.sourcePlaylist.serverId) {
    for (const variant of experiment.variants) {
      const uniqueTracks = variant.tracks.filter((track) => !track.sharedBetweenVariants);
      for (let offset = 0; offset < uniqueTracks.length; offset += 400) {
        const chunk = uniqueTracks.slice(offset, offset + 400);
        const events = await prisma.plexPlaybackEvent.findMany({ where: { serverId: experiment.sourcePlaylist.serverId, trackId: { in: chunk.map((track) => track.trackId) }, playedAt: { gte: since } }, select: { trackId: true, playedAt: true, skipped: true, completionPercent: true, viewOffsetMs: true, durationMs: true }, orderBy: { playedAt: "asc" } });
        const byTrack = new Map<string, typeof events>();
        for (const event of events) if (event.trackId) byTrack.set(event.trackId, [...(byTrack.get(event.trackId) || []), event]);
        for (const track of chunk) {
          const playback = byTrack.get(track.trackId) || [];
          const earlySkipCount = playback.filter((event) => event.skipped && Number(event.completionPercent || 0) < 20).length;
          await prisma.smartExperimentTrack.update({ where: { id: track.id }, data: { playbackCount: playback.length, skipCount: playback.filter((event) => event.skipped).length, earlySkipCount, listeningDurationMs: playback.reduce((sum, event) => sum + BigInt(Math.max(0, event.viewOffsetMs || (event.durationMs && event.completionPercent ? Math.round(event.durationMs * event.completionPercent / 100) : 0))), BigInt(0)), lastPlaybackAt: playback.at(-1)?.playedAt || null, ...(earlySkipCount >= 2 && !track.evaluated ? { evaluated: true, rejected: true } : {}) } });
        }
      }
    }
  }
  const refreshed = await prisma.smartExperiment.findUnique({ where: { id: experimentId }, include: { variants: { orderBy: { variant: "asc" }, include: { tracks: true } } } });
  if (!refreshed) throw new ExperimentError("Experiment disappeared during metric calculation.", 409, "STALE_EXPERIMENT");
  const evidence: Record<string, any> = {};
  await prisma.$transaction(async (tx) => {
    for (const variant of refreshed.variants) {
      const tracks = variant.tracks;
      const rates = calculateOutcomeRates({
        evaluated: tracks.filter((track) => track.evaluated).length,
        positiveUnique: tracks.filter((track) => track.kept || track.liked || track.goodPlaylistFit).length,
        explicitRejectionsUnique: tracks.filter((track) => track.removed || track.replaced || track.disliked || track.neverRecommend).length,
        repeatedEarlySkips: tracks.filter((track) => track.earlySkipCount >= 2 && !(track.removed || track.replaced || track.disliked || track.neverRecommend)).length,
      });
      const playbackCount = tracks.reduce((sum, track) => sum + track.playbackCount, 0);
      const earlySkips = tracks.reduce((sum, track) => sum + track.earlySkipCount, 0);
      const sessionCount = tracks.filter((track) => track.playbackCount > 0).length ? Math.max(1, Math.ceil(playbackCount / Math.max(1, tracks.length))) : 0;
      const metrics = [
        ["acceptance_rate", rates.acceptanceRate, rates.evaluated, "combined"], ["rejection_rate", rates.rejectionRate, rates.evaluated, "combined"],
        ["tracks_evaluated", rates.evaluated, rates.evaluated, "explicit_feedback"], ["explicit_rejections", rates.explicitRejections, rates.evaluated, "explicit_feedback"],
        ["playback_count", playbackCount, playbackCount, "inferred_playback"], ["early_skip_rate", playbackCount ? earlySkips / playbackCount * 100 : 0, playbackCount, "inferred_playback"],
        ["unique_listening_sessions", sessionCount, playbackCount, "inferred_playback"], ["playlist_score", variant.playlistScore || 0, tracks.length, "generation_score"],
      ] as const;
      for (const [metricType, metricValue, sampleSize, source] of metrics) await tx.smartExperimentMetric.upsert({ where: { variantId_metricType_source: { variantId: variant.id, metricType, source } }, create: { experimentId, variantId: variant.id, metricType, metricValue, sampleSize, source }, update: { metricValue, sampleSize, calculatedAt: new Date() } });
      evidence[variant.variant] = { acceptanceRate: rates.acceptanceRate, rejectionRate: rates.rejectionRate, earlySkipRate: playbackCount ? earlySkips / playbackCount * 100 : 0, playlistScore: variant.playlistScore || 0, sessions: sessionCount, interactions: rates.evaluated };
    }
  });
  const elapsedHours = Math.max(0, (Date.now() - since.getTime() - refreshed.pausedDurationSeconds * 1000) / 3_600_000);
  const recommendation = recommendExperimentWinner({ a: evidence.A, b: evidence.B, elapsedHours, thresholds: { minimumSessions: settings.allowPlaybackMetrics ? settings.minimumPlaybackSessions : 0, minimumInteractions: settings.minimumTrackInteractions, minimumDurationHours: settings.minimumDurationHours, minimumDifference: settings.minimumResultDifference } });
  await prisma.$transaction([
    prisma.smartExperiment.update({ where: { id: experimentId }, data: { suggestedWinner: recommendation.suggestedWinner, winnerConfidence: recommendation.confidence, recommendationExplanation: json({ ...recommendation, playbackInterpretation: "Playback behavior is an inferred recommendation signal, not definitive preference. Shared-track playback is excluded from variant attribution." }) } }),
    prisma.smartExperimentEvent.create({ data: { experimentId, eventType: "METRICS_RECALCULATED", actorUserId: userId, metadata: json({ recommendation, evidence }) } }),
  ]);
  return { variants: evidence, recommendation, metricDefinitions: { acceptanceRate: "Kept or positively rated experimental tracks divided by experimental tracks evaluated.", rejectionRate: "Removed, disliked, never-recommend, or repeatedly early-skipped evaluated tracks. Passive inactivity is never rejection.", playback: "Playback signals are inferred only from variant-unique tracks and are not treated as definitive preference." } };
}

export async function listExperimentTracks(userId: string, experimentId: string, input?: { variant?: string; group?: string; cursor?: number; limit?: number }) {
  const owned = await prisma.smartExperiment.findFirst({ where: { id: experimentId, userId }, select: { id: true } });
  if (!owned) throw new ExperimentError("Experiment not found.", 404, "NOT_FOUND");
  const limit = Math.min(100, Math.max(1, input?.limit || 50));
  const rows = await prisma.smartExperimentTrack.findMany({ where: { experimentId, ...(input?.variant ? { variant: { variant: input.variant } } : {}), ...(input?.group === "shared" ? { sharedBetweenVariants: true } : input?.group === "unique" ? { sharedBetweenVariants: false } : input?.group === "positive" ? { accepted: true } : input?.group === "negative" ? { rejected: true } : {}), ...(input?.cursor ? { position: { gt: input.cursor } } : {}) }, take: limit + 1, orderBy: [{ position: "asc" }, { variantId: "asc" }], include: { variant: { select: { variant: true } }, track: { select: { id: true, title: true, ratingKey: true, duration: true, artist: { select: { title: true } }, album: { select: { title: true } } } } } });
  const items = rows.slice(0, limit).map((row) => ({ ...row, listeningDurationMs: row.listeningDurationMs.toString() }));
  return { items, nextCursor: rows.length > limit ? items.at(-1)?.position || null : null };
}

export async function evaluateDueExperimentCompletions() {
  const running = await prisma.smartExperiment.findMany({ where: { status: "RUNNING" }, orderBy: { plannedEndAt: "asc" }, take: 100, include: { variants: { include: { metrics: { where: { metricType: { in: ["unique_listening_sessions", "tracks_evaluated", "playback_count"] } } } } } } });
  let completed = 0; let inconclusive = 0;
  for (const experiment of running) {
    const value = (variant: typeof experiment.variants[number], type: string) => variant.metrics.find((metric) => metric.metricType === type)?.metricValue || 0;
    const sessions = experiment.variants.length ? Math.min(...experiment.variants.map((variant) => value(variant, "unique_listening_sessions"))) : 0;
    const interactions = experiment.variants.length ? Math.min(...experiment.variants.map((variant) => value(variant, "tracks_evaluated"))) : 0;
    const completion = experimentCompletionState({ status: experiment.status, durationType: experiment.durationType, durationTarget: experiment.durationTarget, startAt: experiment.startAt, pausedDurationSeconds: experiment.pausedDurationSeconds, sessions, interactions });
    if (!completion.complete) continue;
    const result = await recalculateExperimentMetrics(experiment.userId, experiment.id);
    const status = result.recommendation.suggestedWinner ? "COMPLETED" : "INCONCLUSIVE";
    await prisma.$transaction([
      prisma.smartExperiment.update({ where: { id: experiment.id }, data: { status, completedAt: new Date(), completionReason: "DURATION_TARGET_REACHED" } }),
      prisma.smartExperimentEvent.create({ data: { experimentId: experiment.id, eventType: "DURATION_TARGET_REACHED", metadata: json({ durationType: experiment.durationType, durationTarget: experiment.durationTarget, outcome: result.recommendation.outcome, status }) } }),
    ]);
    if (status === "COMPLETED") completed += 1; else inconclusive += 1;
  }
  return { attempted: running.length, completed, inconclusive };
}
