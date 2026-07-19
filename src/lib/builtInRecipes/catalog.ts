import { defaultMixRecipeDocument, mixRecipeDocumentSchema, type MixRecipeDocument } from "../mixRecipes/schema";
import { playlistConfigSchema, type PlaylistRuleInput } from "../playlistService";

export const RECIPE_CATEGORY_IDS = [
  "workout", "driving", "focus", "party", "relaxation", "sleep", "discovery", "deep_cuts",
  "recently_added", "forgotten_favorites", "decade_mixes", "seasonal_mixes", "genre_journeys",
  "artist_radio", "album_exploration", "mood_progressions",
] as const;

export type RecipeCategory = typeof RECIPE_CATEGORY_IDS[number];
export type RecipeDifficulty = "beginner" | "intermediate" | "advanced";
export type DiscoveryLevel = "none" | "low" | "medium" | "high";
export type MetadataRequirementId =
  | "playback_history" | "ratings" | "bpm" | "mood" | "energy" | "genre" | "artist"
  | "album" | "date_added" | "release_year" | "popularity" | "local_analysis";
export type MetadataRequirement = { id: MetadataRequirementId; importance: "required" | "recommended" | "optional" };
export type RecipeHistoryEntry = { version: number; appVersion: string; summary: string };

export type BuiltInRecipeDefinition = {
  id: `builtin.${string}`;
  version: number;
  name: string;
  shortDescription: string;
  longDescription: string;
  category: RecipeCategory;
  tags: string[];
  difficulty: RecipeDifficulty;
  metadataRequirements: MetadataRequirement[];
  discoveryLevel: DiscoveryLevel;
  estimatedDurationMinutes: number;
  targetTrackCount: number;
  behaviorSummary: string[];
  importantExclusions: string[];
  expectedPlaylistShape: string;
  engineConfig: MixRecipeDocument;
  customizableFields: string[];
  builtIn: true;
  enabledByDefault: boolean;
  introducedInVersion: string;
  updatedInVersion: string;
  changeSummary: string;
  history: RecipeHistoryEntry[];
};

export const RECIPE_CATEGORY_LABELS: Record<RecipeCategory, string> = {
  workout: "Workout", driving: "Driving", focus: "Focus", party: "Party", relaxation: "Relaxation",
  sleep: "Sleep", discovery: "Discovery", deep_cuts: "Deep Cuts", recently_added: "Recently Added",
  forgotten_favorites: "Forgotten Favorites", decade_mixes: "Decade Mixes", seasonal_mixes: "Seasonal Mixes",
  genre_journeys: "Genre Journeys", artist_radio: "Artist Radio", album_exploration: "Album Exploration",
  mood_progressions: "Mood Progressions",
};

export const METADATA_LABELS: Record<MetadataRequirementId, string> = {
  playback_history: "Playback history", ratings: "Ratings", bpm: "BPM", mood: "Mood", energy: "Energy",
  genre: "Genre", artist: "Artist metadata", album: "Album metadata", date_added: "Date added",
  release_year: "Release year", popularity: "Popularity", local_analysis: "Local analysis",
};

type RecipeInput = Omit<BuiltInRecipeDefinition,
  "version" | "longDescription" | "tags" | "metadataRequirements" | "estimatedDurationMinutes" |
  "importantExclusions" | "expectedPlaylistShape" | "engineConfig" | "builtIn" | "enabledByDefault" |
  "introducedInVersion" | "updatedInVersion" | "changeSummary" | "history"
> & {
  longDescription?: string;
  tags?: string[];
  metadataRequirements?: MetadataRequirement[];
  estimatedDurationMinutes?: number;
  importantExclusions?: string[];
  expectedPlaylistShape?: string;
  rules?: PlaylistRuleInput[];
  negativeFilters?: Record<string, unknown>;
  scoring?: Record<string, unknown>;
  targets?: Record<string, unknown>;
  bpmFlow?: Record<string, unknown>;
  discovery?: Record<string, unknown>;
  variety?: Record<string, unknown>;
  identity?: Record<string, unknown>;
};

