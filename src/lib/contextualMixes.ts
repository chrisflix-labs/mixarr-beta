import { z } from "zod";
import { getTrackBpm, getTrackEnergy, getTrackPopularity } from "./smartMixEngine/v2/metadataFallbacks";
import { getTrackMoodTags } from "./smartMixEngine/v2/moodBlending";
import { discoveryPreset } from "./smartMixEngine/v2/discovery";
import { normalizeSmartMixTuningConfig, type SmartMixTuningConfig } from "./smartMixEngine/v2/tuning";

export const CONTEXT_PROFILE_VERSION = "1";
export const CONTEXT_SCORING_VERSION = "2.1.6-context-1";
export const contextTypes = ["TIME_OF_DAY", "DAY_OF_WEEK", "SEASON", "ACTIVITY", "CUSTOM"] as const;
export const contextInfluenceLevels = ["LOW", "BALANCED", "STRONG"] as const;
export const timeOfDayValues = ["EARLY_MORNING", "MORNING", "AFTERNOON", "EVENING", "LATE_NIGHT"] as const;
export const dayOfWeekValues = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export const seasonValues = ["SPRING", "SUMMER", "AUTUMN", "WINTER"] as const;
export const activityValues = ["WORKOUT", "DRIVING", "FOCUS", "PARTY", "RELAXATION"] as const;

const slider = z.coerce.number().min(0).max(100);
const optionalSlider = slider.optional().nullable();
const optionalBpm = z.coerce.number().min(30).max(300).optional().nullable();

export const contextAvailabilitySchema = z.object({
  timeOfDay: z.array(z.enum(timeOfDayValues)).max(5).default([]),
  daysOfWeek: z.array(z.enum(dayOfWeekValues)).max(7).default([]),
  seasons: z.array(z.enum(seasonValues)).max(4).default([]),
  activities: z.array(z.enum(activityValues)).max(5).default([]),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
}).default({});

export const contextBehaviorSchema = z.object({
  targetEnergy: optionalSlider,
  energyRangeMin: optionalSlider,
  energyRangeMax: optionalSlider,
  discoveryLevel: slider.default(50),
  familiarityWeight: slider.default(50),
  popularityWeight: slider.default(50),
  targetBpmMin: optionalBpm,
  targetBpmMax: optionalBpm,
  bpmFlowMode: z.enum(["RAMP_UP", "RAMP_DOWN", "STEADY", "NATURAL", "DISABLED"]).default("NATURAL"),
  preferredMoods: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  avoidedMoods: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  artistVariety: slider.default(50),
  albumVariety: slider.default(50),
  repeatTolerance: slider.default(50),
  preferRecentAdditions: z.boolean().default(false),
  avoidRecentlyPlayed: z.boolean().default(true),
  preferDeepCuts: z.boolean().default(false),
  preferKnownFavorites: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.energyRangeMin != null && value.energyRangeMax != null && value.energyRangeMin > value.energyRangeMax) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["energyRangeMax"], message: "Maximum energy must be at least the minimum energy." });
  }
  if (value.targetBpmMin != null && value.targetBpmMax != null && value.targetBpmMin > value.targetBpmMax) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetBpmMax"], message: "Maximum BPM must be at least the minimum BPM." });
  }
});

export const customContextInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  icon: z.string().trim().max(40).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  contextType: z.enum(contextTypes).default("CUSTOM"),
  isEnabled: z.boolean().default(true),
  availability: contextAvailabilitySchema,
  behavior: contextBehaviorSchema,
});

