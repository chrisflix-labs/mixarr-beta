import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { isUserAdmin } from "../auth";
import { getOrchestrationSettings } from "./settings";
import { healthStateFor, successRate, timeRangeStart } from "./dashboardCore";

const preferenceSchema = z.object({
  dashboardTimeRange: z.enum(["7d", "30d", "90d", "all"]).optional(),
  onboardingStep: z.number().int().min(1).max(6).optional(),
  onboardingComplete: z.boolean().optional(),
  automationLevel: z.enum(["OBSERVE_ONLY", "SUGGEST", "SAFE_AUTO", "FULL_LIMITED"]).optional(),
  goals: z.array(z.string().min(1).max(80)).max(12).optional(),
  safetySettings: z.record(z.unknown()).optional(),
  dashboard: z.record(z.unknown()).optional(),
}).strict();

const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function getOrchestrationPreference(userId: string) {
  return prisma.orchestrationPreference.upsert({
    where: { userId }, update: {}, create: { userId },
  });
}

export async function updateOrchestrationPreference(userId: string, value: unknown) {
  const input = preferenceSchema.parse(value);
  return prisma.orchestrationPreference.upsert({
    where: { userId },
    create: { userId, dashboardTimeRange: input.dashboardTimeRange, onboardingStep: input.onboardingStep, onboardingComplete: input.onboardingComplete, automationLevel: input.automationLevel, goalsJson: input.goals ? json(input.goals) : undefined, safetySettingsJson: input.safetySettings ? json(input.safetySettings) : undefined, dashboardJson: input.dashboard ? json(input.dashboard) : undefined },
    update: { dashboardTimeRange: input.dashboardTimeRange, onboardingStep: input.onboardingStep, onboardingComplete: input.onboardingComplete, automationLevel: input.automationLevel, goalsJson: input.goals ? json(input.goals) : undefined, safetySettingsJson: input.safetySettings ? json(input.safetySettings) : undefined, dashboardJson: input.dashboard ? json(input.dashboard) : undefined },
  });
}

