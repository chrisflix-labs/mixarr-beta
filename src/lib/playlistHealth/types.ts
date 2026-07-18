export const PLAYLIST_HEALTH_ALERT_TYPES = [
  "BROKEN_PLEX_PLAYLIST",
  "MISSING_TRACKS",
  "UNAVAILABLE_MEDIA",
  "TRACK_REPETITION",
  "ARTIST_CONCENTRATION",
  "ALBUM_CONCENTRATION",
  "IDENTITY_DRIFT",
  "METADATA_CONFIDENCE_DECLINE",
  "EXCESSIVE_BPM_JUMPS",
  "MOOD_CONFLICTS",
  "STALE_PLAYLIST",
  "FAILED_AUTOMATION",
] as const;

export type PlaylistHealthAlertType = typeof PLAYLIST_HEALTH_ALERT_TYPES[number];
export type PlaylistHealthSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type PlaylistHealthStatus = "EXCELLENT" | "GOOD" | "ATTENTION" | "CRITICAL";

export type PlaylistHealthTrack = {
  id: string;
  trackId?: string | null;
  ratingKey?: string | null;
  title: string;
  artistId?: string | null;
  artist?: string | null;
  albumId?: string | null;
  album?: string | null;
  bpm?: number | null;
  mood?: number | null;
  moodTags?: string[];
  energy?: number | null;
  metadataConfidence?: number | null;
  syncStatus?: string | null;
  localFileStatus?: string | null;
  present?: boolean;
  position: number;
};

export type PlaylistHealthThresholds = {
  staleAfterDays: number;
  artistConcentrationPercent: number;
  albumConcentrationPercent: number;
  excessiveBpmJump: number;
  moodConflictDelta: number;
  metadataDeclinePercent: number;
};

export type PlaylistHealthInput = {
  playlist: {
    id: string;
    name: string;
    plexPlaylistRatingKey?: string | null;
    serverId?: string | null;
    expectedTrackCount?: number | null;
    lastChangedAt: Date;
  };
  tracks: PlaylistHealthTrack[];
  thresholds: PlaylistHealthThresholds;
  previousMetadataConfidence?: number | null;
  identityProfile?: {
    confidence?: number | null;
    averageBpm?: number | null;
    bpmRange?: [number, number] | null;
    averageEnergy?: number | null;
    energyRange?: [number, number] | null;
    moodDistribution?: Record<string, number> | null;
  } | null;
  failedAutomation?: { count: number; latestMessage?: string | null } | null;
  now?: Date;
};

export type PlaylistHealthCheck = {
  type: PlaylistHealthAlertType;
  severity: PlaylistHealthSeverity;
  title: string;
  message: string;
  penalty: number;
  value?: number | string | null;
  threshold?: number | string | null;
  details?: Record<string, unknown>;
};

export type PlaylistHealthResult = {
  playlistId: string;
  playlistName: string;
  overallScore: number;
  status: PlaylistHealthStatus;
  metadataConfidence: number | null;
  identityScore: number | null;
  checks: PlaylistHealthCheck[];
  metrics: {
    trackCount: number;
    missingTracks: number;
    unavailableTracks: number;
    duplicateOccurrences: number;
    largestArtistShare: number;
    largestAlbumShare: number;
    excessiveBpmJumps: number;
    moodConflicts: number;
    staleDays: number;
  };
};

export const DEFAULT_PLAYLIST_HEALTH_THRESHOLDS: PlaylistHealthThresholds = {
  staleAfterDays: 30,
  artistConcentrationPercent: 30,
  albumConcentrationPercent: 20,
  excessiveBpmJump: 35,
  moodConflictDelta: 0.55,
  metadataDeclinePercent: 15,
};
