import { z } from "zod";
import { playlistRuleSchema } from "../playlistService";
import { structuredIntentSchema } from "../intentIntelligence/contracts";

export const NATURAL_LANGUAGE_FEATURE_KEY = "natural_language_playlist_requests";
export const NATURAL_LANGUAGE_REQUEST_STATUSES = [
  "DRAFT", "ANALYZING", "NEEDS_REVIEW", "NEEDS_CLARIFICATION", "READY_FOR_APPROVAL",
  "APPROVED", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED",
] as const;

export const naturalLanguageStatusSchema = z.enum(NATURAL_LANGUAGE_REQUEST_STATUSES);
export const confidenceSchema = z.number().finite().transform((value) => Math.max(0, Math.min(1, value)));
export const confidenceLabel = (value: number) => value >= 0.8 ? "High" : value >= 0.5 ? "Medium" : "Low";

const supportedField = z.enum([
  "durationMinutes", "trackCount", "genres", "excludedGenres", "releaseYears", "includedArtists",
  "excludedArtists", "includedAlbums", "excludedAlbums", "library", "sourcePlaylist", "mood", "activity",
  "minimumEnergy", "maximumEnergy", "energyProgression", "instrumentalPreference", "vocalPreference",
  "acousticPreference", "familySuitability", "minimumBpm", "maximumBpm", "startingBpm", "endingBpm",
  "bpmProgression", "artistSpacing", "albumSpacing", "discoveryLevel", "familiarityBalance",
  "recentlyPlayedExclusionDays", "explicitContent", "refreshBehavior", "automation", "similarityStrength",
]);

export const interpretedConstraintSchema = z.object({
  id: z.string().trim().min(1).max(80),
  field: supportedField,
  value: z.unknown().optional(),
  originalWording: z.string().trim().min(1).max(500),
  explanation: z.string().trim().min(1).max(800),
  confidence: confidenceSchema,
}).strict();

export const interpretationAssumptionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  field: supportedField,
  proposedValue: z.unknown(),
  originalPhrase: z.string().trim().max(500).optional().nullable(),
  explanation: z.string().trim().min(1).max(800),
  confidence: confidenceSchema,
  blocking: z.boolean().default(false),
  accepted: z.boolean().default(false),
}).strict();

export const interpretationAmbiguitySchema = z.object({
  id: z.string().trim().min(1).max(80),
  originalPhrase: z.string().trim().min(1).max(500),
  proposedInterpretation: z.string().trim().min(1).max(800),
  reason: z.string().trim().min(1).max(800),
  alternatives: z.array(z.object({ id: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(300), value: z.unknown() }).strict()).max(10).default([]),
  affectedFields: z.array(supportedField).min(1).max(12),
  confidence: confidenceSchema,
  requiresConfirmation: z.boolean(),
  resolution: z.object({ action: z.enum(["accept", "alternative", "custom", "remove"]), value: z.unknown().optional() }).strict().optional().nullable(),
}).strict();

