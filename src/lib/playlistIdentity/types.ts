export const PLAYLIST_IDENTITY_SCHEMA_VERSION = 1;
export const PLAYLIST_IDENTITY_MODES = ["FLEXIBLE", "BALANCED", "STRONG", "STRICT"] as const;
export type PlaylistIdentityMode = typeof PLAYLIST_IDENTITY_MODES[number];

export type WeightedIdentityTrack = {
  id: string;
  artistId?: string | null;
  artistName?: string | null;
  genres?: string[];
  moods?: string[];
  bpm?: number | null;
  energy?: number | null;
  popularity?: number | null;
  durationMs?: number | null;
  year?: number | null;
  isLive?: boolean;
  isExplicit?: boolean;
  metadataConfidence?: number | null;
  position?: number;
  weight?: number;
};

export type PlaylistIdentityProfile = {
  coreMoods: string[];
  secondaryMoods: string[];
  moodDistribution: Record<string, number>;
  averageEnergy: number | null;
  energyRange: [number, number] | null;
  energyCurve: { type: "stable" | "rising" | "falling" | "wave" | "mixed"; sections: Array<number | null> };
  averageBpm: number | null;
  medianBpm: number | null;
  bpmRange: [number, number] | null;
  bpmClusters: number[];
  bpmCurve: { sections: Array<number | null> };
  maximumTransitionGap: number | null;
  preferredArtists: Array<{ artistId: string; name: string; score: number }>;
  preferredGenres: Array<{ name: string; score: number }>;
  releaseYearRange: [number, number] | null;
  discoveryPreference: number | null;
  familiarityPreference: number | null;
  popularityRange: [number, number] | null;
  deepCutPreference: number | null;
  durationRange: [number, number] | null;
  explicitPreference: "allow" | "avoid" | "neutral";
  livePreference: "prefer" | "avoid" | "neutral";
  metadataConfidencePreference: number | null;
  sampleCount: number;
  metadataCoverage: Record<string, number>;
};

export type IdentityAttributeState = {
  key: string;
  learnedValue: unknown;
  userValue: unknown;
  effectiveValue: unknown;
  locked: boolean;
  inherited: boolean;
  source: "LEARNED" | "MANUAL" | "LOCKED" | "INHERITED" | "INSUFFICIENT_DATA";
  confidence: number;
  insufficientData: boolean;
  evidenceCount: number;
};

export type PlaylistIdentityScoringContext = {
  identityId: string;
  enabled: boolean;
  mode: PlaylistIdentityMode;
  strength: number;
  confidence: number;
  profile: PlaylistIdentityProfile;
  artistScores: Record<string, number>;
  genreScores: Record<string, number>;
  trackMemory: Record<string, {
    importance: string;
    rejectionState: string;
    permanentRejection: boolean;
    acceptanceScore: number;
    rejectionCount: number;
    inferenceConfidence?: number;
  }>;
};

export type PlaylistIdentityScoreResult = {
  applied: boolean;
  excluded: boolean;
  adjustment: number;
  matchScore: number;
  components: Record<string, number>;
  reasons: string[];
  exclusionReason?: string;
};
