import { validate as validateCron } from "node-cron";
import prisma from "./prisma";
import {
  buildSchedulerSettingsFromInput,
  DEFAULT_SCHEDULER_CRON,
  isStandardFiveFieldCronShape,
  resolveSchedulerSettingsFromStoredValue,
  SchedulerSettingsValidationError,
  type ResolvedSchedulerSettings,
  type SchedulerSettings,
} from "./schedulerSettingsCore";

export { SchedulerSettingsValidationError };
export type { ResolvedSchedulerSettings, SchedulerSettings };

export const SCHEDULER_SETTINGS_KEY = "backgroundSchedulerSettings";

export function isValidSchedulerCron(cron: string) {
  return isStandardFiveFieldCronShape(cron) && validateCron(cron);
}

export function normalizeSchedulerSettings(input: Record<string, unknown>) {
  return buildSchedulerSettingsFromInput(input, isValidSchedulerCron);
}

export async function getResolvedSchedulerSettings(): Promise<ResolvedSchedulerSettings> {
  const row = await prisma.systemState.findUnique({
    where: { key: SCHEDULER_SETTINGS_KEY },
    select: { value: true },
  });

  try {
    return resolveSchedulerSettingsFromStoredValue(row?.value, process.env.SYNC_CRON_SCHEDULE, isValidSchedulerCron);
  } catch (error) {
    console.error("[SchedulerSettings] Saved scheduler settings are invalid; falling back to default schedule.", error);
    return resolveSchedulerSettingsFromStoredValue(null, DEFAULT_SCHEDULER_CRON, isValidSchedulerCron);
  }
}

export async function saveSchedulerSettings(input: Record<string, unknown>) {
  const settings = normalizeSchedulerSettings(input);
  const saved = {
    ...settings,
    updatedAt: new Date().toISOString(),
  };

  // Persisted UI settings intentionally override SYNC_CRON_SCHEDULE.
  // The env var remains only a fallback/default for installs without a saved setting.
  await prisma.systemState.upsert({
    where: { key: SCHEDULER_SETTINGS_KEY },
    update: { value: JSON.stringify(saved) },
    create: { key: SCHEDULER_SETTINGS_KEY, value: JSON.stringify(saved) },
  });

  return {
    ...saved,
    source: "database" as const,
  };
}