export async function getOrchestrationDashboardSummary(userId: string, requestedRange?: string) {
  const preference = await getOrchestrationPreference(userId);
  const range = ["7d", "30d", "90d", "all"].includes(requestedRange || "") ? requestedRange! : preference.dashboardTimeRange;
  const from = timeRangeStart(range);
  const jobTime = from ? { requestedAt: { gte: from } } : {};
  const now = new Date();
  const [settings, admin, managed, unmanaged, coverage, overlap, pendingActions, experiments, jobsByStatus, upcomingJobs, recentExperiments, openAlerts] = await Promise.all([
    getOrchestrationSettings(),
    isUserAdmin(userId),
    prisma.managedPlaylist.findMany({ where: { userId, enabled: true }, take: 500, orderBy: { displayName: "asc" }, select: {
      id: true, displayName: true, generatedPlaylistId: true, automationEnabled: true, automationState: true, orchestrationMode: true, plexAvailable: true, lastCompletedAt: true, lastFailedAt: true,
      generatedPlaylist: { select: { id: true, trackCount: true, healthSnapshots: { orderBy: { analyzedAt: "desc" }, take: 1, select: { overallScore: true, status: true, warningCount: true, criticalCount: true, metadataConfidence: true, identityScore: true, analyzedAt: true } }, groupMemberships: { take: 5, select: { playlistGroup: { select: { id: true, name: true, isPaused: true } } } } } },
    } }),
    prisma.generatedPlaylist.count({ where: { userId, managedPlaylist: null } }),
    prisma.libraryCoverageSnapshot.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { eligibleTracks: true, usedTracks: true, excludedTracks: true, coveragePercentage: true, partialHistory: true, createdAt: true, explanationJson: true } }),
    prisma.playlistOverlapSummary.aggregate({ where: { playlistA: { userId }, playlistB: { userId }, stale: false }, _avg: { sharedTrackPercentage: true }, _count: { _all: true }, _sum: { excessSharedTrackCount: true } }),
    prisma.smartAction.groupBy({ by: ["status"], where: { userId, status: { in: ["PENDING", "APPROVED", "SCHEDULED", "SNOOZED"] } }, _count: { _all: true } }),
    prisma.smartExperiment.groupBy({ by: ["status"], where: { userId }, _count: { _all: true } }),
    prisma.playlistOrchestrationJob.groupBy({ by: ["status"], where: { userId, ...jobTime }, _count: { _all: true } }),
    prisma.playlistOrchestrationJob.findMany({ where: { userId, status: { in: ["QUEUED", "WAITING", "BLOCKED"] }, scheduledFor: { gte: now } }, take: 6, orderBy: { scheduledFor: "asc" }, select: { id: true, jobType: true, status: true, trigger: true, dryRun: true, scheduledFor: true, managedPlaylist: { select: { id: true, displayName: true, automationEnabled: true } } } }),
    prisma.smartExperiment.findMany({ where: { userId, status: { in: ["COMPLETED", "INCONCLUSIVE"] } }, orderBy: { completedAt: "desc" }, take: 5, select: { id: true, name: true, status: true, suggestedWinner: true, winnerConfidence: true, completedAt: true, sourcePlaylist: { select: { plexPlaylistTitle: true } } } }),
    prisma.playlistHealthAlert.findMany({ where: { userId, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }], take: 10, select: { id: true, playlistId: true, title: true, message: true, severity: true, status: true, lastDetectedAt: true, detailsJson: true, playlist: { select: { plexPlaylistTitle: true } } } }),
  ]);

  const playlists = managed.map((playlist) => {
    const snapshot = playlist.generatedPlaylist?.healthSnapshots[0] || null;
    return { ...playlist, health: { state: healthStateFor({ automationState: playlist.automationState, plexAvailable: playlist.plexAvailable, snapshotStatus: snapshot?.status, score: snapshot?.overallScore, criticalCount: snapshot?.criticalCount, warningCount: snapshot?.warningCount }), score: snapshot?.overallScore ?? null, snapshotAt: snapshot?.analyzedAt ?? null, warningCount: snapshot?.warningCount || 0, criticalCount: snapshot?.criticalCount || 0, metadataConfidence: snapshot?.metadataConfidence ?? null, identityScore: snapshot?.identityScore ?? null } };
  });
  const healthCounts = Object.fromEntries(["HEALTHY", "WARNING", "NEEDS_ATTENTION", "CRITICAL", "PAUSED", "NOT_ENOUGH_DATA"].map((state) => [state, playlists.filter((item) => item.health.state === state).length]));
  const jobCounts = Object.fromEntries(jobsByStatus.map((item) => [item.status, item._count._all]));
  const actionCounts = Object.fromEntries(pendingActions.map((item) => [item.status, item._count._all]));
  const experimentCounts = Object.fromEntries(experiments.map((item) => [item.status, item._count._all]));
  const completedJobs = (jobCounts.SUCCEEDED || 0) + (jobCounts.FAILED || 0);
  const summary = {
    managedPlaylists: playlists.length,
    healthyPlaylists: healthCounts.HEALTHY || 0,
    needsAttention: (healthCounts.WARNING || 0) + (healthCounts.NEEDS_ATTENTION || 0) + (healthCounts.CRITICAL || 0),
    criticalPlaylists: healthCounts.CRITICAL || 0,
    pausedPlaylists: healthCounts.PAUSED || 0,
    disabledPlaylists: playlists.filter((item) => !item.automationEnabled || item.automationState === "DISABLED").length,
    unmanagedPlaylists: unmanaged,
    libraryCoveragePercentage: coverage?.coveragePercentage ?? null,
    coverageDenominator: coverage?.eligibleTracks ?? null,
    coveredTracks: coverage?.usedTracks ?? null,
    averageOverlapPercentage: overlap._avg.sharedTrackPercentage ?? null,
    tracksOverrepresented: overlap._sum.excessSharedTrackCount || 0,
    pendingSmartActions: (actionCounts.PENDING || 0) + (actionCounts.APPROVED || 0) + (actionCounts.SCHEDULED || 0),
    activeExperiments: (experimentCounts.RUNNING || 0) + (experimentCounts.PAUSED || 0),
    recentlyCompletedExperiments: recentExperiments.length,
    upcomingJobs: upcomingJobs.length,
    failedOrStalledJobs: (jobCounts.FAILED || 0) + (jobCounts.STALE || 0) + (jobCounts.BLOCKED || 0),
    automationSuccessRate: successRate(jobCounts.SUCCEEDED || 0, jobCounts.FAILED || 0),
    completedJobs,
  };
  const warnings = [
    ...openAlerts.map((alert) => ({ id: alert.id, severity: alert.severity, title: alert.title, explanation: alert.message, detectedAt: alert.lastDetectedAt, playlist: alert.playlist.plexPlaylistTitle, href: `/playlist-health?playlistId=${alert.playlistId}` })),
    ...(!settings.enabled ? [{ id: "orchestration-disabled", severity: "WARNING", title: "Orchestration is disabled", explanation: "Scheduled work remains preserved but will not run until orchestration is enabled.", detectedAt: null, playlist: null, href: "/settings#orchestration" }] : []),
    ...(coverage == null ? [{ id: "coverage-missing", severity: "INFO", title: "Coverage snapshot unavailable", explanation: "Run a library coverage calculation to establish the coverage denominator and trend.", detectedAt: null, playlist: null, href: "/library-coverage" }] : []),
  ].slice(0, 12);
  return { generatedAt: now, range, preference, settings: { enabled: settings.enabled, allowScheduledOrchestration: settings.allowScheduledOrchestration }, capabilities: { view: true, manageEnrollment: true, approveSmartActions: true, runAutomation: true, manageExperiments: true, importConfiguration: admin, exportConfiguration: true, validateBackups: admin, clearJobHistory: admin, viewAudit: true }, summary, healthCounts, playlists, coverage, upcomingJobs, recentExperiments, warnings };
}

