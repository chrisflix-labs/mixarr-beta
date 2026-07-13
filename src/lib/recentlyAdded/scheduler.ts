import type { ScheduledTask } from "node-cron";
import { validate as validateCron } from "node-cron";
import prisma from "../prisma";

type Runtime = { tasks: Map<string, ScheduledTask> };
declare global { var mixarrRecentlyAddedScheduler: Runtime | undefined; }
const runtime = globalThis.mixarrRecentlyAddedScheduler ?? { tasks: new Map<string, ScheduledTask>() };
globalThis.mixarrRecentlyAddedScheduler = runtime;

export function recentlyAddedCron(settings: { scheduleType: string; scheduleExpression?: string | null; scheduleTime: string; scheduleDayOfWeek: number }) {
  const [hour, minute] = settings.scheduleTime.split(":").map(Number);
  if (settings.scheduleType === "hourly") return "0 * * * *";
  if (settings.scheduleType === "daily") return `${minute} ${hour} * * *`;
  if (settings.scheduleType === "weekly") return `${minute} ${hour} * * ${settings.scheduleDayOfWeek}`;
  if (settings.scheduleType === "custom") return settings.scheduleExpression || "";
  return "";
}

function approximateNextRun(settings: { scheduleType: string; scheduleTime: string; scheduleDayOfWeek: number }, now = new Date()) {
  if (settings.scheduleType === "hourly") return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000 + 3_600_000);
  const [hour, minute] = settings.scheduleTime.split(":").map(Number);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (settings.scheduleType === "weekly") {
    let days = (settings.scheduleDayOfWeek - next.getDay() + 7) % 7;
    if (days === 0 && next <= now) days = 7;
    next.setDate(next.getDate() + days);
  } else if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

export async function rescheduleRecentlyAddedUser(userId: string) {
  runtime.tasks.get(userId)?.stop();
  runtime.tasks.delete(userId);
  const settings = await prisma.recentlyAddedSettings.findUnique({ where: { userId } });
  if (!settings?.enabled || !settings.scheduledRegenerationEnabled || settings.scheduleType === "manual") {
    if (settings) await prisma.recentlyAddedSettings.update({ where: { userId }, data: { nextScheduledRunAt: null } });
    return null;
  }
  const expression = recentlyAddedCron(settings);
  if (!expression || !validateCron(expression)) {
    console.error("[RecentlyAdded] scheduler refused invalid cron", { userId, expression });
    return null;
  }
  const cron = await import("node-cron");
  const task = cron.schedule(expression, async () => {
    const { runRecentlyAddedAutomation } = await import("./automation");
    await runRecentlyAddedAutomation({ userId, triggerType: "scheduled" }).catch((error) => console.error("[RecentlyAdded] scheduled run failed", { userId, reason: error instanceof Error ? error.message : String(error) }));
    const current = await prisma.recentlyAddedSettings.findUnique({ where: { userId } });
    if (current) await prisma.recentlyAddedSettings.update({ where: { userId }, data: { nextScheduledRunAt: approximateNextRun(current) } });
  }, process.env.TZ ? { timezone: process.env.TZ } : undefined);
  runtime.tasks.set(userId, task);
  const nextScheduledRunAt = settings.scheduleType === "custom" ? null : approximateNextRun(settings);
  await prisma.recentlyAddedSettings.update({ where: { userId }, data: { nextScheduledRunAt } });
  console.info("[RecentlyAdded] scheduler active", { userId, expression, timezone: process.env.TZ || "system" });
  return { expression, nextScheduledRunAt };
}

export async function initializeRecentlyAddedScheduler() {
  const settings = await prisma.recentlyAddedSettings.findMany({ where: { enabled: true, scheduledRegenerationEnabled: true, scheduleType: { not: "manual" } }, select: { userId: true } });
  await Promise.all(settings.map((item) => rescheduleRecentlyAddedUser(item.userId)));
  return { scheduledUsers: settings.length };
}

