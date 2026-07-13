import { normalizeMoodList } from "./selectableMoods";

export const CORRECTABLE_METADATA_FIELDS = ["bpm", "mood", "energy"] as const;
export type CorrectableMetadataField = typeof CORRECTABLE_METADATA_FIELDS[number];

export const METADATA_SOURCES = ["api", "local", "embedded", "imported", "fallback"] as const;
export type MetadataSource = typeof METADATA_SOURCES[number] | "manual" | "missing";

export type EffectiveMetadataValue<T> = {
  value: T | null;
  source: MetadataSource;
  corrected: boolean;
  verified: boolean;
  ignoredSources: string[];
  originalValue?: T | null;
  conflict: boolean;
  explanation: string;
};

export type ResolvedTrackMetadata = {
  bpm: EffectiveMetadataValue<number>;
  mood: EffectiveMetadataValue<string[]>;
  moodScore: EffectiveMetadataValue<number>;
  energy: EffectiveMetadataValue<number>;
  hasCorrection: boolean;
  hasVerification: boolean;
  hasIgnoredSource: boolean;
  hasConflict: boolean;
};

export const metadataCorrectionRelations = {
  metadataCorrections: { where: { isActive: true }, orderBy: { updatedAt: "desc" as const } },
  metadataVerifications: { where: { verified: true } },
  metadataSourceOverrides: { where: { ignored: true } },
} as const;

type Candidate<T> = { source: string; value: T | null };

const moodProfiles: Record<string, number> = {
  ambient: 0.5, chill: 0.58, dark: 0.16, emotional: 0.35, energetic: 0.74,
  focus: 0.55, happy: 0.9, hype: 0.76, intense: 0.35, mellow: 0.36,
  moody: 0.28, party: 0.86, relaxed: 0.62, sad: 0.16, upbeat: 0.84, workout: 0.7,
};

function finite(value: unknown, min = -Infinity, max = Infinity): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function normalizeMetadataSource(value: unknown): string {
  const source = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!source) return "embedded";
  if (source === "deezer" || source === "spotify" || source === "lastfm" || source.includes("api")) return "api";
  if (source === "essentia" || source === "aubio" || source.includes("local")) return "local";
  if (source.includes("plex") || source.includes("embed") || source.includes("file")) return "embedded";
  if (source.includes("legacy") || source.includes("import")) return "imported";
  return source;
}

export function isCorrectableMetadataField(value: unknown): value is CorrectableMetadataField {
  return CORRECTABLE_METADATA_FIELDS.includes(value as CorrectableMetadataField);
}

function activeCorrection(track: any, field: CorrectableMetadataField) {
  return (track?.metadataCorrections || []).find((item: any) => item.field === field && item.isActive !== false) || null;
}

function ignoredSources(track: any, field: CorrectableMetadataField) {
  return Array.from(new Set<string>((track?.metadataSourceOverrides || [])
    .filter((item: any) => item.field === field && item.ignored !== false)
    .map((item: any) => normalizeMetadataSource(item.source))));
}

function verifiedSources(track: any, field: CorrectableMetadataField) {
  return new Set<string>((track?.metadataVerifications || [])
    .filter((item: any) => item.field === field && item.verified !== false)
    .map((item: any) => normalizeMetadataSource(item.source)));
}

function pickCandidate<T>(candidates: Candidate<T>[], ignored: string[], verified: Set<string>) {
  const usable = candidates.filter((candidate) => candidate.value !== null && !ignored.includes(normalizeMetadataSource(candidate.source)));
  return usable.find((candidate) => verified.has(normalizeMetadataSource(candidate.source))) || usable[0] || null;
}

function numericConflict(values: Array<number | null>, tolerance: number, halfDouble = false) {
  const usable = values.filter((value): value is number => value !== null);
  for (let index = 0; index < usable.length; index += 1) {
    for (let right = index + 1; right < usable.length; right += 1) {
      const gap = Math.abs(usable[index] - usable[right]);
      if (gap > tolerance) return true;
      if (halfDouble && Math.abs(usable[index] * 2 - usable[right]) <= 2) return true;
    }
  }
  return false;
}

