import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { safeFinishJobHistory, safeStartJobHistory } from "../jobHistory";
import { exportTracksToPlex, generatePlaylistTracksWithStats, playlistConfigSchema, syncTrackIdsToPlexPlaylist } from "../playlistService";
import { calculateOverlap } from "./core";
import { ExperimentError } from "./service";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const inFlightExperimentGeneration = new Set<string>();

function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function deepMerge(base: Record<string, any>, changes: Record<string, any>): Record<string, any> {
  const output = { ...base };
  for (const [key, value] of Object.entries(changes)) output[key] = value && typeof value === "object" && !Array.isArray(value) ? deepMerge(object(base[key]), value) : value;
  return output;
}

function scoreNumber(quality: any) {
  for (const key of ["overallScore", "playlistScore", "score", "overall"]) if (Number.isFinite(Number(quality?.[key]))) return Number(quality[key]);
  return null;
}

async function snapshotReferences(userId: string, libraryId?: string | null) {
  const where = { library: { server: { userId }, ...(libraryId ? { id: libraryId } : {}) }, syncStatus: "active" } as const;
  const [count, newest] = await Promise.all([prisma.track.count({ where }), prisma.track.findFirst({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { updatedAt: true, id: true } })]);
  const raw = `${libraryId || "all"}:${count}:${newest?.updatedAt?.toISOString() || "none"}:${newest?.id || "none"}`;
  const digest = createHash("sha256").update(raw).digest("hex");
  return { library: `library:${digest}`, metadata: `metadata:${digest}`, candidatePool: `candidate-pool:${digest}`, count };
}