export type ContextAvailability = z.infer<typeof contextAvailabilitySchema>;
export type ContextBehavior = z.infer<typeof contextBehaviorSchema>;
export type ContextInfluence = typeof contextInfluenceLevels[number];
export type ContextProfile = z.infer<typeof customContextInputSchema> & {
  id: string;
  userId?: string | null;
  builtInKey?: string | null;
  builtInVersion: string;
  isBuiltIn: boolean;
  clonedFromBuiltInKey?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

type BuiltInDefinition = Omit<ContextProfile, "userId" | "createdAt" | "updatedAt">;

function builtIn(key: string, value: Omit<BuiltInDefinition, "id" | "builtInKey" | "builtInVersion" | "isBuiltIn" | "isEnabled" | "tags"> & { tags?: string[] }): BuiltInDefinition {
  return customContextInputSchema.parse({ ...value, tags: value.tags || [], isEnabled: true }) && {
    ...value,
    id: `builtin:${key}`,
    builtInKey: key,
    builtInVersion: CONTEXT_PROFILE_VERSION,
    isBuiltIn: true,
    isEnabled: true,
    tags: value.tags || [],
  };
}

export const BUILT_IN_CONTEXT_PROFILES: ContextProfile[] = [
  builtIn("monday_morning_focus", {
    name: "Monday Morning Focus", description: "Calm, productive music with familiar anchors and gentle transitions.", icon: "brain", contextType: "ACTIVITY",
    availability: { timeOfDay: ["MORNING"], daysOfWeek: ["MONDAY"], seasons: [], activities: ["FOCUS"], startTime: null, endTime: null },
    behavior: { targetEnergy: 38, energyRangeMin: 20, energyRangeMax: 58, discoveryLevel: 35, familiarityWeight: 68, popularityWeight: 52, targetBpmMin: 70, targetBpmMax: 118, bpmFlowMode: "STEADY", preferredMoods: ["Focus", "Chill", "Relaxed"], avoidedMoods: ["Hype", "Intense"], artistVariety: 70, albumVariety: 64, repeatTolerance: 25, preferRecentAdditions: false, avoidRecentlyPlayed: true, preferDeepCuts: false, preferKnownFavorites: true },
  }),
  builtIn("friday_night_energy", {
    name: "Friday Night Energy", description: "Upbeat, high-energy tracks with a confident rising flow.", icon: "zap", contextType: "DAY_OF_WEEK",
    availability: { timeOfDay: ["EVENING", "LATE_NIGHT"], daysOfWeek: ["FRIDAY"], seasons: [], activities: ["PARTY"], startTime: null, endTime: null },
    behavior: { targetEnergy: 86, energyRangeMin: 65, energyRangeMax: 100, discoveryLevel: 52, familiarityWeight: 62, popularityWeight: 66, targetBpmMin: 105, targetBpmMax: 155, bpmFlowMode: "RAMP_UP", preferredMoods: ["Energetic", "Upbeat", "Party"], avoidedMoods: ["Mellow", "Sad"], artistVariety: 72, albumVariety: 66, repeatTolerance: 45, preferRecentAdditions: false, avoidRecentlyPlayed: false, preferDeepCuts: false, preferKnownFavorites: true },
  }),
  builtIn("late_night_drive", {
    name: "Late Night Drive", description: "Moody, atmospheric music with smooth transitions and deeper discovery.", icon: "car", contextType: "ACTIVITY",
    availability: { timeOfDay: ["LATE_NIGHT"], daysOfWeek: [], seasons: [], activities: ["DRIVING"], startTime: null, endTime: null },
    behavior: { targetEnergy: 62, energyRangeMin: 42, energyRangeMax: 80, discoveryLevel: 68, familiarityWeight: 38, popularityWeight: 42, targetBpmMin: 78, targetBpmMax: 132, bpmFlowMode: "NATURAL", preferredMoods: ["Moody", "Ambient", "Energetic"], avoidedMoods: ["Hype"], artistVariety: 72, albumVariety: 70, repeatTolerance: 30, preferRecentAdditions: false, avoidRecentlyPlayed: true, preferDeepCuts: true, preferKnownFavorites: false },
  }),
  builtIn("weekend_discovery", {
    name: "Weekend Discovery", description: "Underplayed tracks, hidden gems, and broad artist variety with familiar touchstones.", icon: "compass", contextType: "DAY_OF_WEEK",
    availability: { timeOfDay: [], daysOfWeek: ["SATURDAY", "SUNDAY"], seasons: [], activities: [], startTime: null, endTime: null },
    behavior: { targetEnergy: 55, energyRangeMin: 15, energyRangeMax: 95, discoveryLevel: 88, familiarityWeight: 22, popularityWeight: 25, targetBpmMin: null, targetBpmMax: null, bpmFlowMode: "NATURAL", preferredMoods: [], avoidedMoods: [], artistVariety: 88, albumVariety: 86, repeatTolerance: 15, preferRecentAdditions: true, avoidRecentlyPlayed: true, preferDeepCuts: true, preferKnownFavorites: false },
  }),
  builtIn("sunday_acoustic", {
    name: "Sunday Acoustic", description: "Warm, relaxed selections with soft energy and forgiving metadata fallbacks.", icon: "guitar", contextType: "DAY_OF_WEEK",
    availability: { timeOfDay: [], daysOfWeek: ["SUNDAY"], seasons: [], activities: ["RELAXATION"], startTime: null, endTime: null },
    behavior: { targetEnergy: 28, energyRangeMin: 8, energyRangeMax: 48, discoveryLevel: 35, familiarityWeight: 66, popularityWeight: 48, targetBpmMin: 55, targetBpmMax: 108, bpmFlowMode: "STEADY", preferredMoods: ["Relaxed", "Mellow", "Chill"], avoidedMoods: ["Hype", "Intense"], artistVariety: 62, albumVariety: 60, repeatTolerance: 35, preferRecentAdditions: false, avoidRecentlyPlayed: false, preferDeepCuts: false, preferKnownFavorites: true },
  }),
  builtIn("summer_party", {
    name: "Summer Party", description: "Recognizable, happy party tracks with high energy and wide artist variety.", icon: "sun", contextType: "SEASON",
    availability: { timeOfDay: [], daysOfWeek: [], seasons: ["SUMMER"], activities: ["PARTY"], startTime: null, endTime: null },
    behavior: { targetEnergy: 88, energyRangeMin: 62, energyRangeMax: 100, discoveryLevel: 50, familiarityWeight: 66, popularityWeight: 72, targetBpmMin: 100, targetBpmMax: 155, bpmFlowMode: "RAMP_UP", preferredMoods: ["Happy", "Energetic", "Party", "Upbeat"], avoidedMoods: ["Sad", "Mellow"], artistVariety: 82, albumVariety: 72, repeatTolerance: 42, preferRecentAdditions: true, avoidRecentlyPlayed: false, preferDeepCuts: false, preferKnownFavorites: true },
  }),
  builtIn("winter_chill", {
    name: "Winter Chill", description: "Chill, ambient tracks with stable tempo and gentle mood movement.", icon: "snowflake", contextType: "SEASON",
    availability: { timeOfDay: [], daysOfWeek: [], seasons: ["WINTER"], activities: ["RELAXATION"], startTime: null, endTime: null },
    behavior: { targetEnergy: 34, energyRangeMin: 12, energyRangeMax: 55, discoveryLevel: 52, familiarityWeight: 48, popularityWeight: 42, targetBpmMin: 55, targetBpmMax: 112, bpmFlowMode: "STEADY", preferredMoods: ["Chill", "Ambient", "Relaxed", "Moody"], avoidedMoods: ["Hype", "Intense"], artistVariety: 64, albumVariety: 62, repeatTolerance: 32, preferRecentAdditions: false, avoidRecentlyPlayed: true, preferDeepCuts: false, preferKnownFavorites: false },
  }),
];

export const contextSelectionSchema = z.object({
  profileId: z.string().trim().min(1).max(160),
  builtInKey: z.string().trim().max(120).optional().nullable(),
  profileName: z.string().trim().min(1).max(120),
  profileVersion: z.string().trim().min(1).max(40).default(CONTEXT_PROFILE_VERSION),
  isBuiltIn: z.boolean().default(false),
  influence: z.enum(contextInfluenceLevels).default("BALANCED"),
  behavior: contextBehaviorSchema,
  availability: contextAvailabilitySchema,
  manualOverrides: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  appliedAt: z.string().datetime().optional(),
});

export type ContextSelection = z.infer<typeof contextSelectionSchema>;

export function contextInfluenceCap(level: ContextInfluence) {
  return level === "LOW" ? 4 : level === "STRONG" ? 12 : 8;
}

export function energyLabel(value: number | null | undefined) {
  if (value == null) return "Flexible";
  return value < 40 ? "Low" : value < 70 ? "Medium" : "High";
}

export function discoveryLabel(value: number) {
  return value < 40 ? "Low" : value < 70 ? "Medium" : "High";
}

export function contextToSmartMixSettings(profile: ContextProfile, current: SmartMixTuningConfig = normalizeSmartMixTuningConfig(undefined)) {
  const behavior = contextBehaviorSchema.parse(profile.behavior);
  const discoveryLevel = behavior.discoveryLevel < 40 ? "low" : behavior.discoveryLevel >= 70 ? "high" : "medium";
  return normalizeSmartMixTuningConfig({
    ...current,
    familiarityDiscoveryBalance: behavior.familiarityWeight,
    popularityWeight: behavior.popularityWeight,
    energyWeight: behavior.targetEnergy == null ? current.energyWeight : Math.max(55, Math.abs(behavior.targetEnergy - 50) + 55),
    moodWeight: behavior.preferredMoods.length || behavior.avoidedMoods.length ? 72 : current.moodWeight,
    bpmWeight: behavior.bpmFlowMode === "DISABLED" ? current.bpmWeight : 78,
    artistVariety: behavior.artistVariety,
    albumVariety: behavior.albumVariety,
    avoidRecentlyUsedTracks: behavior.avoidRecentlyPlayed,
    discovery: {
      ...discoveryPreset(discoveryLevel),
      level: discoveryLevel,
      deepCutTarget: behavior.preferDeepCuts ? Math.max(55, behavior.discoveryLevel) : Math.round(behavior.discoveryLevel * 0.65),
      avoidRecentlyUsedPlaylistTracks: behavior.avoidRecentlyPlayed,
    },
    bpmFlow: {
      ...current.bpmFlow,
      enabled: behavior.bpmFlowMode !== "DISABLED",
      mode: behavior.bpmFlowMode,
      strength: behavior.bpmFlowMode === "STEADY" ? 85 : 72,
      maxPreferredGap: behavior.bpmFlowMode === "STEADY" || behavior.bpmFlowMode === "NATURAL" ? 8 : 10,
      allowJumps: behavior.bpmFlowMode === "RAMP_UP" && behavior.targetEnergy != null && behavior.targetEnergy >= 80,
    },
    presetName: profile.name,
  });
}

function normalizedFeature(value: number | null) {
  if (value == null) return null;
  return value > 1 ? Math.min(1, Math.max(0, value / 100)) : Math.min(1, Math.max(0, value));
}

export type ContextScoreResult = {
  adjustment: number;
  rawAdjustment: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
  missingMetadata: string[];
};

export function scoreContextMatch(track: any, selection: ContextSelection): ContextScoreResult {
  const context = contextSelectionSchema.parse(selection);
  const behavior = context.behavior;
  const cap = contextInfluenceCap(context.influence);
  const energy = normalizedFeature(getTrackEnergy(track));
  const bpm = getTrackBpm(track);
  const popularity = getTrackPopularity(track);
  const moodTags = getTrackMoodTags(track).map((value) => value.toLowerCase());
  const preferred = behavior.preferredMoods.map((value) => value.toLowerCase());
  const avoided = behavior.avoidedMoods.map((value) => value.toLowerCase());
  const reasons: string[] = [];
  const missingMetadata: string[] = [];
  let raw = 0;
  let knownSignals = 0;

  if (energy == null) missingMetadata.push("energy");
  else if (behavior.targetEnergy != null) {
    knownSignals += 1;
    const distance = Math.abs(energy * 100 - behavior.targetEnergy);
    const delta = 4.5 - distance / 12;
    raw += delta;
    reasons.push(delta >= 0 ? `Matches the ${energyLabel(behavior.targetEnergy).toLowerCase()} energy target` : "Energy falls outside the preferred character");
    const inPreferredRange = (behavior.energyRangeMin == null || energy * 100 >= behavior.energyRangeMin) && (behavior.energyRangeMax == null || energy * 100 <= behavior.energyRangeMax);
    raw += inPreferredRange ? 1 : -2;
    if (!inPreferredRange) reasons.push("Energy exceeds the preferred context range");
  }

  if (bpm == null) missingMetadata.push("BPM");
  else if (behavior.targetBpmMin != null || behavior.targetBpmMax != null) {
    knownSignals += 1;
    const inRange = (behavior.targetBpmMin == null || bpm >= behavior.targetBpmMin) && (behavior.targetBpmMax == null || bpm <= behavior.targetBpmMax);
    raw += inRange ? 2.5 : -2.5;
    reasons.push(inRange ? "BPM is within the preferred range" : "BPM is outside the preferred range");
  }

  if (!moodTags.length) missingMetadata.push("mood");
  else if (preferred.length || avoided.length) {
    knownSignals += 1;
    const preferredMatches = preferred.filter((mood) => moodTags.some((tag) => tag.includes(mood) || mood.includes(tag)));
    const avoidedMatches = avoided.filter((mood) => moodTags.some((tag) => tag.includes(mood) || mood.includes(tag)));
    raw += Math.min(4, preferredMatches.length * 2.5) - Math.min(5, avoidedMatches.length * 3);
    if (preferredMatches.length) reasons.push(`Mood matches ${preferredMatches.slice(0, 3).join(", ")}`);
    if (avoidedMatches.length) reasons.push(`Mood conflicts with ${avoidedMatches.slice(0, 3).join(", ")}`);
  }

  if (popularity == null) missingMetadata.push("popularity");
  else {
    knownSignals += 1;
    if (behavior.preferDeepCuts) {
      const delta = popularity < 55 ? 2.5 : -1.5;
      raw += delta;
      reasons.push(delta > 0 ? "Supports deeper discovery" : "More popular than this discovery context prefers");
    } else if (behavior.preferKnownFavorites) {
      const delta = popularity >= 55 ? 2 : -0.5;
      raw += delta;
      reasons.push(delta > 0 ? "Provides a recognizable anchor" : "Has limited familiarity evidence");
    }
  }

  if (behavior.preferRecentAdditions && track.addedAt) {
    const ageDays = Math.max(0, (Date.now() - new Date(track.addedAt).getTime()) / 86_400_000);
    const delta = ageDays <= 180 ? 2 : 0;
    raw += delta;
    if (delta) reasons.push("Recently added to the library");
  }

  const confidenceMultiplier = knownSignals >= 4 ? 1 : knownSignals >= 2 ? 0.8 : 0.55;
  const adjustment = Math.round(Math.max(-cap, Math.min(cap, raw * confidenceMultiplier)) * 1000) / 1000;
  return {
    adjustment,
    rawAdjustment: Math.round(raw * 1000) / 1000,
    confidence: knownSignals >= 4 ? "HIGH" : knownSignals >= 2 ? "MEDIUM" : "LOW",
    reasons: reasons.length ? reasons : ["Limited metadata; context scoring remained neutral"],
    missingMetadata,
  };
}

export function detectContextIdentityConflict(context: ContextBehavior, identity: { targetEnergy?: number | null; energyRangeMin?: number | null; energyRangeMax?: number | null } | null | undefined) {
  if (!identity || context.targetEnergy == null) return null;
  const identityTarget = identity.targetEnergy ?? (identity.energyRangeMin != null && identity.energyRangeMax != null ? (identity.energyRangeMin + identity.energyRangeMax) / 2 : null);
  if (identityTarget == null || Math.abs(identityTarget - context.targetEnergy) < 35) return null;
  return {
    severity: "warning" as const,
    defaultResolution: "BALANCE" as const,
    message: `Playlist identity targets ${energyLabel(identityTarget).toLowerCase()} energy while this context targets ${energyLabel(context.targetEnergy).toLowerCase()} energy.`,
    options: ["PRESERVE_IDENTITY", "BALANCE", "PRIORITIZE_CONTEXT"] as const,
  };
}

export function timeRangeContains(time: string, start: string, end: string) {
  const minutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
  const current = minutes(time); const from = minutes(start); const to = minutes(end);
  return from <= to ? current >= from && current <= to : current >= from || current <= to;
}

export function profileMatchesDate(profile: ContextProfile, date: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const day = value("weekday").toUpperCase();
  const month = Number(value("month"));
  const season = month >= 3 && month <= 5 ? "SPRING" : month >= 6 && month <= 8 ? "SUMMER" : month >= 9 && month <= 11 ? "AUTUMN" : "WINTER";
  const hour = Number(value("hour"));
  const timeOfDay = hour < 6 ? "EARLY_MORNING" : hour < 12 ? "MORNING" : hour < 17 ? "AFTERNOON" : hour < 22 ? "EVENING" : "LATE_NIGHT";
  const availability = profile.availability;
  return (!availability.daysOfWeek.length || availability.daysOfWeek.includes(day as any))
    && (!availability.seasons.length || availability.seasons.includes(season as any))
    && (!availability.timeOfDay.length || availability.timeOfDay.includes(timeOfDay as any))
    && (!availability.startTime || !availability.endTime || timeRangeContains(`${String(hour).padStart(2, "0")}:${value("minute")}`, availability.startTime, availability.endTime));
}

export function contextProfileSnapshot(profile: ContextProfile, influence: ContextInfluence, manualOverrides: string[] = []): ContextSelection {
  return contextSelectionSchema.parse({
    profileId: profile.id,
    builtInKey: profile.builtInKey,
    profileName: profile.name,
    profileVersion: profile.builtInVersion,
    isBuiltIn: profile.isBuiltIn,
    influence,
    behavior: profile.behavior,
    availability: profile.availability,
    manualOverrides,
    appliedAt: new Date().toISOString(),
  });
}
