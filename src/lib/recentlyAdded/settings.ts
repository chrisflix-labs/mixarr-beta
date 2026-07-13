import { z } from "zod";
import prisma from "../prisma";

export const recentlyAddedPresetValues = {
  conservative: { matchThreshold: 95, maxAddsPerPlaylist: 1, maxAddsPerRun: 10, metadataConfidenceThreshold: 90 },
  balanced: { matchThreshold: 90, maxAddsPerPlaylist: 3, maxAddsPerRun: 25, metadataConfidenceThreshold: 75 },
  aggressive: { matchThreshold: 80, maxAddsPerPlaylist: 5, maxAddsPerRun: 40, metadataConfidenceThreshold: 60 },
} as const;

export const recentlyAddedSettingsInputSchema = z.object({
  enabled: z.boolean().default(false),
  timeWindowDays: z.coerce.number().int().min(1).max(365).default(7),
  customTimeWindowDays: z.coerce.number().int().min(1).max(365).nullable().optional(),
  maxTracksPerRun: z.coerce.number().int().min(1).max(10_000).default(500),
  createRecentlyAddedPlaylists: z.boolean().default(false),
  suggestExistingPlaylistMatches: z.boolean().default(true),
  autoAddStrongMatches: z.boolean().default(false),
  quarantineUntilAnalyzed: z.boolean().default(true),
  quarantineRule: z.enum(["all_core", "two_core", "confidence", "manual"]).default("all_core"),
  quarantineTimeoutHours: z.coerce.number().int().min(1).max(168).nullable().optional(),
  allowLowConfidenceAutomation: z.boolean().default(false),
  scheduledRegenerationEnabled: z.boolean().default(false),
  notificationEnabled: z.boolean().default(false),
  notifyStrongMatches: z.boolean().default(true),
  notifySuggestionsReady: z.boolean().default(true),
  notifyAutomaticAdditions: z.boolean().default(true),
  notifyMixCreated: z.boolean().default(true),
  notifyLowConfidence: z.boolean().default(true),
  notifyFailures: z.boolean().default(true),
  matchThreshold: z.coerce.number().min(50).max(100).default(90),
  metadataConfidenceThreshold: z.coerce.number().min(0).max(100).default(75),
  maxAddsPerPlaylist: z.coerce.number().int().min(1).max(25).default(3),
  maxAddsPerRun: z.coerce.number().int().min(1).max(250).default(25),
  requirePreview: z.boolean().default(true),
  automationPreset: z.enum(["conservative", "balanced", "aggressive", "custom"]).default("balanced"),
  scheduleType: z.enum(["manual", "hourly", "daily", "weekly", "custom"]).default("manual"),
  scheduleExpression: z.string().trim().max(120).nullable().optional(),
  scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("02:00"),
  scheduleDayOfWeek: z.coerce.number().int().min(0).max(6).default(0),
  regenerationBehavior: z.enum(["add_only", "replace_weakest", "weak_sections", "rebuild_preserving_locked", "suggestions_only"]).default("add_only"),
  staleLockTimeoutMinutes: z.coerce.number().int().min(5).max(1440).default(60),
  playlistNameTemplate: z.string().trim().min(1).max(120).default("Recently Added — {week}"),
  recentMixMinimumTrackCount: z.coerce.number().int().min(1).max(5000).default(5),
  recentMixMaximumTrackCount: z.coerce.number().int().min(1).max(5000).default(100),
  recentMixMinimumScore: z.coerce.number().min(0).max(100).default(60),
  recentMixMinimumConfidence: z.coerce.number().min(0).max(100).default(60),
  recentMixPublishToPlex: z.boolean().default(false),
  recentMixVersioned: z.boolean().default(false),
  recentMixLibraryId: z.string().uuid().nullable().optional(),
  exclusionsJson: z.unknown().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.recentMixMaximumTrackCount < value.recentMixMinimumTrackCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recentMixMaximumTrackCount"], message: "Maximum track count must be at least the minimum." });
  }
  if (value.scheduleType === "custom" && !value.scheduleExpression) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scheduleExpression"], message: "A cron expression is required for a custom schedule." });
  }
});

