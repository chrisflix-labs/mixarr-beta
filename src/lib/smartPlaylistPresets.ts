import type { PlaylistConfigInput, PlaylistRuleInput } from "./playlistService";
import { DEFAULT_SMART_MIX_TUNING } from "./smartMixEngine/v2";

export const SMART_PRESET_VERSION = "v1";

export type SmartPlaylistPreset = {
  id: string;
  name: string;
  description: string;
  suggestedPlaylistName: string;
  badges: string[];
  explanation: string;
  filters: Pick<PlaylistConfigInput, "rules" | "limit" | "duplicateStrategy" | "preferNonLive" | "excludeRemasters" | "negativeFilters" | "safetyRules">;
};

const rangeRules = (field: PlaylistRuleInput["field"], min?: number, max?: number): PlaylistRuleInput[] => [
  ...(min == null ? [] : [{ field, operator: "gte" as const, value: String(min) }]),
  ...(max == null ? [] : [{ field, operator: "lte" as const, value: String(max) }]),
];

const safetyRules = ({
  maxTracksPerArtist = 3,
  limitTracksPerAlbum = false,
  maxTracksPerAlbum = 2,
}: {
  maxTracksPerArtist?: number;
  limitTracksPerAlbum?: boolean;
  maxTracksPerAlbum?: number;
} = {}) => ({
  avoidSameArtistBackToBack: true,
  limitTracksPerArtist: true,
  maxTracksPerArtist,
  limitTracksPerAlbum,
  maxTracksPerAlbum,
  warnIfFewerThan: true,
  minimumTrackCount: 10,
});

const baseFilters = {
  duplicateStrategy: "song_artist" as const,
  preferNonLive: true,
  excludeRemasters: false,
  negativeFilters: {
    excludeHoliday: false,
    excludeLive: false,
    excludeRemasters: false,
    excludeExplicit: false,
    excludeIntroOutro: false,
    minRating: null,
    excludePlayedWithinDays: null,
    minDurationMinutes: null,
    maxDurationMinutes: null,
  },
};

