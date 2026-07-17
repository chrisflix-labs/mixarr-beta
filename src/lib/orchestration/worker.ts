import prisma from "../prisma";
import { previewGeneratedPlaylistRegeneration, regenerateGeneratedPlaylistFromPreview, syncGeneratedPlaylistToPlex } from "../playlistService";
import { claimNextOrchestrationJob, cleanupOrchestrationHistory, completeOrchestrationJob, failOrchestrationJob, heartbeatOrchestrationJob, recoverStaleOrchestrationJobs } from "./service";

type Runtime = { initialized: boolean; processing: boolean; timer: NodeJS.Timeout | null };
declare global { var mixarrOrchestrationRuntime: Runtime | undefined; }
const runtime: Runtime = globalThis.mixarrOrchestrationRuntime ?? { initialized: false, processing: false, timer: null };
globalThis.mixarrOrchestrationRuntime = runtime;

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }

function summarizePreview(preview: any, playlistName: string) {
  const current = Array.isArray(preview?.currentTracks) ? preview.currentTracks.length : Number(preview?.currentTrackCount || 0);
  const proposed = Array.isArray(preview?.tracks) ? preview.tracks.length : Array.isArray(preview?.proposedTracks) ? preview.proposedTracks.length : Number(preview?.trackCount || current);
  const added = Number(preview?.summary?.added ?? preview?.addedCount ?? Math.max(0, proposed - current));
  const removed = Number(preview?.summary?.removed ?? preview?.removedCount ?? Math.max(0, current - proposed));
  return { playlist: playlistName, wouldAdd: added, wouldRemove: removed, wouldPreserve: Math.max(0, current - removed), expectedTrackCount: proposed, dependenciesSatisfied: true, conflictsDetected: [], plexModified: false, previewId: preview?.previewId || null };
}

async function executeJob(job: NonNullable<Awaited<ReturnType<typeof claimNextOrchestrationJob>>>) {
  const playlist = job.managedPlaylist;
  if (!playlist) throw new Error("Managed playlist was removed before execution.");
  const payload = record(job.requestPayloadJson);
  if (job.dryRun || job.jobType === "DRY_RUN" || job.jobType === "PREVIEW") {
    await heartbeatOrchestrationJob(job.id, "CANDIDATE_ANALYSIS");
    if (!playlist.generatedPlaylistId) {
      return { playlist: playlist.displayName, wouldAdd: 0, wouldRemove: 0, wouldPreserve: 0, dependenciesSatisfied: true, conflictsDetected: [], plexModified: false, note: "External Plex playlist candidate analysis is not available until it is linked to a Mixarr generated playlist." };
    }
    const preview = await previewGeneratedPlaylistRegeneration({ userId: job.userId, generatedPlaylistId: playlist.generatedPlaylistId, mode: String(payload.mode || "replace_all"), keepPercent: Number(payload.keepPercent || 25), preferDifferentTracks: Boolean(payload.preferDifferentTracks) });
    await heartbeatOrchestrationJob(job.id, "CANDIDATES_READY");
    return summarizePreview(preview, playlist.displayName);
  }
  if (!playlist.generatedPlaylistId) throw new Error("Write jobs require a managed Mixarr generated playlist in v2.2.0.");
  if (job.jobType === "SYNC") {
    await heartbeatOrchestrationJob(job.id, "PLEX_WRITE_STARTED");
    const result = await syncGeneratedPlaylistToPlex(job.userId, playlist.generatedPlaylistId);
    await heartbeatOrchestrationJob(job.id, "PLEX_WRITE_COMPLETED");
    return { playlist: playlist.displayName, operation: "SYNC", plexModified: true, result: record(result) };
  }
  if (job.jobType === "REGENERATE") {
    const trackIds = Array.isArray(payload.trackIds) ? payload.trackIds.filter((id): id is string => typeof id === "string").slice(0, 10_000) : [];
    if (!trackIds.length) throw new Error("A real regeneration job requires reviewed preview trackIds. Queue a dry run first, then submit its selected tracks.");
    await heartbeatOrchestrationJob(job.id, "PLEX_WRITE_STARTED");
    const result = await regenerateGeneratedPlaylistFromPreview({ userId: job.userId, generatedPlaylistId: playlist.generatedPlaylistId, trackIds, previewId: typeof payload.previewId === "string" ? payload.previewId : null, mode: String(payload.mode || "replace_all"), keepPercent: payload.keepPercent == null ? null : Number(payload.keepPercent), preferDifferentTracks: Boolean(payload.preferDifferentTracks), regeneration: payload.regeneration || null, warnings: Array.isArray(payload.warnings) ? payload.warnings.slice(0, 50) : [] });
    await heartbeatOrchestrationJob(job.id, "DATABASE_COMMIT_COMPLETED");
    return { playlist: playlist.displayName, operation: "REGENERATE", plexModified: true, trackCount: trackIds.length, playlistId: record(result).playlist?.id || null };
  }
  if (job.jobType === "ANALYZE") {
    const preview = await previewGeneratedPlaylistRegeneration({ userId: job.userId, generatedPlaylistId: playlist.generatedPlaylistId, mode: String(payload.mode || "replace_all"), keepPercent: Number(payload.keepPercent || 25), preferDifferentTracks: Boolean(payload.preferDifferentTracks) });
    return summarizePreview(preview, playlist.displayName);
  }
  throw new Error(`${job.jobType} execution is not available through orchestration without an explicit reviewed operation payload.`);
}

export async function processOneOrchestrationJob() {
  if (runtime.processing) return null;
  runtime.processing = true;
  let heartbeat: NodeJS.Timeout | null = null;
  try {
    const job = await claimNextOrchestrationJob();
    if (!job) return null;
    heartbeat = setInterval(() => { void heartbeatOrchestrationJob(job.id); }, 30_000);
    try {
      const result = await executeJob(job);
      await completeOrchestrationJob(job.id, result);
      console.log(`[OrchestrationWorker] Completed jobId=${job.id} playlist="${job.managedPlaylist?.displayName || "unknown"}" dryRun=${job.dryRun}`);
      return { jobId: job.id, status: "SUCCEEDED" };
    } catch (error) {
      await failOrchestrationJob(job.id, error);
      console.error(`[OrchestrationWorker] Failed jobId=${job.id}`, error instanceof Error ? error.message : error);
      return { jobId: job.id, status: "FAILED" };
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    runtime.processing = false;
  }
}

export async function initializePlaylistOrchestrationWorker() {
  if (runtime.initialized) return;
  runtime.initialized = true;
  const schemaReady = await prisma.managedPlaylist.count().then(() => true).catch(() => false);
  if (!schemaReady) {
    console.warn("[Orchestration] Database schema is incomplete. Run the v2.2.0 Prisma migration; legacy Mixarr services will continue running.");
    runtime.initialized = false;
    return;
  }
  const recovery = await recoverStaleOrchestrationJobs();
  const cleanup = await cleanupOrchestrationHistory();
  console.log(`[OrchestrationRecovery] Startup recovery inspected=${recovery.inspected} requeued=${recovery.requeued} reviewRequired=${recovery.reviewRequired}`);
  if (cleanup.auditEventsDeleted || cleanup.jobsDeleted) console.log(`[Orchestration] Retention cleanup jobs=${cleanup.jobsDeleted} auditEvents=${cleanup.auditEventsDeleted}`);
  runtime.timer = setInterval(() => { void processOneOrchestrationJob(); }, 5_000);
  void processOneOrchestrationJob();
}
