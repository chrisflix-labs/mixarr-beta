export type SchedulerMode = "daily" | "interval" | "weekly" | "custom";
export type SchedulerSettingsSource = "database" | "environment" | "default";

export type SchedulerSettings = {
  schedulerEnabled: boolean;
  schedulerMode: SchedulerMode;
  schedulerCron: string;
  schedulerTime: string;
  schedulerDayOfWeek: number;
  schedulerIntervalHours: number;
  updatedAt: string | null;
};

export type ResolvedSchedulerSettings = SchedulerSettings & {
  source: SchedulerSettingsSource;
};

export const DEFAULT_SCHEDULER_CRON = "0 3 * * *";
export const DEFAULT_SCHEDULER_TIME = "03:00";
export const DEFAULT_SCHEDULER_DAY_OF_WEEK = 0;
export const DEFAULT_SCHEDULER_INTERVAL_HOURS = 6;

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const DEFAULT_SCHEDULER_SETTINGS: SchedulerSettings = {
  schedulerEnabled: true,
  schedulerMode: "daily",
  schedulerCron: DEFAULT_SCHEDULER_CRON,
  schedulerTime: DEFAULT_SCHEDULER_TIME,
  schedulerDayOfWeek: DEFAULT_SCHEDULER_DAY_OF_WEEK,
  schedulerIntervalHours: DEFAULT_SCHEDULER_INTERVAL_HOURS,
  updatedAt: null,
};

export class SchedulerSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulerSettingsValidationError";
    Object.setPrototypeOf(this, SchedulerSettingsValidationError.prototype);
  }
}

export function isStandardFiveFieldCronShape(value: string) {
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field) => /^[\d*/,\-A-Za-z?]+$/.test(field));
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeMode(value: unknown): SchedulerMode {
  return value === "interval" || value === "weekly" || value === "custom" || value === "daily" ? value : "daily";
}

function normalizeTime(value: unknown, fallback = DEFAULT_SCHEDULER_TIME) {
  if (typeof value !== "string") return fallback;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeDayOfWeek(value: unknown, fallback = DEFAULT_SCHEDULER_DAY_OF_WEEK) {
  const day = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) return fallback;
  return day;
}

function normalizeIntervalHours(value: unknown, fallback = DEFAULT_SCHEDULER_INTERVAL_HOURS) {
  const hours = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > 24) return fallback;
  return hours;
}

function timeParts(time: string) {
  const [hour, minute] = normalizeTime(time).split(":").map((part) => Number(part));
  return { hour, minute };
}

export function generateSchedulerCron(settings: Pick<SchedulerSettings, "schedulerMode" | "schedulerTime" | "schedulerDayOfWeek" | "schedulerIntervalHours" | "schedulerCron">) {
  const { hour, minute } = timeParts(settings.schedulerTime);

  if (settings.schedulerMode === "interval") {
    return `0 */${normalizeIntervalHours(settings.schedulerIntervalHours)} * * *`;
  }

  if (settings.schedulerMode === "weekly") {
    return `${minute} ${hour} * * ${normalizeDayOfWeek(settings.schedulerDayOfWeek)}`;
  }

  if (settings.schedulerMode === "custom") {
    return settings.schedulerCron.trim();
  }

  return `${minute} ${hour} * * *`;
}

export function buildSchedulerSettingsFromInput(
  input: Record<string, unknown>,
  validateCustomCron: (cron: string) => boolean = isStandardFiveFieldCronShape,
): SchedulerSettings {
  const mode = normalizeMode(input.schedulerMode);
  const schedulerTime = normalizeTime(input.schedulerTime);
  const schedulerDayOfWeek = normalizeDayOfWeek(input.schedulerDayOfWeek);
  const schedulerIntervalHours = normalizeIntervalHours(input.schedulerIntervalHours);
  const base = {
    schedulerEnabled: normalizeBoolean(input.schedulerEnabled, DEFAULT_SCHEDULER_SETTINGS.schedulerEnabled),
    schedulerMode: mode,
    schedulerCron: typeof input.schedulerCron === "string" ? input.schedulerCron.trim() : DEFAULT_SCHEDULER_CRON,
    schedulerTime,
    schedulerDayOfWeek,
    schedulerIntervalHours,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
  };
  const schedulerCron = generateSchedulerCron(base);

  if (mode === "custom" && !validateCustomCron(schedulerCron)) {
    throw new SchedulerSettingsValidationError("Invalid cron expression. Use standard 5-field cron format, for example: 0 3 * * *");
  }

  return {
    ...base,
    schedulerCron,
  };
}

