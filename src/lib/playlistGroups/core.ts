export type InheritanceState = "inherit" | "override" | "disabled";
export type SettingsRecord = Record<string, unknown>;

export type SettingSource = {
  value: unknown;
  source: "system-default" | "user-default" | "playlist-group" | "playlist" | "one-time" | "disabled";
  sourceId?: string;
  sourceName?: string;
};

export const PLAYLIST_GROUP_SYSTEM_DEFAULTS: SettingsRecord = {
  discoveryLevel: "balanced",
  deepCutPercentage: 35,
  maximumTracksPerArtist: 0,
  maximumArtistPercentage: 100,
  minimumUniqueArtists: 1,
  artistCooldownDistance: 0,
  preferArtistVariety: true,
  allowArtistLimitRelaxation: true,
  groupWideArtistDistribution: false,
  recentlyPlayedExclusionDays: 0,
  recentlyUsedPlaylistExclusionDays: 0,
  liveTrackHandling: "allow",
  missingMetadataBehavior: "allow-with-warning",
  recommendationStrength: 50,
  maximumPersonalizationInfluence: 25,
};

function own(record: SettingsRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function resolveSettingsLayers(input: {
  systemDefaults?: SettingsRecord;
  userDefaults?: SettingsRecord;
  groupDefaults?: SettingsRecord;
  playlistSettings?: SettingsRecord;
  oneTimeOverrides?: SettingsRecord;
  inheritance?: Record<string, InheritanceState>;
  inheritByDefault?: boolean;
  group?: { id: string; name: string } | null;
}) {
  const system = { ...PLAYLIST_GROUP_SYSTEM_DEFAULTS, ...(input.systemDefaults || {}) };
  const user = input.userDefaults || {};
  const group = input.groupDefaults || {};
  const playlist = input.playlistSettings || {};
  const oneTime = input.oneTimeOverrides || {};
  const keys = new Set([...Object.keys(system), ...Object.keys(user), ...Object.keys(group), ...Object.keys(playlist), ...Object.keys(oneTime), ...Object.keys(input.inheritance || {})]);
  const effectiveSettings: SettingsRecord = {};
  const sources: Record<string, SettingSource> = {};
  const warnings: string[] = [];

  for (const key of Array.from(keys)) {
    const state = input.inheritance?.[key] || (input.inheritByDefault ? "inherit" : "override");
    let value: unknown;
    let source: SettingSource;
    if (state === "disabled") {
      value = undefined;
      source = { value, source: "disabled" };
    } else if (state === "override" && own(playlist, key)) {
      value = playlist[key];
      source = { value, source: "playlist" };
    } else if (state === "inherit" && own(group, key) && input.group) {
      value = group[key];
      source = { value, source: "playlist-group", sourceId: input.group.id, sourceName: input.group.name };
    } else if (own(playlist, key)) {
      value = playlist[key];
      source = { value, source: "playlist" };
    } else if (own(user, key)) {
      value = user[key];
      source = { value, source: "user-default" };
    } else {
      value = system[key];
      source = { value, source: "system-default" };
    }
    if (own(oneTime, key)) {
      value = oneTime[key];
      source = { value, source: "one-time" };
    }
    if (value !== undefined) effectiveSettings[key] = value;
    sources[key] = { ...source, value };
  }

  if (input.inheritByDefault && !input.group) warnings.push("Inheritance is enabled, but no primary settings group is selected.");
  return { effectiveSettings, sources, conflicts: [] as string[], warnings };
}

export type PlaylistHealthInput = {
  id: string;
  qualityScore?: number | null;
  metadataCompleteness?: number | null;
  automationHealthy?: boolean;
  configurationWarnings?: number;
  plexSynchronized?: boolean | null;
  isPaused?: boolean;
  isEmpty?: boolean;
  engineVersion?: string | null;
};

export function calculateGroupHealth(playlists: PlaylistHealthInput[]) {
  const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
  const average = (values: number[], fallback = 100) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
  const generation = clamp(average(playlists.map((playlist) => playlist.isEmpty ? 20 : playlist.qualityScore ?? 75)));
  const metadata = clamp(average(playlists.map((playlist) => playlist.metadataCompleteness ?? 100)));
  const automation = clamp(average(playlists.map((playlist) => playlist.isPaused ? 80 : playlist.automationHealthy === false ? 35 : 100)));
  const configuration = clamp(average(playlists.map((playlist) => Math.max(0, 100 - (playlist.configurationWarnings || 0) * 20))));
  const plex = clamp(average(playlists.map((playlist) => playlist.plexSynchronized === false ? 30 : 100)));
  const components = { generation, metadata, automation, configuration, plexSynchronization: plex };
  const overallScore = clamp(generation * 0.3 + metadata * 0.2 + automation * 0.15 + configuration * 0.2 + plex * 0.15);
  const affected = {
    generation: playlists.filter((p) => p.isEmpty || (p.qualityScore ?? 75) < 70).map((p) => p.id),
    metadata: playlists.filter((p) => (p.metadataCompleteness ?? 100) < 90).map((p) => p.id),
    automation: playlists.filter((p) => p.automationHealthy === false).map((p) => p.id),
    configuration: playlists.filter((p) => (p.configurationWarnings || 0) > 0).map((p) => p.id),
    plexSynchronization: playlists.filter((p) => p.plexSynchronized === false).map((p) => p.id),
  };
  return { overallScore, components, affected };
}

export function compactSortOrders(ids: string[]) {
  return ids.map((id, index) => ({ id, sortOrder: (index + 1) * 1_000 }));
}