export async function captureOrchestrationTrendSnapshot(userId: string, force = false) {
  const latest = await prisma.orchestrationTrendSnapshot.findFirst({ where: { userId }, orderBy: { capturedAt: "desc" } });
  if (!force && latest && Date.now() - latest.capturedAt.getTime() < 6 * 60 * 60_000) return { snapshot: latest, created: false };
  const dashboard = await getOrchestrationDashboardSummary(userId);
  const scores = dashboard.playlists.map((item) => item.health.score).filter((value): value is number => value != null);
  const metadata = dashboard.playlists.map((item) => item.health.metadataConfidence).filter((value): value is number => value != null);
  const identity = dashboard.playlists.map((item) => item.health.identityScore).filter((value): value is number => value != null);
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const snapshot = await prisma.orchestrationTrendSnapshot.create({ data: {
    userId, managedPlaylistCount: dashboard.summary.managedPlaylists, healthyPlaylistCount: dashboard.summary.healthyPlaylists, attentionPlaylistCount: dashboard.summary.needsAttention,
    pausedPlaylistCount: dashboard.summary.pausedPlaylists, averageHealthScore: average(scores), libraryCoveragePercentage: dashboard.summary.libraryCoveragePercentage,
    averageOverlapPercentage: dashboard.summary.averageOverlapPercentage, automationSuccessRate: dashboard.summary.automationSuccessRate, pendingSmartActionCount: dashboard.summary.pendingSmartActions,
    activeExperimentCount: dashboard.summary.activeExperiments, failedJobCount: dashboard.summary.failedOrStalledJobs, metadataConfidence: average(metadata), identityMatch: average(identity),
  } });
  console.info(`[OrchestrationTrends] Captured user=${userId} managed=${snapshot.managedPlaylistCount} healthy=${snapshot.healthyPlaylistCount}`);
  return { snapshot, created: true };
}

export async function getOrchestrationTrends(userId: string, range: string) {
  const from = timeRangeStart(range);
  await captureOrchestrationTrendSnapshot(userId).catch((error) => console.warn("[OrchestrationTrends] Snapshot capture failed", error instanceof Error ? error.message : error));
  const items = await prisma.orchestrationTrendSnapshot.findMany({ where: { userId, ...(from ? { capturedAt: { gte: from } } : {}) }, orderBy: { capturedAt: "asc" }, take: 500 });
  return { range, items, missingHistory: items.length < 2, note: items.length < 2 ? "Trend history will appear after additional scheduled ecosystem snapshots are captured." : null };
}
