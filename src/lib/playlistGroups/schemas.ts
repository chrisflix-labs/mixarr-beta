import { z } from "zod";

const jsonRecord = z.record(z.unknown());

export const playlistGroupSettingsSchema = z.object({
  discoveryLevel: z.enum(["low", "balanced", "high"]).optional(),
  deepCutPercentage: z.number().min(0).max(100).optional(),
  maximumTracksPerArtist: z.number().int().min(0).max(1000).optional(),
  maximumArtistPercentage: z.number().min(1).max(100).optional(),
  minimumUniqueArtists: z.number().int().min(1).max(10_000).optional(),
  artistCooldownDistance: z.number().int().min(0).max(1000).optional(),
  preferArtistVariety: z.boolean().optional(),
  allowArtistLimitRelaxation: z.boolean().optional(),
  groupWideArtistDistribution: z.boolean().optional(),
  recentlyPlayedExclusionDays: z.number().int().min(0).max(3650).optional(),
  recentlyUsedPlaylistExclusionDays: z.number().int().min(0).max(3650).optional(),
  liveTrackHandling: z.enum(["allow", "exclude", "prefer"]).optional(),
  missingMetadataBehavior: z.enum(["allow", "allow-with-warning", "exclude"]).optional(),
  recommendationStrength: z.number().min(0).max(100).optional(),
  maximumPersonalizationInfluence: z.number().min(0).max(100).optional(),
  albumLimit: z.number().int().min(0).max(1000).optional(),
  repeatTolerance: z.number().min(0).max(100).optional(),
}).passthrough();

export const createPlaylistGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).default(""),
  artworkUrl: z.string().trim().url().max(2048).nullable().optional(),
  artworkSource: z.enum(["url", "playlist", "collage", "default"]).nullable().optional(),
  settings: playlistGroupSettingsSchema.default({}),
  schedule: jsonRecord.nullable().optional(),
});

export const updatePlaylistGroupSchema = createPlaylistGroupSchema.partial().extend({
  isPaused: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(2_000_000_000).optional(),
});

export const membershipPatchSchema = z.object({
  playlistIds: z.array(z.string().uuid()).min(1).max(200),
});

export const membershipSettingsSchema = z.object({
  inheritsSettings: z.boolean().optional(),
  isPrimarySettingsGroup: z.boolean().optional(),
  inheritance: z.record(z.enum(["inherit", "override", "disabled"])).optional(),
});

export const reorderSchema = z.object({ playlistIds: z.array(z.string().uuid()).min(1).max(500) });

export const cloneGroupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  includeSettings: z.boolean().default(true),
  includeMemberships: z.boolean().default(true),
  includeArtwork: z.boolean().default(true),
  includeSchedule: z.boolean().default(false),
});

export const exclusionRuleSchema = z.object({
  ruleType: z.enum(["track", "artist", "album", "genre", "mood", "live", "remix", "instrumental", "explicit", "metadata-confidence", "library"]),
  ruleValue: z.string().trim().min(1).max(500),
  reason: z.string().trim().max(500).nullable().optional(),
  allowOverride: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
});
