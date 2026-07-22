import { z } from "zod";

export const TROUBLESHOOTING_FEATURE_KEY = "troubleshooting_explanations";
export const DIAGNOSTIC_BUNDLE_VERSION = "1";
export const SANITIZATION_VERSION = "1.0";
export const DIAGNOSTIC_ENGINE_VERSION = "1.0";

export const PRIVACY_CATEGORIES = [
  "SANITIZED_LOGS", "RECIPE_CONFIGURATION", "PROVIDER_STATUS", "PLEX_STATUS",
  "LIBRARY_STATISTICS", "TRACK_METADATA", "INTEGRATION_CONFIGURATION", "RECENT_JOB_HISTORY",
] as const;
export type PrivacyCategory = typeof PRIVACY_CATEGORIES[number];

export const SESSION_STATUSES = [
  "DRAFT", "AWAITING_APPROVAL", "COLLECTING", "SANITIZING", "RUNNING_CHECKS",
  "READY_FOR_ANALYSIS", "REQUESTING_AI", "COMPLETE", "PARTIALLY_COMPLETE", "FAILED",
  "CANCELLED", "DELETED",
] as const;

export const SEVERITIES = ["INFORMATION", "WARNING", "ERROR", "CRITICAL"] as const;
export const EVIDENCE_STRENGTHS = ["CONFIRMED", "STRONG", "MODERATE", "WEAK", "INSUFFICIENT_DATA"] as const;
export const SUGGESTION_STATUSES = [
  "PROPOSED", "AWAITING_REVIEW", "ACCEPTED", "REJECTED", "DISMISSED", "APPLYING",
  "APPLIED", "APPLY_FAILED", "COMPLETED_MANUALLY", "NO_LONGER_APPLICABLE", "SUPERSEDED",
] as const;
export const ACTION_TYPES = [
  "RECIPE_SET_VALUE", "RECIPE_REDUCE_PLAYLIST_SIZE", "RECIPE_ENABLE_FALLBACK",
  "NAVIGATE_TO_PROVIDER_SETTINGS", "NAVIGATE_TO_PLEX_SETTINGS", "RETRY_EXISTING_JOB",
  "RUN_LIBRARY_SCAN", "MANUAL_STEP", "VIEW_DOCUMENTATION",
] as const;

export const createSessionSchema = z.object({
  problemCategory: z.string().trim().min(1).max(100),
  problemDescription: z.string().trim().max(4000).default(""),
  relatedResourceType: z.string().trim().max(80).optional(),
  relatedResourceId: z.string().trim().max(200).optional(),
  householdId: z.string().uuid().optional(),
  deterministicOnly: z.boolean().default(true),
  privacyCategories: z.array(z.enum(PRIVACY_CATEGORIES)).max(PRIVACY_CATEGORIES.length).default([]),
  timeWindowMinutes: z.number().int().min(15).max(1440).default(60),
}).strict();

