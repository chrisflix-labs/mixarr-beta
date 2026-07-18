import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { safeFinishJobHistory, safeStartJobHistory } from "../jobHistory";
import { generatePlaylistTracksWithStats, playlistConfigSchema, syncGeneratedPlaylistToPlex } from "../playlistService";
import { createPlaylistVersion } from "../playlists/versions/playlist-version-service";
import { restorePlaylistVersion } from "../playlists/versions/playlist-version-restore";
import { mergeExperimentSettings } from "./core";
import { ExperimentError } from "./service";

const json = (value: unknown) => value as Prisma.InputJsonValue;
function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function deepMerge(base: Record<string, any>, changes: Record<string, any>): Record<string, any> { const output = { ...base }; for (const [key, value] of Object.entries(changes)) output[key] = value && typeof value === "object" && !Array.isArray(value) ? deepMerge(object(base[key]), value) : value; return output; }

async function loadDecisionContext(userId: string, experimentId: string) {
  const experiment = await prisma.smartExperiment.findFirst({ where: { id: experimentId, userId }, include: { sourcePlaylist: true, variants: { orderBy: { variant: "asc" }, include: { tracks: { orderBy: { position: "asc" }, include: { track: { include: { artist: true, album: true } } } } } } } });
  if (!experiment) throw new ExperimentError("Experiment not found.", 404, "NOT_FOUND");
  return experiment;
}

async function applyTracksAndConfiguration(input: { userId: string; experimentId: string; sourcePlaylistId: string; tracks: Array<{ id: string; ratingKey: string; plexId: string; title: string; artist: { title: string }; album: { title: string } }>; configuration: Record<string, any>; label: string }) {
  const before = await prisma.generatedPlaylist.findFirst({ where: { id: input.sourcePlaylistId, userId: input.userId }, select: { updatedAt: true } });
  if (!before) throw new ExperimentError("The original playlist no longer exists.", 409, "SOURCE_DELETED");
  const safetyVersion = await createPlaylistVersion({ generatedPlaylistId: input.sourcePlaylistId, reason: "manual_edit", label: `Before ${input.label}`, description: `Automatic protected snapshot before applying ${input.label}.`, isPinned: true, isAutomatic: false, force: true });
  if (!safetyVersion) throw new ExperimentError("Could not create the required safety snapshot.", 500, "SNAPSHOT_FAILED");
  await prisma.$transaction(async (tx) => {
    await tx.generatedPlaylistTrack.deleteMany({ where: { generatedPlaylistId: input.sourcePlaylistId } });
    for (let offset = 0; offset < input.tracks.length; offset += 500) await tx.generatedPlaylistTrack.createMany({ data: input.tracks.slice(offset, offset + 500).map((track, index) => ({ generatedPlaylistId: input.sourcePlaylistId, trackId: track.id, plexTrackRatingKey: track.ratingKey || track.plexId, position: offset + index + 1, title: track.title, artist: track.artist.title, album: track.album.title })) });
    await tx.generatedPlaylist.update({ where: { id: input.sourcePlaylistId }, data: { filtersJson: json(input.configuration), tuningConfigJson: input.configuration.tuningConfig ? json(input.configuration.tuningConfig) : undefined, discoveryConfigJson: input.configuration.tuningConfig?.discovery ? json(input.configuration.tuningConfig.discovery) : undefined, trackCount: input.tracks.length, lastRegeneratedAt: new Date() } });
  });
  try {
    await syncGeneratedPlaylistToPlex(input.userId, input.sourcePlaylistId);
  } catch (error) {
    const changed = await prisma.generatedPlaylist.findUnique({ where: { id: input.sourcePlaylistId }, select: { updatedAt: true } });
    if (changed) await restorePlaylistVersion({ userId: input.userId, generatedPlaylistId: input.sourcePlaylistId, versionId: safetyVersion.id, expectedPlaylistUpdatedAt: changed.updatedAt.toISOString(), missingTrackStrategy: "restore_available", restoreSettings: true, restorePlaylistMetadata: true, restoreIdentitySnapshot: true });
    throw new ExperimentError(`Plex synchronization failed and the protected pre-decision version was restored: ${error instanceof Error ? error.message : "Plex unavailable"}`, 502, "PLEX_SYNC_FAILED");
  }
  const appliedVersion = await createPlaylistVersion({ generatedPlaylistId: input.sourcePlaylistId, reason: "settings_change", label: input.label, description: `Applied ${input.label} after explicit Smart Experiment confirmation.`, isAutomatic: false, force: true });
  return { safetyVersionId: safetyVersion.id, appliedVersionId: appliedVersion?.id || null, originalUpdatedAt: before.updatedAt };
}

