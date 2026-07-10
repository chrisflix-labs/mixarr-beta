import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  getAudioFeatureHealthSummary,
  getBpmHealthSummary,
  getGenreHealthSummary,
  getPopularityHealthSummary,
} from "./libraryHealth";
import { buildLibraryHealthTrackWhere } from "./libraryHealthDetails";
import { getEnrichmentJobStatuses } from "./enrichmentJobStatus";
import { getUserSyncSettings, resolveMetadataProviderSettings } from "./syncSettings";
import { isHeartbeatStale, workerStaleThresholdMs } from "./workerHealth";

type DashboardStatus = "healthy" | "needs_attention" | "refreshing" | "stale" | "failed" | "empty";

const activeJobStatuses = ["running", "processing", "retrying"] as const;
const failedJobStatuses = ["failed", "interrupted", "stale"] as const;

function activeTrackWhere(userId: string): Prisma.TrackWhereInput {
  return {
    syncStatus: "active",
    library: { server: { userId } },
  };
}

function jobIsStale(job: { lastHeartbeatAt: Date | null; leaseExpiresAt: Date | null; startedAt: Date }) {
  const now = Date.now();
  if (job.leaseExpiresAt && job.leaseExpiresAt.getTime() < now) return true;
  return isHeartbeatStale(job.lastHeartbeatAt || job.startedAt, now, workerStaleThresholdMs());
}

function serializeJob(job: {
  id: string;
  name: string;
  type: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  lastHeartbeatAt?: Date | null;
  leaseExpiresAt?: Date | null;
  error?: string | null;
} | null) {
  if (!job) return null;
  return {
    id: job.id,
    name: job.name,
    type: job.type,
    status: job.status,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    lastHeartbeatAt: job.lastHeartbeatAt?.toISOString() ?? null,
    leaseExpiresAt: job.leaseExpiresAt?.toISOString() ?? null,
    error: job.error ?? null,
  };
}

function summarizeJobMetadata(metadata: Prisma.JsonValue | null | undefined) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, any>
    : {};
}

export type DashboardSummary = Awaited<ReturnType<typeof getDashboardSummary>>;

