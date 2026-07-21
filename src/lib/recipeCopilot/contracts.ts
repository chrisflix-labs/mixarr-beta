import { z } from "zod";
import { playlistRuleSchema } from "../playlistService";
import {
  recipeAutomationPolicySchema, recipeBpmFlowSchema, recipeDiscoverySchema,
  recipeIdentityDefaultsSchema, recipeRefreshPolicySchema, recipeScoringSchema,
  recipeTargetsSchema, recipeVarietySchema,
} from "../mixRecipes/schema";

export const RECIPE_COPILOT_FEATURE_KEY = "recipe_copilot";
export const RECIPE_COPILOT_SCHEMA_VERSION = "1.0";
export const RECIPE_COPILOT_PROMPT_VERSION = "recipe-copilot-1.0";

export const RECIPE_COPILOT_ACTIONS = [
  "create", "refine", "explain", "diagnose", "optimize", "compare_intent",
  "from_playlist", "suggest_names", "generate_description", "onboarding",
] as const;
export type RecipeCopilotAction = typeof RECIPE_COPILOT_ACTIONS[number];

export const AI_RECIPE_STATUSES = ["DRAFT", "NEEDS_REVIEW", "VALIDATED", "APPROVED", "REJECTED", "SUPERSEDED", "QUARANTINED"] as const;
export type AiRecipeStatus = typeof AI_RECIPE_STATUSES[number];
export const aiRecipeStatusSchema = z.enum(AI_RECIPE_STATUSES);

const text = (maximum = 1000) => z.string().trim().max(maximum);
const confidence = z.number().finite().transform((value) => Math.max(0, Math.min(1, value)));
const negativeFiltersPatchSchema = z.object({
  excludeHoliday: z.boolean().optional(), excludeLive: z.boolean().optional(), excludeRemasters: z.boolean().optional(),
  excludeExplicit: z.boolean().optional(), excludeIntroOutro: z.boolean().optional(), minRating: z.number().min(0).max(10).nullable().optional(),
  excludePlayedWithinDays: z.number().int().min(1).max(3650).nullable().optional(), minDurationMinutes: z.number().min(0).max(120).nullable().optional(),
  maxDurationMinutes: z.number().min(0).max(120).nullable().optional(),
}).strict();
const safetyRulesPatchSchema = z.object({
  avoidSameArtistBackToBack: z.boolean().optional(), limitTracksPerArtist: z.boolean().optional(), maxTracksPerArtist: z.number().int().min(1).max(5000).optional(),
  limitTracksPerAlbum: z.boolean().optional(), maxTracksPerAlbum: z.number().int().min(1).max(5000).optional(), warnIfFewerThan: z.boolean().optional(), minimumTrackCount: z.number().int().min(1).max(5000).optional(),
}).strict();

export const recipeCopilotPatchSchema = z.object({
  metadata: z.object({ name: text(120).min(1).optional(), description: text(1000).optional(), category: text(80).min(1).optional() }).strict().default({}),
  generation: z.object({ rules: z.array(playlistRuleSchema.strict()).max(25).optional(), limit: z.number().int().min(1).max(5000).optional(), negativeFilters: negativeFiltersPatchSchema.optional(), safetyRules: safetyRulesPatchSchema.optional(), duplicateStrategy: z.enum(["allow", "song_artist", "avoid_recordings", "allow_alternate_copies", "prefer_highest_quality", "prefer_existing_playlist_copy"]).optional(), preferNonLive: z.boolean().optional(), excludeRemasters: z.boolean().optional() }).strict().default({}),
  scoring: recipeScoringSchema.partial().strict().default({}),
  targets: recipeTargetsSchema.partial().strict().default({}),
  bpmFlow: recipeBpmFlowSchema.partial().strict().default({}),
  discovery: recipeDiscoverySchema.partial().strict().default({}),
  variety: recipeVarietySchema.partial().strict().default({}),
  playlistIdentity: recipeIdentityDefaultsSchema.partial().strict().default({}),
  refreshPolicy: recipeRefreshPolicySchema.partial().strict().default({}),
  automationPolicy: recipeAutomationPolicySchema.partial().strict().default({}),
}).strict();