export async function generateExperimentVariants(userId: string, experimentId: string) {
  const experiment = await prisma.smartExperiment.findFirst({ where: { id: experimentId, userId }, include: { sourcePlaylist: true, variants: { orderBy: { variant: "asc" } } } });
  if (!experiment) throw new ExperimentError("Experiment not found.", 404, "NOT_FOUND");
  if (!["DRAFT", "READY"].includes(experiment.status)) throw new ExperimentError("Variants can only be generated before an experiment starts.", 409, "INVALID_STATUS");
  const base = object(experiment.sourcePlaylist.filtersJson);
  const reference = await snapshotReferences(userId, experiment.sourcePlaylist.filtersJson && object(experiment.sourcePlaylist.filtersJson).libraryId);
  if (inFlightExperimentGeneration.has(experimentId)) throw new ExperimentError("This experiment is already generating. Duplicate submission was blocked.", 409, "GENERATION_IN_PROGRESS");
  inFlightExperimentGeneration.add(experimentId);
  const job = await safeStartJobHistory({ userId, type: "smart_experiment", name: `Generate experiment variants: ${experiment.name}`, trigger: "manual", metadata: json({ experimentId, candidatePoolReference: reference.candidatePool, stages: ["snapshot", "variant_a", "variant_b", "overlap", "metrics"] }) });
  const results: Array<{ variant: string; success: boolean; trackIds: string[]; error?: string }> = [];
  try {
    for (const variant of experiment.variants) {
      const stored = object(variant.configurationSnapshot);
      const variantChanges = object(stored.settings);
      const parsed = playlistConfigSchema.parse(deepMerge(base, variantChanges));
      if (parsed.engineVersion !== "v2") throw new ExperimentError("Experiment variants must use Smart Mix Engine v2.", 409, "ENGINE_CHANGED");
      await prisma.smartExperimentVariant.update({ where: { id: variant.id }, data: { generationStatus: "GENERATING", generationError: null, candidatePoolReference: reference.candidatePool, librarySnapshotReference: reference.library } });
      try {
        const generated = await generatePlaylistTracksWithStats({ userId, config: parsed, personalizationPlaylistId: experiment.sourcePlaylistId });
        if (!generated.tracks.length) throw new Error("The controlled candidate pool did not produce any eligible tracks.");
        const trackIds = generated.tracks.map((track) => track.id);
        const missingCounts: Record<string, number> = {};
        for (const track of generated.tracks) for (const field of track.metadataStatus?.missingFields || []) missingCounts[field] = (missingCounts[field] || 0) + 1;
        await prisma.$transaction(async (tx) => {
          await tx.smartExperimentTrack.deleteMany({ where: { variantId: variant.id } });
          for (let offset = 0; offset < generated.tracks.length; offset += 500) {
            const chunk = generated.tracks.slice(offset, offset + 500);
            await tx.smartExperimentTrack.createMany({ data: chunk.map((track, index) => ({
              experimentId, variantId: variant.id, trackId: track.id, position: offset + index + 1,
              selectionScore: Number.isFinite(Number(track.score)) ? Number(track.score) : null,
              selectionExplanation: track.decisionExplanation ? json(track.decisionExplanation) : undefined,
              personalizationInfluenced: Math.abs(Number(track.personalizedScore || 0) - Number(track.baseScore || track.score || 0)) > 0.01,
            })) });
          }
          await tx.smartExperimentVariant.update({ where: { id: variant.id }, data: {
            generationStatus: "COMPLETED", generationError: null, generatedTrackCount: trackIds.length,
            playlistScore: scoreNumber(generated.qualityScore), engineVersion: generated.engineVersion,
            fallbackBehavior: json({ stableFallbackUsed: generated.stableFallbackUsed, reason: generated.fallbackReason, warnings: generated.safety.warnings }),
            missingMetadataConditions: json(missingCounts), personalizationSnapshot: json({ influencedTrackCount: generated.tracks.filter((track) => Math.abs(Number(track.personalizedScore || 0) - Number(track.baseScore || track.score || 0)) > 0.01).length }),
          } });
          await tx.smartExperimentEvent.create({ data: { experimentId, eventType: "VARIANT_GENERATED", actorUserId: userId, metadata: json({ variant: variant.variant, trackCount: trackIds.length, score: scoreNumber(generated.qualityScore), fallbackUsed: generated.stableFallbackUsed, missingMetadata: missingCounts }) } });
        });
        results.push({ variant: variant.variant, success: true, trackIds });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Variant generation failed.";
        await prisma.smartExperimentVariant.update({ where: { id: variant.id }, data: { generationStatus: "FAILED", generationError: message } });
        await prisma.smartExperimentEvent.create({ data: { experimentId, eventType: "VARIANT_GENERATION_FAILED", actorUserId: userId, metadata: json({ variant: variant.variant, error: message }) } });
        results.push({ variant: variant.variant, success: false, trackIds: [], error: message });
      }
    }
    const a = results.find((result) => result.variant === "A");
    const b = results.find((result) => result.variant === "B");
    let overlap = null;
    if (a?.success && b?.success) {
      overlap = calculateOverlap(a.trackIds, b.trackIds);
      for (let offset = 0; offset < overlap.sharedTrackIds.length; offset += 500) await prisma.smartExperimentTrack.updateMany({ where: { experimentId, trackId: { in: overlap.sharedTrackIds.slice(offset, offset + 500) } }, data: { sharedBetweenVariants: true } });
    }
    const ready = Boolean(a?.success && b?.success);
    await prisma.smartExperiment.update({ where: { id: experimentId }, data: { status: ready ? "READY" : "DRAFT", generatedAt: ready ? new Date() : null, candidatePoolReference: reference.candidatePool, librarySnapshotReference: reference.library, metadataSnapshotReference: reference.metadata, overlapPercentage: overlap?.overlapPercentage ?? null, randomSeed: experiment.variants.map((variant) => `${variant.variant}:${variant.randomSeed}`).join("|") } });
    await prisma.smartExperimentEvent.create({ data: { experimentId, eventType: ready ? "EXPERIMENT_READY" : "EXPERIMENT_GENERATION_PARTIAL", actorUserId: userId, metadata: json({ overlap, candidatePoolCount: reference.count, candidatePoolReference: reference.candidatePool, successfulVariants: results.filter((result) => result.success).map((result) => result.variant) }) } });
    await safeFinishJobHistory({ job, status: ready ? "success" : "completed_with_warnings", summary: ready ? `Generated both controlled variants. Playlist overlap is ${overlap?.overlapPercentage || 0}%. Plex was not modified.` : "One or more experiment variants failed. Successful variants were preserved for retry.", counts: { attempted: 2, processed: results.filter((result) => result.success).length, skipped: 0, failed: results.filter((result) => !result.success).length }, metadata: json({ experimentId, overlap, reference, results: results.map(({ trackIds, ...result }) => ({ ...result, trackCount: trackIds.length })) }) });
    return { ready, results: results.map(({ trackIds, ...result }) => ({ ...result, trackCount: trackIds.length })), overlap, candidatePoolReference: reference.candidatePool };
  } catch (error) {
    await safeFinishJobHistory({ job, status: "failed", summary: "Smart Experiment generation failed before both variants could be evaluated.", error, metadata: json({ experimentId }) });
    throw error;
  } finally {
    inFlightExperimentGeneration.delete(experimentId);
  }
}