export async function getDashboardSummary(userId: string) {
  const started = Date.now();
  const settings = resolveMetadataProviderSettings(await getUserSyncSettings(userId));
  const audioFeatureClassification = await getAudioFeatureHealthSummary(userId, undefined, settings.audioFeatures);

  const [
    activeTracks,
    missingBpm,
    missingAudioFeatures,
    partialAudioFeatures,
    pendingAudioFeatures,
    failedAnalysis,
    completeAudioFeatures,
    bpm,
    genres,
    popularity,
    lastSyncLog,
    latestHealthSnapshot,
    activeHealthJob,
    lastHealthFailure,
    lastPlexJob,
  ] = await Promise.all([
    prisma.track.count({ where: activeTrackWhere(userId) }),
    prisma.track.count({ where: buildLibraryHealthTrackWhere(userId, { category: "missing_bpm", settings: settings.audioFeatures }) }),
    prisma.track.count({ where: buildLibraryHealthTrackWhere(userId, { category: "missing_audio_features", settings: settings.audioFeatures }) }),
    prisma.track.count({ where: buildLibraryHealthTrackWhere(userId, { category: "partial_audio_features", settings: settings.audioFeatures }) }),
    prisma.track.count({ where: buildLibraryHealthTrackWhere(userId, { category: "pending_audio_features", settings: settings.audioFeatures }) }),
    prisma.track.count({ where: buildLibraryHealthTrackWhere(userId, { category: "failed_analysis", settings: settings.audioFeatures }) }),
    prisma.track.count({ where: buildLibraryHealthTrackWhere(userId, { category: "complete_audio_features", settings: settings.audioFeatures }) }),
    getBpmHealthSummary(userId),
    getGenreHealthSummary(userId),
    getPopularityHealthSummary(userId),
    prisma.syncLog.findFirst({
      where: { library: { server: { userId } } },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, startedAt: true, endedAt: true, error: true },
    }),
    prisma.libraryHealthSnapshot.findFirst({
      where: { library: { server: { userId } } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.jobHistory.findFirst({
      where: {
        OR: [{ userId }, { userId: null }],
        type: "library_health",
        status: { in: [...activeJobStatuses] },
      },
      orderBy: { startedAt: "desc" },
    }),
    prisma.jobHistory.findFirst({
      where: {
        OR: [{ userId }, { userId: null }],
        type: "library_health",
        status: { in: [...failedJobStatuses] },
      },
      orderBy: { startedAt: "desc" },
    }),
    prisma.jobHistory.findFirst({
      where: { OR: [{ userId }, { userId: null }], type: "plex_sync" },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const runningHealthJobIsStale = activeHealthJob ? jobIsStale(activeHealthJob) : false;
  const audioIncomplete = Math.max(0, activeTracks - completeAudioFeatures);
  const hasIssues = missingBpm > 0
    || missingAudioFeatures > 0
    || partialAudioFeatures > 0
    || pendingAudioFeatures > 0
    || failedAnalysis > 0;
  const lastRefreshFailed = !!lastHealthFailure && (!activeHealthJob || lastHealthFailure.startedAt > activeHealthJob.startedAt);

  let status: DashboardStatus = activeTracks > 0 ? "healthy" : "empty";
  let statusLabel = activeTracks > 0 ? "Healthy" : "No sync";
  let message = activeTracks > 0
    ? "Library Health summary is current."
    : "No library sync has run yet.";

  if (activeHealthJob && !runningHealthJobIsStale) {
    status = "refreshing";
    statusLabel = "Refreshing";
    message = "Library Health refresh running...";
  } else if (activeHealthJob && runningHealthJobIsStale) {
    status = "stale";
    statusLabel = "Refresh may be stale";
    message = "Last refresh was interrupted.";
    console.warn("[Dashboard] Library Health marked refreshing but no active job found; using latest summary.");
  } else if (lastRefreshFailed) {
    status = "failed";
    statusLabel = "Refresh failed";
    message = "Last Library Health refresh failed. Open Library Health for details.";
  } else if (hasIssues) {
    status = "needs_attention";
    statusLabel = "Needs attention";
    message = "Library Health has warnings.";
  }

  const enrichmentJobs = getEnrichmentJobStatuses();
  const runningEnrichment = {
    bpm: enrichmentJobs.bpm?.running || false,
    audioFeatures: enrichmentJobs.audio?.running || false,
    genres: enrichmentJobs.tags?.running || false,
    popularity: enrichmentJobs.popularity?.running || false,
  };
  const runningJobs = [
    activeHealthJob && !runningHealthJobIsStale,
    lastSyncLog?.status === "in_progress",
    ...Object.values(runningEnrichment),
  ].some(Boolean);

  const plexMetadata = summarizeJobMetadata(lastPlexJob?.metadata);
  const plexCounts = summarizeJobMetadata(plexMetadata.counts);

  if (process.env.DASHBOARD_DEBUG === "1") {
    console.log(`[Dashboard] Loaded Library Health summary active=${activeTracks} missingBpm=${missingBpm} partialAudio=${partialAudioFeatures} pendingAudio=${pendingAudioFeatures} status=${status}`);
    console.log(`[Dashboard] Loaded Data Enrichment summary bpm=${bpm.tracksWithBpm} audio=${completeAudioFeatures} genres=${genres.tracksWithGenres} popularity=${popularity.tracksWithPopularity}`);
  }

  return {
    loadedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    polling: { active: runningJobs },
    libraryHealth: {
      status,
      statusLabel,
      message,
      activeTracks,
      missingBpm,
      missingAudioFeatures,
      partialAudioFeatures,
      pendingAudioFeatures,
      failedAnalysis,
      completeAudioFeatures,
      audioIncomplete,
      lastSyncAt: lastSyncLog?.endedAt?.toISOString() ?? lastSyncLog?.startedAt?.toISOString() ?? null,
      lastSyncStatus: lastSyncLog?.status ?? null,
      updatedAt: latestHealthSnapshot?.updatedAt?.toISOString() ?? null,
      activeJob: serializeJob(activeHealthJob),
      activeJobStale: runningHealthJobIsStale,
      lastFailure: serializeJob(lastHealthFailure),
    },
    dataEnrichment: {
      totalTracks: activeTracks,
      bpmComplete: bpm.tracksWithBpm,
      audioComplete: completeAudioFeatures,
      genresComplete: genres.tracksWithGenres,
      popularityComplete: popularity.tracksWithPopularity,
      running: runningEnrichment,
      details: {
        bpm,
        audioFeatures: {
          complete: completeAudioFeatures,
          partial: partialAudioFeatures,
          missing: missingAudioFeatures,
          pending: pendingAudioFeatures,
          failed: audioFeatureClassification.failed,
          api: audioFeatureClassification.api,
          local: audioFeatureClassification.local,
          heuristic: audioFeatureClassification.heuristic,
        },
        genres,
        popularity,
      },
    },
    plexSync: {
      lastJob: serializeJob(lastPlexJob),
      counts: {
        newTracks: Number(plexCounts.newTracks || 0),
        updatedMetadata: Number(plexCounts.updatedMetadata || 0),
        duplicateCandidates: Number(plexCounts.duplicateCandidates || 0),
        matchConflicts: Number(plexCounts.matchConflicts || 0),
      },
    },
  };
}
