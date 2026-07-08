import fs from "fs";
import os from "os";
import prisma from "./prisma";
import { APP_VERSION } from "./appVersion";
import { APP_NAME, MIXARR_GITHUB_URL } from "./appInfo";
import { getDashboardSummary } from "./dashboardSummary";
import { getDataEnrichmentSummary } from "./dataEnrichment";
import { getRecentJobSummary } from "./jobHistory";
import { getLibraryHealthDetailSummary } from "./libraryHealthDetails";
import { getUserSyncSettings, metadataProviderModeLabel, resolveMetadataProviderSettings } from "./syncSettings";
import { getWorkerHealthSummary } from "./workerHealth";
import { buildBugReportTemplate, buildFeedbackTemplate, buildHealthReport, buildJobFailureReport } from "./supportReports";
import { sanitizeDiagnostics, sanitizeErrorText } from "./supportRedaction";

export const DEFAULT_GITHUB_REPO_URL = "https://github.com/cvarano84/mixarr-beta";

function validHttpUrl(value: string | undefined | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function getSupportLinks() {
  return {
    githubRepoUrl: validHttpUrl(process.env.GITHUB_REPO_URL || process.env.NEXT_PUBLIC_GITHUB_REPO_URL) || MIXARR_GITHUB_URL || DEFAULT_GITHUB_REPO_URL,
    discordSupportUrl: validHttpUrl(process.env.DISCORD_SUPPORT_URL || process.env.NEXT_PUBLIC_DISCORD_SUPPORT_URL),
    discordConfigured: !!validHttpUrl(process.env.DISCORD_SUPPORT_URL || process.env.NEXT_PUBLIC_DISCORD_SUPPORT_URL),
  };
}

function dockerDetected() {
  return fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv") || process.env.DOCKER === "1" || process.env.CONTAINER === "1";
}

function buildInfo() {
  return {
    buildDate: process.env.BUILD_DATE || process.env.NEXT_PUBLIC_BUILD_DATE || null,
    gitCommit: process.env.GIT_COMMIT || process.env.NEXT_PUBLIC_GIT_COMMIT || null,
    runtimeMode: process.env.NODE_ENV || "unknown",
  };
}

function environmentSummary() {
  return {
    dockerDetected: dockerDetected(),
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  };
}

function compactWorker(worker: Awaited<ReturnType<typeof getWorkerHealthSummary>> | null) {
  if (!worker) return null;
  return {
    status: worker.status,
    version: worker.version,
    workerCount: worker.workerCount,
    lastHeartbeat: worker.lastHeartbeat,
    heartbeatAgeSeconds: worker.heartbeatAgeSeconds,
    currentJob: worker.currentJob ? {
      name: (worker.currentJob as any).name,
      type: (worker.currentJob as any).type,
      startedAt: (worker.currentJob as any).startedAt,
    } : null,
    queueDepth: worker.queueDepth,
    runningJobs: worker.runningJobs,
    failedRecentJobs: worker.failedRecentJobs,
    staleJobs: worker.staleJobs,
    scheduler: {
      enabled: worker.scheduler.enabled,
      runtime: worker.scheduler.runtime ? {
        schedulerEnabled: worker.scheduler.runtime.schedulerEnabled,
        active: worker.scheduler.runtime.active,
        schedulerCron: worker.scheduler.runtime.schedulerCron,
        schedulerMode: worker.scheduler.runtime.schedulerMode,
        pipelineRunning: worker.scheduler.runtime.pipelineRunning,
      } : null,
    },
    diagnostics: worker.diagnostics,
    lastError: sanitizeErrorText(worker.lastError),
  };
}

function compactJob(job: any) {
  if (!job) return null;
  return {
    id: job.id,
    name: job.name,
    type: job.type,
    status: job.status,
    trigger: job.trigger,
    startedAt: job.startedAt?.toISOString?.() ?? job.startedAt ?? null,
    finishedAt: job.finishedAt?.toISOString?.() ?? job.finishedAt ?? null,
    durationMs: job.durationMs ?? null,
    attempted: job.attempted ?? 0,
    processed: job.processed ?? 0,
    skipped: job.skipped ?? 0,
    failed: job.failed ?? 0,
    summary: sanitizeErrorText(job.summary, 600),
    error: sanitizeErrorText(job.error),
  };
}

export async function getSupportSummary(userId: string) {
  const [user, settings, worker, recentJobs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        defaultLibraryId: true,
        servers: {
          select: {
            id: true,
            name: true,
            libraries: { where: { type: "artist" }, select: { id: true, name: true, type: true }, orderBy: { name: "asc" } },
          },
          orderBy: { name: "asc" },
        },
      },
    }),
    getUserSyncSettings(userId),
    getWorkerHealthSummary().catch(() => null),
    getRecentJobSummary(userId).catch(() => null),
  ]);
  const providerSettings = resolveMetadataProviderSettings(settings);
  const libraries = (user?.servers || []).flatMap((server) =>
    server.libraries.map((library) => ({ id: library.id, name: library.name, type: library.type, serverName: server.name })),
  );

  return sanitizeDiagnostics({
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      beta: true,
      releaseVersion: APP_VERSION,
      ...buildInfo(),
      serverTime: new Date().toISOString(),
    },
    links: getSupportLinks(),
    environment: environmentSummary(),
    configuredFeatures: {
      localAudio: providerSettings.audioFeatures.local,
      apiEnrichment: providerSettings.bpm.api || providerSettings.audioFeatures.api,
      scheduler: compactWorker(worker)?.scheduler.enabled ?? false,
      worker: !!worker && worker.status !== "Stopped",
      providerModes: {
        bpm: metadataProviderModeLabel(providerSettings.bpm),
        audioFeatures: metadataProviderModeLabel(providerSettings.audioFeatures),
      },
    },
    plex: {
      connected: !!user,
      libraryCount: libraries.length,
      selectedLibraryId: user?.defaultLibraryId || null,
      libraries,
    },
    worker: compactWorker(worker),
    recentJob: compactJob(recentJobs?.lastJob),
    recentFailures: recentJobs?.recentFailures ?? 0,
  });
}

