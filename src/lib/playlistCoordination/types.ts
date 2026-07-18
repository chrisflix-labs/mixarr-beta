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
  albumArtistName?: string | null;
  creditedArtistIds?: string[] | null;
  creditedArtistNames?: string[] | null;
  isCompilation?: boolean;
  canonicalRecordingId?: string | null;
  active?: boolean;
  deleted?: boolean;
  available?: boolean;
  resolved?: boolean;
};

export type PlaylistOverlapPolicy = {
  maximumTrackOverlapPercent?: number;
  maximumArtistOverlapPercent?: number;
  maximumAlbumOverlapPercent?: number;
  maximumSharedTrackCount?: number | null;
  minimumUniqueTrackPercent?: number;
  minimumUniqueTrackCount?: number | null;
  sharedTrackAllowance?: number;
  allowedSharedTrackKeys?: Iterable<string>;
  allowedArtistKeys?: Iterable<string>;
  allowedAlbumKeys?: Iterable<string>;
  coreTrackKeys?: Iterable<string>;
};

export type PlaylistOverlapResult = {
  sourceTrackCount: number;
  targetTrackCount: number;
  sharedTrackCount: number;
  sharedTrackPercentage: number;
  overlapPercentOfSource: number;
  overlapPercentOfTarget: number;
  jaccardSimilarity: number;
  sourceUniqueTrackCount: number;
  targetUniqueTrackCount: number;
  sourceUniqueTrackPercentage: number;
  targetUniqueTrackPercentage: number;
  policySharedTrackCount: number;
  allowedSharedTrackCount: number;
  excessSharedTrackCount: number;
  sharedArtistCount: number;
  sharedPrimaryArtistCount: number;
  sharedArtistPercentage: number;
  policySharedArtistPercentage: number;
  tracksFromSharedArtists: number;
  artistConcentrationScore: number;
  excessiveArtistKeys: string[];
  mostRepeatedArtists: Array<{ key: string; count: number }>;
  sharedAlbumCount: number;
  sharedAlbumPercentage: number;
  policySharedAlbumPercentage: number;
  tracksFromSharedAlbums: number;
  dominatingAlbumKeys: string[];
  mostRepeatedAlbums: Array<{ key: string; count: number }>;
  sharedCoreTrackCount: number;
  similarityScore: number;
  sharedTrackKeys: string[];
  sharedArtistKeys: string[];
  sharedAlbumKeys: string[];
  withinPolicy: boolean;
  policy: {
    maximumTrackOverlapPercent: number;
    maximumArtistOverlapPercent: number;
    maximumAlbumOverlapPercent: number;
    maximumSharedTrackCount: number | null;
    minimumUniqueTrackPercent: number;
    minimumUniqueTrackCount: number | null;
  };
  warnings: Array<{ level: "INFORMATIONAL" | "MODERATE" | "HIGH" | "SEVERE"; code: string; message: string }>;
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
  maximumSharedAlbumPercentage?: number | null;
  maximumSharedTrackCount?: number | null;
  minimumUniqueTrackPercentage?: number;
  minimumUniqueTrackCount?: number | null;
  uniqueTargetMode?: "PREFERRED" | "STRICT";
  recentUsageLookbackDays?: number | null;
  recentUsagePenaltyStrength?: "OFF" | "LOW" | "MEDIUM" | "HIGH" | "STRICT";
  sharedTrackAllowance?: number;
  coreTrackAllowance?: number | null;
  comparisonScope?: "ALL_MANAGED" | "SELECTED_GROUPS" | "SIMILAR_IDENTITIES" | "RELATED_ONLY";
  automaticRepairEnabled?: boolean;
  requireRepairPreview?: boolean;
  excludedFromEnforcement?: boolean;
  exclusivityBehavior?: "OFF" | "PREFER_EXCLUSIVE" | "STRICT_EXCLUSIVE";
  exclusivityLookbackDays?: number | null;
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
  allowedSharedTrackKeys?: string[];
  exclusiveTrackKeys?: string[];
  recentTrackUsage?: Record<string, number>;
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
  crossPlaylistRecentUsagePenalty: number;
  crossPlaylistArtistPenalty: number;
  crossPlaylistAlbumPenalty: number;
  playlistExclusivityPenalty: number;
  unusedTrackBonus: number;
  uniqueCandidateBoost: number;
  sharedCoreAdjustment: number;
  sharedTrackAllowanceAdjustment: number;
  progressionFitAdjustment: number;
  totalAdjustment: number;
  hardOverlapRejected: boolean;
  exclusionReason?: string;
  reasons: string[];
};