export async function publishExperimentVariants(userId: string, experimentId: string) {
  const experiment = await prisma.smartExperiment.findFirst({ where: { id: experimentId, userId }, include: { sourcePlaylist: true, variants: { orderBy: { variant: "asc" }, include: { tracks: { orderBy: { position: "asc" }, select: { trackId: true } } } } } });
  if (!experiment) throw new ExperimentError("Experiment not found.", 404, "NOT_FOUND");
  if (experiment.publicationMode === "PREVIEW_ONLY") throw new ExperimentError("Change publication mode before publishing. Preview Only intentionally keeps Plex unchanged.", 409, "PREVIEW_ONLY");
  if (!experiment.variants.every((variant) => variant.generationStatus === "COMPLETED")) throw new ExperimentError("Both variants must be generated before publishing.", 409, "VARIANTS_NOT_READY");
  const job = await safeStartJobHistory({ userId, type: "smart_experiment", name: `Publish experiment playlists: ${experiment.name}`, trigger: "manual", metadata: json({ experimentId, publicationMode: experiment.publicationMode }) });
  const published: Array<{ variant: string; plexPlaylistId: string; existing: boolean }> = [];
  try {
    const targets = experiment.publicationMode === "ALTERNATING_ACTIVE" ? experiment.variants.filter((variant) => variant.variant === "A") : experiment.variants;
    for (const variant of targets) {
      if (variant.plexPlaylistId) { published.push({ variant: variant.variant, plexPlaylistId: variant.plexPlaylistId, existing: true }); continue; }
      const suffix = experiment.publicationMode === "ALTERNATING_ACTIVE" ? "Experiment Active (A)" : `Experiment ${variant.variant}`;
      const result = await exportTracksToPlex({ userId, name: `${experiment.sourcePlaylist.plexPlaylistTitle} — ${suffix}`, trackIds: variant.tracks.map((track) => track.trackId), rulesJson: JSON.stringify([]), optionsJson: JSON.stringify({ smartExperimentId: experimentId, variant: variant.variant }) });
      await prisma.smartExperimentVariant.update({ where: { id: variant.id }, data: { plexPlaylistId: result.playlistId } });
      await prisma.smartExperimentEvent.create({ data: { experimentId, eventType: "VARIANT_PUBLISHED", actorUserId: userId, metadata: json({ variant: variant.variant, plexPlaylistId: result.playlistId, publicationMode: experiment.publicationMode }) } });
      published.push({ variant: variant.variant, plexPlaylistId: result.playlistId, existing: false });
    }
    if (experiment.publicationMode === "ALTERNATING_ACTIVE" && published[0]) await prisma.smartExperiment.update({ where: { id: experimentId }, data: { finalPlexPlaylistId: published[0].plexPlaylistId, activeVariant: "A", lastRotatedAt: new Date() } });
    await safeFinishJobHistory({ job, status: "success", summary: `Published ${published.length} experiment playlist${published.length === 1 ? "" : "s"} without changing the original.`, counts: { attempted: targets.length, processed: published.length, skipped: published.filter((item) => item.existing).length, failed: 0 }, metadata: json({ experimentId, published }) });
    return { published, originalPlaylistPreserved: true, alternatingModeExperimental: experiment.publicationMode === "ALTERNATING_ACTIVE" };
  } catch (error) {
    await safeFinishJobHistory({ job, status: "failed", summary: "Experiment playlist publication failed. Previously published variants were preserved for idempotent retry.", error, metadata: json({ experimentId, published }) });
    throw error;
  }
}