export async function decideExperimentWinner(userId: string, experimentId: string, input: { decision: string; confirm: boolean; applyToSource: boolean; explanation?: string }) {
  const experiment = await loadDecisionContext(userId, experimentId);
  if (!["RUNNING", "PAUSED", "COMPLETED", "INCONCLUSIVE"].includes(experiment.status)) throw new ExperimentError("Start the experiment before recording a final decision.", 409, "INVALID_STATUS");
  const selected = input.decision === "SELECT_A" ? "A" : input.decision === "SELECT_B" ? "B" : null;
  if (!input.confirm) return { confirmationRequired: true, selectedVariant: selected, applyToSource: input.applyToSource, summary: selected ? [`Preserve the original as a pinned, restorable version.`, `Apply Version ${selected}'s Smart Mix settings${input.applyToSource ? " and tracks to the active playlist" : " as the recorded winner only"}.`, "Keep experiment history and feedback from both versions.", input.applyToSource ? "Plex changes occur only after this confirmation." : "Plex will not be modified."] : ["Record the experiment outcome without applying either variant.", "Preserve the original playlist and all experiment history."] };
  const variant = selected ? experiment.variants.find((item) => item.variant === selected) : null;
  if (selected && !variant) throw new ExperimentError("Selected variant is unavailable.", 409, "VARIANT_NOT_FOUND");
  let applyResult: Awaited<ReturnType<typeof applyTracksAndConfiguration>> | null = null;
  if (variant && input.applyToSource) {
    const settings = object(variant.configurationSnapshot).settings;
    const configuration = playlistConfigSchema.parse(deepMerge(object(experiment.sourcePlaylist.filtersJson), object(settings)));
    applyResult = await applyTracksAndConfiguration({ userId, experimentId, sourcePlaylistId: experiment.sourcePlaylistId, tracks: variant.tracks.map((row) => row.track) as any, configuration, label: `Smart Experiment ${experiment.name} — Version ${selected}` });
  }
  const status = input.decision === "CONTINUE" ? "RUNNING" : input.decision === "INCONCLUSIVE" || input.decision === "NO_WINNER" ? "INCONCLUSIVE" : "COMPLETED";
  await prisma.$transaction([
    prisma.smartExperimentDecision.create({ data: { experimentId, decisionType: input.decision, selectedVariant: selected, explanation: input.explanation, actorUserId: userId } }),
    prisma.smartExperiment.update({ where: { id: experimentId }, data: { status, selectedWinner: selected, completedAt: status === "RUNNING" ? null : new Date(), completionReason: input.decision, ...(input.applyToSource ? { finalPlexPlaylistId: experiment.sourcePlaylist.plexPlaylistRatingKey } : {}) } }),
    prisma.smartExperimentEvent.create({ data: { experimentId, eventType: "DECISION_RECORDED", actorUserId: userId, metadata: json({ decision: input.decision, selectedVariant: selected, appliedToSource: input.applyToSource, ...applyResult }) } }),
  ]);
  return { success: true, decision: input.decision, selectedVariant: selected, appliedToSource: Boolean(applyResult), originalPlaylistVersionId: experiment.originalPlaylistVersionId, ...applyResult };
}