export function inferSchedulerSettingsFromCron(cron: string): SchedulerSettings {
  const normalized = cron.trim();
  const intervalMatch = normalized.match(/^0\s+\*\/(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (intervalMatch) {
    return {
      ...DEFAULT_SCHEDULER_SETTINGS,
      schedulerMode: "interval",
      schedulerCron: normalized,
      schedulerIntervalHours: normalizeIntervalHours(Number(intervalMatch[1])),
    };
  }

  const weeklyMatch = normalized.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6])$/);
  if (weeklyMatch) {
    return {
      ...DEFAULT_SCHEDULER_SETTINGS,
      schedulerMode: "weekly",
      schedulerCron: normalized,
      schedulerTime: normalizeTime(`${weeklyMatch[2]}:${weeklyMatch[1]}`),
      schedulerDayOfWeek: Number(weeklyMatch[3]),
    };
  }

  const dailyMatch = normalized.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (dailyMatch) {
    return {
      ...DEFAULT_SCHEDULER_SETTINGS,
      schedulerMode: "daily",
      schedulerCron: normalized,
      schedulerTime: normalizeTime(`${dailyMatch[2]}:${dailyMatch[1]}`),
    };
  }

  return {
    ...DEFAULT_SCHEDULER_SETTINGS,
    schedulerMode: "custom",
    schedulerCron: normalized,
  };
}

export function resolveSchedulerSettingsFromStoredValue(
  storedValue: string | null | undefined,
  envCron: string | null | undefined,
  validateCron: (cron: string) => boolean = isStandardFiveFieldCronShape,
): ResolvedSchedulerSettings {
  if (storedValue) {
    const parsed = JSON.parse(storedValue) as Record<string, unknown>;
    return {
      ...buildSchedulerSettingsFromInput(parsed, validateCron),
      source: "database",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  }

  // SYNC_CRON_SCHEDULE remains an environment fallback/default only.
  // Once the UI saves a database setting, that saved value overrides this env var.
  const fallbackCron = (envCron || DEFAULT_SCHEDULER_CRON).trim();
  const validFallbackCron = validateCron(fallbackCron) ? fallbackCron : DEFAULT_SCHEDULER_CRON;
  return {
    ...inferSchedulerSettingsFromCron(validFallbackCron),
    source: envCron ? "environment" : "default",
    updatedAt: null,
  };
}

export function formatSchedulerTime(time: string) {
  const { hour, minute } = timeParts(time);
  const period = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:${String(minute).padStart(2, "0")} ${period}`;
}

export function schedulerSummary(settings: Pick<SchedulerSettings, "schedulerMode" | "schedulerTime" | "schedulerDayOfWeek" | "schedulerIntervalHours" | "schedulerCron">) {
  if (settings.schedulerMode === "interval") {
    return `Runs every ${normalizeIntervalHours(settings.schedulerIntervalHours)} hours.`;
  }
  if (settings.schedulerMode === "weekly") {
    return `Runs every ${DAY_NAMES[normalizeDayOfWeek(settings.schedulerDayOfWeek)]} at ${formatSchedulerTime(settings.schedulerTime)}.`;
  }
  if (settings.schedulerMode === "custom") {
    return `Runs using custom cron: ${settings.schedulerCron}.`;
  }
  return `Runs every day at ${formatSchedulerTime(settings.schedulerTime)}.`;
}

export function calculateNextSchedulerRun(settings: SchedulerSettings, now = new Date()) {
  if (!settings.schedulerEnabled || settings.schedulerMode === "custom") return null;

  if (settings.schedulerMode === "interval") {
    const interval = normalizeIntervalHours(settings.schedulerIntervalHours);
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(0);
    if (candidate <= now) candidate.setHours(candidate.getHours() + 1);
    for (let attempts = 0; attempts < 48; attempts += 1) {
      if (candidate.getHours() % interval === 0) return candidate;
      candidate.setHours(candidate.getHours() + 1);
    }
    return null;
  }

  const { hour, minute } = timeParts(settings.schedulerTime);
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setHours(hour, minute, 0, 0);

  if (settings.schedulerMode === "weekly") {
    const targetDay = normalizeDayOfWeek(settings.schedulerDayOfWeek);
    const daysUntilTarget = (targetDay - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + daysUntilTarget);
    if (candidate <= now) candidate.setDate(candidate.getDate() + 7);
    return candidate;
  }

  if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}
