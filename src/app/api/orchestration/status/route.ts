import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { orchestrationApiError, orchestrationSession, orchestrationUnauthorized } from "@/lib/orchestration/api";
import { getOrchestrationSettings } from "@/lib/orchestration/settings";
import { workerStaleThresholdMs } from "@/lib/workerHealth";

export const dynamic = "force-dynamic";
export async function GET() {
  const userId = orchestrationSession(); if (!userId) return orchestrationUnauthorized();
  try {
    const settings = await getOrchestrationSettings();
    const staleBefore = new Date(Date.now() - workerStaleThresholdMs());
    const [managed, enabled, paused, blocked, running, queued, waiting, failed, locks, worker] = await Promise.all([
      prisma.managedPlaylist.count({ where: { userId, enabled: true } }),
      prisma.managedPlaylist.count({ where: { userId, enabled: true, automationEnabled: true } }),
      prisma.managedPlaylist.count({ where: { userId, enabled: true, automationState: "PAUSED" } }),
      prisma.managedPlaylist.count({ where: { userId, enabled: true, automationState: "BLOCKED" } }),
      prisma.playlistOrchestrationJob.count({ where: { userId, status: "RUNNING" } }),
      prisma.playlistOrchestrationJob.count({ where: { userId, status: "QUEUED" } }),
      prisma.playlistOrchestrationJob.count({ where: { userId, status: { in: ["WAITING", "BLOCKED"] } } }),
      prisma.playlistOrchestrationJob.count({ where: { userId, status: "FAILED", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } } }),
      prisma.playlistOrchestrationLock.count({ where: { job: { userId }, leaseExpiresAt: { gt: new Date() } } }),
      prisma.workerHeartbeat.findFirst({ where: { lastHeartbeatAt: { gte: staleBefore }, status: { not: "stopped" } }, orderBy: { lastHeartbeatAt: "desc" } }),
    ]);
    return NextResponse.json({ settings, summary: { managedPlaylists: managed, automationEnabled: enabled, paused, blocked, runningJobs: running, queuedJobs: queued, waitingJobs: waiting, failuresLast24Hours: failed, activeLocks: locks }, health: { schemaReady: true, workerAvailable: Boolean(worker), workerLastHeartbeatAt: worker?.lastHeartbeatAt || null, queueStalled: queued > 0 && !worker, orchestrationEnabled: settings.enabled } });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "P2021" || (error instanceof Error && /does not exist|ManagedPlaylist/i.test(error.message))) {
      return NextResponse.json({ settings: await getOrchestrationSettings().catch(() => null), summary: { managedPlaylists: 0, automationEnabled: 0, paused: 0, blocked: 0, runningJobs: 0, queuedJobs: 0, waitingJobs: 0, failuresLast24Hours: 0, activeLocks: 0 }, health: { schemaReady: false, workerAvailable: false, queueStalled: false, orchestrationEnabled: false, warning: "Playlist orchestration schema is incomplete. Apply the v2.2.0 Prisma migration. Legacy Mixarr services remain available." } });
    }
    return orchestrationApiError(error);
  }
}
