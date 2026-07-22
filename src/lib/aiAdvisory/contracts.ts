import { z } from "zod";

export const PLAYLIST_SUMMARY_FEATURE_KEY = "playlist_ai_summaries";
export const METADATA_SUGGESTION_FEATURE_KEY = "metadata_suggestions";
export const PLAYLIST_ANALYSIS_SCHEMA_VERSION = "1.0";
export const PLAYLIST_SUMMARY_PROMPT_VERSION = "playlist-summary-1.0";
export const METADATA_SUGGESTION_PROMPT_VERSION = "metadata-suggestion-1.0";

export const SUMMARY_TYPES = [
  "ONE_SENTENCE", "DETAILED_DESCRIPTION", "MOOD", "GENRE", "ERA", "ENERGY_PROGRESSION",
  "BPM_PROGRESSION", "DISCOVERY", "FAMILIARITY", "PLAYLIST_CHANGE", "REFRESH",
  "WHY_THIS_PLAYLIST_EXISTS", "PLEX_FRIENDLY", "HOUSEHOLD_SHAREABLE",
] as const;
export type SummaryType = typeof SUMMARY_TYPES[number];

export const METADATA_SUGGESTION_STATUSES = [
  "PENDING", "APPROVED", "REJECTED", "IGNORED", "SUPERSEDED", "CONFLICT", "ARCHIVED",
] as const;
export type MetadataSuggestionStatus = typeof METADATA_SUGGESTION_STATUSES[number];

export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW", "CONFLICTING_SOURCES"] as const;
export const IGNORE_SCOPES = [
  "EXACT_SUGGESTION", "SUGGESTION_TYPE", "METADATA_FIELD", "ARTIST", "ALBUM",
  "EXISTING_VALUE", "SUGGESTED_VALUE", "VALUE_PAIR", "SOURCE_CONFLICT_PATTERN",
] as const;

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);

export const generateSummaryRequestSchema = z.object({
  summaryTypes: z.array(z.enum(SUMMARY_TYPES)).min(1).max(SUMMARY_TYPES.length),
  privacyMode: z.enum(["LOCAL_ONLY", "METADATA_LIMITED", "ANONYMOUS_METADATA", "FULL_METADATA"]).optional(),
  providerId: z.string().uuid().optional(),
  model: boundedText(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  previewAcknowledged: z.boolean().optional(),
}).strict();

export const summaryProviderResponseSchema = z.object({
  schemaVersion: z.literal("1.0"),
  summaries: z.array(z.object({
    type: z.enum(SUMMARY_TYPES),
    text: boundedText(6000),
    usedFacts: z.array(boundedText(80)).max(40).default([]),
    unavailableFacts: z.array(boundedText(80)).max(40).default([]),
  }).strict()).min(1).max(SUMMARY_TYPES.length),
}).strict();

export const updateSummarySchema = z.object({
  generatedText: z.string().trim().min(1).max(6000).optional(),
  preferred: z.boolean().optional(),
  archived: z.boolean().optional(),
  saveAsPlaylistNotes: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one summary change is required.");

export const metadataScanRequestSchema = z.object({
  libraryId: z.string().uuid().optional(),
  privacyMode: z.enum(["LOCAL_ONLY", "METADATA_LIMITED", "ANONYMOUS_METADATA", "FULL_METADATA"]).optional(),
  providerId: z.string().uuid().optional(),
  model: boundedText(200).optional(),
  useAi: z.boolean().default(true),
  batchSize: z.number().int().min(1).max(100).optional(),
}).strict();

export const aiMetadataCandidateResponseSchema = z.object({
  schemaVersion: z.literal("1.0"),
  suggestions: z.array(z.object({
    candidateId: z.string().uuid(),
    suggestedValue: z.string().trim().max(1000).nullable(),
    reason: boundedText(1500),
    confidenceScore: z.number().finite().min(0).max(1),
    confidenceLevel: z.enum(CONFIDENCE_LEVELS),
    sourceSupport: z.array(z.object({ sourceType: boundedText(80), supports: z.boolean(), value: z.unknown().optional() }).strict()).max(20),
    advisoryOnly: z.literal(true),
  }).strict()).max(100),
}).strict();

export const reviewRequestSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "IGNORE", "ARCHIVE", "RESTORE"]),
  notes: z.string().trim().max(2000).optional(),
  confirmation: z.literal("I understand this records a recommendation only and does not modify metadata.").optional(),
}).strict();

export const bulkReviewRequestSchema = reviewRequestSchema.extend({
  suggestionIds: z.array(z.string().uuid()).min(1).max(5000),
}).strict();

export const createIgnoreRuleSchema = z.object({
  scope: z.enum(IGNORE_SCOPES),
  description: boundedText(500),
  match: z.record(z.union([z.string().max(1000), z.boolean(), z.number().finite(), z.null()])),
}).strict();

export const updateIgnoreRuleSchema = z.object({ enabled: z.boolean() }).strict();

export const advisorySettingsSchema = z.object({
  playlistSummariesEnabled: z.boolean(), metadataSuggestionsEnabled: z.boolean(),
  defaultSummaryTypes: z.array(z.enum(SUMMARY_TYPES)).min(1).max(SUMMARY_TYPES.length),
  automaticRefreshSummaries: z.boolean(), plexDescriptionMaxLength: z.number().int().min(100).max(5000),
  metadataAnalysisBatchSize: z.number().int().min(1).max(100), minimumConfidenceToDisplay: z.number().min(0).max(1),
  retainSummaryHistory: z.boolean(), retainRejectedSuggestions: z.boolean(), deterministicChecksEnabled: z.boolean(),
  aiAssistedChecksEnabled: z.boolean(), allowFullTrackMetadata: z.boolean(),
}).strict();

export const exportRequestSchema = z.object({
  format: z.enum(["CSV", "JSON"]),
  suggestionIds: z.array(z.string().uuid()).max(10000).optional(),
  filters: z.record(z.string().max(500)).optional(),
}).strict();