const req = (id: MetadataRequirementId, importance: MetadataRequirement["importance"] = "recommended"): MetadataRequirement => ({ id, importance });
const rule = (field: PlaylistRuleInput["field"], operator: PlaylistRuleInput["operator"], value: string): PlaylistRuleInput => ({ field, operator, value });

function recipe(input: RecipeInput): BuiltInRecipeDefinition {
  const categoryLabel = RECIPE_CATEGORY_LABELS[input.category];
  const generation = playlistConfigSchema.parse({
    rules: input.rules || [],
    limit: input.targetTrackCount,
    engineVersion: "v2",
    duplicateStrategy: "avoid_recordings",
    negativeFilters: { excludeIntroOutro: true, ...input.negativeFilters },
    safetyRules: { avoidSameArtistBackToBack: true, limitTracksPerArtist: true, maxTracksPerArtist: 3, limitTracksPerAlbum: true, maxTracksPerAlbum: 2, warnIfFewerThan: true, minimumTrackCount: Math.min(10, input.targetTrackCount) },
  });
  const base = defaultMixRecipeDocument({
    name: input.name,
    slug: input.id.slice("builtin.".length),
    description: input.shortDescription,
    category: categoryLabel,
  }, generation);
  const engineConfig = mixRecipeDocumentSchema.parse({
    ...base,
    scoring: { ...base.scoring, ...input.scoring },
    targets: { ...base.targets, ...input.targets },
    bpmFlow: { ...base.bpmFlow, ...input.bpmFlow },
    discovery: { ...base.discovery, level: input.discoveryLevel === "none" ? "low" : input.discoveryLevel, ...input.discovery },
    variety: { ...base.variety, ...input.variety },
    playlistIdentity: { ...base.playlistIdentity, personalitySummary: input.shortDescription, discoveryTolerance: input.discoveryLevel === "high" ? 85 : input.discoveryLevel === "medium" ? 60 : input.discoveryLevel === "low" ? 30 : 10, ...input.identity },
  });
  return {
    id: input.id, version: 1, name: input.name, shortDescription: input.shortDescription,
    longDescription: input.longDescription || input.shortDescription, category: input.category,
    tags: input.tags || [], difficulty: input.difficulty, metadataRequirements: input.metadataRequirements || [],
    discoveryLevel: input.discoveryLevel, estimatedDurationMinutes: input.estimatedDurationMinutes || Math.round(input.targetTrackCount * 3.7),
    targetTrackCount: input.targetTrackCount, behaviorSummary: input.behaviorSummary,
    importantExclusions: input.importantExclusions || ["Blocked tracks and manual exclusions", "Duplicate recordings when identifiable"],
    expectedPlaylistShape: input.expectedPlaylistShape || `${input.targetTrackCount} varied tracks with artist and album repetition controls.`,
    engineConfig, customizableFields: input.customizableFields, builtIn: true, enabledByDefault: true,
    introducedInVersion: "2.3.4", updatedInVersion: "2.3.4", changeSummary: `Initial ${input.name} recipe.`,
    history: [{ version: 1, appVersion: "2.3.4", summary: `Initial ${input.name} recipe.` }],
  };
}

const standardCustom = ["playlistName", "targetTrackCount", "discoveryLevel", "recentlyPlayedExclusion", "artistRepeatLimit", "albumRepeatLimit"];
const audioCustom = [...standardCustom, "bpmRange", "energy", "progressionDirection"];
const moodCustom = [...audioCustom, "mood"];

