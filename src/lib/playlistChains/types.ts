import { z } from "zod";

export const roleBehaviorModes = ["LABEL_ONLY", "SUGGEST", "APPLY"] as const;
export const chainStatuses = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export const sharedTransitionModes = ["DISABLED", "SUGGEST_ONLY", "AUTOMATIC"] as const;
export const energyHandoffModes = ["SMOOTH_CONTINUATION", "GRADUAL_INCREASE", "GRADUAL_DECREASE", "ENERGY_RESET", "INTENTIONAL_CONTRAST", "NO_PREFERENCE"] as const;
export const bpmHandoffModes = ["SMOOTH_CONTINUATION", "GRADUAL_RAMP_UP", "GRADUAL_RAMP_DOWN", "HALF_TIME", "DOUBLE_TIME", "INTENTIONAL_RESET", "NO_GUIDANCE"] as const;
export const moodHandoffModes = ["SMOOTH_CONTINUATION", "EMOTIONAL_BUILD", "EMOTIONAL_RELEASE", "DARKER_PROGRESSION", "BRIGHTER_PROGRESSION", "CALM_RESET", "INTENTIONAL_CONTRAST", "NO_PREFERENCE"] as const;

export type RoleBehaviorMode = typeof roleBehaviorModes[number];
export type ChainStatus = typeof chainStatuses[number];
export type SharedTransitionMode = typeof sharedTransitionModes[number];
export type EnergyHandoffMode = typeof energyHandoffModes[number];
export type BpmHandoffMode = typeof bpmHandoffModes[number];
export type MoodHandoffMode = typeof moodHandoffModes[number];

export type RoleGuidance = {
  energyStart: number | null;
  energyEnd: number | null;
  bpmMin: number | null;
  bpmMax: number | null;
  discoveryLevel: number | null;
  transitionMode: string | null;
  moodDirection: string | null;
  settings: Record<string, unknown>;
};

export type BoundaryTrack = {
  id: string;
  snapshotId?: string;
  title: string;
  artist: string | null;
  album: string | null;
  bpm: number | null;
  energy: number | null;
  moodIntensity: number | null;
  moods: string[];
  duration: number | null;
  popularity: number | null;
  locked: boolean;
  liked: boolean;
  available: boolean;
};

export type PlaylistJourneySummary = {
  playlistId: string;
  name: string;
  trackCount: number;
  estimatedDurationMs: number;
  startingBpm: number | null;
  endingBpm: number | null;
  startingBpmRange: [number, number] | null;
  endingBpmRange: [number, number] | null;
  startingEnergy: number | null;
  endingEnergy: number | null;
  primaryMoods: string[];
  startingMoods: string[];
  endingMoods: string[];
  moodIntensityStart: number | null;
  moodIntensityEnd: number | null;
  metadataConfidence: number;
  missing: { bpm: number; energy: number; mood: number; unavailable: number };
  familiarityPercent: number;
  energyCurve: Array<number | null>;
  bpmCurve: Array<number | null>;
  moodCurve: Array<number | null>;
  tracks: BoundaryTrack[];
};

export type HandoffAnalysis = {
  fromMemberId: string;
  toMemberId: string;
  fromPlaylistId: string;
  toPlaylistId: string;
  quality: "Excellent" | "Smooth" | "Noticeable" | "Abrupt" | "Intentional Contrast" | "Unable to Evaluate";
  qualityScore: number | null;
  energyScore: number | null;
  bpmScore: number | null;
  moodScore: number | null;
  confidence: number;
  energy: Record<string, unknown>;
  bpm: Record<string, unknown>;
  mood: Record<string, unknown>;
  warnings: string[];
  explanations: string[];
};

