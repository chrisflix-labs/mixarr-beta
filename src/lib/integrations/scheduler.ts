import type { ScheduledTask } from "node-cron";
import prisma from "../prisma";
import { cleanupIntegrationHistory, deliverWebhook, detectPlaylistChange, runMountChecks, testPlexServer } from "./service";

const db = prisma as any;
type Runtime = { healthTask: ScheduledTask | null; cleanupTask: ScheduledTask | null; running: boolean };
declare global { var mixarrIntegrationScheduler: Runtime | undefined; }
const runtime: Runtime = globalThis.mixarrIntegrationScheduler || { healthTask: null, cleanupTask: null, running: false };
globalThis.mixarrIntegrationScheduler = runtime;

async function runIntegrationMaintenance() {
  if (runtime.running) return;
  runtime.running = true;
  try {
    await runMountChecks();
    const servers = await db.server.findMany({ where: { enabled: true }, select: { id: true, userId: true } });
    for (const server of servers) await testPlexServer(server.id, server.userId).catch(() => null);
    const playlists = await db.generatedPlaylist.findMany({ where: { managedByMixarr: true, plexPlaylistRatingKey: { not: null }, externalChangeState: "NO_CHANGE" }, select: { id: true }, take: 100, orderBy: { updatedAt: "asc" } });
    for (const playlist of playlists) await detectPlaylistChange(playlist.id).catch(() => null);
    const due = await db.webhookDelivery.findMany({ where: { status: "RETRY_SCHEDULED", nextAttemptAt: { lte: new Date() } }, take: 100, orderBy: { nextAttemptAt: "asc" } });
    for (const delivery of due) {
      const retry = await db.webhookDelivery.create({ data: { deliveryId: delivery.deliveryId, eventId: delivery.eventId, endpointId: delivery.endpointId, attemptNumber: delivery.attemptNumber + 1 } }).catch(() => null);
      if (retry) await deliverWebhook(retry.id).catch(() => null);
      await db.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "RETRIED", completedAt: new Date() } }).catch(() => null);
    }
  } finally { runtime.running = false; }
}

export async function initializeIntegrationScheduler() {
  if (process.env.INTEGRATION_SCHEDULER_ENABLED === "false") return;
  const cron = await import("node-cron");
  runtime.healthTask?.stop(); runtime.cleanupTask?.stop();
  runtime.healthTask = cron.schedule(process.env.INTEGRATION_HEALTH_CRON || "*/5 * * * *", () => { void runIntegrationMaintenance(); });
  runtime.cleanupTask = cron.schedule(process.env.INTEGRATION_RETENTION_CRON || "17 3 * * *", () => { void cleanupIntegrationHistory(); });
  console.log("[Integrations] Health, change-detection, retry, and retention jobs scheduled.");
}
