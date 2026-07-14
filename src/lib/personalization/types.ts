export const TRACK_INTERACTION_TYPES = [
  "TRACK_SELECTED",
  "TRACK_REJECTED",
  "TRACK_REMOVED",
  "TRACK_LOCKED",
  "TRACK_LIKED",
  "TRACK_DISLIKED",
  "TRACK_SKIPPED",
  "TRACK_REPLACED",
  "TRACK_ACCEPTED_FROM_PREVIEW",
  "TRACK_REJECTED_FROM_PREVIEW",
  "PLAYLIST_RESTORED",
  "MANUAL_TRACK_ADDITION",
] as const;

export const TRACK_INTERACTION_SOURCES = [
  "SMART_MIX_GENERATION",
  "REGENERATION_PREVIEW",
  "PLAYLIST_EDITOR",
  "VERSION_RESTORE",
  "MANUAL_ACTION",
  "PLEX_ACTIVITY",
  "SYSTEM",
] as const;

export type TrackInteractionType = typeof TRACK_INTERACTION_TYPES[number];
export type TrackInteractionSource = typeof TRACK_INTERACTION_SOURCES[number];
export type PersonalizationConfidenceState = "NOT_ENOUGH_DATA" | "LEARNING" | "DEVELOPING" | "ESTABLISHED";
export type PlaylistPersonalizationMode = "GENERAL_PROFILE" | "PLAYLIST_SPECIFIC" | "GLOBAL_ONLY";

export type RecommendationProfileSnapshot = {
  enabled: boolean;
  learningEnabled: boolean;
  confidence: number;
  confidenceState: PersonalizationConfidenceState;
  minimumEventsRequired: number;
  interactionCount: number;
  preferredEnergyMin: number | null;
  preferredEnergyMax: number | null;
  preferredBpmMin: number | null;
  preferredBpmMax: number | null;
  preferredDiscoveryLevel: number | null;
  preferredDeepCutWeight: number | null;
  preferredPopularityWeight: number | null;
  preferredArtistVariety: number | null;
  preferredAlbumVariety: number | null;
  avoidRecentlyPlayed: boolean;
  avoidRecentlyUsedArtists: boolean;
  avoidLiveRecordings: boolean;
  avoidLowConfidenceMetadata: boolean;
};

export type PlaylistPreferenceSnapshot = {
  enabled: boolean;
  mode: PlaylistPersonalizationMode;
  source: string;
  isLearned: boolean;
  confidence: number;
  evidenceCount: number;
  energyMin: number | null;
  energyMax: number | null;
  bpmMin: number | null;
  bpmMax: number | null;
  discoveryPreference: number | null;
  deepCutPreference: number | null;
  artistVarietyPreference: number | null;
  albumVarietyPreference: number | null;
  repetitionTolerance: number | null;
  avoidLiveRecordings: boolean | null;
  avoidLowConfidenceMetadata: boolean | null;
  avoidRecentlyPlayedTracks: boolean | null;
};

export type PersonalizationScoringContext = {
  profile: RecommendationProfileSnapshot;
  playlistProfile?: PlaylistPreferenceSnapshot | null;
  recentlyUsedTrackIds?: string[];
  recentlyUsedArtistIds?: string[];
  maxAdjustment?: number;
};

export type PersonalizationScoreReason = {
  layer: "playlist" | "user";
  feature: string;
  adjustment: number;
  message: string;
};

export type PersonalizationScoreResult = {
  globalScore: number;
  playlistContextScore: number;
  personalizationAdjustment: number;
  finalScore: number;
  personalizationReasons: PersonalizationScoreReason[];
  boundedBy: number;
  applied: boolean;
};

export type TrackInteractionContext = {
  baseScore?: number;
  energy?: number;
  bpm?: number;
  discoveryScore?: number;
  popularity?: number;
  metadataConfidence?: number;
  isLive?: boolean;
  artistId?: string;
};

