import { z } from "zod";

export const INTENT_SCHEMA_VERSION = 1 as const;
export const INTENT_CATEGORIES = [
  "relaxing", "focus", "coding", "reading", "studying", "workout", "running", "driving",
  "party", "dinner", "sleep", "morning", "late_night", "background_listening", "nostalgic",
  "romantic", "energetic", "melancholic", "aggressive", "cinematic",
] as const;
export const intentCategorySchema = z.enum(INTENT_CATEGORIES);
export type IntentCategory = z.infer<typeof intentCategorySchema>;

const unit = z.number().finite().min(0).max(1);
const confidence = unit;
const nullableBpm = z.number().finite().min(30).max(300).nullable();

export const categoryIntentSchema = z.object({
  name: intentCategorySchema,
  weight: unit,
  confidence,
  sourcePhrase: z.string().trim().min(1).max(300),
  source: z.enum(["BUILT_IN", "PERSONAL_DICTIONARY", "HOUSEHOLD_DICTIONARY", "ADMIN_DICTIONARY", "SAVED_PRESET", "DETERMINISTIC_PARSER", "AI_PROVIDER"]),
}).strict();

export const rangeTargetSchema = z.object({
  minimum: unit.nullable().default(null),
  maximum: unit.nullable().default(null),
  preferred: unit.nullable().default(null),
  label: z.string().trim().max(80).nullable().default(null),
  tolerance: unit.optional(),
}).strict().superRefine((value, context) => {
  if (value.minimum != null && value.maximum != null && value.minimum > value.maximum) context.addIssue({ code: z.ZodIssueCode.custom, message: "Minimum cannot exceed maximum." });
});

export const tempoTargetSchema = z.object({
  minimumBpm: nullableBpm.default(null),
  maximumBpm: nullableBpm.default(null),
  preferredBpm: nullableBpm.default(null),
  label: z.string().trim().max(80).nullable().default(null),
  toleranceBpm: z.number().finite().min(0).max(80).optional(),
}).strict().superRefine((value, context) => {
  if (value.minimumBpm != null && value.maximumBpm != null && value.minimumBpm > value.maximumBpm) context.addIssue({ code: z.ZodIssueCode.custom, message: "Minimum BPM cannot exceed maximum BPM." });
});

export const intentPhaseSchema = z.object({
  id: z.string().trim().min(1).max(80),
  position: z.number().int().min(1).max(6),
  label: z.string().trim().min(1).max(100),
  targetShare: unit,
  categories: z.array(intentCategorySchema).max(10).default([]),
  energy: rangeTargetSchema.optional().nullable(),
  valence: rangeTargetSchema.optional().nullable(),
  tempo: tempoTargetSchema.optional().nullable(),
  vocalMode: z.enum(["ANY", "INSTRUMENTAL", "VOCAL", "MINIMAL_VOCALS"]).default("ANY"),
  transition: z.enum(["SMOOTH", "GRADUAL", "DISTINCT", "ABRUPT_ALLOWED"]).default("SMOOTH"),
  confidence,
  sourcePhrase: z.string().trim().max(500).nullable().default(null),
}).strict();

export const preferenceStrengthSchema = z.enum(["REQUIRED", "PREFERRED", "NEUTRAL", "DISCOURAGED", "EXCLUDED"]);
export const preferenceTypeSchema = z.enum(["CATEGORY", "GENRE", "ARTIST", "DECADE", "FAMILIARITY", "RATING", "INSTRUMENTAL", "VOCALS", "EXPLICIT", "LIVE", "HOLIDAY", "MEDIA_TYPE", "ENERGY", "VALENCE", "BPM", "TRANSITION", "REPETITION"]);
export const intentPreferenceSchema = z.object({
  id: z.string().trim().min(1).max(80),
  target: z.string().trim().min(1).max(200),
  type: preferenceTypeSchema,
  strength: preferenceStrengthSchema,
  confidence,
  classificationConfidence: confidence,
  sourcePhrase: z.string().trim().min(1).max(500),
  scope: z.object({ phaseId: z.string().trim().min(1).max(80).nullable().default(null) }).strict(),
  deterministicMapping: z.object({ kind: z.enum(["FILTER", "EXCLUSION", "BONUS", "PENALTY", "ORDERING", "UNAVAILABLE"]), field: z.string().trim().min(1).max(80), value: z.unknown().optional() }).strict(),
  userEdited: z.boolean().default(false),
}).strict();

export const intentConflictSchema = z.object({
  id: z.string().trim().min(1).max(80),
  type: z.enum(["HARD_CONFLICT", "SOFT_TENSION", "INSUFFICIENT_LIBRARY", "UNAVAILABLE_METADATA"]),
  itemIds: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
  explanation: z.string().trim().min(1).max(800),
  suggestion: z.string().trim().min(1).max(800),
  resolution: z.object({ winnerId: z.string().trim().max(80).nullable(), action: z.enum(["KEEP", "SOFTEN", "REMOVE", "CUSTOM"]), note: z.string().trim().max(500).nullable() }).strict().nullable().default(null),
}).strict();

export const intentCurveSchema = z.object({
  shape: z.enum(["FLAT", "RISING", "FALLING", "RISE_AND_FALL", "FALL_AND_RISE", "MIDDLE_PEAK", "FINAL_PEAK", "STEPPED", "WAVE", "CUSTOM_MULTI_PHASE"]),
  points: z.array(z.object({ position: unit, value: z.number().finite() }).strict()).min(2).max(24),
  tolerance: z.number().finite().min(0).max(80),
  hard: z.boolean().default(false),
  confidence,
}).strict();

