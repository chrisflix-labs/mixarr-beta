import type { MixRecipeDocument } from "./mixRecipes/schema";

export const ADAPTIVE_MAPPING_ENGINE_VERSION = "2.3.2";

export type RecipeMappingType = "genre" | "mood" | "artist" | "bpm" | "energy" | "metadata";
export type RecipeMappingStatus =
  | "exact_match"
  | "normalized_match"
  | "saved_mapping"
  | "strong_suggested_match"
  | "multiple_possible_matches"
  | "relaxed_match"
  | "unavailable"
  | "unsupported"
  | "no_mapping_required";
export type MappingAction = "accept" | "keep_original" | "relax" | "disable";
export type WarningSeverity = "informational" | "caution" | "high_risk" | "blocking";
export type IdentityImpact = "identity_preserving" | "minor" | "moderate" | "major";

export type LibraryVocabularyValue = { value: string; normalized: string; trackCount: number };
export type SavedMappingInput = {
  id?: string;
  mappingType: RecipeMappingType;
  sourceValueNormalized: string;
  destinationValues: string[];
  confidence: number;
  manuallyConfirmed: boolean;
  libraryId?: string | null;
};
export type LibraryRecipeProfile = {
  libraryId: string;
  libraryName: string;
  totalTracks: number;
  genres: LibraryVocabularyValue[];
  moods: LibraryVocabularyValue[];
  artists: LibraryVocabularyValue[];
  bpmCoverage: number;
  energyCoverage: number;
  moodCoverage: number;
  popularityCoverage: number;
  audioFeatureCoverage: number;
  bpmMinimum: number | null;
  bpmMaximum: number | null;
  bpmAverage: number | null;
  energyMinimum: number | null;
  energyMaximum: number | null;
  energyAverage: number | null;
  syncInProgress?: boolean;
  savedMappings: SavedMappingInput[];
};

export type MappingSuggestion = {
  value: string;
  confidence: number;
  trackCount: number;
  matchType: RecipeMappingStatus;
  reason: string;
};
export type AdaptiveMappingDecision = {
  id: string;
  mappingType: RecipeMappingType;
  path: string;
  originalValue: string;
  originalValues?: string[];
  mappedValues: string[];
  status: RecipeMappingStatus;
  confidence: number;
  reason: string;
  required: boolean;
  excluded: boolean;
  localTrackCount: number;
  originalCandidateContribution: number;
  adaptedCandidateContribution: number;
  candidateImpact: number;
  action: MappingAction;
  suggestions: MappingSuggestion[];
  manuallyModified: boolean;
  accepted: boolean;
  saveForFuture: boolean;
  identityImpact: IdentityImpact;
};
export type CompatibilityBreakdown = {
  genres: number;
  moods: number;
  bpm: number;
  energyMetadata: number;
  artistAvailability: number;
  metadata: number;
  candidateCoverage: number;
  ruleSupport: number;
};
export type RecipeMappingWarning = {
  id: string;
  severity: WarningSeverity;
  category: string;
  message: string;
  recoveryAction?: string;
};
export type RelaxationRecommendation = {
  id: string;
  mappingId?: string;
  currentConstraint: string;
  suggestedConstraint: string;
  reason: string;
  estimatedCandidateIncrease: number;
  compatibilityScoreImpact: number;
  identityImpact: IdentityImpact;
  highImpact: boolean;
};
export type AdaptiveRecipeAnalysis = {
  schemaVersion: 1;
  engineVersion: string;
  library: Omit<LibraryRecipeProfile, "savedMappings">;
  originalRecipe: MixRecipeDocument;
  adaptedRecipe: MixRecipeDocument;
  mappings: AdaptiveMappingDecision[];
  compatibilityScore: number;
  compatibilityLabel: "Excellent" | "Good" | "Partial" | "Poor" | "Unusable";
  compatibilityBreakdown: CompatibilityBreakdown;
  originalCandidateEstimate: number;
  adaptedCandidateEstimate: number;
  requestedPlaylistLength: number;
  recommendedMinimumCandidatePool: number;
  candidateToPlaylistRatio: number;
  estimateConfidence: "high" | "medium" | "low";
  coverageEstimate: number;
  metadataEligibleTracks: number;
  excludedByHardRules: number;
  unavailableFromMissingMetadata: number;
  warnings: RecipeMappingWarning[];
  recommendations: RelaxationRecommendation[];
  identityImpact: IdentityImpact;
  automaticMappingCount: number;
  reviewMappingCount: number;
  readiness: "ready" | "review_required" | "blocked";
  analyzedAt: string;
};

