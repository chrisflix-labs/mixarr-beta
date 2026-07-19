import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { createPlaylistVersion } from "../playlists/versions/playlist-version-service";
import { rollbackCreatedPlexPlaylist } from "../playlistService";
import { stableConfigurationSnapshot, validateControlledExperiment } from "./core";
import type { z } from "zod";
import type { createExperimentSchema, updateExperimentSchema } from "./schemas";

type CreateInput = z.infer<typeof createExperimentSchema>;
type UpdateInput = z.infer<typeof updateExperimentSchema>;

export class ExperimentError extends Error {
  constructor(message: string, public status = 400, public code = "EXPERIMENT_ERROR") { super(message); }
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function getExperimentSettings(userId: string) {
  return prisma.smartExperimentSetting.upsert({ where: { userId }, create: { userId }, update: {} });
}

export async function updateExperimentSettings(userId: string, input: Record<string, unknown>) {
  return prisma.smartExperimentSetting.upsert({ where: { userId }, create: { userId, ...input }, update: input });
}

export async function createExperiment(userId: string, input: CreateInput) {
  const [source, settings] = await Promise.all([
    prisma.generatedPlaylist.findFirst({
      where: { id: input.sourcePlaylistId, userId },
      include: { tracks: { orderBy: { position: "asc" } }, identity: true },
    }),
    getExperimentSettings(userId),
  ]);
  if (!source) throw new ExperimentError("Source playlist not found.", 404, "SOURCE_NOT_FOUND");
  if (!settings.enabled) throw new ExperimentError("Smart Experiments are disabled in Settings.", 403, "EXPERIMENTS_DISABLED");
  if (source.engineVersion !== "v2") throw new ExperimentError("Only Smart Mix v2 playlists are eligible for controlled experiments.", 409, "PLAYLIST_NOT_ELIGIBLE");
  if (!source.tracks.length) throw new ExperimentError("The source playlist has no tracks to preserve.", 409, "EMPTY_SOURCE_PLAYLIST");
  if (input.idempotencyKey) {
    const existing = await prisma.smartExperiment.findFirst({ where: { userId, idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
  }
  const controlled = validateControlledExperiment({ experimentType: input.experimentType, configurationA: input.configurationA, configurationB: input.configurationB, allowMultiVariable: settings.allowMultiVariableExperiments });
  if (!controlled.valid) throw new ExperimentError(controlled.errors.join(" "), 400, "INVALID_CONTROLLED_VARIABLES");

  const originalVersion = await createPlaylistVersion({
    generatedPlaylistId: source.id, reason: "manual_edit", label: `Protected before experiment: ${input.name}`,
    description: "Protected original playlist snapshot created before a Smart Experiment. Restoring this version never deletes experiment history.",
    isPinned: true, isAutomatic: false, force: true,
  });
  if (!originalVersion) throw new ExperimentError("The original playlist snapshot could not be created.", 500, "SNAPSHOT_FAILED");
  const originalSnapshot = await prisma.playlistRevision.findUnique({ where: { id: originalVersion.id }, select: { trackSnapshot: true, settingsSnapshot: true, scoreSnapshot: true, engineVersion: true } });
  if (!originalSnapshot) throw new ExperimentError("The protected original snapshot is unavailable.", 500, "SNAPSHOT_FAILED");

  const experiment = await prisma.smartExperiment.create({
    data: {
      userId, sourcePlaylistId: source.id, originalPlaylistVersionId: originalVersion.id, name: input.name,
      hypothesis: input.hypothesis || null, experimentType: input.experimentType, publicationMode: input.publicationMode,
      durationType: input.durationType, durationTarget: input.durationTarget || null, idempotencyKey: input.idempotencyKey,
      alternatingIntervalHours: input.alternatingIntervalHours,
      constantConfiguration: json({
        source: stableConfigurationSnapshot(source.filtersJson),
        recipe: source.recipeId ? { id: source.recipeId, name: source.recipeName, recipeVersion: source.recipeVersionUsed, schemaVersion: source.recipeSchemaVersionUsed, resolvedSnapshot: source.resolvedRecipeSnapshotJson, playlistOverrides: source.playlistOverridesJson } : null,
        identity: source.identity?.effectiveProfileJson || null,
        lockedTrackIds: source.tracks.filter((track) => track.locked).map((track) => track.trackId).filter(Boolean),
        requiredTrackIds: source.tracks.filter((track) => track.locked || track.automationProtected).map((track) => track.trackId).filter(Boolean),
        engineVersion: source.engineVersion,
        differences: controlled.differences,
        warnings: controlled.warnings,
      }),
      originalSnapshot: json({ schemaVersion: 1, playlistVersionId: originalVersion.id, snapshot: originalSnapshot, recipeId: source.recipeId, recipeVersion: source.recipeVersionUsed, resolvedRecipeSnapshot: source.resolvedRecipeSnapshotJson, playlistOverrides: source.playlistOverridesJson }),
      variants: {
        create: [
          { variant: "A", engineVersion: source.engineVersion, randomSeed: crypto.randomUUID(), configurationSnapshot: json(stableConfigurationSnapshot(input.configurationA)) },
          { variant: "B", engineVersion: source.engineVersion, randomSeed: crypto.randomUUID(), configurationSnapshot: json(stableConfigurationSnapshot(input.configurationB)) },
        ],
      },
      events: { create: { eventType: "EXPERIMENT_CREATED", actorUserId: userId, metadata: json({ protectedVersionId: originalVersion.id, differences: controlled.differences, plexModified: false }) } },
    },
    include: { variants: true, sourcePlaylist: { select: { id: true, plexPlaylistTitle: true, plexPlaylistRatingKey: true, trackCount: true } } },
  });
  return experiment;
}

export async function listExperiments(userId: string, input?: { status?: string; playlistId?: string; type?: string; winner?: string; confidence?: string; cursor?: string; limit?: number; sort?: string }) {
  const limit = Math.min(50, Math.max(1, input?.limit || 20));
  const orderBy: Prisma.SmartExperimentOrderByWithRelationInput = input?.sort === "ending_soon" ? { plannedEndAt: "asc" } : input?.sort === "highest_confidence" ? { winnerConfidence: "desc" } : { updatedAt: "desc" };
  const where: Prisma.SmartExperimentWhereInput = {
    userId, ...(input?.status ? { status: input.status } : {}), ...(input?.playlistId ? { sourcePlaylistId: input.playlistId } : {}),
    ...(input?.type ? { experimentType: input.type } : {}), ...(input?.winner ? { suggestedWinner: input.winner } : {}),
    ...(input?.confidence ? { winnerConfidence: input.confidence } : {}), ...(input?.cursor ? { id: { lt: input.cursor } } : {}),
  };
  const [rows, grouped, completed] = await Promise.all([
    prisma.smartExperiment.findMany({ where, take: limit + 1, orderBy, include: { sourcePlaylist: { select: { id: true, plexPlaylistTitle: true } }, variants: { select: { id: true, variant: true, generationStatus: true, generatedTrackCount: true, playlistScore: true, plexPlaylistId: true } } } }),
    prisma.smartExperiment.groupBy({ by: ["status"], where: { userId }, _count: { _all: true } }),
    prisma.smartExperiment.findMany({ where: { userId, status: "COMPLETED", suggestedWinner: { in: ["A", "B"] } }, select: { metrics: { where: { metricType: "acceptance_rate", source: "combined" }, select: { variant: { select: { variant: true } }, metricValue: true } } }, take: 200, orderBy: { completedAt: "desc" } }),
  ]);
  const items = rows.slice(0, limit);
  const statusCounts = Object.fromEntries(grouped.map((group) => [group.status, group._count._all]));
  const improvements = completed.flatMap((experiment) => {
    const a = experiment.metrics.find((metric) => metric.variant.variant === "A")?.metricValue;
    const b = experiment.metrics.find((metric) => metric.variant.variant === "B")?.metricValue;
    return a == null || b == null ? [] : [Math.abs(b - a)];
  });
  return { items, nextCursor: rows.length > limit ? items.at(-1)?.id || null : null, summary: { active: statusCounts.RUNNING || 0, drafts: statusCounts.DRAFT || 0, completed: statusCounts.COMPLETED || 0, inconclusive: statusCounts.INCONCLUSIVE || 0, archived: statusCounts.ARCHIVED || 0, awaitingData: items.filter((item) => item.status === "RUNNING" && !item.suggestedWinner).length, clearWinners: completed.length, averageAcceptanceImprovement: improvements.length ? improvements.reduce((sum, value) => sum + value, 0) / improvements.length : 0 } };
}

export async function getExperiment(userId: string, experimentId: string) {
  const experiment = await prisma.smartExperiment.findFirst({
    where: { id: experimentId, userId },
    include: {
      sourcePlaylist: { select: { id: true, plexPlaylistTitle: true, plexPlaylistRatingKey: true, serverId: true, engineVersion: true, updatedAt: true } },
      originalPlaylistVersion: { select: { id: true, revisionNumber: true, label: true, createdAt: true, isPinned: true } },
      variants: { orderBy: { variant: "asc" }, include: { metrics: { orderBy: { metricType: "asc" } }, _count: { select: { tracks: true } } } },
      events: { orderBy: { createdAt: "desc" }, take: 100 }, decisions: { orderBy: { createdAt: "desc" }, take: 25 },
    },
  });
  if (!experiment) throw new ExperimentError("Experiment not found.", 404, "NOT_FOUND");
  return experiment;
}

export async function updateExperiment(userId: string, experimentId: string, input: UpdateInput) {
  const owned = await prisma.smartExperiment.findFirst({ where: { id: experimentId, userId }, select: { id: true, status: true } });
  if (!owned) throw new ExperimentError("Experiment not found.", 404, "NOT_FOUND");
  if (!["DRAFT", "READY"].includes(owned.status)) throw new ExperimentError("Only draft or ready experiments can change setup fields.", 409, "INVALID_STATUS");
  return prisma.smartExperiment.update({ where: { id: experimentId }, data: input });
}

export async function transitionExperiment(userId: string, experimentId: string, action: "start" | "pause" | "resume" | "complete" | "cancel" | "archive" | "continue") {
  const experiment = await prisma.smartExperiment.findFirst({ where: { id: experimentId, userId }, include: { variants: true } });
  if (!experiment) throw new ExperimentError("Experiment not found.", 404, "NOT_FOUND");
  const transitions: Record<string, { from: string[]; to: string }> = {
    start: { from: ["READY"], to: "RUNNING" }, pause: { from: ["RUNNING"], to: "PAUSED" }, resume: { from: ["PAUSED"], to: "RUNNING" },
    complete: { from: ["RUNNING", "PAUSED"], to: "COMPLETED" }, cancel: { from: ["DRAFT", "READY", "RUNNING", "PAUSED"], to: "CANCELLED" },
    archive: { from: ["COMPLETED", "CANCELLED", "INCONCLUSIVE"], to: "ARCHIVED" }, continue: { from: ["COMPLETED", "INCONCLUSIVE"], to: "RUNNING" },
  };
  const transition = transitions[action];
  if (!transition.from.includes(experiment.status)) throw new ExperimentError(`Cannot ${action} an experiment with status ${experiment.status}.`, 409, "INVALID_STATUS");
  if (action === "start" && experiment.variants.some((variant) => variant.generationStatus !== "COMPLETED")) throw new ExperimentError("Generate both variants before starting the experiment.", 409, "VARIANTS_NOT_READY");
  const now = new Date();
  let plannedEndAt: Date | null | undefined;
  if ((action === "start" || action === "continue") && experiment.durationType === "DAYS" && experiment.durationTarget) plannedEndAt = new Date(now.getTime() + experiment.durationTarget * 86_400_000);
  const pausedDurationSeconds = action === "resume" && experiment.pausedAt ? experiment.pausedDurationSeconds + Math.max(0, Math.floor((now.getTime() - experiment.pausedAt.getTime()) / 1000)) : experiment.pausedDurationSeconds;
  if (action === "resume" && experiment.pausedAt && experiment.plannedEndAt) plannedEndAt = new Date(experiment.plannedEndAt.getTime() + Math.max(0, now.getTime() - experiment.pausedAt.getTime()));
  return prisma.$transaction(async (tx) => {
    const updated = await tx.smartExperiment.update({ where: { id: experimentId }, data: {
      status: transition.to, ...(action === "start" ? { startAt: now } : {}), ...(plannedEndAt !== undefined ? { plannedEndAt } : {}),
      ...(action === "pause" ? { pausedAt: now } : {}), ...(action === "resume" ? { pausedAt: null, pausedDurationSeconds } : {}),
      ...(["complete", "cancel"].includes(action) ? { completedAt: now, completionReason: action === "complete" ? "MANUAL_COMPLETION" : "USER_CANCELLED" } : {}),
    } });
    await tx.smartExperimentEvent.create({ data: { experimentId, eventType: `EXPERIMENT_${action.toUpperCase()}${action.endsWith("e") ? "D" : "ED"}`, actorUserId: userId, metadata: json({ previousStatus: experiment.status, status: transition.to }) } });
    return updated;
  });
}

export async function deleteExperiment(userId: string, experimentId: string, deletePlexPlaylists = false) {
  const experiment = await prisma.smartExperiment.findFirst({ where: { id: experimentId, userId }, select: { id: true, status: true, sourcePlaylist: { select: { serverId: true } }, variants: { select: { variant: true, plexPlaylistId: true } } } });
  if (!experiment) throw new ExperimentError("Experiment not found.", 404, "NOT_FOUND");
  if (["RUNNING", "PAUSED"].includes(experiment.status)) throw new ExperimentError("Cancel the experiment before deleting its history.", 409, "EXPERIMENT_ACTIVE");
  const deletedPlexPlaylists: string[] = [];
  if (deletePlexPlaylists) {
    if (!experiment.sourcePlaylist.serverId) throw new ExperimentError("The source Plex server mapping is unavailable. Experiment history was not deleted, so published variant playlists can be reviewed manually.", 409, "PLEX_SERVER_MISSING");
    for (const variant of experiment.variants) {
      if (!variant.plexPlaylistId) continue;
      try { await rollbackCreatedPlexPlaylist({ userId, serverId: experiment.sourcePlaylist.serverId, playlistId: variant.plexPlaylistId }); deletedPlexPlaylists.push(variant.variant); }
      catch (error) { throw new ExperimentError(`Version ${variant.variant}'s Plex playlist could not be deleted. Experiment history was retained: ${error instanceof Error ? error.message : "Plex unavailable"}`, 502, "PLEX_DELETE_FAILED"); }
    }
  }
  await prisma.smartExperiment.delete({ where: { id: experimentId } });
  return { success: true, originalPlaylistPreserved: true, experimentHistoryDeleted: true, plexPlaylistsDeleted: deletedPlexPlaylists };
}

export async function cleanupExpiredExperimentHistory() {
  const settings = await prisma.smartExperimentSetting.findMany({ where: { historyRetentionDays: { not: null } }, select: { userId: true, historyRetentionDays: true } });
  let deleted = 0;
  for (const setting of settings) {
    if (!setting.historyRetentionDays) continue;
    const cutoff = new Date(Date.now() - setting.historyRetentionDays * 86_400_000);
    const expired = await prisma.smartExperiment.findMany({ where: { userId: setting.userId, status: { in: ["COMPLETED", "CANCELLED", "INCONCLUSIVE", "ARCHIVED"] }, completedAt: { lt: cutoff } }, orderBy: { completedAt: "asc" }, take: 25, select: { id: true } });
    if (!expired.length) continue;
    const result = await prisma.smartExperiment.deleteMany({ where: { id: { in: expired.map((item) => item.id) }, userId: setting.userId } });
    deleted += result.count;
  }
  return { usersWithRetention: settings.length, deleted };
}