export const BUILT_IN_RECIPES: readonly BuiltInRecipeDefinition[] = [
  recipe({ id: "builtin.high-energy-workout", name: "High-Energy Workout", shortDescription: "Fast, energetic tracks with a motivating forward drive.", category: "workout", difficulty: "intermediate", discoveryLevel: "medium", targetTrackCount: 50, metadataRequirements: [req("bpm"), req("energy")], rules: [rule("tempo", "gte", "120"), rule("tempo", "lte", "180"), rule("energy", "gte", "0.65")], targets: { minimumEnergy: .65, maximumEnergy: 1, targetEnergy: .82, energyProgression: "wave" }, bpmFlow: { minimumBpm: 120, maximumBpm: 180, targetBpm: 145, mode: "NATURAL", maximumBpmGap: 12 }, discovery: { familiarityBalance: 55, deepCutPercentage: 35 }, behaviorSummary: ["Prefer high-energy tracks around 120–180 BPM.", "Keep momentum while allowing short recovery valleys.", "Balance familiar motivators with some discovery.", "Limit repeated artists and albums."], expectedPlaylistShape: "About 50 tracks with sustained energy and controlled tempo changes.", customizableFields: moodCustom }),
  recipe({ id: "builtin.steady-cardio", name: "Steady Cardio", shortDescription: "A consistent pulse for runs, cycling, and longer aerobic sessions.", category: "workout", difficulty: "intermediate", discoveryLevel: "low", targetTrackCount: 45, metadataRequirements: [req("bpm"), req("energy")], rules: [rule("tempo", "gte", "115"), rule("tempo", "lte", "150")], targets: { minimumEnergy: .55, maximumEnergy: .9, targetEnergy: .7, energyProgression: "steady" }, bpmFlow: { minimumBpm: 115, maximumBpm: 150, targetBpm: 132, mode: "STEADY", maximumBpmGap: 7 }, behaviorSummary: ["Keep tempo and energy consistent.", "Avoid disruptive BPM jumps.", "Favor familiar tracks over aggressive discovery."], customizableFields: audioCustom }),
  recipe({ id: "builtin.progressive-intensity", name: "Progressive Intensity", shortDescription: "Begin controlled and build toward a powerful finish.", category: "workout", difficulty: "advanced", discoveryLevel: "medium", targetTrackCount: 48, metadataRequirements: [req("bpm", "required"), req("energy", "required"), req("local_analysis")], rules: [rule("tempo", "gte", "95"), rule("tempo", "lte", "180")], targets: { minimumEnergy: .4, maximumEnergy: 1, energyProgression: "rising" }, bpmFlow: { minimumBpm: 95, maximumBpm: 180, mode: "RAMP_UP", maximumBpmGap: 10 }, behaviorSummary: ["Start at moderate energy.", "Increase tempo and energy across the playlist.", "Finish with the strongest tracks.", "Use smooth transitions where metadata permits."], customizableFields: moodCustom }),

  recipe({ id: "builtin.open-road", name: "Open Road", shortDescription: "Expansive, varied music for long drives and changing scenery.", category: "driving", difficulty: "beginner", discoveryLevel: "medium", targetTrackCount: 60, metadataRequirements: [req("popularity"), req("playback_history", "optional")], discovery: { familiarityBalance: 58, deepCutPercentage: 40 }, variety: { maximumTracksPerArtist: 2, minimumArtistSpacing: 2 }, behaviorSummary: ["Mix familiar favorites with worthwhile discoveries.", "Use broad pacing rather than a strict BPM band.", "Keep artists well spaced on a long journey."], customizableFields: standardCustom }),
  recipe({ id: "builtin.night-drive", name: "Night Drive", shortDescription: "Moody, smooth tracks with a restrained late-night pulse.", category: "driving", difficulty: "intermediate", discoveryLevel: "medium", targetTrackCount: 45, metadataRequirements: [req("mood"), req("energy"), req("bpm")], targets: { selectedMoods: ["atmospheric", "calm"], primaryMood: "atmospheric", minimumEnergy: .25, maximumEnergy: .75, targetEnergy: .5, moodBlendMode: "smooth_transition", moodTransition: "smooth" }, bpmFlow: { minimumBpm: 65, maximumBpm: 135, mode: "NATURAL", maximumBpmGap: 9 }, behaviorSummary: ["Favor atmospheric and reflective tracks.", "Keep energy controlled.", "Use smooth mood and tempo transitions.", "Leave room for moderate discovery."], customizableFields: moodCustom }),

  recipe({ id: "builtin.deep-focus", name: "Deep Focus", shortDescription: "Low-distraction listening that stays calm and consistent.", category: "focus", difficulty: "beginner", discoveryLevel: "low", targetTrackCount: 50, metadataRequirements: [req("mood"), req("energy")], negativeFilters: { excludeExplicit: true }, targets: { selectedMoods: ["calm", "focus"], primaryMood: "focus", minimumEnergy: .1, maximumEnergy: .55, targetEnergy: .35, energyProgression: "steady", moodBlendMode: "smooth_transition" }, variety: { maximumTracksPerArtist: 2 }, behaviorSummary: ["Prefer calm, low-to-medium energy music.", "Avoid abrupt mood and energy shifts.", "Keep discovery conservative.", "Spread artists to reduce distraction."], customizableFields: moodCustom }),
  recipe({ id: "builtin.instrumental-concentration", name: "Instrumental Concentration", shortDescription: "A flexible foundation for instrumental and score-focused work sessions.", category: "focus", difficulty: "intermediate", discoveryLevel: "medium", targetTrackCount: 55, metadataRequirements: [req("genre", "required"), req("mood"), req("energy")], targets: { minimumEnergy: .05, maximumEnergy: .55, targetEnergy: .3, energyProgression: "steady" }, behaviorSummary: ["Emphasize low-distraction genres selected during customization.", "Keep energy steady and restrained.", "Explore underplayed material without sharp transitions."], expectedPlaylistShape: "A long, even work session; choose instrumental, classical, ambient, or soundtrack genres during customization.", customizableFields: [...moodCustom, "genre"] }),

  recipe({ id: "builtin.crowd-pleasers", name: "Crowd Pleasers", shortDescription: "Recognizable, upbeat tracks designed for a mixed group.", category: "party", difficulty: "beginner", discoveryLevel: "low", targetTrackCount: 60, metadataRequirements: [req("popularity"), req("ratings", "optional")], scoring: { popularityWeight: 80, discoveryWeight: 20 }, discovery: { familiarityBalance: 82, deepCutPercentage: 10, maximumHighPopularityPercentage: 80 }, targets: { minimumEnergy: .5, targetEnergy: .72, energyProgression: "wave" }, behaviorSummary: ["Favor familiar and popular tracks.", "Maintain upbeat energy.", "Use conservative discovery.", "Avoid consecutive tracks by the same artist."], customizableFields: audioCustom }),
  recipe({ id: "builtin.dance-floor-builder", name: "Dance Floor Builder", shortDescription: "A deliberate rise from party warm-up to peak dance energy.", category: "party", difficulty: "advanced", discoveryLevel: "medium", targetTrackCount: 55, metadataRequirements: [req("bpm", "required"), req("energy", "required"), req("mood")], targets: { minimumEnergy: .4, maximumEnergy: 1, energyProgression: "rising" }, bpmFlow: { minimumBpm: 90, maximumBpm: 155, mode: "RAMP_UP", maximumBpmGap: 9 }, behaviorSummary: ["Open with accessible warm-up tracks.", "Raise BPM and energy in stages.", "Reach peak energy near the end.", "Keep artist and album repetition tight."], customizableFields: moodCustom }),

  recipe({ id: "builtin.evening-wind-down", name: "Evening Wind-Down", shortDescription: "A gentle transition from the day toward a calmer evening.", category: "relaxation", difficulty: "beginner", discoveryLevel: "low", targetTrackCount: 35, metadataRequirements: [req("energy"), req("mood")], targets: { selectedMoods: ["calm", "reflective"], minimumEnergy: .05, maximumEnergy: .5, energyProgression: "falling", moodBlendMode: "smooth_transition" }, behaviorSummary: ["Prefer calm and reflective tracks.", "Gradually lower energy.", "Avoid jarring transitions and aggressive discovery."], customizableFields: moodCustom }),
  recipe({ id: "builtin.quiet-night", name: "Quiet Night", shortDescription: "Very low-energy music for settling down before sleep.", category: "sleep", difficulty: "intermediate", discoveryLevel: "none", targetTrackCount: 40, metadataRequirements: [req("energy", "required"), req("mood"), req("local_analysis")], negativeFilters: { excludeExplicit: true }, targets: { selectedMoods: ["calm", "peaceful"], minimumEnergy: 0, maximumEnergy: .3, targetEnergy: .15, energyProgression: "falling", moodBlendMode: "strict_matching", strictMoodMatching: true }, bpmFlow: { minimumBpm: 45, maximumBpm: 100, mode: "RAMP_DOWN", maximumBpmGap: 6 }, behaviorSummary: ["Select very low-energy, calm tracks.", "Reduce tempo across the session.", "Avoid explicit content and abrupt changes.", "Use almost entirely familiar material."], customizableFields: moodCustom }),

  recipe({ id: "builtin.balanced-discovery", name: "Balanced Discovery", shortDescription: "A friendly mix of trusted music and tracks you may have overlooked.", category: "discovery", difficulty: "beginner", discoveryLevel: "medium", targetTrackCount: 50, metadataRequirements: [req("popularity"), req("playback_history")], discovery: { familiarityBalance: 50, deepCutPercentage: 45, hiddenGemPreference: 60, favorUnderplayedPlexTracks: true }, behaviorSummary: ["Split attention between familiar and lesser-played music.", "Favor underplayed tracks with useful metadata.", "Maintain broad artist variety."], customizableFields: standardCustom }),
  recipe({ id: "builtin.hidden-gems", name: "Hidden Gems", shortDescription: "Underplayed tracks with enough positive signals to deserve another chance.", category: "discovery", difficulty: "intermediate", discoveryLevel: "high", targetTrackCount: 45, metadataRequirements: [req("playback_history"), req("popularity"), req("ratings")], discovery: { familiarityBalance: 25, deepCutPercentage: 75, hiddenGemPreference: 90, maximumHighPopularityPercentage: 20 }, behaviorSummary: ["Strongly prefer underplayed and lower-popularity tracks.", "Use ratings and engagement as confidence signals when available.", "Avoid overplayed material.", "Keep the result varied."], customizableFields: standardCustom }),
  recipe({ id: "builtin.something-different", name: "Something Different", shortDescription: "A high-discovery mix that deliberately leaves the usual rotation.", category: "discovery", difficulty: "intermediate", discoveryLevel: "high", targetTrackCount: 40, metadataRequirements: [req("playback_history"), req("genre"), req("popularity")], discovery: { familiarityBalance: 12, deepCutPercentage: 85, hiddenGemPreference: 95, maximumHighPopularityPercentage: 15 }, variety: { maximumTracksPerArtist: 1, artistVarietyStrategy: "strict" }, behaviorSummary: ["Push strongly toward unfamiliar and underplayed tracks.", "Use unusually strict artist variety.", "Minimize highly popular selections.", "Retain normal safety and duplicate controls."], customizableFields: [...standardCustom, "genre"] }),

  recipe({ id: "builtin.artist-deep-cuts", name: "Artist Deep Cuts", shortDescription: "Go beyond an artist’s obvious tracks while keeping their sound central.", category: "deep_cuts", difficulty: "advanced", discoveryLevel: "high", targetTrackCount: 35, metadataRequirements: [req("artist", "required"), req("popularity"), req("playback_history")], discovery: { familiarityBalance: 20, deepCutPercentage: 90, hiddenGemPreference: 90, maximumHighPopularityPercentage: 20 }, variety: { maximumTracksPerArtist: 12, maximumTracksPerAlbum: 2 }, behaviorSummary: ["Center the artist selected during customization.", "Prefer less-played and lower-popularity tracks.", "Spread selections across albums.", "Allow related sounds if the candidate pool is small."], customizableFields: [...standardCustom, "artist", "discoveryLevel"] }),
  recipe({ id: "builtin.new-to-library", name: "New to the Library", shortDescription: "Surface recent additions before they disappear into a large collection.", category: "recently_added", difficulty: "beginner", discoveryLevel: "medium", targetTrackCount: 40, metadataRequirements: [req("date_added", "required")], discovery: { recentlyAddedPreference: 95, familiarityBalance: 35, deepCutPercentage: 55 }, behaviorSummary: ["Strongly favor recently added tracks.", "Mix new familiar additions with unexplored ones.", "Keep artists and albums varied."], customizableFields: [...standardCustom, "dateAddedWindow"] }),
  recipe({ id: "builtin.forgotten-favorites", name: "Forgotten Favorites", shortDescription: "Find positively engaged tracks that have not been played recently.", category: "forgotten_favorites", difficulty: "intermediate", discoveryLevel: "low", targetTrackCount: 50, metadataRequirements: [req("playback_history"), req("ratings"), req("popularity", "optional")], rules: [rule("playCount", "gte", "1")], negativeFilters: { excludePlayedWithinDays: 60 }, scoring: { historicalAcceptanceWeight: 80, recencyPenalty: 85, repeatPenalty: 80, popularityWeight: 45 }, discovery: { familiarityBalance: 88, deepCutPercentage: 25, favorTracksNotRecentlyUsed: true }, variety: { recentlyPlayedExclusionDays: 60, maximumTracksPerArtist: 2 }, behaviorSummary: ["Prefer tracks with ratings or positive historical engagement.", "Exclude tracks played during the last 60 days.", "Favor music heard before over aggressive discovery.", "Use play count, favorites, popularity, and library age when ratings are sparse.", "Limit repeated artists."], expectedPlaylistShape: "Approximately 50 familiar tracks that have fallen out of rotation.", customizableFields: [...standardCustom, "minimumRating"] }),

  recipe({ id: "builtin.1980s-essentials", name: "1980s Essentials", shortDescription: "A varied pass through music released from 1980 through 1989.", category: "decade_mixes", difficulty: "beginner", discoveryLevel: "low", targetTrackCount: 50, metadataRequirements: [req("release_year", "required")], rules: [rule("year", "gte", "1980"), rule("year", "lte", "1989")], discovery: { familiarityBalance: 72, deepCutPercentage: 28 }, behaviorSummary: ["Include music released from 1980–1989.", "Favor recognizable tracks while reserving room for deeper cuts.", "Maintain broad artist variety."], customizableFields: [...standardCustom, "releaseYear"] }),
  recipe({ id: "builtin.1990s-replay", name: "1990s Replay", shortDescription: "Familiar favorites and worthwhile rediscoveries from the 1990s.", category: "decade_mixes", difficulty: "beginner", discoveryLevel: "medium", targetTrackCount: 50, metadataRequirements: [req("release_year", "required")], rules: [rule("year", "gte", "1990"), rule("year", "lte", "1999")], discovery: { familiarityBalance: 62, deepCutPercentage: 38 }, behaviorSummary: ["Include music released from 1990–1999.", "Blend recognizable tracks with underplayed selections.", "Avoid artist-heavy clustering."], customizableFields: [...standardCustom, "releaseYear"] }),
  recipe({ id: "builtin.2000s-throwback", name: "2000s Throwback", shortDescription: "A lively, varied look back at music from 2000 through 2009.", category: "decade_mixes", difficulty: "beginner", discoveryLevel: "medium", targetTrackCount: 50, metadataRequirements: [req("release_year", "required")], rules: [rule("year", "gte", "2000"), rule("year", "lte", "2009")], discovery: { familiarityBalance: 60, deepCutPercentage: 40 }, behaviorSummary: ["Include music released from 2000–2009.", "Balance popular memory anchors with rediscovery.", "Keep albums and artists varied."], customizableFields: [...standardCustom, "releaseYear"] }),

  recipe({ id: "builtin.summer-energy", name: "Summer Energy", shortDescription: "Bright, upbeat music for warm days and social afternoons.", category: "seasonal_mixes", difficulty: "intermediate", discoveryLevel: "medium", targetTrackCount: 50, metadataRequirements: [req("mood"), req("energy"), req("popularity")], targets: { selectedMoods: ["happy", "upbeat"], primaryMood: "happy", minimumEnergy: .5, maximumEnergy: 1, targetEnergy: .72, moodBlendMode: "mixed_mood" }, behaviorSummary: ["Favor upbeat moods and medium-to-high energy.", "Blend familiar anchors with bright discoveries.", "Keep the pacing social and varied."], customizableFields: moodCustom }),
  recipe({ id: "builtin.winter-calm", name: "Winter Calm", shortDescription: "Reflective, lower-energy music for quiet seasonal listening.", category: "seasonal_mixes", difficulty: "intermediate", discoveryLevel: "low", targetTrackCount: 42, metadataRequirements: [req("mood"), req("energy")], negativeFilters: { excludeHoliday: false }, targets: { selectedMoods: ["calm", "reflective"], primaryMood: "calm", minimumEnergy: .05, maximumEnergy: .55, targetEnergy: .32, energyProgression: "wave", moodBlendMode: "smooth_transition" }, behaviorSummary: ["Favor calm and reflective moods.", "Keep energy gentle with small waves.", "Allow seasonal music without requiring it.", "Use conservative discovery."], customizableFields: [...moodCustom, "includeHoliday"] }),

  recipe({ id: "builtin.genre-journey", name: "Genre Journey", shortDescription: "Explore the essentials, deeper cuts, and edges of a chosen genre.", category: "genre_journeys", difficulty: "intermediate", discoveryLevel: "medium", targetTrackCount: 50, metadataRequirements: [req("genre", "required"), req("popularity")], discovery: { familiarityBalance: 50, deepCutPercentage: 50, hiddenGemPreference: 60 }, variety: { maximumTracksPerArtist: 2 }, behaviorSummary: ["Center the genre selected during customization.", "Begin with accessible tracks and move toward deeper cuts.", "Spread selections across artists and albums."], customizableFields: [...standardCustom, "genre"] }),
  recipe({ id: "builtin.artist-radio", name: "Artist Radio", shortDescription: "Build a varied station around a selected artist and compatible sounds.", category: "artist_radio", difficulty: "advanced", discoveryLevel: "medium", targetTrackCount: 45, metadataRequirements: [req("artist", "required"), req("genre"), req("mood"), req("popularity")], discovery: { familiarityBalance: 48, deepCutPercentage: 48 }, identity: { transitionPreference: "balanced" }, behaviorSummary: ["Use the artist selected during customization as the anchor.", "Mix anchor tracks with related library sounds.", "Avoid turning the result into a single-artist playlist.", "Balance recognition and discovery."], customizableFields: [...standardCustom, "artist", "genre", "mood"] }),
  recipe({ id: "builtin.album-discovery", name: "Album Discovery", shortDescription: "Sample across underplayed albums instead of returning to the same tracks.", category: "album_exploration", difficulty: "intermediate", discoveryLevel: "high", targetTrackCount: 45, metadataRequirements: [req("album", "required"), req("playback_history"), req("popularity")], variety: { maximumTracksPerAlbum: 2, albumVarietyStrategy: "strict", maximumTracksPerArtist: 3 }, discovery: { familiarityBalance: 30, deepCutPercentage: 70, favorUnderplayedPlexTracks: true }, behaviorSummary: ["Prefer underplayed album material.", "Limit each album to a small sample.", "Spread listening across artists.", "Favor discovery over familiar singles."], customizableFields: [...standardCustom, "albumRepeatLimit"] }),

  recipe({ id: "builtin.calm-to-energetic", name: "Calm to Energetic", shortDescription: "A smooth emotional and energy rise from quiet to invigorating.", category: "mood_progressions", difficulty: "advanced", discoveryLevel: "medium", targetTrackCount: 48, metadataRequirements: [req("mood", "required"), req("energy", "required"), req("bpm")], targets: { selectedMoods: ["calm", "hopeful", "energetic"], primaryMood: "calm", secondaryMoods: ["hopeful", "energetic"], minimumEnergy: .1, maximumEnergy: .95, energyProgression: "rising", moodBlendMode: "smooth_transition", moodTransition: "sectioned" }, bpmFlow: { minimumBpm: 55, maximumBpm: 170, mode: "RAMP_UP", maximumBpmGap: 10 }, behaviorSummary: ["Open calm and restrained.", "Move through hopeful bridge moods.", "Increase energy and tempo gradually.", "Finish with energetic tracks."], customizableFields: moodCustom }),
  recipe({ id: "builtin.energetic-to-relaxed", name: "Energetic to Relaxed", shortDescription: "Come down smoothly from high energy toward a settled finish.", category: "mood_progressions", difficulty: "advanced", discoveryLevel: "low", targetTrackCount: 45, metadataRequirements: [req("mood", "required"), req("energy", "required"), req("bpm")], targets: { selectedMoods: ["energetic", "content", "calm"], primaryMood: "energetic", secondaryMoods: ["content", "calm"], minimumEnergy: .1, maximumEnergy: .95, energyProgression: "falling", moodBlendMode: "smooth_transition", moodTransition: "sectioned" }, bpmFlow: { minimumBpm: 55, maximumBpm: 170, mode: "RAMP_DOWN", maximumBpmGap: 10 }, behaviorSummary: ["Start with high energy.", "Step down through balanced bridge moods.", "Lower tempo and intensity smoothly.", "End calm and settled."], customizableFields: moodCustom }),
  recipe({ id: "builtin.evening-mood-journey", name: "Evening Mood Journey", shortDescription: "A warm arc from active evening listening to reflective late-night calm.", category: "mood_progressions", difficulty: "advanced", discoveryLevel: "medium", targetTrackCount: 55, metadataRequirements: [req("mood", "required"), req("energy", "required")], targets: { selectedMoods: ["upbeat", "content", "reflective", "calm"], primaryMood: "upbeat", secondaryMoods: ["content", "reflective", "calm"], minimumEnergy: .08, maximumEnergy: .85, energyProgression: "falling", moodBlendMode: "smooth_transition", moodTransition: "sectioned" }, behaviorSummary: ["Begin social and upbeat.", "Shift through content and reflective moods.", "Reduce energy toward a calm finish.", "Keep discoveries compatible with the emotional arc."], customizableFields: moodCustom }),
];