const GENRE_ALIASES: Record<string, string[]> = {
  "synth wave": ["retrowave", "synthpop", "electronic"],
  synthwave: ["retrowave", "synthpop", "electronic"],
  "hip hop": ["hip-hop", "rap"],
  "hip-hop": ["hip hop", "rap"],
  electronica: ["electronic"],
  edm: ["electronic", "dance"],
  "r and b": ["r&b", "rhythm and blues"],
  "rhythm and blues": ["r&b"],
  "alt rock": ["alternative rock", "alternative"],
  "indie rock": ["indie", "alternative rock"],
  soundtrack: ["soundtracks", "score"],
};
const MOOD_ALIASES: Record<string, string[]> = {
  atmospheric: ["ambient", "dreamy", "ethereal"],
  energetic: ["high energy", "upbeat", "excited"],
  calm: ["peaceful", "relaxed", "chill"],
  happy: ["joyful", "upbeat", "cheerful"],
  melancholy: ["melancholic", "sad", "reflective"],
  focus: ["focused", "concentration"],
  romantic: ["love", "tender"],
};

export function normalizeRecipeVocabulary(value: string) {
  let normalized = value.normalize("NFKD").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const words = normalized.split(" ").map((word) => word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
  normalized = words.join(" ");
  return normalized;
}

function levenshtein(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function vocabularySimilarity(left: string, right: string) {
  const a = normalizeRecipeVocabulary(left);
  const b = normalizeRecipeVocabulary(right);
  if (!a || !b) return 0;
  return Number((1 - levenshtein(a, b) / Math.max(a.length, b.length)).toFixed(4));
}

function mappingId(type: RecipeMappingType, path: string, original: string) {
  return `${type}:${path}:${normalizeRecipeVocabulary(original)}`;
}

function findSuggestions(type: "genre" | "mood" | "artist", source: string, values: LibraryVocabularyValue[], saved: SavedMappingInput[], libraryId: string) {
  const normalized = normalizeRecipeVocabulary(source);
  const byNormalized = new Map(values.map((item) => [item.normalized || normalizeRecipeVocabulary(item.value), item]));
  const savedRule = saved
    .filter((item) => item.mappingType === type && item.sourceValueNormalized === normalized && item.destinationValues.every((destination) => byNormalized.has(normalizeRecipeVocabulary(destination))))
    .sort((left, right) => Number(Boolean(right.manuallyConfirmed)) - Number(Boolean(left.manuallyConfirmed)) || Number(right.libraryId === libraryId) - Number(left.libraryId === libraryId))[0];
  if (savedRule) {
    return savedRule.destinationValues.map((destination) => {
      const local = byNormalized.get(normalizeRecipeVocabulary(destination))!;
      return { value: local.value, confidence: savedRule.confidence, trackCount: local.trackCount, matchType: "saved_mapping" as const, reason: savedRule.manuallyConfirmed ? "Previously confirmed mapping" : "Previously saved automatic mapping" };
    });
  }
  const exactCase = values.find((item) => item.value.toLowerCase() === source.toLowerCase());
  if (exactCase) return [{ value: exactCase.value, confidence: 1, trackCount: exactCase.trackCount, matchType: "exact_match" as const, reason: "Exact local value" }];
  const exactNormalized = byNormalized.get(normalized);
  if (exactNormalized) return [{ value: exactNormalized.value, confidence: 0.97, trackCount: exactNormalized.trackCount, matchType: "normalized_match" as const, reason: "Case, punctuation, or plural-normalized local value" }];
  const aliasTable = type === "genre" ? GENRE_ALIASES : type === "mood" ? MOOD_ALIASES : {};
  const aliases = aliasTable[normalized] || [];
  const aliasMatches = aliases.map((alias) => byNormalized.get(normalizeRecipeVocabulary(alias))).filter((item): item is LibraryVocabularyValue => Boolean(item));
  if (aliasMatches.length) return aliasMatches.map((item, index) => ({ value: item.value, confidence: Number(Math.max(0.82, 0.94 - index * 0.04).toFixed(2)), trackCount: item.trackCount, matchType: aliasMatches.length > 1 ? "multiple_possible_matches" as const : "strong_suggested_match" as const, reason: type === "genre" ? "Known genre alias or related category" : "Known mood alias or related mood" }));
  if (type === "artist") return [];
  return values
    .map((item) => ({ item, similarity: vocabularySimilarity(source, item.value) }))
    .filter(({ similarity }) => similarity >= 0.88)
    .sort((left, right) => right.similarity - left.similarity || right.item.trackCount - left.item.trackCount)
    .slice(0, 3)
    .map(({ item, similarity }) => ({ value: item.value, confidence: similarity, trackCount: item.trackCount, matchType: "strong_suggested_match" as const, reason: "Conservative vocabulary similarity match" }));
}

type ExtractedValue = { type: "genre" | "mood" | "artist"; path: string; value: string; required: boolean; excluded: boolean };
function flattenRules(node: any, prefix = "generation.rules"): Array<{ rule: any; path: string }> {
  if (!node) return [];
  if (node.type !== "group") return [{ rule: node, path: prefix }];
  return (node.children || []).flatMap((child: any, index: number) => flattenRules(child, `${prefix}.children.${index}`));
}

export function extractRecipeVocabulary(recipe: MixRecipeDocument): ExtractedValue[] {
  const nodes = recipe.generation.ruleTree ? flattenRules(recipe.generation.ruleTree, "generation.ruleTree") : recipe.generation.rules.map((rule, index) => ({ rule, path: `generation.rules.${index}` }));
  const output: ExtractedValue[] = nodes.filter(({ rule }) => ["genre", "artist"].includes(rule.field)).map(({ rule, path }) => ({
    type: rule.field,
    path,
    value: String(rule.value),
    required: rule.operator !== "not_contains",
    excluded: rule.operator === "not_contains",
  }));
  const moodValues = Array.from(new Set([recipe.targets.primaryMood, ...recipe.targets.selectedMoods, ...recipe.targets.secondaryMoods].filter((value): value is string => Boolean(value))));
  moodValues.forEach((value) => output.push({ type: "mood", path: `targets.moods.${normalizeRecipeVocabulary(value)}`, value, required: recipe.targets.strictMoodMatching, excluded: false }));
  recipe.playlistIdentity.preferredGenres.forEach((value) => output.push({ type: "genre", path: `playlistIdentity.preferredGenres.${normalizeRecipeVocabulary(value)}`, value, required: false, excluded: false }));
  recipe.playlistIdentity.avoidedGenres.forEach((value) => output.push({ type: "genre", path: `playlistIdentity.avoidedGenres.${normalizeRecipeVocabulary(value)}`, value, required: false, excluded: true }));
  recipe.playlistIdentity.preferredArtists.forEach((value) => output.push({ type: "artist", path: `playlistIdentity.preferredArtists.${normalizeRecipeVocabulary(value)}`, value, required: false, excluded: false }));
  recipe.playlistIdentity.avoidedArtists.forEach((value) => output.push({ type: "artist", path: `playlistIdentity.avoidedArtists.${normalizeRecipeVocabulary(value)}`, value, required: false, excluded: true }));
  return output.filter((item, index, items) => items.findIndex((other) => other.type === item.type && other.path === item.path && normalizeRecipeVocabulary(other.value) === normalizeRecipeVocabulary(item.value)) === index);
}

function identityForMapping(status: RecipeMappingStatus, required: boolean, count: number): IdentityImpact {
  if (["exact_match", "normalized_match", "saved_mapping", "no_mapping_required"].includes(status)) return "identity_preserving";
  if (status === "strong_suggested_match" && count === 1) return "minor";
  if (status === "multiple_possible_matches" || (!required && status === "unavailable")) return "moderate";
  return required ? "major" : "moderate";
}

export function buildVocabularyMappings(recipe: MixRecipeDocument, profile: LibraryRecipeProfile): AdaptiveMappingDecision[] {
  return extractRecipeVocabulary(recipe).map((source) => {
    const values = source.type === "genre" ? profile.genres : source.type === "mood" ? profile.moods : profile.artists;
    const suggestions = findSuggestions(source.type, source.value, values, profile.savedMappings, profile.libraryId);
    const first = suggestions[0];
    const status: RecipeMappingStatus = source.excluded && !first ? "no_mapping_required" : first?.matchType || "unavailable";
    const mappedValues = suggestions.map((item) => item.value);
    const localTrackCount = suggestions.reduce((total, item) => total + item.trackCount, 0);
    return {
      id: mappingId(source.type, source.path, source.value), mappingType: source.type, path: source.path,
      originalValue: source.value, mappedValues, status, confidence: first?.confidence || (status === "no_mapping_required" ? 1 : 0),
      reason: source.excluded && !first ? "Excluded value is not present locally and does not reduce compatibility" : first?.reason || `No reliable local ${source.type} match was found`,
      required: source.required, excluded: source.excluded, localTrackCount,
      originalCandidateContribution: first && ["exact_match", "normalized_match"].includes(first.matchType) ? localTrackCount : 0,
      adaptedCandidateContribution: localTrackCount, candidateImpact: first && !["exact_match", "normalized_match"].includes(first.matchType) ? localTrackCount : 0,
      action: first ? "accept" : "keep_original", suggestions, manuallyModified: false, accepted: Boolean(first), saveForFuture: false,
      identityImpact: identityForMapping(status, source.required, suggestions.length),
    };
  });
}

function replaceList(source: string[], mappings: AdaptiveMappingDecision[], prefix: string) {
  return source.flatMap((value) => {
    const mapping = mappings.find((item) => item.path.startsWith(prefix) && normalizeRecipeVocabulary(item.originalValue) === normalizeRecipeVocabulary(value));
    if (!mapping || mapping.action === "keep_original") return [value];
    if (mapping.action === "disable") return [];
    return mapping.mappedValues.length ? mapping.mappedValues : [value];
  }).filter((value, index, values) => values.findIndex((other) => normalizeRecipeVocabulary(other) === normalizeRecipeVocabulary(value)) === index);
}

function replaceRule(rule: any, path: string, mappings: AdaptiveMappingDecision[]): any {
  const mapping = mappings.find((item) => item.path === path);
  if (!mapping || mapping.action === "keep_original") return rule;
  if (mapping.action === "disable") return null;
  const values = mapping.mappedValues.length ? mapping.mappedValues : [mapping.originalValue];
  if (values.length === 1) return { ...rule, value: values[0] };
  return { type: "group", combinator: rule.operator === "not_contains" ? "AND" : "OR", children: values.map((value) => ({ ...rule, value })) };
}

export function applyAdaptiveMappings(recipe: MixRecipeDocument, mappings: AdaptiveMappingDecision[]) {
  const adapted = JSON.parse(JSON.stringify(recipe)) as MixRecipeDocument;
  if (adapted.generation.ruleTree) {
    const walk = (node: any, path: string): any => node.type === "group"
      ? { ...node, children: node.children.map((child: any, index: number) => walk(child, `${path}.children.${index}`)).filter(Boolean) }
      : replaceRule(node, path, mappings);
    adapted.generation.ruleTree = walk(adapted.generation.ruleTree, "generation.ruleTree");
  } else {
    const replaced = adapted.generation.rules.map((rule, index) => replaceRule(rule, `generation.rules.${index}`, mappings)).filter(Boolean);
    if (replaced.some((node: any) => node.type === "group")) {
      adapted.generation.ruleTree = { type: "group", combinator: "AND", children: replaced } as any;
      adapted.generation.rules = [];
    } else adapted.generation.rules = replaced;
  }
  adapted.targets.selectedMoods = replaceList(adapted.targets.selectedMoods, mappings, "targets.moods.");
  adapted.targets.secondaryMoods = replaceList(adapted.targets.secondaryMoods, mappings, "targets.moods.");
  if (adapted.targets.primaryMood) adapted.targets.primaryMood = replaceList([adapted.targets.primaryMood], mappings, "targets.moods.")[0] || null;
  adapted.playlistIdentity.preferredGenres = replaceList(adapted.playlistIdentity.preferredGenres, mappings, "playlistIdentity.preferredGenres.");
  adapted.playlistIdentity.avoidedGenres = replaceList(adapted.playlistIdentity.avoidedGenres, mappings, "playlistIdentity.avoidedGenres.");
  adapted.playlistIdentity.preferredArtists = replaceList(adapted.playlistIdentity.preferredArtists, mappings, "playlistIdentity.preferredArtists.");
  adapted.playlistIdentity.avoidedArtists = replaceList(adapted.playlistIdentity.avoidedArtists, mappings, "playlistIdentity.avoidedArtists.");
  const bpm = mappings.find((item) => item.mappingType === "bpm");
  if (bpm?.action === "disable") { adapted.bpmFlow.minimumBpm = null; adapted.bpmFlow.maximumBpm = null; adapted.bpmFlow.targetBpm = null; adapted.bpmFlow.mode = "DISABLED"; }
  else if (bpm && bpm.action !== "keep_original" && bpm.mappedValues.length >= 2) { adapted.bpmFlow.minimumBpm = Number(bpm.mappedValues[0]); adapted.bpmFlow.maximumBpm = Number(bpm.mappedValues[1]); }
  const energy = mappings.find((item) => item.mappingType === "energy");
  if (energy?.action === "disable") { adapted.targets.minimumEnergy = null; adapted.targets.maximumEnergy = null; adapted.targets.targetEnergy = null; }
  else if (energy && energy.action !== "keep_original" && energy.mappedValues.length >= 2) { adapted.targets.minimumEnergy = Number(energy.mappedValues[0]); adapted.targets.maximumEnergy = Number(energy.mappedValues[1]); }
  return adapted;
}

export function adaptNumericRanges(recipe: MixRecipeDocument, profile: LibraryRecipeProfile, originalEstimate: number): AdaptiveMappingDecision[] {
  const output: AdaptiveMappingDecision[] = [];
  const requested = recipe.generation.limit;
  const bpmMin = recipe.bpmFlow.minimumBpm;
  const bpmMax = recipe.bpmFlow.maximumBpm;
  if (bpmMin != null || bpmMax != null) {
    const low = bpmMin ?? Math.max(30, (bpmMax || 120) - 30); const high = bpmMax ?? Math.min(300, (bpmMin || 90) + 30);
    const width = Math.max(1, high - low); const expansion = Math.max(5, Math.min(15, Math.ceil(width * 0.5)));
    const suggested = originalEstimate < requested * 3 ? [Math.max(30, low - expansion), Math.min(300, high + expansion)] : [low, high];
    const changed = suggested[0] !== low || suggested[1] !== high;
    output.push({
      id: "bpm:bpmFlow.range", mappingType: "bpm", path: "bpmFlow.range", originalValue: `${low}-${high}`, originalValues: [String(low), String(high)], mappedValues: suggested.map(String),
      status: changed ? "relaxed_match" : "no_mapping_required", confidence: profile.bpmCoverage >= 0.7 ? 0.9 : profile.bpmCoverage >= 0.3 ? 0.7 : 0.35,
      reason: changed ? "The local candidate pool is small; a conservative symmetric expansion is available" : "The original BPM range is healthy for the requested length",
      required: true, excluded: false, localTrackCount: 0, originalCandidateContribution: originalEstimate, adaptedCandidateContribution: originalEstimate,
      candidateImpact: 0, action: changed ? "accept" : "keep_original", suggestions: [], manuallyModified: false, accepted: changed, saveForFuture: false,
      identityImpact: changed && expansion > 10 ? "moderate" : changed ? "minor" : "identity_preserving",
    });
  }
  const energyMin = recipe.targets.minimumEnergy; const energyMax = recipe.targets.maximumEnergy;
  if (energyMin != null || energyMax != null) {
    const low = energyMin ?? 0; const high = energyMax ?? 1;
    const widen = profile.energyCoverage < 0.7 && originalEstimate < requested * 3 ? 0.06 : 0;
    const suggested = [Math.max(0, Number((low - widen).toFixed(2))), Math.min(1, Number((high + widen).toFixed(2)))];
    output.push({
      id: "energy:targets.range", mappingType: "energy", path: "targets.energyRange", originalValue: `${low}-${high}`, originalValues: [String(low), String(high)], mappedValues: suggested.map(String),
      status: widen ? "relaxed_match" : "no_mapping_required", confidence: profile.energyCoverage >= 0.7 ? 0.9 : profile.energyCoverage >= 0.3 ? 0.65 : 0.3,
      reason: widen ? "Energy coverage is limited; a small range expansion can improve participation without fabricating values" : "The original energy range is suitable",
      required: true, excluded: false, localTrackCount: 0, originalCandidateContribution: originalEstimate, adaptedCandidateContribution: originalEstimate,
      candidateImpact: 0, action: widen ? "accept" : "keep_original", suggestions: [], manuallyModified: false, accepted: Boolean(widen), saveForFuture: false,
      identityImpact: widen ? "minor" : "identity_preserving",
    });
  }
  return output;
}

function componentScore(mappings: AdaptiveMappingDecision[], type: RecipeMappingType) {
  const relevant = mappings.filter((item) => item.mappingType === type && !item.excluded);
  if (!relevant.length) return 100;
  const weighted = relevant.map((item) => {
    const score = item.status === "unavailable" ? 0 : item.status === "multiple_possible_matches" ? 72 : item.status === "strong_suggested_match" ? 84 : Math.round(item.confidence * 100);
    return { score, weight: item.required ? 4 : 1 };
  });
  const denominator = weighted.reduce((total, item) => total + item.weight / Math.max(1, item.score), 0);
  return Math.round(weighted.reduce((total, item) => total + item.weight, 0) / denominator);
}

export function calculateCompatibility(input: { mappings: AdaptiveMappingDecision[]; profile: LibraryRecipeProfile; originalCandidates: number; adaptedCandidates: number; requestedLength: number; unsupportedRequired?: number }): { score: number; breakdown: CompatibilityBreakdown } {
  const genre = componentScore(input.mappings, "genre"); const moodMap = componentScore(input.mappings, "mood"); const artist = componentScore(input.mappings, "artist");
  const hasMood = input.mappings.some((item) => item.mappingType === "mood");
  const hasBpm = input.mappings.some((item) => item.mappingType === "bpm"); const hasEnergy = input.mappings.some((item) => item.mappingType === "energy");
  const breakdown: CompatibilityBreakdown = {
    genres: genre,
    moods: hasMood ? Math.round(moodMap * (0.55 + input.profile.moodCoverage * 0.45)) : 100,
    bpm: hasBpm ? Math.round(45 + input.profile.bpmCoverage * 55) : 100,
    energyMetadata: hasEnergy ? Math.round(input.profile.energyCoverage * 100) : 100,
    artistAvailability: artist,
    metadata: Math.round(((hasMood ? input.profile.moodCoverage : 1) + (hasBpm ? input.profile.bpmCoverage : 1) + (hasEnergy ? input.profile.energyCoverage : 1) + input.profile.popularityCoverage) / 4 * 100),
    candidateCoverage: Math.min(100, Math.round(input.adaptedCandidates / Math.max(1, input.requestedLength * 3) * 100)),
    ruleSupport: input.unsupportedRequired ? 0 : 100,
  };
  const weights: Array<[keyof CompatibilityBreakdown, number]> = [["genres", 4], ["moods", 3], ["bpm", 2], ["energyMetadata", 2], ["artistAvailability", 3], ["metadata", 1.5], ["candidateCoverage", 4], ["ruleSupport", 6]];
  const harmonic = weights.reduce((total, [key, weight]) => total + weight, 0) / weights.reduce((total, [key, weight]) => total + weight / Math.max(1, breakdown[key]), 0);
  const requiredUnavailable = input.mappings.filter((item) => item.required && !item.excluded && item.status === "unavailable").length;
  const score = Math.max(0, Math.min(100, Math.round(harmonic * Math.pow(0.78, requiredUnavailable))));
  return { score, breakdown };
}

export function compatibilityLabel(score: number): AdaptiveRecipeAnalysis["compatibilityLabel"] {
  return score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 50 ? "Partial" : score >= 25 ? "Poor" : "Unusable";
}

const IMPACT_RANK: Record<IdentityImpact, number> = { identity_preserving: 0, minor: 1, moderate: 2, major: 3 };
export function classifyIdentityImpact(mappings: AdaptiveMappingDecision[]) {
  return mappings.reduce<IdentityImpact>((impact, item) => item.action === "keep_original" ? impact : IMPACT_RANK[item.identityImpact] > IMPACT_RANK[impact] ? item.identityImpact : impact, "identity_preserving");
}

export function buildAnalysisWarnings(recipe: MixRecipeDocument, profile: LibraryRecipeProfile, mappings: AdaptiveMappingDecision[], originalCandidates: number, adaptedCandidates: number) {
  const warnings: RecipeMappingWarning[] = [];
  const add = (severity: WarningSeverity, category: string, message: string, recoveryAction?: string) => warnings.push({ id: `${category}:${warnings.length}`, severity, category, message, recoveryAction });
  if (!profile.totalTracks) add("blocking", "library", "The selected music library has no synced tracks.", "Sync the library, then retry analysis.");
  if (profile.syncInProgress) add("informational", "library", "Library sync is currently running, so estimates may change.", "Recalculate after sync completes.");
  mappings.filter((item) => item.required && item.status === "unavailable").forEach((item) => add("high_risk", item.mappingType, `Required ${item.mappingType} “${item.originalValue}” has no reliable local match.`, "Choose a local value, relax it to a preference, or disable the constraint."));
  if (recipe.targets.selectedMoods.length && profile.moodCoverage < 0.5) add("caution", "mood", `Mood metadata is available for ${Math.round(profile.moodCoverage * 100)}% of this library.`, "Use blended matching or allow unknown mood metadata.");
  if ((recipe.bpmFlow.minimumBpm != null || recipe.bpmFlow.maximumBpm != null) && profile.bpmCoverage < 0.5) add("caution", "bpm", `BPM metadata is available for ${Math.round(profile.bpmCoverage * 100)}% of this library. Corrected BPM values are used first.`, "Allow unknown BPM values or analyze more tracks.");
  if ((recipe.targets.minimumEnergy != null || recipe.targets.maximumEnergy != null) && profile.energyCoverage < 0.7) add("caution", "energy", `Energy metadata is available for ${Math.round(profile.energyCoverage * 100)}% of this library; missing values are not fabricated.`, "Use the existing missing-energy fallback behavior.");
  if (adaptedCandidates < recipe.generation.limit) add(adaptedCandidates === 0 ? "blocking" : "high_risk", "candidates", `Only about ${adaptedCandidates} candidates are expected for a ${recipe.generation.limit}-track playlist.`, "Apply a recommended relaxation or reduce playlist length.");
  else if (adaptedCandidates < recipe.generation.limit * 3) add("caution", "candidates", `The candidate-to-playlist ratio is only ${(adaptedCandidates / recipe.generation.limit).toFixed(1)}:1.`, "Aim for a candidate pool at least three times the requested length.");
  if (originalCandidates < adaptedCandidates) add("informational", "adaptation", `Recommended mappings increase the estimated pool by ${adaptedCandidates - originalCandidates} tracks.`);
  return warnings;
}

export function buildRelaxationRecommendations(recipe: MixRecipeDocument, mappings: AdaptiveMappingDecision[], originalCandidates: number, adaptedCandidates: number) {
  const recommendations: RelaxationRecommendation[] = [];
  mappings.filter((item) => item.action === "accept" && item.status !== "no_mapping_required").forEach((item) => recommendations.push({
    id: `apply:${item.id}`, mappingId: item.id, currentConstraint: `${item.mappingType}: ${item.originalValue}`,
    suggestedConstraint: item.mappedValues.length ? item.mappedValues.join(", ") : "Disable unavailable constraint", reason: item.reason,
    estimatedCandidateIncrease: Math.max(0, item.candidateImpact), compatibilityScoreImpact: item.status === "unavailable" ? 12 : item.status === "relaxed_match" ? 6 : 3,
    identityImpact: item.identityImpact, highImpact: item.identityImpact === "major",
  }));
  if (adaptedCandidates < recipe.generation.limit * 3) recommendations.push({
    id: "candidate:length", currentConstraint: `${recipe.generation.limit} requested tracks`, suggestedConstraint: `${Math.max(1, Math.floor(adaptedCandidates / 3))} tracks`,
    reason: "A smaller output improves the candidate-to-playlist ratio.", estimatedCandidateIncrease: 0, compatibilityScoreImpact: 8, identityImpact: "moderate", highImpact: false,
  });
  return recommendations;
}

export function mergeMappingEdits(mappings: AdaptiveMappingDecision[], edits: Array<Partial<AdaptiveMappingDecision> & { id: string }>) {
  const byId = new Map(edits.map((edit) => [edit.id, edit]));
  return mappings.map((mapping) => {
    const edit = byId.get(mapping.id); if (!edit) return mapping;
    const action = ["accept", "keep_original", "relax", "disable"].includes(String(edit.action)) ? edit.action as MappingAction : mapping.action;
    const mappedValues = Array.isArray(edit.mappedValues) ? edit.mappedValues.map(String).filter(Boolean).slice(0, 20) : mapping.mappedValues;
    return { ...mapping, action, mappedValues, accepted: action === "accept" || action === "relax", manuallyModified: true, saveForFuture: edit.saveForFuture === true };
  });
}