export const structuredIntentSchema = z.object({
  schemaVersion: z.literal(INTENT_SCHEMA_VERSION),
  sourceText: z.string().max(10_000),
  summary: z.string().trim().min(1).max(1200),
  categories: z.array(categoryIntentSchema).max(30).default([]),
  phases: z.array(intentPhaseSchema).max(6).default([]),
  positivePreferences: z.array(intentPreferenceSchema).max(50).default([]),
  negativePreferences: z.array(intentPreferenceSchema).max(50).default([]),
  hardRequirements: z.array(intentPreferenceSchema).max(50).default([]),
  softPreferences: z.array(intentPreferenceSchema).max(50).default([]),
  energyCurve: intentCurveSchema.nullable().default(null),
  bpmCurve: intentCurveSchema.nullable().default(null),
  conflicts: z.array(intentConflictSchema).max(30).default([]),
  warnings: z.array(z.string().trim().min(1).max(800)).max(50).default([]),
  overallConfidence: confidence,
  phaseBoundaryConfidence: confidence,
  requiresReview: z.boolean(),
  interpretationSource: z.enum(["LOCAL_RULES", "LOCAL_DICTIONARY", "LOCAL_RULES_WITH_PROVIDER", "AI_PROVIDER_FALLBACK_REJECTED"]),
  matchedPhrases: z.array(z.object({ phrase: z.string().trim().min(1).max(300), normalizedPhrase: z.string().trim().min(1).max(300), source: z.string().trim().min(1).max(80), confidence }).strict()).max(100).default([]),
}).strict().superRefine((value, context) => {
  if (value.phases.length > 1) {
    const total = value.phases.reduce((sum, phase) => sum + phase.targetShare, 0);
    if (Math.abs(total - 1) > 0.001) context.addIssue({ code: z.ZodIssueCode.custom, path: ["phases"], message: "Phase percentages must total 100%." });
    const positions = value.phases.map((phase) => phase.position);
    if (new Set(positions).size !== positions.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["phases"], message: "Phase positions must be unique." });
  }
});

export const dictionaryDefinitionSchema = z.object({
  categories: z.array(intentCategorySchema).max(12).default([]),
  positivePreferences: z.array(intentPreferenceSchema).max(25).default([]),
  negativePreferences: z.array(intentPreferenceSchema).max(25).default([]),
  hardRequirements: z.array(intentPreferenceSchema).max(25).default([]),
  softPreferences: z.array(intentPreferenceSchema).max(25).default([]),
  energyTarget: rangeTargetSchema.optional().nullable(),
  valenceTarget: rangeTargetSchema.optional().nullable(),
  tempoTarget: tempoTargetSchema.optional().nullable(),
  energyCurve: intentCurveSchema.optional().nullable(),
  bpmCurve: intentCurveSchema.optional().nullable(),
  phases: z.array(intentPhaseSchema).max(6).default([]),
}).strict();

export const interpretIntentRequestSchema = z.object({
  text: z.string().trim().min(3).max(10_000),
  privacyMode: z.enum(["LOCAL_ONLY", "METADATA_LIMITED", "ANONYMOUS_METADATA", "FULL_METADATA"]).default("LOCAL_ONLY"),
  providerAssistance: z.boolean().default(false),
  retainSourceText: z.boolean().default(true),
  persist: z.boolean().default(true),
}).strict();

export const dictionaryEntryInputSchema = z.object({
  phrase: z.string().trim().min(2).max(200),
  aliases: z.array(z.string().trim().min(2).max(200)).max(20).default([]),
  description: z.string().trim().max(1000).nullable().default(null),
  definition: dictionaryDefinitionSchema,
  visibility: z.enum(["PERSONAL", "HOUSEHOLD", "ADMIN"]).default("PERSONAL"),
  householdId: z.string().uuid().nullable().default(null),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(100),
  updatedAt: z.string().datetime().optional(),
}).strict();

export const intentPresetInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().default(null),
  intent: structuredIntentSchema,
  visibility: z.enum(["PERSONAL", "HOUSEHOLD"]).default("PERSONAL"),
  householdId: z.string().uuid().nullable().default(null),
  enabled: z.boolean().default(true),
  updatedAt: z.string().datetime().optional(),
}).strict();

export const intentSettingsInputSchema = z.object({
  enabled: z.boolean(), localEnabled: z.boolean(), providerAssistanceEnabled: z.boolean(), defaultProviderId: z.string().uuid().nullable(),
  automaticSoftPreferenceMinimum: unit, inferredHardRequirementMinimum: unit, maximumPhases: z.number().int().min(2).max(6),
  defaultEnergyTolerance: z.number().min(0.02).max(0.5), defaultBpmTolerance: z.number().min(1).max(80),
  coverageEstimationEnabled: z.boolean(), reviewRequired: z.boolean(), personalDictionariesEnabled: z.boolean(), householdDictionariesEnabled: z.boolean(), presetsEnabled: z.boolean(),
  retainSourceText: z.boolean(), retentionDays: z.number().int().min(1).max(3650), auditDetailLevel: z.enum(["MINIMAL", "SUMMARY", "DETAILED"]),
}).strict();

export type StructuredIntent = z.infer<typeof structuredIntentSchema>;
export type IntentPreference = z.infer<typeof intentPreferenceSchema>;
export type IntentPhase = z.infer<typeof intentPhaseSchema>;
export type DictionaryDefinition = z.infer<typeof dictionaryDefinitionSchema>;