export const roleDefinitionInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  defaultEnergyStart: z.number().min(0).max(1).nullable().optional(),
  defaultEnergyEnd: z.number().min(0).max(1).nullable().optional(),
  defaultBpmMin: z.number().min(20).max(300).nullable().optional(),
  defaultBpmMax: z.number().min(20).max(300).nullable().optional(),
  defaultDiscoveryLevel: z.number().min(0).max(1).nullable().optional(),
  defaultTransitionMode: z.string().trim().max(80).nullable().optional(),
  defaultMoodDirection: z.string().trim().max(80).nullable().optional(),
  defaultSettings: z.record(z.unknown()).default({}),
});

export const roleAssignmentInputSchema = z.object({
  roleDefinitionId: z.string().min(1),
  customRoleName: z.string().trim().min(1).max(80).nullable().optional(),
  behaviorMode: z.enum(roleBehaviorModes).default("SUGGEST"),
  settingsOverride: z.record(z.unknown()).default({}),
});

export const chainMemberInputSchema = z.object({
  id: z.string().optional(),
  playlistId: z.string().uuid(),
  roleDefinitionId: z.string().nullable().optional(),
  roleOverride: z.record(z.unknown()).nullable().optional(),
  expectedStartEnergy: z.number().min(0).max(1).nullable().optional(),
  expectedEndEnergy: z.number().min(0).max(1).nullable().optional(),
  expectedStartBpm: z.number().min(20).max(300).nullable().optional(),
  expectedEndBpm: z.number().min(20).max(300).nullable().optional(),
  targetMood: z.string().trim().max(80).nullable().optional(),
  minimumEnergy: z.number().min(0).max(1).nullable().optional(),
  maximumEnergy: z.number().min(0).max(1).nullable().optional(),
  minimumBpm: z.number().min(20).max(300).nullable().optional(),
  maximumBpm: z.number().min(20).max(300).nullable().optional(),
  recommendedDuration: z.number().int().min(1).max(1440).nullable().optional(),
  handoffEnabled: z.boolean().default(true),
  autoHandoffGuidance: z.boolean().default(true),
});

export const chainInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  status: z.enum(chainStatuses).default("DRAFT"),
  guidanceEnabled: z.boolean().default(true),
  autoMaintenanceEnabled: z.boolean().default(false),
  sharedTransitionMode: z.enum(sharedTransitionModes).default("SUGGEST_ONLY"),
  masterPlaylistEnabled: z.boolean().default(false),
  maximumAdjacentOverlapPercentage: z.number().min(0).max(100).default(15),
  maximumChainOverlapPercentage: z.number().min(0).max(100).default(20),
  settings: z.record(z.unknown()).default({}),
  members: z.array(chainMemberInputSchema).min(2).max(50),
});

export const handoffInputSchema = z.object({
  energyMode: z.enum(energyHandoffModes).optional(),
  bpmMode: z.enum(bpmHandoffModes).optional(),
  moodMode: z.enum(moodHandoffModes).optional(),
  sharedTrackMode: z.enum(["INHERIT", ...sharedTransitionModes]).optional(),
  locked: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const chainSettingsSchema = z.object({
  rolesEnabled: z.boolean().default(true),
  chainsEnabled: z.boolean().default(true),
  defaultRoleBehavior: z.enum(roleBehaviorModes).default("SUGGEST"),
  sharedTransitionTracksEnabled: z.boolean().default(true),
  maximumSharedTransitionTracks: z.number().int().min(0).max(5).default(1),
  masterJourneyPlaylistsEnabled: z.boolean().default(true),
  automaticallyAnalyzeUpdatedChains: z.boolean().default(true),
  automaticallyRepairWeakHandoffs: z.boolean().default(false),
  minimumAutomaticRepairImprovement: z.number().min(1).max(100).default(10),
  maximumTracksReplacedAutomatically: z.number().int().min(0).max(10).default(2),
  preserveLockedBoundaryTracks: z.boolean().default(true),
  analysisConcurrency: z.number().int().min(1).max(4).default(1),
  retainVersions: z.boolean().default(true),
  versionRetentionCount: z.number().int().min(1).max(100).default(20),
  showExperimentalFeatures: z.boolean().default(false),
});