const percent = z.number().min(0).max(100);
const unit = z.number().min(0).max(1);
const recipePatchSchema = z.object({
  metadata: z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().trim().max(1000).optional(), category: z.string().trim().min(1).max(80).optional() }).strict().default({}),
  generation: z.object({
    limit: z.number().int().min(1).max(5000).optional(),
    rules: z.array(playlistRuleSchema).max(25).optional(),
    negativeFilters: z.object({ excludeHoliday: z.boolean().optional(), excludeLive: z.boolean().optional(), excludeRemasters: z.boolean().optional(), excludeExplicit: z.boolean().optional(), excludeIntroOutro: z.boolean().optional(), minRating: z.number().min(0).max(10).nullable().optional(), excludePlayedWithinDays: z.number().int().min(1).max(3650).nullable().optional() }).strict().optional(),
    engineVersion: z.literal("v2").optional(), moodBlendMode: z.enum(["off", "smooth_transition", "strict_matching", "mixed_mood"]).optional(), selectedMoodPath: z.array(z.string().max(40)).max(12).optional(), allowedMoods: z.array(z.string().max(40)).max(12).optional(), transitionSmoothness: percent.optional(),
    intentOrdering: z.object({ schemaVersion: z.literal(1), phases: z.array(z.object({ id: z.string(), label: z.string(), targetShare: unit }).strict()).max(6), energyCurve: z.unknown().nullable(), bpmCurve: z.unknown().nullable(), smoothTransitions: z.boolean() }).strict().optional(),
  }).strict().default({}),
  targets: z.object({ selectedMoods: z.array(z.string().trim().min(1).max(120)).max(50).optional(), primaryMood: z.string().trim().max(80).nullable().optional(), secondaryMoods: z.array(z.string().max(120)).max(50).optional(), moodBlendMode: z.enum(["off", "smooth_transition", "strict_matching", "mixed_mood"]).optional(), moodTransition: z.enum(["none", "smooth", "sectioned"]).optional(), moodCurve: z.array(z.object({ start: percent, end: percent, mood: z.string() }).strict()).max(12).optional(), minimumEnergy: unit.nullable().optional(), maximumEnergy: unit.nullable().optional(), targetEnergy: unit.nullable().optional(), energyProgression: z.enum(["steady", "rising", "falling", "wave", "mixed"]).optional() }).strict().default({}),
  bpmFlow: z.object({ minimumBpm: z.number().min(30).max(300).nullable().optional(), maximumBpm: z.number().min(30).max(300).nullable().optional(), targetBpm: z.number().min(30).max(300).nullable().optional(), mode: z.enum(["RAMP_UP", "RAMP_DOWN", "STEADY", "NATURAL", "CUSTOM", "DISABLED"]).optional(), sections: z.array(z.object({ start: percent, end: percent, targetBpm: z.number().min(30).max(300) }).strict()).max(12).optional(), maximumBpmGap: z.number().min(1).max(80).optional() }).strict().default({}),
  discovery: z.object({ level: z.enum(["low", "medium", "high", "custom"]).optional(), deepCutPercentage: percent.optional(), familiarityBalance: percent.optional(), avoidOverplayedTracks: z.boolean().optional(), favorUnderplayedPlexTracks: z.boolean().optional(), recentlyAddedPreference: percent.optional() }).strict().default({}),
  variety: z.object({ maximumTracksPerArtist: z.number().int().min(1).max(5000).optional(), minimumArtistSpacing: z.number().int().min(0).max(5000).optional(), maximumTracksPerAlbum: z.number().int().min(1).max(5000).optional(), minimumAlbumSpacing: z.number().int().min(0).max(5000).optional(), recentlyPlayedExclusionDays: z.number().int().min(0).max(3650).optional() }).strict().default({}),
  refreshPolicy: z.object({ mode: z.enum(["manual", "scheduled"]).optional(), frequencyDays: z.number().int().min(1).max(3650).nullable().optional() }).strict().default({}),
}).strict();

export const naturalLanguageInterpretationSchema = z.object({
  detectedLanguage: z.string().trim().min(2).max(20),
  intent: z.enum(["create_playlist", "revise_playlist", "similar_playlist"]),
  summary: z.string().trim().min(1).max(1200),
  confidence: z.object({ overall: confidenceSchema }).catchall(confidenceSchema),
  explicitConstraints: z.array(interpretedConstraintSchema).max(100).default([]),
  inferredConstraints: z.array(interpretedConstraintSchema).max(100).default([]),
  assumptions: z.array(interpretationAssumptionSchema).max(50).default([]),
  ambiguities: z.array(interpretationAmbiguitySchema).max(50).default([]),
  unresolvedEntities: z.array(z.object({ id: z.string().trim().min(1).max(80), type: z.enum(["library", "playlist", "recipe", "artist", "album", "genre"]), query: z.string().trim().min(1).max(200), confidence: confidenceSchema }).strict()).max(50).default([]),
  unsupportedRequests: z.array(z.object({ originalWording: z.string().trim().min(1).max(500), explanation: z.string().trim().min(1).max(800) }).strict()).max(50).default([]),
  recipePatch: recipePatchSchema,
  warnings: z.array(z.string().trim().min(1).max(800)).max(50).default([]),
  structuredIntent: structuredIntentSchema.optional(),
  interpretationSource: z.enum(["LOCAL_RULES", "LOCAL_DICTIONARY", "LOCAL_RULES_WITH_PROVIDER", "AI_PROVIDER_FALLBACK_REJECTED"]).optional(),
}).strict();

export const createNaturalLanguageRequestSchema = z.object({
  request: z.string().trim().min(3).max(10_000),
  privacyMode: z.enum(["LOCAL_ONLY", "METADATA_LIMITED", "ANONYMOUS_METADATA", "FULL_METADATA"]).optional(),
  retainOriginalRequest: z.boolean().default(true),
}).strict();

export const revisionRequestSchema = z.object({ revision: z.string().trim().min(2).max(5000) }).strict();
export const ambiguityResolutionSchema = z.object({ action: z.enum(["accept", "alternative", "custom", "remove"]), alternativeId: z.string().trim().max(80).optional(), value: z.unknown().optional() }).strict();

export type NaturalLanguageInterpretation = z.infer<typeof naturalLanguageInterpretationSchema>;
