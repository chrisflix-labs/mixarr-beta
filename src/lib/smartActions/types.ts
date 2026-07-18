import { z } from "zod";

export const SMART_ACTION_TYPES = [
  "TRACK_ADDITION",
  "TRACK_REMOVAL",
  "PLAYLIST_OVERLAP_FIX",
  "METADATA_CORRECTION",
  "PLAYLIST_REFRESH",
  "IDENTITY_DRIFT",
  "TRANSITION_FIX",
  "COVERAGE_OPPORTUNITY",
] as const;
export type SmartActionType = typeof SMART_ACTION_TYPES[number];

export const SMART_ACTION_STATUSES = [
  "PENDING", "APPROVED", "REJECTED", "SNOOZED", "SCHEDULED", "RUNNING",
  "COMPLETED", "FAILED", "EXPIRED", "CANCELED", "SUPERSEDED",
] as const;
export type SmartActionStatus = typeof SMART_ACTION_STATUSES[number];
export type SmartActionConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type SmartActionRiskLevel = "LOW" | "MODERATE" | "HIGH";

const resourceVersion = z.object({
  expectedPlaylistUpdatedAt: z.string().datetime().optional(),
  expectedPlaylistRevision: z.number().int().nonnegative().optional(),
}).strict();

const trackAdditionPayload = resourceVersion.extend({
  type: z.literal("TRACK_ADDITION"),
  trackId: z.string().min(1),
  position: z.number().int().positive().optional(),
  sourceMatchId: z.string().optional(),
}).strict();
const trackRemovalPayload = resourceVersion.extend({
  type: z.literal("TRACK_REMOVAL"),
  trackId: z.string().min(1),
  replacementTrackId: z.string().min(1).optional(),
}).strict();
const overlapPayload = resourceVersion.extend({
  type: z.literal("PLAYLIST_OVERLAP_FIX"),
  comparisonPlaylistId: z.string().min(1),
  removeTrackIds: z.array(z.string().min(1)).max(250),
  addTrackIds: z.array(z.string().min(1)).max(250),
}).strict();
const metadataPayload = z.object({
  type: z.literal("METADATA_CORRECTION"),
  trackId: z.string().min(1),
  field: z.enum(["bpm", "mood", "energy"]),
  currentValue: z.union([z.number(), z.string(), z.array(z.string()), z.null()]),
  suggestedValue: z.union([z.number(), z.string(), z.array(z.string())]),
  source: z.string().min(1).max(80),
}).strict();
const smartRefreshPayload = resourceVersion.extend({
  type: z.literal("PLAYLIST_REFRESH"),
  evaluationId: z.string().min(1),
  previewId: z.string().min(1),
  mode: z.enum(["WEAK_TRACKS", "AFFECTED_SECTIONS", "FULL", "RESCORE"]),
}).strict();
const identityPayload = resourceVersion.extend({
  type: z.literal("IDENTITY_DRIFT"),
  proposedTrackIds: z.array(z.string().min(1)).max(2_000),
  driftScore: z.number().min(0).max(100),
}).strict();
const transitionPayload = resourceVersion.extend({
  type: z.literal("TRANSITION_FIX"),
  orderedTrackIds: z.array(z.string().min(1)).min(1).max(2_000),
  affectedPositions: z.array(z.number().int().positive()).max(250),
}).strict();
const coveragePayload = resourceVersion.extend({
  type: z.literal("COVERAGE_OPPORTUNITY"),
  trackIds: z.array(z.string().min(1)).min(1).max(250),
  position: z.enum(["START", "END"]).default("END"),
}).strict();

export const smartActionPayloadSchema = z.discriminatedUnion("type", [
  trackAdditionPayload, trackRemovalPayload, overlapPayload, metadataPayload,
  smartRefreshPayload, identityPayload, transitionPayload, coveragePayload,
]);
export type SmartActionPayload = z.infer<typeof smartActionPayloadSchema>;

export const smartActionPreviewSchema = z.object({
  before: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  after: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  added: z.array(z.object({ id: z.string(), title: z.string(), artist: z.string().nullable().optional(), reason: z.string().optional() }).strict()).max(250).default([]),
  removed: z.array(z.object({ id: z.string(), title: z.string(), artist: z.string().nullable().optional(), reason: z.string().optional() }).strict()).max(250).default([]),
  reordered: z.array(z.object({ id: z.string(), title: z.string(), from: z.number().int(), to: z.number().int() }).strict()).max(250).default([]),
  unchanged: z.array(z.string()).max(30).default([]),
  warnings: z.array(z.string()).max(30).default([]),
}).strict();
export type SmartActionPreview = z.infer<typeof smartActionPreviewSchema>;

export const expectedImpactSchema = z.object({
  playlistScoreBefore: z.number().nullable().optional(),
  playlistScoreAfter: z.number().nullable().optional(),
  transitionScoreBefore: z.number().nullable().optional(),
  transitionScoreAfter: z.number().nullable().optional(),
  identityMatchBefore: z.number().nullable().optional(),
  identityMatchAfter: z.number().nullable().optional(),
  libraryCoverageChange: z.number().nullable().optional(),
  artistVarietyChange: z.number().nullable().optional(),
  tracksAdded: z.number().int().nonnegative().default(0),
  tracksRemoved: z.number().int().nonnegative().default(0),
  tracksReordered: z.number().int().nonnegative().default(0),
  playlistsAffected: z.number().int().nonnegative().default(0),
  protectedTracksChanged: z.literal(0).default(0),
  estimateNote: z.string().default("Estimated outcome; actual results can vary after revalidation."),
}).strict();
export type SmartActionExpectedImpact = z.infer<typeof expectedImpactSchema>;

export type SmartActionCandidate = {
  userId: string;
  libraryId?: string | null;
  playlistId?: string | null;
  actionType: SmartActionType;
  title: string;
  summary: string;
  explanation: string;
  confidenceScore: number;
  priority?: number;
  sourceService: string;
  sourceVersion: string;
  actionPayload: unknown;
  previewPayload: unknown;
  expectedImpact: unknown;
  riskLevel: SmartActionRiskLevel;
  deduplicationKey: string;
  sourceFingerprint?: string | null;
  expiresAt?: Date | null;
};

export interface SmartActionProvider {
  readonly id: string;
  generate(userId: string, options?: { libraryId?: string; playlistId?: string; limit?: number }): Promise<SmartActionCandidate[]>;
}

export const recommendationTypeDefaults = Object.fromEntries(SMART_ACTION_TYPES.map((type) => [type, true])) as Record<SmartActionType, boolean>;