function manualNumber(correction: any, min: number, max: number) {
  return correction ? finite(correction.valueJson, min, max) : null;
}

function result<T>({ value, source, corrected = false, verified = false, ignored, originalValue, conflict = false, field }: {
  value: T | null; source: MetadataSource; corrected?: boolean; verified?: boolean; ignored: string[];
  originalValue?: T | null; conflict?: boolean; field: CorrectableMetadataField;
}): EffectiveMetadataValue<T> {
  const label = source === "missing" ? "No usable value" : `${source}${verified ? " (verified)" : ""}`;
  return {
    value, source, corrected, verified, ignoredSources: ignored, originalValue, conflict,
    explanation: `${field.toUpperCase()} resolved from ${label}${ignored.length ? `; ignored ${ignored.join(", ")}` : ""}.`,
  };
}

function resolveNumberField(track: any, field: "bpm" | "energy", candidates: Candidate<number>[], min: number, max: number) {
  const ignored = ignoredSources(track, field);
  const verified = verifiedSources(track, field);
  const correction = activeCorrection(track, field);
  const picked = pickCandidate(candidates, ignored, verified);
  const correctedValue = manualNumber(correction, min, max);
  const values = candidates.map((candidate) => candidate.value);
  const conflict = field === "bpm" ? numericConflict(values, 8, true) : numericConflict(values, 0.2);
  if (correction && correctedValue !== null) {
    return result({ value: correctedValue, source: "manual", corrected: true, verified: correction.isVerified !== false,
      ignored, originalValue: picked?.value ?? null, conflict: conflict || numericConflict([correctedValue, ...values], field === "bpm" ? 8 : 0.2), field });
  }
  if (!picked) return result<number>({ value: null, source: "missing", ignored, conflict, field });
  const source = normalizeMetadataSource(picked.source) as MetadataSource;
  return result({ value: picked.value, source, verified: verified.has(source), ignored, conflict, field });
}

function normalizeManualMoods(value: unknown) {
  const input = Array.isArray(value) ? value : [value];
  return normalizeMoodList(input).map((mood) => mood.name).slice(0, 12);
}

