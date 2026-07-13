export const PLAYLIST_SNAPSHOT_SCHEMA_VERSION = 1;

export const playlistVersionReasons = [
  "initial_generation", "full_regeneration", "advanced_regeneration",
  "manual_track_add", "manual_track_remove", "manual_reorder", "manual_edit",
  "settings_change", "restore", "undo", "import", "system_migration",
  "recently_added_automation",
] as const;

export type PlaylistVersionReason = typeof playlistVersionReasons[number];
export type PlaylistEngineFamily = "smart_mix_v1" | "smart_mix_v2" | "manual" | "import";

export interface VersionedGenerationSettings {
  schemaVersion: number;
  engineVersion: string | null;
  settings: Record<string, unknown>;
}

export interface PlaylistVersionTrack {
  trackId: string | null;
  plexTrackRatingKey: string | null;
  position: number;
  locked: boolean;
  liked: boolean;
  regenerationExcluded: boolean;
  titleSnapshot: string;
  artistSnapshot: string | null;
  albumSnapshot: string | null;
  durationMsSnapshot: number | null;
  bpmSnapshot: number | null;
  moodSnapshot: string[];
  energySnapshot: number | null;
}

export interface PlaylistVersionSnapshot {
  playlist: {
    name: string;
    description: string | null;
    engineFamily: PlaylistEngineFamily | null;
    engineVersion: string | null;
    generationSettings: VersionedGenerationSettings | null;
    betaMetadata?: Record<string, unknown> | null;
  };
  tracks: PlaylistVersionTrack[];
  scores: Record<string, unknown> | null;
  summary: { trackCount: number; durationMs: number };
}

export interface StoredPlaylistSnapshot {
  schemaVersion: number;
  data: PlaylistVersionSnapshot;
}

export interface VersionDiffTrack extends PlaylistVersionTrack {
  availability?: "available" | "track_deleted";
}

export interface SettingsDiffEntry {
  path: string;
  label: string;
  group: "General" | "Mood" | "BPM" | "Energy" | "Discovery" | "Variety" | "Regeneration" | "Fallback behavior";
  from: unknown;
  to: unknown;
}

export interface PlaylistVersionDiff {
  fromVersionId: string;
  toVersionId: string;
  summary: {
    addedCount: number;
    removedCount: number;
    movedCount: number;
    unchangedCount: number;
    replacedCount: number;
    trackCountFrom: number;
    trackCountTo: number;
    durationMsFrom: number;
    durationMsTo: number;
  };
  addedTracks: VersionDiffTrack[];
  removedTracks: VersionDiffTrack[];
  movedTracks: Array<{ track: VersionDiffTrack; fromPosition: number; toPosition: number }>;
  replacements: Array<{ position: number; removed: VersionDiffTrack; added: VersionDiffTrack; inferred: true }>;
  unchangedTracks: VersionDiffTrack[];
  stateChanges: Array<{ track: VersionDiffTrack; fields: Array<"locked" | "liked" | "regenerationExcluded"> }>;
  settingsChanges: SettingsDiffEntry[];
  scoreChanges: Array<{ path: string; label: string; from: number | null; to: number | null }>;
}