export const updateSessionSchema = z.object({
  problemCategory: z.string().trim().min(1).max(100).optional(),
  problemDescription: z.string().trim().max(4000).optional(),
  privacyCategories: z.array(z.enum(PRIVACY_CATEGORIES)).max(PRIVACY_CATEGORIES.length).optional(),
  deterministicOnly: z.boolean().optional(),
  timeWindowMinutes: z.number().int().min(15).max(1440).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one change is required.");

export const suggestionDecisionSchema = z.object({ reason: z.string().trim().max(2000).optional() }).strict();
export const suggestionApplySchema = z.object({
  confirmation: z.literal("I approve this exact change."),
  expectedTargetVersion: z.string().trim().min(1).max(200),
}).strict();

export type DiagnosticFinding = {
  checkId: string;
  checkVersion: string;
  category: string;
  title: string;
  severity: typeof SEVERITIES[number];
  evidenceStrength: typeof EVIDENCE_STRENGTHS[number];
  summary: string;
  observedValues: Record<string, unknown>;
  expectedValues: Record<string, unknown>;
  evidence: Array<{ label: string; value: unknown; source?: string; observedAt?: string }>;
  affectedResources: Array<{ type: string; id: string; label?: string }>;
  possibleActions: string[];
  limitations: string[];
  dataFreshness?: string;
};

export type CandidateStage = {
  id: string;
  label: string;
  rejected: number;
  remaining: number;
};

export type CandidateFunnel = {
  totalScanned: number;
  requested: number;
  selected: number;
  eligible: number;
  unfilled: number;
  stages: CandidateStage[];
  overlap?: Record<string, number>;
};

export type DiagnosticBundle = {
  bundle_version: "1";
  generated_at: string;
  session: Record<string, unknown>;
  problem: Record<string, unknown>;
  system_summary: Record<string, unknown> | { availability: string };
  selected_privacy_categories: PrivacyCategory[];
  recipe_context: Record<string, unknown> | { availability: string };
  evaluation_context: Record<string, unknown> | { availability: string };
  provider_status: unknown[] | { availability: string };
  plex_status: Record<string, unknown> | { availability: string };
  library_statistics: Record<string, unknown> | { availability: string };
  track_metadata_summary: Record<string, unknown> | { availability: string };
  integration_status: unknown[] | { availability: string };
  recent_jobs: unknown[] | { availability: string };
  sanitized_logs: unknown[] | { availability: string };
  deterministic_findings: DiagnosticFinding[];
  redaction_summary: Record<string, number>;
  collection_warnings: string[];
};

const aiCauseSchema = z.object({
  interpretation: z.string().trim().min(1).max(2000),
  finding_ids: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  classification: z.enum(["LIKELY_INTERPRETATION", "POSSIBLE_CAUSE"]),
}).strict();

const aiActionSchema = z.object({
  title: z.string().trim().min(1).max(300),
  explanation: z.string().trim().min(1).max(2000),
  action_type: z.enum(ACTION_TYPES),
  finding_ids: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  target_resource_type: z.string().trim().max(80).nullable(),
  target_resource_id: z.string().trim().max(200).nullable(),
  setting_path: z.string().trim().max(300).nullable(),
  proposed_value: z.unknown().nullable(),
  expected_effect: z.string().trim().min(1).max(1000),
  possible_side_effects: z.array(z.string().trim().min(1).max(500)).max(10),
  risk_level: z.enum(["LOW", "MODERATE", "HIGH", "DESTRUCTIVE"]),
  reversible: z.boolean(),
  manual_only: z.boolean(),
}).strict();

export const aiTroubleshootingResponseSchema = z.object({
  summary: z.string().trim().min(1).max(4000),
  most_likely_causes: z.array(aiCauseSchema).max(20),
  how_the_findings_connect: z.string().trim().max(4000),
  suggested_actions: z.array(aiActionSchema).max(20),
  missing_information: z.array(z.string().trim().min(1).max(1000)).max(30),
  uncertainty_warnings: z.array(z.string().trim().min(1).max(1000)).max(30),
  technical_details: z.string().trim().max(6000),
}).strict();

export type AiTroubleshootingResponse = z.infer<typeof aiTroubleshootingResponseSchema>;

export const SAFE_DEFAULT_CATEGORIES: PrivacyCategory[] = [
  "PROVIDER_STATUS", "PLEX_STATUS", "LIBRARY_STATISTICS", "RECENT_JOB_HISTORY",
];

export const CATEGORY_DETAILS: Record<PrivacyCategory, { label: string; sensitivity: "LOW" | "MODERATE" | "HIGH"; defaultEnabled: boolean; description: string; excluded: string }> = {
  SANITIZED_LOGS: { label: "Sanitized logs", sensitivity: "MODERATE", defaultEnabled: false, description: "Relevant bounded errors and warnings from the selected time window.", excluded: "Credentials, unrelated events, identifiers, and repeated lines." },
  RECIPE_CONFIGURATION: { label: "Recipe configuration", sensitivity: "MODERATE", defaultEnabled: false, description: "The related recipe's filters and version information.", excluded: "Unrelated recipes and ownership data." },
  PROVIDER_STATUS: { label: "Provider status", sensitivity: "LOW", defaultEnabled: true, description: "Enabled state, health, latency, and sanitized failure category.", excluded: "API keys, secret headers, and credentials." },
  PLEX_STATUS: { label: "Plex connection status", sensitivity: "LOW", defaultEnabled: true, description: "Server availability and library access summaries.", excluded: "Plex tokens, server addresses, and machine identifiers." },
  LIBRARY_STATISTICS: { label: "Library statistics", sensitivity: "LOW", defaultEnabled: true, description: "Aggregate track and metadata completeness counts.", excluded: "Track names and library paths." },
  TRACK_METADATA: { label: "Track-level metadata", sensitivity: "HIGH", defaultEnabled: false, description: "A bounded sample relevant to candidate evaluation.", excluded: "Media paths, Plex keys, and metadata outside the selected resource." },
  INTEGRATION_CONFIGURATION: { label: "Integration configuration", sensitivity: "HIGH", defaultEnabled: false, description: "Enabled state and sanitized integration health.", excluded: "Tokens, URLs with credentials, webhook secrets, and payload bodies." },
  RECENT_JOB_HISTORY: { label: "Recent job history", sensitivity: "LOW", defaultEnabled: true, description: "Recent bounded job outcomes and durations.", excluded: "Unrelated users' jobs and raw secret-bearing metadata." },
};