export function moodTagsToScore(moods: string[]): number | null {
  const values = moods.map((mood) => moodProfiles[mood.toLowerCase()]).filter((value): value is number => value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rawMoodTags(track: any) {
  return normalizeMoodList([
    track?.moodTags, track?.moods, typeof track?.mood === "string" ? track.mood : null,
    ...(Array.isArray(track?.tags) ? track.tags.filter((tag: any) => !tag.type || tag.type === "mood") : []),
  ]).map((mood) => mood.name).slice(0, 12);
}

export function resolveEffectiveTrackMetadata(track: any): ResolvedTrackMetadata {
  const bpmCandidates: Candidate<number>[] = [
    { source: normalizeMetadataSource(track?.bpmSource || "imported"), value: finite(track?.effectiveBpm, 1, 400) },
    { source: "api", value: finite(track?.apiBpm, 1, 400) },
    { source: "local", value: finite(track?.localBpm, 1, 400) },
    { source: normalizeMetadataSource(track?.bpmSource || "imported"), value: finite(track?.bpm, 1, 400) },
    { source: normalizeMetadataSource(track?.audioFeature?.tempoSource || "embedded"), value: finite(track?.audioFeature?.tempo ?? track?.tempo, 1, 400) },
  ];
  const energyCandidates: Candidate<number>[] = [
    { source: normalizeMetadataSource(track?.audioFeature?.energySource || track?.audioFeature?.source || "embedded"), value: finite(track?.audioFeature?.effectiveEnergy, 0, 1) },
    { source: "api", value: finite(track?.audioFeature?.apiEnergy, 0, 1) },
    { source: "local", value: finite(track?.audioFeature?.localEnergy, 0, 1) },
    { source: normalizeMetadataSource(track?.audioFeature?.energySource || track?.audioFeature?.source || "embedded"), value: finite(track?.audioFeature?.energy ?? track?.energy, 0, 1) },
  ];
  const bpm = resolveNumberField(track, "bpm", bpmCandidates, 1, 400);
  const energy = resolveNumberField(track, "energy", energyCandidates, 0, 1);

  const moodIgnored = ignoredSources(track, "mood");
  const moodVerified = verifiedSources(track, "mood");
  const moodCorrection = activeCorrection(track, "mood");
  const manualMoods = moodCorrection ? normalizeManualMoods(moodCorrection.valueJson) : [];
  const embeddedMoods = rawMoodTags(track);
  const moodCandidates: Candidate<number>[] = [
    { source: normalizeMetadataSource(track?.audioFeature?.valenceSource || track?.audioFeature?.source || "embedded"), value: finite(track?.audioFeature?.effectiveMood, 0, 1) },
    { source: "api", value: finite(track?.audioFeature?.apiMood, 0, 1) },
    { source: "local", value: finite(track?.audioFeature?.localMood, 0, 1) },
    { source: normalizeMetadataSource(track?.audioFeature?.valenceSource || track?.audioFeature?.source || "embedded"), value: finite(track?.audioFeature?.valence ?? track?.mood, 0, 1) },
  ];
  const pickedMoodScore = pickCandidate(moodCandidates, moodIgnored, moodVerified);
  const manualMoodScore = moodTagsToScore(manualMoods);
  const moodConflict = numericConflict(moodCandidates.map((candidate) => candidate.value), 0.25)
    || (manualMoodScore !== null && numericConflict([manualMoodScore, ...moodCandidates.map((candidate) => candidate.value)], 0.25));
  const mood = moodCorrection && manualMoods.length
    ? result({ value: manualMoods, source: "manual", corrected: true, verified: moodCorrection.isVerified !== false,
      ignored: moodIgnored, originalValue: embeddedMoods, conflict: moodConflict, field: "mood" })
    : embeddedMoods.length && !moodIgnored.includes("embedded")
      ? result({ value: embeddedMoods, source: "embedded", verified: moodVerified.has("embedded"), ignored: moodIgnored, conflict: moodConflict, field: "mood" })
      : result<string[]>({ value: null, source: "missing", ignored: moodIgnored, conflict: moodConflict, field: "mood" });
  const moodScore = moodCorrection && manualMoods.length
    ? result({ value: manualMoodScore, source: "manual", corrected: true, verified: moodCorrection.isVerified !== false,
      ignored: moodIgnored, originalValue: pickedMoodScore?.value ?? null, conflict: moodConflict, field: "mood" })
    : pickedMoodScore
      ? result({ value: pickedMoodScore.value, source: normalizeMetadataSource(pickedMoodScore.source) as MetadataSource,
        verified: moodVerified.has(normalizeMetadataSource(pickedMoodScore.source)), ignored: moodIgnored, conflict: moodConflict, field: "mood" })
      : result<number>({ value: null, source: "missing", ignored: moodIgnored, conflict: moodConflict, field: "mood" });

  const values = [bpm, mood, energy];
  return {
    bpm, mood, moodScore, energy,
    hasCorrection: values.some((value) => value.corrected),
    hasVerification: values.some((value) => value.verified),
    hasIgnoredSource: values.some((value) => value.ignoredSources.length > 0),
    hasConflict: values.some((value) => value.conflict),
  };
}

export function bpmCorrectionSuggestions(track: any) {
  const resolved = resolveEffectiveTrackMetadata(track);
  const values = [finite(track?.localBpm, 1, 400), finite(track?.apiBpm, 1, 400), resolved.bpm.value]
    .filter((value): value is number => value !== null);
  const suggestions = values.flatMap((value) => [
    { value: Math.round(value / 2 * 100) / 100, label: "Half-time" },
    { value: Math.round(value * 100) / 100, label: "Original" },
    { value: Math.round(value * 2 * 100) / 100, label: "Double-time" },
  ]);
  const seen = new Set<number>();
  return suggestions.filter((item) => item.value >= 1 && item.value <= 400 && !seen.has(item.value) && seen.add(item.value));
}