export async function previewOrApplyMergedSettings(userId: string, experimentId: string, input: { selections: Record<string, "A" | "B">; confirm: boolean; applyToSource: boolean; explanation?: string }) {
  const experiment = await loadDecisionContext(userId, experimentId);
  const a = experiment.variants.find((variant) => variant.variant === "A");
  const b = experiment.variants.find((variant) => variant.variant === "B");
  if (!a || !b) throw new ExperimentError("Both variants are required to merge settings.", 409, "VARIANTS_NOT_READY");
  const configA = object(object(a.configurationSnapshot).settings);
  const configB = object(object(b.configurationSnapshot).settings);
  const merged = mergeExperimentSettings(configA, configB, input.selections);
  const configuration = playlistConfigSchema.parse(deepMerge(object(experiment.sourcePlaylist.filtersJson), object(merged.configuration)));
  const job = await safeStartJobHistory({ userId, type: "smart_experiment", name: `Preview merged experiment settings: ${experiment.name}`, trigger: "manual", metadata: json({ experimentId, selections: input.selections, confirmed: input.confirm }) });
  try {
    const generation = await generatePlaylistTracksWithStats({ userId, config: configuration, personalizationPlaylistId: experiment.sourcePlaylistId });
    const preview = generation.tracks.slice(0, 100).map((track, index) => ({ position: index + 1, id: track.id, title: track.title, artist: track.artist?.title || null, score: track.score || null }));
    if (!input.confirm) {
      await safeFinishJobHistory({ job, status: "success", summary: `Generated a ${generation.tracks.length}-track merged-configuration preview. Plex was not modified.`, counts: { attempted: configuration.limit, processed: generation.tracks.length, skipped: 0, failed: 0 }, metadata: json({ experimentId, plexModified: false }) });
      return { confirmationRequired: true, mergedConfiguration: merged.configuration, selections: merged.differences, preview, previewTrackCount: generation.tracks.length, plexModified: false };
    }
    let applyResult = null;
    if (input.applyToSource) applyResult = await applyTracksAndConfiguration({ userId, experimentId, sourcePlaylistId: experiment.sourcePlaylistId, tracks: generation.tracks as any, configuration, label: `Smart Experiment ${experiment.name} — Merged configuration` });
    await prisma.$transaction([
      prisma.smartExperimentDecision.create({ data: { experimentId, decisionType: "MERGE_SETTINGS", mergedConfiguration: json(merged.configuration), explanation: input.explanation, actorUserId: userId } }),
      prisma.smartExperiment.update({ where: { id: experimentId }, data: { status: "COMPLETED", selectedWinner: "MERGED", completedAt: new Date(), completionReason: "MERGE_SETTINGS", ...(input.applyToSource ? { finalPlexPlaylistId: experiment.sourcePlaylist.plexPlaylistRatingKey } : {}) } }),
      prisma.smartExperimentEvent.create({ data: { experimentId, eventType: "SETTINGS_MERGED", actorUserId: userId, metadata: json({ selections: input.selections, appliedToSource: input.applyToSource, ...applyResult }) } }),
    ]);
    await safeFinishJobHistory({ job, status: "success", summary: input.applyToSource ? "Merged settings were generated, explicitly applied, and synchronized to Plex." : "Merged settings were generated and recorded without changing Plex.", counts: { attempted: 1, processed: 1, skipped: 0, failed: 0 }, metadata: json({ experimentId, appliedToSource: input.applyToSource, ...applyResult }) });
    return { success: true, mergedConfiguration: merged.configuration, preview, appliedToSource: Boolean(applyResult), ...applyResult };
  } catch (error) {
    await safeFinishJobHistory({ job, status: "failed", summary: "Merged experiment configuration could not be generated or applied.", error, metadata: json({ experimentId }) });
    throw error;
  }
}

export async function restoreExperimentOriginal(userId: string, experimentId: string) {
  const experiment = await loadDecisionContext(userId, experimentId);
  const current = await prisma.generatedPlaylist.findUnique({ where: { id: experiment.sourcePlaylistId }, select: { updatedAt: true } });
  if (!current) throw new ExperimentError("The source playlist no longer exists.", 409, "SOURCE_DELETED");
  const job = await safeStartJobHistory({ userId, type: "smart_experiment", name: `Restore experiment original: ${experiment.name}`, trigger: "manual", metadata: json({ experimentId, originalPlaylistVersionId: experiment.originalPlaylistVersionId }) });
  try {
    const result = await restorePlaylistVersion({ userId, generatedPlaylistId: experiment.sourcePlaylistId, versionId: experiment.originalPlaylistVersionId, expectedPlaylistUpdatedAt: current.updatedAt.toISOString(), missingTrackStrategy: "restore_available", restoreSettings: true, restorePlaylistMetadata: true, restoreIdentitySnapshot: true });
    await prisma.$transaction([
      prisma.smartExperimentDecision.create({ data: { experimentId, decisionType: "RESTORE_ORIGINAL", actorUserId: userId, explanation: "Restored the protected original playlist snapshot." } }),
      prisma.smartExperimentEvent.create({ data: { experimentId, eventType: "ORIGINAL_RESTORED", actorUserId: userId, metadata: json({ originalPlaylistVersionId: experiment.originalPlaylistVersionId, restoredTrackCount: result.restoredTrackCount, syncStatus: result.syncStatus }) } }),
    ]);
    await safeFinishJobHistory({ job, status: result.syncStatus === "synced" ? "success" : "completed_with_warnings", summary: result.syncStatus === "synced" ? "Original playlist tracks, settings, identity, metadata, and Plex mapping were restored." : "The original was restored locally, but Plex synchronization needs attention.", counts: { attempted: 1, processed: 1, skipped: 0, failed: result.syncStatus === "synced" ? 0 : 1 }, metadata: json({ experimentId, syncStatus: result.syncStatus }) });
    return { ...result, experimentHistoryPreserved: true };
  } catch (error) {
    await safeFinishJobHistory({ job, status: "failed", summary: "The protected original playlist could not be restored.", error, metadata: json({ experimentId }) });
    throw error;
  }
}