const intentSchema = z.object({ summary: text(1200), primaryGoals: z.array(text(300)).max(20).default([]), secondaryGoals: z.array(text(300)).max(20).default([]), conflicts: z.array(z.object({ code: text(80), description: text(800), resolution: text(800), resolved: z.boolean() }).strict()).max(30).default([]) }).strict();
const analysisSchema = z.object({ confidence, assumptions: z.array(text(800)).max(50).default([]), warnings: z.array(text(800)).max(50).default([]), unsupportedRequests: z.array(text(800)).max(50).default([]), expectedBehavioralChanges: z.array(text(800)).max(50).default([]), compatibilityNotes: z.array(text(800)).max(50).default([]) }).strict();
const recommendationSchema = z.object({
  parentRecipes: z.array(z.object({ id: text(160), name: text(160), reason: text(800), inheritedRules: z.array(text(200)).max(30), childRules: z.array(text(200)).max(30), conflicts: z.array(text(500)).max(20), compatibilityRequirements: z.array(text(300)).max(20), maintenanceBenefit: text(600) }).strict()).max(10).default([]),
  inheritance: z.array(z.object({ path: text(240), reason: text(800) }).strict()).max(30).default([]),
  missingRules: z.array(z.object({ path: text(240), reason: text(800), suggestedValue: z.unknown().optional() }).strict()).max(30).default([]),
  saferSettings: z.array(z.object({ path: text(240), reason: text(800), suggestedValue: z.unknown().optional() }).strict()).max(30).default([]),
}).strict();
const changeRationaleSchema = z.object({ path: text(240), reason: text(800), expectedBehaviorChange: text(800), potentialSideEffects: z.array(text(500)).max(20).default([]), confidence }).strict();
const diagnosisSchema = z.object({ category: text(120), likelyCause: text(1000), affectedRules: z.array(text(240)).max(30), evidence: z.array(text(800)).max(30), confidence, suggestedCorrections: z.array(z.object({ path: text(240), suggestion: text(800), changesPurpose: z.boolean(), locallyValidatable: z.boolean() }).strict()).max(30) }).strict();

export const recipeCopilotResponseSchema = z.object({
  schemaVersion: z.literal(RECIPE_COPILOT_SCHEMA_VERSION),
  action: z.enum(RECIPE_COPILOT_ACTIONS),
  proposedPatch: recipeCopilotPatchSchema.nullable().default(null),
  intent: intentSchema,
  analysis: analysisSchema,
  recommendations: recommendationSchema,
  changeRationales: z.array(changeRationaleSchema).max(100).default([]),
  explanation: z.object({ summary: text(3000), detailed: z.array(z.object({ section: text(120), rules: z.array(text(240)).max(30), explanation: text(1800), surprises: z.array(text(500)).max(20) }).strict()).max(30) }).strict().nullable().default(null),
  diagnoses: z.array(diagnosisSchema).max(30).default([]),
  behaviorComparison: z.object({ matches: z.array(text(800)).max(30), partialMatches: z.array(text(800)).max(30), contradictions: z.array(text(800)).max(30), nonContributingRules: z.array(text(240)).max(30), missingRules: z.array(text(800)).max(30), misunderstoodEffects: z.array(text(800)).max(30), suggestedCorrections: z.array(text(800)).max(30), confidence }).strict().nullable().default(null),
  nameSuggestions: z.array(z.object({ name: text(120).min(1), rationale: text(500), style: text(80) }).strict()).max(10).default([]),
  onboarding: z.array(z.object({ title: text(160), guidance: text(1200) }).strict()).max(20).default([]),
}).strict();

export const recipeCopilotRequestSchema = z.object({
  action: z.enum(RECIPE_COPILOT_ACTIONS), instruction: text(6000).default(""), recipe: z.record(z.unknown()).optional(),
  purpose: text(1600).optional(), providerId: z.string().uuid().optional(), model: text(200).optional(),
  privacyMode: z.enum(["LOCAL_ONLY", "METADATA_LIMITED", "ANONYMOUS_METADATA", "FULL_METADATA"]).optional(),
  expectedUpdatedAt: z.string().datetime().optional(), playlistId: z.string().uuid().optional(),
}).strict();

export type RecipeCopilotResponse = z.infer<typeof recipeCopilotResponseSchema>;
export type RecipeCopilotPatch = z.infer<typeof recipeCopilotPatchSchema>;