export async function rotateAlternatingExperiment(userId: string, experimentId: string, force = false) {
  const experiment = await prisma.smartExperiment.findFirst({ where: { id: experimentId, userId }, include: { sourcePlaylist: { select: { serverId: true, plexPlaylistTitle: true } }, variants: { include: { tracks: { orderBy: { position: "asc" }, select: { trackId: true } } } } } });
  if (!experiment) throw new ExperimentError("Experiment not found.", 404, "NOT_FOUND");
  if (experiment.publicationMode !== "ALTERNATING_ACTIVE") throw new ExperimentError("This experiment is not using Alternating Active publication.", 409, "INVALID_PUBLICATION_MODE");
  if (experiment.status !== "RUNNING") throw new ExperimentError("Only a running experiment can rotate its active version.", 409, "INVALID_STATUS");
  if (!experiment.finalPlexPlaylistId || !experiment.sourcePlaylist.serverId) throw new ExperimentError("Publish the initial active variant before rotation.", 409, "ACTIVE_PLAYLIST_MISSING");
  const dueAt = new Date((experiment.lastRotatedAt || experiment.startAt || experiment.createdAt).getTime() + experiment.alternatingIntervalHours * 3_600_000);
  if (!force && dueAt.getTime() > Date.now()) return { rotated: false, activeVariant: experiment.activeVariant || "A", dueAt };
  const targetKey = experiment.activeVariant === "B" ? "A" : "B";
  const target = experiment.variants.find((variant) => variant.variant === targetKey);
  if (!target || target.generationStatus !== "COMPLETED") throw new ExperimentError(`Version ${targetKey} is not available for rotation.`, 409, "VARIANT_NOT_READY");
  const job = await safeStartJobHistory({ userId, type: "smart_experiment", name: `Rotate active experiment variant: ${experiment.name}`, trigger: force ? "manual" : "scheduled", metadata: json({ experimentId, from: experiment.activeVariant || "A", to: targetKey }) });
  try {
    await syncTrackIdsToPlexPlaylist({ userId, serverId: experiment.sourcePlaylist.serverId, playlistId: experiment.finalPlexPlaylistId, name: `${experiment.sourcePlaylist.plexPlaylistTitle} — Experiment Active (${targetKey})`, trackIds: target.tracks.map((track) => track.trackId) });
    const now = new Date();
    await prisma.$transaction([
      prisma.smartExperiment.update({ where: { id: experimentId }, data: { activeVariant: targetKey, lastRotatedAt: now } }),
      prisma.smartExperimentEvent.create({ data: { experimentId, eventType: "ACTIVE_VARIANT_ROTATED", actorUserId: force ? userId : null, metadata: json({ from: experiment.activeVariant || "A", to: targetKey, plexPlaylistId: experiment.finalPlexPlaylistId, scheduled: !force }) } }),
    ]);
    await safeFinishJobHistory({ job, status: "success", summary: `Alternating Active playlist rotated to Version ${targetKey}. The original playlist was not modified.`, counts: { attempted: 1, processed: 1, skipped: 0, failed: 0 }, metadata: json({ experimentId, activeVariant: targetKey }) });
    return { rotated: true, activeVariant: targetKey, rotatedAt: now };
  } catch (error) {
    const settings = await prisma.smartExperimentSetting.findUnique({ where: { userId }, select: { automaticallyPauseMissingPlaylists: true } });
    if (settings?.automaticallyPauseMissingPlaylists) await prisma.smartExperiment.update({ where: { id: experimentId }, data: { status: "PAUSED", pausedAt: new Date(), completionReason: "ACTIVE_PLEX_PLAYLIST_UNAVAILABLE" } });
    await safeFinishJobHistory({ job, status: "failed", summary: "Alternating Active rotation failed. The original playlist remained protected and the experiment may require attention.", error, metadata: json({ experimentId, targetVariant: targetKey }) });
    throw error;
  }
}

export async function rotateDueAlternatingExperiments() {
  const experiments = await prisma.smartExperiment.findMany({ where: { status: "RUNNING", publicationMode: "ALTERNATING_ACTIVE", finalPlexPlaylistId: { not: null } }, orderBy: { lastRotatedAt: "asc" }, take: 25, select: { id: true, userId: true, alternatingIntervalHours: true, lastRotatedAt: true, startAt: true, createdAt: true } });
  let rotated = 0; let failed = 0;
  for (const experiment of experiments) {
    const last = experiment.lastRotatedAt || experiment.startAt || experiment.createdAt;
    if (last.getTime() + experiment.alternatingIntervalHours * 3_600_000 > Date.now()) continue;
    try { const result = await rotateAlternatingExperiment(experiment.userId, experiment.id); if (result.rotated) rotated += 1; } catch { failed += 1; }
  }
  return { attempted: experiments.length, processed: rotated, skipped: Math.max(0, experiments.length - rotated - failed), failed };
}
