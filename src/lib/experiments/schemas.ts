import { z } from "zod";

export const experimentTypeSchema = z.enum(["SCORING_CONFIGURATION", "PERSONALIZED_VS_BASE", "DISCOVERY_LEVEL", "BPM_TRANSITION", "MOOD_BLEND", "ARTIST_VARIETY", "CUSTOM"]);
export const publicationModeSchema = z.enum(["PREVIEW_ONLY", "SEPARATE_PLEX_PLAYLISTS", "ALTERNATING_ACTIVE"]);
export const durationTypeSchema = z.enum(["DAYS", "SESSIONS", "COMPLETED_PLAYS", "INTERACTIONS", "MANUAL", "NONE"]);
export const variantSchema = z.enum(["A", "B"]);

export const createExperimentSchema = z.object({
  sourcePlaylistId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  hypothesis: z.string().trim().max(1000).optional().nullable(),
  experimentType: experimentTypeSchema,
  publicationMode: publicationModeSchema.default("PREVIEW_ONLY"),
  durationType: durationTypeSchema.default("DAYS"),
  durationTarget: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  alternatingIntervalHours: z.coerce.number().int().min(1).max(168).default(24),
  configurationA: z.record(z.unknown()),
  configurationB: z.record(z.unknown()),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export const updateExperimentSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  hypothesis: z.string().trim().max(1000).nullable().optional(),
  publicationMode: publicationModeSchema.optional(),
  durationType: durationTypeSchema.optional(),
  durationTarget: z.coerce.number().int().min(1).max(3650).nullable().optional(),
}).strict();

export const experimentFeedbackSchema = z.object({
  variant: variantSchema,
  trackId: z.string().uuid(),
  action: z.enum(["KEEP", "REMOVE", "REPLACE", "LIKE", "DISLIKE", "NEVER_RECOMMEND", "GOOD_FIT", "POOR_TRANSITION", "CLEAR"]),
  idempotencyKey: z.string().trim().min(8).max(160).optional(),
});

export const winnerDecisionSchema = z.object({
  decision: z.enum(["SELECT_A", "SELECT_B", "NO_WINNER", "CONTINUE", "INCONCLUSIVE", "KEEP_BOTH"]),
  confirm: z.boolean().default(false),
  applyToSource: z.boolean().default(false),
  explanation: z.string().trim().max(1000).optional(),
});

export const mergeSettingsSchema = z.object({
  selections: z.record(variantSchema),
  confirm: z.boolean().default(false),
  applyToSource: z.boolean().default(false),
  explanation: z.string().trim().max(1000).optional(),
});

export const restoreExperimentSchema = z.object({ confirm: z.literal(true) });
export const deleteExperimentSchema = z.object({ confirm: z.literal(true), deletePlexPlaylists: z.boolean().default(false) });

export const experimentSettingsSchema = z.object({
  enabled: z.boolean(), defaultDurationType: durationTypeSchema, defaultDurationTarget: z.coerce.number().int().min(1).max(3650),
  defaultPublicationMode: publicationModeSchema, minimumPlaybackSessions: z.coerce.number().int().min(0).max(1000),
  minimumTrackInteractions: z.coerce.number().int().min(0).max(100000), minimumDurationHours: z.coerce.number().int().min(0).max(8760),
  minimumResultDifference: z.coerce.number().min(0).max(100), minimumConfidence: z.enum(["VERY_LOW", "LOW", "MODERATE", "HIGH"]),
  allowPlaybackMetrics: z.boolean(), automaticallyEvaluate: z.boolean(), automaticallyPauseMissingPlaylists: z.boolean(),
  historyRetentionDays: z.coerce.number().int().min(1).max(3650).nullable(), showAdvancedControls: z.boolean(),
  allowMultiVariableExperiments: z.boolean(), notificationsEnabled: z.boolean(),
});
