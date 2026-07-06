import type { PlaylistRuleInput } from "./playlistService";

export const MOOD_PRESET_VERSION = "v1";

export type MoodPresetRange = [number, number] | null;

export type MoodPreset = {
  id: string;
  name: string;
  description: string;
  moodRange: MoodPresetRange;
  energyRange: MoodPresetRange;
  bpmRange?: MoodPresetRange;
  badges?: string[];
  explanation: string;
};

const audioMoodFields = new Set<PlaylistRuleInput["field"]>(["energy", "valence", "tempo"]);

function rangeRules(field: PlaylistRuleInput["field"], range?: MoodPresetRange): PlaylistRuleInput[] {
  if (!range) return [];
  const [min, max] = range;
  return [
    { field, operator: "gte", value: String(min) },
    { field, operator: "lte", value: String(max) },
  ];
}

export const moodPresets: MoodPreset[] = [
  {
    id: "happy",
    name: "Happy",
    description: "Bright mood with moderate-to-high lift.",
    moodRange: [0.7, 1],
    energyRange: [0.4, 0.9],
    bpmRange: [85, 140],
    badges: ["High Mood"],
    explanation: "Happy favors higher mood with moderate-to-high energy.",
  },
  {
    id: "chill",
    name: "Chill",
    description: "Lower energy and slower pacing.",
    moodRange: [0.35, 0.75],
    energyRange: [0, 0.45],
    bpmRange: [60, 110],
    badges: ["Low Energy", "Slow BPM"],
    explanation: "Chill lowers energy and keeps BPM slower for relaxed listening.",
  },
  {
    id: "hype",
    name: "Hype",
    description: "Intense energy with faster tempos.",
    moodRange: [0.65, 1],
    energyRange: [0.75, 1],
    bpmRange: [120, 170],
    badges: ["High Energy", "Fast BPM"],
    explanation: "Hype pushes energy and BPM higher for more intense playlists.",
  },
  {
    id: "dark",
    name: "Dark",
    description: "Lower mood with flexible intensity.",
    moodRange: [0, 0.35],
    energyRange: [0.2, 0.85],
    bpmRange: null,
    badges: ["Low Mood", "Flexible"],
    explanation: "Dark favors lower mood while allowing a wider energy range.",
  },
  {
    id: "emotional",
    name: "Emotional",
    description: "Lower-to-mid mood with restrained energy.",
    moodRange: [0.2, 0.65],
    energyRange: [0.1, 0.65],
    bpmRange: [60, 125],
    badges: ["Low Mood"],
    explanation: "Emotional keeps mood lower-to-mid with measured energy and tempo.",
  },
  {
    id: "sad-mellow",
    name: "Sad / Mellow",
    description: "Soft, low mood, low energy songs.",
    moodRange: [0, 0.4],
    energyRange: [0, 0.45],
    bpmRange: [55, 105],
    badges: ["Low Mood", "Low Energy", "Slow BPM"],
    explanation: "Sad / Mellow favors lower mood, lower energy, and slower BPM.",
  },
  {
    id: "relaxed",
    name: "Relaxed",
    description: "Easy energy with comfortable tempo.",
    moodRange: [0.35, 0.8],
    energyRange: [0, 0.4],
    bpmRange: [60, 115],
    badges: ["Low Energy", "Slow BPM"],
    explanation: "Relaxed keeps energy low while allowing a comfortable mood range.",
  },
  {
    id: "focus",
    name: "Focus",
    description: "Steady, moderate, less distracting.",
    moodRange: [0.35, 0.75],
    energyRange: [0.15, 0.55],
    bpmRange: [70, 125],
    badges: ["Low Energy"],
    explanation: "Focus keeps mood and energy moderate so the playlist stays steady.",
  },
  {
    id: "upbeat",
    name: "Upbeat",
    description: "Positive mood and driving energy.",
    moodRange: [0.65, 1],
    energyRange: [0.55, 1],
    bpmRange: [100, 150],
    badges: ["High Mood", "High Energy"],
    explanation: "Upbeat favors positive mood with higher energy and a lively BPM range.",
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "Clears mood-specific limits.",
    moodRange: null,
    energyRange: null,
    bpmRange: null,
    badges: ["Flexible"],
    explanation: "Balanced clears mood-specific limits and keeps the playlist flexible.",
  },
];

export function getMoodPreset(id?: string | null) {
  return moodPresets.find((preset) => preset.id === id) || null;
}

export function buildMoodPresetRules(preset: MoodPreset): PlaylistRuleInput[] {
  return [
    ...rangeRules("valence", preset.moodRange),
    ...rangeRules("energy", preset.energyRange),
    ...rangeRules("tempo", preset.bpmRange),
  ];
}

export function removeMoodPresetRules(rules: PlaylistRuleInput[]) {
  return rules.filter((rule) => !audioMoodFields.has(rule.field));
}

export function applyMoodPresetToRules(rules: PlaylistRuleInput[], preset: MoodPreset) {
  return [
    ...removeMoodPresetRules(rules),
    ...buildMoodPresetRules(preset),
  ];
}

export function moodPresetLabel(name?: string | null, modified?: boolean | null) {
  if (!name) return "Custom";
  return modified ? `${name} modified` : name;
}

export function isMoodPresetRuleField(field?: string | null) {
  return audioMoodFields.has(field as PlaylistRuleInput["field"]);
}
