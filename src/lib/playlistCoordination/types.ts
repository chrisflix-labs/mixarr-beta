export const PLAYLIST_RELATIONSHIP_TYPES = [
  "SISTER",
  "PROGRESSION_PREVIOUS",
  "PROGRESSION_NEXT",
  "PARENT",
  "CHILD",
  "RELATED",
  "DISTINCT_FROM",
] as const;

export type PlaylistRelationshipType = typeof PLAYLIST_RELATIONSHIP_TYPES[number];
export type OverlapEnforcement = "OFF" | "WARNING_ONLY" | "SOFT_TARGET" | "HARD_MAXIMUM";

export type PlaylistTrackFact = {
  trackId?: string | null;
  ratingKey?: string | null;
  title?: string | null;
  normalizedTitle?: string | null;
  artistId?: string | null;
  artistName?: string | null;
  albumId?: string | null;
  albumName?: string | null;
  canonicalRecordingId?: string | null;
  active?: boolean;
  deleted?: boolean;
};

export type PlaylistOverlapResult = {
  sourceTrackCount: number;
  targetTrackCount: number;
  sharedTrackCount: number;
  sharedTrackPercentage: number;
  jaccardSimilarity: number;
  sourceUniqueTrackCount: number;
  targetUniqueTrackCount: number;
  sharedArtistCount: number;
  sharedArtistPercentage: number;
  sharedAlbumCount: number;
  sharedAlbumPercentage: number;
  sharedCoreTrackCount: number;
  similarityScore: number;
  sharedTrackKeys: string[];
  sharedArtistKeys: string[];
  sharedAlbumKeys: string[];
  enforcementCalculation: "shared / smaller active playlist";
};

export type CoordinationSettings = {
  coordinationEnabled: boolean;
  maximumSharedTrackPercentage: number;
  overlapEnforcement: OverlapEnforcement;
  keepDistinct: boolean;
  allowSharedCoreTracks: boolean;
  maximumSharedCoreTracks?: number | null;
  preferGloballyUnusedTracks: boolean;
  unusedTrackPreferenceStrength: number;
  maximumCoordinationInfluence: number;
  crossPlaylistArtistBalancingEnabled: boolean;
  maximumSharedArtistPercentage?: number | null;
  maximumTracksPerArtistAcrossGroup?: number | null;
  warnBeforeExceedingOverlap: boolean;
};

export type CoordinationScoringContext = {
  settings: CoordinationSettings;
  targetPlaylistSize: number;
  relatedPlaylistIds: string[];
  excludedTrackKeys: string[];
  relatedTrackUsage: Record<string, number>;
  globalActiveUsage: Record<string, number>;
  globalHistoricalUsage?: Record<string, number>;
  artistUsage: Record<string, number>;
  albumUsage: Record<string, number>;
  sharedCoreTrackKeys: string[];
  maximumRelatedPlaylistSize: number;
  progression?: {
    previousPlaylistId?: string;
    nextPlaylistId?: string;
    previousHandoffBpm?: number | null;
    nextHandoffBpm?: number | null;
  };
};

export type CoordinationScoreBreakdown = {
  alreadyUsedInRelatedPlaylistPenalty: number;
  globalSmartMixUsagePenalty: number;
  crossPlaylistArtistPenalty: number;
  crossPlaylistAlbumPenalty: number;
  unusedTrackBonus: number;
  sharedCoreAdjustment: number;
  progressionFitAdjustment: number;
  totalAdjustment: number;
  hardOverlapRejected: boolean;
  exclusionReason?: string;
  reasons: string[];
};
