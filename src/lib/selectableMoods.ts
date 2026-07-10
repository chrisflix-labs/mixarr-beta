import { getEffectiveAudioFeatures, type EffectiveAudioFeatureSettings } from "./audioFeatures";

export type SelectableMoodStatus = "not_enriched" | "pending" | "available" | "empty" | "error";

export type SelectableMood = {
  name: string;
  normalizedName: string;
  trackCount: number;
  percentage: number;
};

export type SelectableMoodIndex = {
  status: SelectableMoodStatus;
  libraryId?: string | null;
  serverId?: string | null;
  totalTracks: number;
  tracksWithMood: number;
  tracksWithoutMood: number;
  uniqueMoodCount: number;
  pendingTracks: number;
  inspectedTracks: number;
  moods: SelectableMood[];
  parsingFailures: Record<string, number>;
};

type MoodProfile = {
  name: string;
  normalizedName: string;
  valence: number;
  energy: number;
};

const placeholderMoodValues = new Set([
  "unknown",
  "none",
  "n/a",
  "n a",
  "na",
  "null",
  "undefined",
  "not found",
  "not_found",
  "no data",
  "no_data",
]);

const moodProfiles: MoodProfile[] = [
  { name: "Ambient", normalizedName: "ambient", valence: 0.5, energy: 0.15 },
  { name: "Chill", normalizedName: "chill", valence: 0.58, energy: 0.25 },
  { name: "Dark", normalizedName: "dark", valence: 0.16, energy: 0.55 },
  { name: "Emotional", normalizedName: "emotional", valence: 0.35, energy: 0.45 },
  { name: "Energetic", normalizedName: "energetic", valence: 0.74, energy: 0.86 },
  { name: "Focus", normalizedName: "focus", valence: 0.55, energy: 0.35 },
  { name: "Happy", normalizedName: "happy", valence: 0.9, energy: 0.62 },
  { name: "Hype", normalizedName: "hype", valence: 0.76, energy: 0.94 },
  { name: "Intense", normalizedName: "intense", valence: 0.35, energy: 0.92 },
  { name: "Mellow", normalizedName: "mellow", valence: 0.36, energy: 0.22 },
  { name: "Moody", normalizedName: "moody", valence: 0.28, energy: 0.46 },
  { name: "Party", normalizedName: "party", valence: 0.86, energy: 0.9 },
  { name: "Relaxed", normalizedName: "relaxed", valence: 0.62, energy: 0.22 },
  { name: "Sad", normalizedName: "sad", valence: 0.16, energy: 0.24 },
  { name: "Upbeat", normalizedName: "upbeat", valence: 0.84, energy: 0.76 },
  { name: "Workout", normalizedName: "workout", valence: 0.7, energy: 0.9 },
];

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeMoodName(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  const normalizedName = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalizedName || placeholderMoodValues.has(normalizedName)) return null;
  if (/^[\[{]/.test(trimmed) && !trimmed.includes(" ")) return null;
  return {
    name: titleCase(trimmed),
    normalizedName,
  };
}

function addFailure(failures: Record<string, number>, reason: string) {
  failures[reason] = (failures[reason] || 0) + 1;
}

function parseJsonMoodString(value: string, failures: Record<string, number>): unknown[] | null {
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{"]/.test(trimmed)) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    addFailure(failures, "malformed_json");
    return null;
  }
}

export function collectStoredMoodValues(value: unknown, failures: Record<string, number> = {}): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "number" || typeof value === "boolean") return [];
  if (typeof value === "string") {
    const parsedJson = parseJsonMoodString(value, failures);
    if (parsedJson) return parsedJson.flatMap((item) => collectStoredMoodValues(item, failures));
    return value.split(/\s*(?:->|>|,|\||;|\n)\s*/).filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectStoredMoodValues(item, failures));
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return collectStoredMoodValues(item.name ?? item.value ?? item.label ?? item.mood, failures);
  }
  return [];
}

export function normalizeMoodList(values: unknown[], failures: Record<string, number> = {}) {
  const seen = new Set<string>();
  const moods: Array<{ name: string; normalizedName: string }> = [];
  for (const value of values.flatMap((item) => collectStoredMoodValues(item, failures))) {
    const mood = normalizeMoodName(value);
    if (!mood) continue;
    if (seen.has(mood.normalizedName)) continue;
    seen.add(mood.normalizedName);
    moods.push(mood);
  }
  return moods;
}

function unitValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

function profileDistance(profile: MoodProfile, mood: number, energy: number) {
  return Math.hypot(profile.valence - mood, profile.energy - energy);
}