export type RecentlyAddedSettingsInput = z.infer<typeof recentlyAddedSettingsInputSchema>;

export function effectivePlaylistAutomationMode(globalSettings: Pick<RecentlyAddedSettingsInput, "enabled" | "suggestExistingPlaylistMatches" | "autoAddStrongMatches">, playlistMode?: string | null) {
  const mode = playlistMode || "suggestions";
  if (!globalSettings.enabled || mode === "off") return "off" as const;
  if (mode === "automatic" && globalSettings.autoAddStrongMatches) return "automatic" as const;
  return globalSettings.suggestExistingPlaylistMatches ? "suggestions" as const : "off" as const;
}

export function automationSummary(settings: RecentlyAddedSettingsInput) {
  if (!settings.enabled) return ["Automation is disabled. Manual scanning and review remain available."];
  const actions = [
    settings.suggestExistingPlaylistMatches && "Create reviewable playlist suggestions",
    settings.autoAddStrongMatches && `Add matches at or above ${settings.matchThreshold}% when playlist-level settings allow it`,
    settings.createRecentlyAddedPlaylists && "Create configured recently added mixes",
    settings.scheduledRegenerationEnabled && `Run ${settings.scheduleType} Smart Mix regeneration`,
    settings.notificationEnabled && "Create in-app match notifications",
  ].filter(Boolean) as string[];
  return actions.length ? actions : ["Wait for new tracks; no individual automation actions are enabled."];
}

export async function getRecentlyAddedSettings(userId: string) {
  return prisma.recentlyAddedSettings.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function saveRecentlyAddedSettings(userId: string, input: unknown) {
  const parsed = recentlyAddedSettingsInputSchema.parse(input);
  const data = { ...parsed, exclusionsJson: parsed.exclusionsJson as any };
  const saved = await prisma.recentlyAddedSettings.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  const { rescheduleRecentlyAddedUser } = await import("./scheduler");
  await rescheduleRecentlyAddedUser(userId);
  return saved;
}

type ExclusionType = "artist" | "album" | "library" | "genre";

export function normalizeRecentlyAddedExclusions(value: unknown) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const strings = (key: string) => Array.from(new Set((Array.isArray(input[key]) ? input[key] : []).map(String).filter(Boolean))).slice(0, 5000);
  const confidenceBelow = input.confidenceBelow == null ? Number.NaN : Number(input.confidenceBelow);
  return { artistIds: strings("artistIds"), albumIds: strings("albumIds"), libraryIds: strings("libraryIds"), genres: strings("genres"), confidenceBelow: Number.isFinite(confidenceBelow) && confidenceBelow >= 0 && confidenceBelow <= 100 ? confidenceBelow : null };
}

export async function addRecentlyAddedExclusion(userId: string, type: ExclusionType, value: string) {
  const settings = await getRecentlyAddedSettings(userId);
  const exclusions = normalizeRecentlyAddedExclusions(settings.exclusionsJson);
  const key = type === "artist" ? "artistIds" : type === "album" ? "albumIds" : type === "library" ? "libraryIds" : "genres";
  exclusions[key] = Array.from(new Set([...exclusions[key], value])).slice(0, 5000);
  await prisma.recentlyAddedSettings.update({ where: { userId }, data: { exclusionsJson: exclusions } });
  const trackWhere = type === "artist" ? { artistId: value }
    : type === "album" ? { albumId: value }
    : type === "library" ? { libraryId: value }
    : { tags: { some: { name: { equals: value, mode: "insensitive" as const } } } };
  const updated = await prisma.recentlyAddedTrackState.updateMany({ where: { track: { ...trackWhere, library: { server: { userId } } } }, data: { ignored: true, status: "ignored" } });
  return { type, value, updated: updated.count, exclusions };
}
