import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { SMART_REFRESH_MODES, SMART_REFRESH_SENSITIVITIES, type SmartRefreshThresholds } from "./types";
import { SENSITIVITY_DEFAULTS } from "./core";

const timezoneSchema = z.string().min(1).max(100).refine((value) => { try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date()); return true; } catch { return false; } }, "Enter a valid IANA time zone, such as America/New_York");

export const smartRefreshSettingsSchema = z.object({
  refreshMode: z.enum(SMART_REFRESH_MODES).optional(),
  sensitivity: z.enum(SMART_REFRESH_SENSITIVITIES).optional(),
  minimumEstimatedImprovement: z.coerce.number().min(0).max(25).optional(),
  minimumCompatibleTracks: z.coerce.number().int().min(1).max(100).optional(),
  weakTrackThreshold: z.coerce.number().int().min(20).max(90).optional(),
  identityDriftThreshold: z.coerce.number().min(5).max(80).optional(),
  repetitionThreshold: z.coerce.number().min(20).max(95).optional(),
  metadataImprovementThreshold: z.coerce.number().int().min(1).max(100).optional(),
  evaluationIntervalHours: z.coerce.number().int().min(1).max(720).optional(),
  minimumRefreshIntervalHours: z.coerce.number().int().min(1).max(8760).optional(),
  maximumRefreshesPerWeek: z.union([z.coerce.number().int().min(1).max(20), z.null()]).optional(),
  fallbackAfterHours: z.union([z.coerce.number().int().min(24).max(8760), z.null()]).optional(),
  allowPlaylistGrowth: z.boolean().optional(),
  allowAutomaticWeakTrackRefresh: z.boolean().optional(),
  allowAutomaticFullRegeneration: z.boolean().optional(),
  quietHoursOverrideJson: z.union([z.object({ enabled: z.boolean(), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), timezone: timezoneSchema, allowEvaluations: z.boolean().default(true), allowGeneration: z.boolean().default(false) }), z.null()]).optional(),
}).strict();

export const smartRefreshGlobalSettingsSchema = z.object({
  quietHoursEnabled: z.boolean().optional(), quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(), quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(), timezone: timezoneSchema.optional(),
  allowEvaluationsQuietHours: z.boolean().optional(), allowGenerationQuietHours: z.boolean().optional(), allowUrgentRepairs: z.boolean().optional(), runDeferredAfterQuietHours: z.boolean().optional(),
}).strict();

export async function ensureSmartRefreshSettings(userId: string, generatedPlaylistId: string) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, select: { id: true, plexPlaylistRatingKey: true } });
  if (!playlist) throw new Error("Generated playlist not found");
  const existingFixedSchedule = playlist.plexPlaylistRatingKey ? await prisma.playlistRule.count({ where: { userId, plexPlaylistId: playlist.plexPlaylistRatingKey, autoRefresh: true } }) : 0;
  return prisma.smartRefreshSettings.upsert({ where: { generatedPlaylistId }, create: { generatedPlaylistId, refreshMode: existingFixedSchedule ? "FIXED_SCHEDULE" : "MANUAL_ONLY" }, update: {} });
}

export async function ensureSmartRefreshGlobalSettings(userId: string) {
  return prisma.smartRefreshGlobalSetting.upsert({ where: { userId }, create: { userId }, update: {} });
}

export function resolvedThresholds(settings: any): SmartRefreshThresholds {
  if (settings.sensitivity !== "CUSTOM") return SENSITIVITY_DEFAULTS[settings.sensitivity as keyof typeof SENSITIVITY_DEFAULTS] || SENSITIVITY_DEFAULTS.BALANCED;
  return { minimumEstimatedImprovement: settings.minimumEstimatedImprovement, minimumCompatibleTracks: settings.minimumCompatibleTracks, weakTrackThreshold: settings.weakTrackThreshold, identityDriftThreshold: settings.identityDriftThreshold, repetitionThreshold: settings.repetitionThreshold, metadataImprovementThreshold: settings.metadataImprovementThreshold };
}

export async function getSmartRefreshSettings(userId: string, generatedPlaylistId: string) {
  const [settings, globalSettings] = await Promise.all([ensureSmartRefreshSettings(userId, generatedPlaylistId), ensureSmartRefreshGlobalSettings(userId)]);
  return { settings, globalSettings, thresholds: resolvedThresholds(settings) };
}

export async function updateSmartRefreshSettings(userId: string, generatedPlaylistId: string, raw: unknown) {
  const value = smartRefreshSettingsSchema.parse(raw);
  const current = await ensureSmartRefreshSettings(userId, generatedPlaylistId);
  const settings = await prisma.smartRefreshSettings.update({ where: { id: current.id }, data: { ...value, invalidationVersion: { increment: 1 }, pendingTriggerSource: "SETTINGS_CHANGED", deferredUntil: null } as any });
  return { settings, globalSettings: await ensureSmartRefreshGlobalSettings(userId), thresholds: resolvedThresholds(settings) };
}

export async function updateSmartRefreshGlobalSettings(userId: string, raw: unknown) {
  const value = smartRefreshGlobalSettingsSchema.parse(raw);
  await ensureSmartRefreshGlobalSettings(userId);
  const settings = await prisma.smartRefreshGlobalSetting.update({ where: { userId }, data: value });
  await prisma.smartRefreshSettings.updateMany({ where: { generatedPlaylist: { userId }, quietHoursOverrideJson: { equals: Prisma.DbNull } }, data: { invalidationVersion: { increment: 1 }, pendingTriggerSource: "QUIET_HOURS_CHANGED" } }).catch(() => undefined);
  return settings;
}