export function deriveMoodAnchorsFromAudioFeatures(track: any, settings: EffectiveAudioFeatureSettings = {}) {
  const effective = getEffectiveAudioFeatures(track, settings);
  const mood = unitValue(effective.mood);
  if (mood === null) return [];
  const energy = unitValue(effective.energy) ?? 0.5;
  const ranked = moodProfiles
    .map((profile) => ({ profile, distance: profileDistance(profile, mood, energy) }))
    .sort((left, right) => left.distance - right.distance);
  const selected = ranked.slice(0, 2).filter((item, index) => index === 0 || item.distance <= 0.18);
  return selected.map((item) => ({
    name: item.profile.name,
    normalizedName: item.profile.normalizedName,
  }));
}

export function collectTrackSelectableMoods(track: any, settings: EffectiveAudioFeatureSettings = {}, failures: Record<string, number> = {}) {
  const explicitMoods = normalizeMoodList([
    track?.moodTags,
    track?.moods,
    track?.moodTag,
    typeof track?.mood === "string" ? track.mood : null,
    track?.metadata?.mood,
    track?.metadata?.moods,
    track?.metadata?.moodTags,
    track?.audioFeature?.mood,
    track?.audioFeature?.moods,
    track?.audioFeature?.moodTag,
    track?.audioFeature?.moodLabel,
    track?.audioFeature?.moodTags,
    ...(Array.isArray(track?.tags) ? track.tags.filter((tag: any) => !tag?.type || tag.type === "mood") : []),
    ...(Array.isArray(track?.artist?.tags) ? track.artist.tags.filter((tag: any) => !tag?.type || tag.type === "mood") : []),
    ...(Array.isArray(track?.album?.tags) ? track.album.tags.filter((tag: any) => !tag?.type || tag.type === "mood") : []),
  ], failures);
  const derivedMoods = deriveMoodAnchorsFromAudioFeatures(track, settings);
  const seen = new Set<string>();
  return [...explicitMoods, ...derivedMoods].filter((mood) => {
    if (seen.has(mood.normalizedName)) return false;
    seen.add(mood.normalizedName);
    return true;
  });
}

function trackWasInspected(track: any) {
  return Boolean(track?.audioFeature)
    || (Array.isArray(track?.tags) && track.tags.length > 0)
    || (Array.isArray(track?.artist?.tags) && track.artist.tags.length > 0)
    || (Array.isArray(track?.album?.tags) && track.album.tags.length > 0);
}

export function aggregateSelectableMoodIndexFromTracks({
  tracks,
  libraryId,
  serverId,
  settings = {},
}: {
  tracks: any[];
  libraryId?: string | null;
  serverId?: string | null;
  settings?: EffectiveAudioFeatureSettings;
}): SelectableMoodIndex {
  const activeTracks = tracks.filter((track) => {
    if (track?.syncStatus && track.syncStatus !== "active") return false;
    if (libraryId && track?.libraryId && track.libraryId !== libraryId) return false;
    const trackServerId = track?.serverId || track?.library?.serverId || track?.library?.server?.id;
    if (serverId && trackServerId && trackServerId !== serverId) return false;
    return true;
  });
  const counts = new Map<string, { name: string; trackIds: Set<string> }>();
  const parsingFailures: Record<string, number> = {};
  let tracksWithMood = 0;
  let pendingTracks = 0;
  let inspectedTracks = 0;

  for (const track of activeTracks) {
    if (trackWasInspected(track)) inspectedTracks += 1;
    if (track?.audioFeature?.audioFeatureStatus === "pending") pendingTracks += 1;
    const moods = collectTrackSelectableMoods(track, settings, parsingFailures);
    if (moods.length > 0) tracksWithMood += 1;
    for (const mood of moods) {
      const entry = counts.get(mood.normalizedName) || { name: mood.name, trackIds: new Set<string>() };
      entry.trackIds.add(String(track.id || `${mood.normalizedName}-${entry.trackIds.size}`));
      counts.set(mood.normalizedName, entry);
    }
  }

  const totalTracks = activeTracks.length;
  const moods = Array.from(counts.entries())
    .map(([normalizedName, entry]) => ({
      name: entry.name,
      normalizedName,
      trackCount: entry.trackIds.size,
      percentage: totalTracks > 0 ? Math.round(entry.trackIds.size / totalTracks * 10000) / 100 : 0,
    }))
    .sort((left, right) => right.trackCount - left.trackCount || left.name.localeCompare(right.name));

  const status: SelectableMoodStatus = moods.length > 0
    ? "available"
    : pendingTracks > 0
      ? "pending"
      : inspectedTracks === 0
        ? "not_enriched"
        : "empty";

  return {
    status,
    libraryId,
    serverId,
    totalTracks,
    tracksWithMood,
    tracksWithoutMood: Math.max(0, totalTracks - tracksWithMood),
    uniqueMoodCount: moods.length,
    pendingTracks,
    inspectedTracks,
    moods,
    parsingFailures,
  };
}
