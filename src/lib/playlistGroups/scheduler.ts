import type { ScheduledTask } from "node-cron";
import { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { queueGroupRegeneration } from "./regeneration";

type Runtime = { task: ScheduledTask | null; running: boolean };
declare global { var mixarrPlaylistGroupScheduler: Runtime | undefined; }
const runtime = globalThis.mixarrPlaylistGroupScheduler ?? { task: null, running: false };
globalThis.mixarrPlaylistGroupScheduler = runtime;

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function localParts(timeZone: string) { const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()); return Object.fromEntries(parts.map((part) => [part.type, part.value])); }

export async function runDuePlaylistGroupSchedules() {
  if (runtime.running) return { inspected: 0, queued: 0, skipped: 0 };
  runtime.running = true; let queued = 0; let skipped = 0;
  try {
    const groups = await prisma.playlistGroup.findMany({ where: { isPaused: false, scheduleJson: { not: Prisma.DbNull } }, select: { id: true, userId: true, name: true, scheduleJson: true }, take: 500 });
    for (const group of groups) {
      const schedule = record(group.scheduleJson); if (!schedule.enabled) { skipped += 1; continue; }
      const timeZone = typeof schedule.timezone === "string" ? schedule.timezone : "UTC"; let parts: Record<string, string>;
      try { parts = localParts(timeZone); } catch { console.warn(`[PlaylistGroupScheduler] Invalid timezone groupId=${group.id}`); skipped += 1; continue; }
      const time = `${parts.hour}:${parts.minute}`; if (time !== String(schedule.time || "03:00")) { skipped += 1; continue; }
      const days = Array.isArray(schedule.days) ? schedule.days.map(String) : []; if ((schedule.frequency === "weekly" || schedule.frequency === "selected_days") && days.length && !days.includes(parts.weekday)) { skipped += 1; continue; }
      const dayKey = `${parts.year}-${parts.month}-${parts.day}`;
      const duplicate = await prisma.jobHistory.findFirst({ where: { userId: group.userId, type: "playlist_group", trigger: "scheduled", metadata: { path: ["scheduleKey"], equals: `${group.id}:${dayKey}` } }, select: { id: true } });
      if (duplicate) { skipped += 1; continue; }
      try { const result = await queueGroupRegeneration(group.userId, group.id, { only: schedule.only === "unhealthy" ? "unhealthy" : schedule.only === "warnings" ? "warnings" : "all" }); await prisma.jobHistory.update({ where: { id: result.jobId }, data: { trigger: "scheduled", metadata: { playlistGroupId: group.id, playlistIds: result.preview.playlistIds, scheduleKey: `${group.id}:${dayKey}`, timezone: timeZone } } }); queued += 1; }
      catch (error) { console.warn(`[PlaylistGroupScheduler] Skipped groupId=${group.id} reason=${error instanceof Error ? error.message : String(error)}`); skipped += 1; }
    }
    return { inspected: groups.length, queued, skipped };
  } finally { runtime.running = false; }
}

export async function initializePlaylistGroupScheduler() {
  if (runtime.task) return;
  const cron = await import("node-cron");
  runtime.task = cron.schedule("* * * * *", () => { void runDuePlaylistGroupSchedules(); });
  console.log("[PlaylistGroupScheduler] Active with one-minute due-schedule checks.");
  void runDuePlaylistGroupSchedules();
}