export async function getSupportDiagnostics(userId: string) {
  const [summary, dashboard, worker, settings, libraries, recentJobs] = await Promise.all([
    getSupportSummary(userId),
    getDashboardSummary(userId).catch((error) => ({ error: sanitizeErrorText(error) })),
    getWorkerHealthSummary().catch((error) => ({ error: sanitizeErrorText(error) })),
    getUserSyncSettings(userId),
    prisma.library.findMany({
      where: { type: "artist", server: { userId } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.jobHistory.findMany({
      where: { OR: [{ userId }, { userId: null }] },
      orderBy: { startedAt: "desc" },
      take: 12,
    }),
  ]);
  const providerSettings = resolveMetadataProviderSettings(settings);
  const [libraryHealth, dataEnrichment] = await Promise.all([
    getLibraryHealthDetailSummary(userId, undefined, providerSettings.audioFeatures).catch((error) => ({ error: sanitizeErrorText(error) })),
    getDataEnrichmentSummary(userId).catch((error) => ({ error: sanitizeErrorText(error) })),
  ]);

  return sanitizeDiagnostics({
    timestamp: new Date().toISOString(),
    mixarrVersion: APP_VERSION,
    releaseVersion: APP_VERSION,
    build: buildInfo(),
    environment: environmentSummary(),
    supportSummary: summary,
    configuredFeatures: (summary as any).configuredFeatures,
    plex: {
      connected: true,
      libraries,
    },
    dashboardSummary: dashboard,
    libraryHealthSummary: libraryHealth,
    dataEnrichmentSummary: dataEnrichment,
    workerHealthSummary: compactWorker("status" in worker ? worker as any : null) || worker,
    schedulerSummary: "status" in worker ? compactWorker(worker as any)?.scheduler : null,
    recentJobHistory: recentJobs.map(compactJob),
    lastErrors: recentJobs.filter((job) => job.error).slice(0, 5).map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      error: sanitizeErrorText(job.error),
    })),
  });
}

export async function getBugReportTemplate(userId: string, context: { route?: string | null; libraryId?: string | null } = {}) {
  const [summary, library] = await Promise.all([
    getSupportSummary(userId),
    context.libraryId
      ? prisma.library.findFirst({ where: { id: context.libraryId, server: { userId } }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ]);
  return buildBugReportTemplate({
    route: context.route || null,
    timestamp: new Date().toISOString(),
    library,
    recentJob: (summary as any).recentJob,
    worker: (summary as any).worker,
  });
}

export async function getFeedbackTemplate(userId: string, context: { route?: string | null } = {}) {
  const summary = await getSupportSummary(userId);
  return buildFeedbackTemplate({
    route: context.route || null,
    timestamp: new Date().toISOString(),
    recentJob: (summary as any).recentJob,
    worker: (summary as any).worker,
  });
}

export async function getJobFailureReport(userId: string, jobId: string) {
  const [job, worker] = await Promise.all([
    prisma.jobHistory.findFirst({ where: { id: jobId, OR: [{ userId }, { userId: null }] } }),
    getWorkerHealthSummary().catch(() => null),
  ]);
  if (!job) return null;
  return buildJobFailureReport({
    ...job,
    workerStatus: worker?.status || "unknown",
  });
}

export async function getHealthSupportReport(userId: string, libraryId?: string | null) {
  const settings = resolveMetadataProviderSettings(await getUserSyncSettings(userId));
  const [health, worker] = await Promise.all([
    getLibraryHealthDetailSummary(userId, libraryId || undefined, settings.audioFeatures),
    getWorkerHealthSummary().catch(() => null),
  ]);
  const lastHealthRefresh = health.diagnostics.localAnalysisDiagnostics?.lastRunAt || health.diagnostics.plexSyncDiagnostics?.lastSyncTime || null;
  return buildHealthReport({
    activeTracks: health.totalTracks,
    categories: health.categories,
    providerMode: metadataProviderModeLabel(settings.audioFeatures),
    lastHealthRefresh: lastHealthRefresh instanceof Date ? lastHealthRefresh.toISOString() : lastHealthRefresh,
    workerStatus: worker?.status || "unknown",
  });
}