export const smartPlaylistPresets: SmartPlaylistPreset[] = [
  {
    id: "workout",
    name: "Workout",
    description: "High-energy tracks for exercise, movement, and motivation.",
    suggestedPlaylistName: "Workout Mix",
    badges: ["High Energy"],
    explanation: "Workout uses higher energy, faster BPM, and artist spacing to keep the playlist moving.",
    filters: {
      ...baseFilters,
      limit: 50,
      rules: [
        ...rangeRules("energy", 0.7, 1),
        ...rangeRules("valence", 0.45, 1),
        ...rangeRules("tempo", 115, 160),
        { field: "popularity", operator: "gte", value: "35" },
      ],
      safetyRules: safetyRules({ maxTracksPerArtist: 3 }),
    },
  },
  {
    id: "chill",
    name: "Chill",
    description: "Lower-energy tracks for relaxing, winding down, or background listening.",
    suggestedPlaylistName: "Chill Mix",
    badges: ["Chill"],
    explanation: "Chill lowers energy and BPM while keeping light artist spacing for a smoother listen.",
    filters: {
      ...baseFilters,
      limit: 40,
      rules: [
        ...rangeRules("energy", 0, 0.55),
        ...rangeRules("valence", 0.35, 0.75),
        ...rangeRules("tempo", 60, 110),
      ],
      safetyRules: safetyRules({ maxTracksPerArtist: 3 }),
    },
  },
  {
    id: "party",
    name: "Party",
    description: "Upbeat, familiar, higher-energy tracks for group listening.",
    suggestedPlaylistName: "Party Mix",
    badges: ["High Energy", "Popular"],
    explanation: "Party favors upbeat, familiar tracks with tighter artist variety so the mix does not camp on one performer.",
    filters: {
      ...baseFilters,
      limit: 75,
      rules: [
        ...rangeRules("energy", 0.55, 1),
        ...rangeRules("valence", 0.65, 1),
        ...rangeRules("tempo", 100, 145),
        { field: "popularity", operator: "gte", value: "45" },
      ],
      safetyRules: safetyRules({ maxTracksPerArtist: 2 }),
    },
  },
  {
    id: "focus",
    name: "Focus",
    description: "Steady, less distracting tracks for working or concentrating.",
    suggestedPlaylistName: "Focus Mix",
    badges: ["Balanced"],
    explanation: "Focus keeps energy moderate, mood neutral to positive, and BPM steady for fewer distracting jumps.",
    filters: {
      ...baseFilters,
      limit: 50,
      rules: [
        ...rangeRules("energy", 0.2, 0.6),
        ...rangeRules("valence", 0.4, 0.8),
        ...rangeRules("tempo", 70, 120),
      ],
      safetyRules: safetyRules({ maxTracksPerArtist: 3 }),
    },
  },
  {
    id: "driving",
    name: "Driving",
    description: "Balanced tracks for road trips and everyday driving.",
    suggestedPlaylistName: "Driving Mix",
    badges: ["Balanced"],
    explanation: "Driving keeps BPM, energy, and mood in a broad middle-to-high lane for road-trip variety.",
    filters: {
      ...baseFilters,
      limit: 60,
      rules: [
        ...rangeRules("energy", 0.45, 1),
        ...rangeRules("valence", 0.45, 1),
        ...rangeRules("tempo", 85, 145),
      ],
      safetyRules: safetyRules({ maxTracksPerArtist: 3 }),
    },
  },
  {
    id: "discovery",
    name: "Discovery",
    description: "Find tracks that fit your filters but may not be your most obvious picks.",
    suggestedPlaylistName: "Discovery Mix",
    badges: ["Discovery"],
    explanation: "Discovery favors less obvious tracks where popularity data is available and applies stronger artist variety.",
    filters: {
      ...baseFilters,
      limit: 50,
      rules: [
        { field: "popularity", operator: "lte", value: "55" },
      ],
      safetyRules: safetyRules({ maxTracksPerArtist: 2 }),
    },
  },
  {
    id: "deep-cuts",
    name: "Deep Cuts",
    description: "Lower-popularity tracks from your library for something different.",
    suggestedPlaylistName: "Deep Cuts Mix",
    badges: ["Discovery"],
    explanation: "Deep Cuts leans into lower-popularity tracks and stronger artist variety for a less obvious playlist.",
    filters: {
      ...baseFilters,
      limit: 50,
      rules: [
        { field: "popularity", operator: "lte", value: "45" },
      ],
      safetyRules: safetyRules({ maxTracksPerArtist: 2 }),
    },
  },
  {
    id: "popular-favorites",
    name: "Popular Favorites",
    description: "More familiar tracks using popularity data where available.",
    suggestedPlaylistName: "Popular Favorites",
    badges: ["Popular"],
    explanation: "Popular Favorites uses stronger popularity matches where Mixarr has popularity data.",
    filters: {
      ...baseFilters,
      limit: 50,
      rules: [
        { field: "popularity", operator: "gte", value: "55" },
      ],
      safetyRules: safetyRules({ maxTracksPerArtist: 3 }),
    },
  },
  {
    id: "balanced-mix",
    name: "Balanced Mix",
    description: "A general-purpose playlist with light variety rules.",
    suggestedPlaylistName: "Balanced Mix",
    badges: ["Balanced"],
    explanation: "Balanced Mix starts broad and relies on light artist and album variety rules instead of tight filters.",
    filters: {
      ...baseFilters,
      limit: 50,
      rules: [],
      safetyRules: safetyRules({ maxTracksPerArtist: 3, limitTracksPerAlbum: true, maxTracksPerAlbum: 2 }),
    },
  },
];

export function getSmartPlaylistPreset(id: string) {
  return smartPlaylistPresets.find((preset) => preset.id === id) || null;
}

export function buildSmartPresetConfig(preset: SmartPlaylistPreset): PlaylistConfigInput {
  return {
    ...preset.filters,
    smartPresetId: preset.id,
    smartPresetName: preset.name,
    smartPresetVersion: SMART_PRESET_VERSION,
    moodPresetModified: false,
    bpmPresetModified: false,
    engineVersion: "v2",
    tuningConfig: DEFAULT_SMART_MIX_TUNING,
    moodBlendMode: "off",
    selectedMoodPath: [],
    allowedMoods: [],
    serverId: undefined,
    libraryId: undefined,
    pinnedTrackIds: [],
    excludedTrackIds: [],
  };
}
