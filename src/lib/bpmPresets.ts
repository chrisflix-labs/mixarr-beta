import type { PlaylistRuleInput } from "./playlistService";

export const BPM_PRESET_VERSION = "v1";

export type BpmPresetRange = [number, number] | null;

export type BpmPreset = {
  id: string;
  name: string;
  description: string;
  minBpm: number | null;
  maxBpm: number | null;
  badges: string[];
  explanation: string;
};

export const bpmPresets: BpmPreset[] = [
  {
    id: "slow",
    name: "Slow",
    description: "Lower-tempo tracks for relaxed or mellow playlists.",
    minBpm: 60,
    maxBpm: 90,
    badges: ["Slow", "60–90 BPM"],
    explanation: "Slow focuses on lower-tempo tracks for relaxed or mellow playlists.",
  },
  {
    id: "medium",
    name: "Medium",
    description: "Comfortable mid-tempo tracks for general listening.",
    minBpm: 90,
    maxBpm: 120,
    badges: ["Medium", "90–120 BPM"],
    explanation: "Medium keeps tempos in a comfortable middle range for general listening.",
  },
  {
    id: "upbeat",
    name: "Upbeat",
    description: "Livelier tracks with more movement and pace.",
    minBpm: 100,
    maxBpm: 135,
    badges: ["Upbeat", "100–135 BPM"],
    explanation: "Upbeat favors livelier tempos with more movement and pace.",
  },
  {
    id: "dance",
    name: "Dance",
    description: "Steady dance-friendly tempo range.",
    minBpm: 120,
    maxBpm: 140,
    badges: ["Dance", "120–140 BPM"],
    explanation: "Dance focuses on steady tempos commonly useful for upbeat movement playlists.",
  },
  {
    id: "high-energy",
    name: "High Energy",
    description: "Fast tracks for workouts, hype, and intense playlists.",
    minBpm: 140,
    maxBpm: 180,
    badges: ["Fast", "140–180 BPM"],
    explanation: "High Energy pushes tempo higher for workouts, hype, and intense playlists.",
  },
  {
    id: "wide-open",
    name: "Wide Open",
    description: "Clears BPM limits and allows any tempo.",
    minBpm: null,
    maxBpm: null,
    badges: ["Flexible", "Any BPM"],
    explanation: "Wide Open clears BPM limits so tempo does not restrict the playlist.",
  },
];

export function getBpmPreset(id?: string | null) {
  return bpmPresets.find((preset) => preset.id === id) || null;
}

export function bpmPresetRangeLabel(preset?: Pick<BpmPreset, "minBpm" | "maxBpm"> | null) {
  if (!preset || (preset.minBpm == null && preset.maxBpm == null)) return "Any BPM";
  if (preset.minBpm != null && preset.maxBpm != null) return `${preset.minBpm}–${preset.maxBpm} BPM`;
  if (preset.minBpm != null) return `${preset.minBpm}+ BPM`;
  return `Up to ${preset.maxBpm} BPM`;
}

export function bpmPresetLabel(name?: string | null, modified?: boolean | null) {
  if (!name) return "Custom";
  return modified ? `${name} modified` : name;
}

export function buildBpmPresetRules(preset: BpmPreset): PlaylistRuleInput[] {
  return [
    ...(preset.minBpm == null ? [] : [{ field: "tempo" as const, operator: "gte" as const, value: String(preset.minBpm) }]),
    ...(preset.maxBpm == null ? [] : [{ field: "tempo" as const, operator: "lte" as const, value: String(preset.maxBpm) }]),
  ];
}
