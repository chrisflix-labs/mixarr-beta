import { z } from "zod";

export const REGENERATION_ENGINE_VERSION = "v2.0.8";

export const regenerationModes = [
  "replace_weak_tracks",
  "replace_low_scoring",
  "improve_bpm_flow",
  "increase_energy",
  "increase_discovery",
  "smooth_mood_transitions",
  "regenerate_section",
  "manual_selection",
] as const;

export const playlistSections = ["intro", "early", "middle", "late", "ending", "custom_range"] as const;
export const replacementSensitivities = ["conservative", "balanced", "aggressive"] as const;

export type RegenerationMode = typeof regenerationModes[number];
export type PlaylistSection = typeof playlistSections[number];
export type ReplacementSensitivity = typeof replacementSensitivities[number];

export const REPLACEMENT_THRESHOLDS: Record<ReplacementSensitivity, number> = {
  conservative: 70,
  balanced: 50,
  aggressive: 35,
};

export const ENERGY_ADJUSTMENTS = {
  subtle: 0.08,
  moderate: 0.16,
  strong: 0.25,
} as const;

const sectionSchema = z.object({
  type: z.enum(playlistSections),
  start: z.coerce.number().int().min(1).optional(),
  end: z.coerce.number().int().min(1).optional(),
}).superRefine((value, context) => {
  if (value.type === "custom_range" && (value.start == null || value.end == null || value.end < value.start)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A custom range requires a valid start and end position." });
  }
});

export const playlistRegenerationRequestSchema = z.object({
  playlistId: z.string().min(1).optional(),
  mode: z.enum(regenerationModes).default("replace_weak_tracks"),
  targetTrackIds: z.array(z.string().min(1)).max(5000).optional(),
  candidateTrackIds: z.array(z.string().min(1)).max(5000).optional(),
  targetSection: sectionSchema.optional(),
  preserveLength: z.boolean().default(true),
  preserveMoodCurve: z.boolean().default(true),
  preserveBpmCurve: z.boolean().default(true),
  preserveEnergyCurve: z.boolean().default(true),
  preserveLockedTracks: z.boolean().default(true),
  preserveOrder: z.boolean().default(true),
  keepLikedTracks: z.boolean().default(true),
  discoveryAdjustment: z.coerce.number().min(0).max(1).default(0.15),
  energyAdjustment: z.coerce.number().min(-0.5).max(0.5).default(0.16),
  minimumReplacementImprovement: z.coerce.number().min(0).max(100).default(8),
  maximumReplacements: z.coerce.number().int().min(1).max(100).default(10),
  replacementSensitivity: z.enum(replacementSensitivities).default("balanced"),
  scoreThreshold: z.coerce.number().min(0).max(100).default(65),
  lowestCount: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10)]).optional(),
  replacementPercentage: z.coerce.number().min(1).max(100).optional(),
  durationTolerance: z.coerce.number().min(0).max(0.5).default(0.05),
});

export type PlaylistRegenerationRequest = z.infer<typeof playlistRegenerationRequestSchema>;

export type PlaylistTrackState = {
  trackId: string;
  position: number;
  locked: boolean;
  liked?: boolean;
  regenerationExcluded?: boolean;
};

export type TrackMetrics = {
  bpm: number | null;
  mood: number | null;
  energy: number | null;
  popularity: number | null;
  durationMs: number;
  metadataConfidence: number;
  artist: string | null;
  album: string | null;
};

export type TrackWeaknessAnalysis = {
  trackId: string;
  position: number;
  overallWeakness: number;
  trackScore: number;
  previousTransitionScore?: number;
  nextTransitionScore?: number;
  moodPenalty: number;
  bpmPenalty: number;
  energyPenalty: number;
  varietyPenalty: number;
  discoveryPenalty: number;
  metadataConfidencePenalty: number;
  reasons: string[];
  confidenceReasons: string[];
  locked: boolean;
  liked: boolean;
};

export type ReplacementCandidateScore = {
  candidateTrackId: string;
  totalScore: number;
  playlistFitScore: number;
  previousTransitionScore: number;
  nextTransitionScore: number;
  moodCurveScore: number;
  bpmCurveScore: number;
  energyCurveScore: number;
  discoveryScore: number;
  varietyScore: number;
  metadataConfidenceScore: number;
  identityMatchScore: number;
  identityAdjustment: number;
  improvementOverOriginal: number;
  reasons: string[];
};

export type RegenerationPreviewChange = {
  position: number;
  originalTrackId: string;
  proposedTrackId: string;
  originalScore: number;
  proposedScore: number;
  improvement: number;
  reasons: string[];
  identityReasons?: string[];
  originalMetrics: TrackMetrics;
  proposedMetrics: TrackMetrics;
  originalTrack?: unknown;
  proposedTrack?: unknown;
};

export type RegenerationPreview = {
  previewId: string;
  playlistId: string;
  mode: RegenerationMode;
  originalPlaylistScore: number;
  proposedPlaylistScore: number;
  estimatedImprovement: number;
  originalDurationMs: number;
  proposedDurationMs: number;
  changes: RegenerationPreviewChange[];
  warnings: string[];
  createdAt: Date;
  analyzedTrackCount: number;
  finalTrackIds: string[];
  weakness: TrackWeaknessAnalysis[];
  identityImpact?: {
    level: "Low" | "Medium" | "High";
    summary: string[];
    lockedTracksRemoved: number;
  };
};

export type RegenerationTrack = Record<string, any> & { id: string };