export function getBuiltInRecipe(recipeId: string) {
  return BUILT_IN_RECIPES.find((item) => item.id === recipeId) || null;
}

export function compareRecipeVersions(installedVersion: number | null | undefined, currentVersion: number) {
  if (!installedVersion) return "not_installed" as const;
  return installedVersion < currentVersion ? "update_available" as const : installedVersion > currentVersion ? "newer_than_catalog" as const : "current" as const;
}

export function validateBuiltInRecipeCatalog(catalog: readonly BuiltInRecipeDefinition[] = BUILT_IN_RECIPES) {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const item of catalog) {
    if (!/^builtin\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) errors.push(`${item.id}: invalid stable ID`);
    if (ids.has(item.id)) errors.push(`${item.id}: duplicate stable ID`);
    ids.add(item.id);
    if (!RECIPE_CATEGORY_IDS.includes(item.category)) errors.push(`${item.id}: invalid category`);
    if (!Number.isInteger(item.version) || item.version < 1) errors.push(`${item.id}: invalid version`);
    if (!item.behaviorSummary.length) errors.push(`${item.id}: behavior summary is required`);
    if (!Array.isArray(item.metadataRequirements)) errors.push(`${item.id}: metadata requirements must be declared`);
    if (!item.history.some((entry) => entry.version === item.version)) errors.push(`${item.id}: current version is missing from history`);
    const parsed = mixRecipeDocumentSchema.safeParse(item.engineConfig);
    if (!parsed.success) errors.push(`${item.id}: ${parsed.error.issues[0]?.message || "invalid engine configuration"}`);
  }
  for (const category of RECIPE_CATEGORY_IDS) if (!catalog.some((item) => item.category === category)) errors.push(`${category}: category has no built-in recipe`);
  return { valid: errors.length === 0, errors };
}

const catalogValidation = validateBuiltInRecipeCatalog(BUILT_IN_RECIPES);
if (!catalogValidation.valid) throw new Error(`Invalid built-in recipe catalog:\n${catalogValidation.errors.join("\n")}`);
