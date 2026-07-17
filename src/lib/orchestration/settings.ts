import prisma from "../prisma";

export const ORCHESTRATION_SETTINGS_KEY = "playlistOrchestrationSettings";
export type OrchestrationSettings = {
  enabled: boolean;
  dryRunByDefault: boolean;
  globalMaxConcurrentJobs: number;
  perUserMaxConcurrentJobs: number;
  perLibraryMaxConcurrentJobs: number;
  defaultPriority: "HIGH" | "NORMAL" | "LOW";
  autoRegisterGeneratedPlaylists: boolean;
  autoEnableRegisteredPlaylists: boolean;
  staleJobTimeoutMinutes: number;
  jobHistoryRetentionDays: number;
  auditRetentionDays: number;
  allowScheduledOrchestration: boolean;
};

export const DEFAULT_ORCHESTRATION_SETTINGS: OrchestrationSettings = {
  enabled: false,
  dryRunByDefault: false,
  globalMaxConcurrentJobs: 1,
  perUserMaxConcurrentJobs: 1,
  perLibraryMaxConcurrentJobs: 1,
  defaultPriority: "NORMAL",
  autoRegisterGeneratedPlaylists: false,
  autoEnableRegisteredPlaylists: false,
  staleJobTimeoutMinutes: 15,
  jobHistoryRetentionDays: 90,
  auditRetentionDays: 365,
  allowScheduledOrchestration: false,
};

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function normalizeOrchestrationSettings(value: unknown): OrchestrationSettings {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const priority = ["HIGH", "NORMAL", "LOW"].includes(String(input.defaultPriority)) ? input.defaultPriority as OrchestrationSettings["defaultPriority"] : "NORMAL";
  return {
    enabled: input.enabled === true,
    dryRunByDefault: input.dryRunByDefault === true,
    globalMaxConcurrentJobs: boundedInt(input.globalMaxConcurrentJobs, 1, 1, 16),
    perUserMaxConcurrentJobs: boundedInt(input.perUserMaxConcurrentJobs, 1, 1, 8),
    perLibraryMaxConcurrentJobs: boundedInt(input.perLibraryMaxConcurrentJobs, 1, 1, 8),
    defaultPriority: priority,
    autoRegisterGeneratedPlaylists: input.autoRegisterGeneratedPlaylists === true,
    autoEnableRegisteredPlaylists: input.autoEnableRegisteredPlaylists === true,
    staleJobTimeoutMinutes: boundedInt(input.staleJobTimeoutMinutes, 15, 5, 1440),
    jobHistoryRetentionDays: boundedInt(input.jobHistoryRetentionDays, 90, 7, 3650),
    auditRetentionDays: boundedInt(input.auditRetentionDays, 365, 30, 3650),
    allowScheduledOrchestration: input.allowScheduledOrchestration === true,
  };
}

export async function getOrchestrationSettings() {
  const row = await prisma.systemState.findUnique({ where: { key: ORCHESTRATION_SETTINGS_KEY }, select: { value: true } });
  if (!row) return DEFAULT_ORCHESTRATION_SETTINGS;
  try { return normalizeOrchestrationSettings(JSON.parse(row.value)); }
  catch { return DEFAULT_ORCHESTRATION_SETTINGS; }
}

export async function saveOrchestrationSettings(input: unknown) {
  const settings = normalizeOrchestrationSettings(input);
  await prisma.systemState.upsert({ where: { key: ORCHESTRATION_SETTINGS_KEY }, update: { value: JSON.stringify(settings) }, create: { key: ORCHESTRATION_SETTINGS_KEY, value: JSON.stringify(settings) } });
  return settings;
}
