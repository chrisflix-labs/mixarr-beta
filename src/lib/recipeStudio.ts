import { DEFAULT_SCORING_MODEL } from "./scoringModelCatalog";

export type RecipeStudioMode = "guided" | "beginner" | "advanced";

export type GuidedRecipeAnswers = {
  mixStyle: "balanced" | "focus" | "workout" | "party" | "chill" | "discovery";
  libraryId?: string | null;
  trackCount: number;
  discoveryBalance: "familiar" | "balanced" | "exploratory";
  energyShape: "steady" | "rising" | "falling" | "peak" | "dip";
  smoothBpm: boolean;
  artistRepetition: "low" | "balanced" | "relaxed";
  refresh: "manual" | "weekly" | "monthly";
  requireApproval: boolean;
  household: boolean;
  insufficientCandidates: "allow_fallback" | "reduce_size" | "stop";
};

export type CurvePoint = { position: number; value: number };

export type LibraryAnalysisProfile = {
  libraryId: string | null;
  libraryName: string;
  totalTracks: number;
  bpmTracks: number;
  energyTracks: number;
  moodTracks: number;
  popularityTracks: number;
  uniqueArtists: number;
  uniqueAlbums: number;
  explicitTracks?: number;
  liveTracks?: number;
  holidayTracks?: number;
  recentlyAddedTracks?: number;
  integrations?: Array<{ key: string; enabled: boolean; status?: string }>;
  analyzedAt?: string;
};

export type StudioFinding = {
  code: string;
  severity: "error" | "warning" | "recommendation" | "information";
  title: string;
  message: string;
  remediation?: string;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const percent = (part: number, total: number) => total > 0 ? Math.round(part / total * 100) : 0;

export function defaultRecipeStudioDraft() {
  return {
    name: "Untitled Mix Recipe",
    description: "",
    category: "Custom",
    enabled: false,
    filters: { rules: [], limit: 100, libraryId: null, serverId: null, pinnedTrackIds: [], excludedTrackIds: [], duplicateStrategy: "song_artist", preferNonLive: true, excludeRemasters: false, negativeFilters: {}, safetyRules: {}, personalizationMode: "INDIVIDUAL" },
    scoring: { moodMatchWeight: 50, energyMatchWeight: 50, bpmCompatibilityWeight: 50, popularityWeight: 50, discoveryWeight: 50, playlistIdentityWeight: 50, historicalAcceptanceWeight: 50, historicalRejectionPenalty: 50, artistPreferenceWeight: 50, recencyPenalty: 50, repeatPenalty: 50, metadataConfidenceWeight: 50, transitionQualityWeight: 50, personalizedScoringInfluence: 35, scoringMode: "base", scoringModel: DEFAULT_SCORING_MODEL },
    targets: { selectedMoods: [], primaryMood: null, secondaryMoods: [], moodBlendMode: "off", strictMoodMatching: false, moodTransition: "none", moodCurve: [], minimumEnergy: null, maximumEnergy: null, targetEnergy: null, energyProgression: "mixed", missingMoodFallback: "allow", missingEnergyFallback: "allow" },
    bpmFlow: { minimumBpm: null, maximumBpm: null, targetBpm: null, mode: "DISABLED", sections: [], maximumBpmGap: 8, allowBpmJumps: false, halfTimeMatching: true, doubleTimeMatching: true, transitionDifficultyTolerance: 70, missingBpmFallback: "allow", minimumBpmConfidence: 0 },
    discovery: { level: "medium", deepCutPercentage: 35, familiarityBalance: 50, avoidOverplayedTracks: true, favorUnderplayedPlexTracks: true, favorTracksNotRecentlyUsed: true, hiddenGemPreference: 50, maximumHighPopularityPercentage: 45, recentlyAddedPreference: 0, newTrackQuarantineDays: 0, lowConfidenceBehavior: "neutral" },
    variety: { maximumTracksPerArtist: 3, minimumArtistSpacing: 1, maximumTracksPerAlbum: 2, minimumAlbumSpacing: 0, maximumRepeatedGenres: 12, duplicateTrackHandling: "avoid", alternateVersionHandling: "avoid", liveVersionHandling: "avoid", remixHandling: "allow", recentlyPlayedExclusionDays: 0, recentlyUsedPlaylistTrackExclusion: true, repeatTolerance: 35, artistVarietyStrategy: "balanced", albumVarietyStrategy: "balanced" },
    playlistIdentity: { personalitySummary: "", coreMoods: [], preferredEnergyCharacter: "unspecified", preferredBpmMinimum: null, preferredBpmMaximum: null, preferredArtists: [], preferredGenres: [], avoidedArtists: [], avoidedGenres: [], avoidedTrackTraits: [], discoveryTolerance: 50, repeatTolerance: 35, transitionPreference: "balanced", lockedTraits: [], identityLearningEnabled: true, personalizationEnabled: false, maximumPersonalizationInfluence: 35 },
    refreshPolicy: { mode: "manual", frequencyDays: null, strategy: "replace_weak", preserveLockedTracks: true, preserveLikedTracks: true, preservePlaylistLength: true, preserveMoodCurve: true, preserveBpmCurve: true, addCompatibleRecentlyAddedTracks: false, weakTrackScoreThreshold: 50, minimumReplacements: 1, maximumReplacements: 10, notificationPreference: "in_app" },
    automationPolicy: { enabled: false, requireExplicitConfirmation: true, libraryId: null, preserveManualEdits: true },
  } as Record<string, any>;
}

export function applyGuidedRecipeAnswers<T extends Record<string, any>>(source: T, answers: GuidedRecipeAnswers): T {
  const draft: Record<string, any> = clone(source);
  const style = {
    balanced: { category: "Custom", energy: "mixed", moods: [] },
    focus: { category: "Focus", energy: "steady", moods: ["Focused", "Calm"] },
    workout: { category: "Workout", energy: "rising", moods: ["Energetic", "Motivated"] },
    party: { category: "Party", energy: "peak", moods: ["Upbeat", "Happy"] },
    chill: { category: "Chill", energy: "falling", moods: ["Relaxed", "Calm"] },
    discovery: { category: "Discovery", energy: "mixed", moods: [] },
  }[answers.mixStyle];
  const discovery = answers.discoveryBalance === "familiar" ? 25 : answers.discoveryBalance === "exploratory" ? 75 : 50;
  const repetition = answers.artistRepetition === "low" ? 2 : answers.artistRepetition === "relaxed" ? 5 : 3;
  const selectedEnergy = answers.energyShape;
  const energyProgression = selectedEnergy === "peak" || selectedEnergy === "dip" ? "wave" : selectedEnergy;
  draft.category = style.category;
  draft.filters = { ...(draft.filters || {}), limit: clamp(Math.round(answers.trackCount), 1, 5000), libraryId: answers.libraryId || null, personalizationMode: answers.household ? "HOUSEHOLD" : "INDIVIDUAL" };
  draft.targets = { ...(draft.targets || {}), selectedMoods: style.moods, primaryMood: style.moods[0] || null, energyProgression };
  draft.discovery = { ...(draft.discovery || {}), familiarityBalance: 100 - discovery, deepCutPercentage: discovery, level: discovery < 40 ? "low" : discovery > 60 ? "high" : "medium" };
  draft.bpmFlow = { ...(draft.bpmFlow || {}), mode: answers.smoothBpm ? (selectedEnergy === "falling" ? "RAMP_DOWN" : selectedEnergy === "rising" ? "RAMP_UP" : "NATURAL") : "DISABLED", maximumBpmGap: answers.smoothBpm ? 8 : 16, allowBpmJumps: !answers.smoothBpm };
  draft.variety = { ...(draft.variety || {}), maximumTracksPerArtist: repetition, artistVarietyStrategy: answers.artistRepetition === "low" ? "strict" : answers.artistRepetition === "relaxed" ? "relaxed" : "balanced" };
  draft.refreshPolicy = { ...(draft.refreshPolicy || {}), mode: answers.refresh === "manual" ? "manual" : "scheduled", frequencyDays: answers.refresh === "weekly" ? 7 : answers.refresh === "monthly" ? 30 : null, preservePlaylistLength: answers.insufficientCandidates !== "reduce_size" };
  draft.automationPolicy = { ...(draft.automationPolicy || {}), enabled: answers.refresh !== "manual", requireExplicitConfirmation: true, libraryId: answers.libraryId || null };
  if (answers.requireApproval) draft.automationPolicy.enabled = false;
  const fallback = answers.insufficientCandidates === "stop" ? "exclude" : answers.insufficientCandidates === "allow_fallback" ? "allow" : "neutral";
  draft.targets.missingMoodFallback = fallback;
  draft.targets.missingEnergyFallback = fallback;
  draft.bpmFlow.missingBpmFallback = fallback;
  return draft as T;
}

export function energyCurvePreset(preset: "flat" | "rising" | "falling" | "peak" | "dip"): CurvePoint[] {
  if (preset === "rising") return [{ position: 0, value: 25 }, { position: 100, value: 85 }];
  if (preset === "falling") return [{ position: 0, value: 85 }, { position: 100, value: 25 }];
  if (preset === "peak") return [{ position: 0, value: 35 }, { position: 50, value: 90 }, { position: 100, value: 45 }];
  if (preset === "dip") return [{ position: 0, value: 75 }, { position: 50, value: 25 }, { position: 100, value: 70 }];
  return [{ position: 0, value: 50 }, { position: 100, value: 50 }];
}

export function validateCurve(points: CurvePoint[]): StudioFinding[] {
  if (points.length < 2) return [{ code: "curve.empty", severity: "error", title: "Curve needs points", message: "Add at least a start and end point.", remediation: "Choose a preset or add two points." }];
  const findings: StudioFinding[] = [];
  points.forEach((point, index) => {
    if (!Number.isFinite(point.position) || point.position < 0 || point.position > 100) findings.push({ code: "curve.position_range", severity: "error", title: "Invalid curve position", message: `Point ${index + 1} must be between 0 and 100%.` });
    if (!Number.isFinite(point.value) || point.value < 0 || point.value > 100) findings.push({ code: "curve.value_range", severity: "error", title: "Invalid curve value", message: `Point ${index + 1} must have a value between 0 and 100.` });
    if (index > 0 && point.position <= points[index - 1].position) findings.push({ code: point.position === points[index - 1].position ? "curve.duplicate_position" : "curve.order", severity: "error", title: "Curve points are out of order", message: "Every point must have a unique position after the previous point." });
  });
  return findings;
}

export function validateBpmFlow(flow: Record<string, any>): StudioFinding[] {
  const findings: StudioFinding[] = [];
  if ((flow.minimumBpm ?? -Infinity) > (flow.maximumBpm ?? Infinity)) findings.push({ code: "bpm.range", severity: "error", title: "Invalid BPM range", message: "Minimum BPM cannot be higher than maximum BPM.", remediation: "Adjust the minimum or maximum BPM." });
  if (flow.startingBpm != null && flow.minimumBpm != null && flow.startingBpm < flow.minimumBpm) findings.push({ code: "bpm.start_range", severity: "warning", title: "Start is outside the range", message: "The starting BPM is below the requested minimum.", remediation: "Move the starting BPM into the target range." });
  const sections = Array.isArray(flow.sections) ? flow.sections : [];
  for (let index = 1; index < sections.length; index += 1) if (sections[index].start < sections[index - 1].end) findings.push({ code: "bpm.sections_overlap", severity: "error", title: "BPM sections overlap", message: "Section-specific BPM targets must be ordered without overlap." });
  return findings;
}

function rangeSelectivity(minimum: unknown, maximum: unknown, domainMinimum: number, domainMaximum: number) {
  const low = minimum == null ? domainMinimum : clamp(Number(minimum), domainMinimum, domainMaximum);
  const high = maximum == null ? domainMaximum : clamp(Number(maximum), domainMinimum, domainMaximum);
  return clamp((high - low) / (domainMaximum - domainMinimum), 0.05, 1);
}

export function estimateRecipeCandidates(recipe: Record<string, any>, profile: LibraryAnalysisProfile) {
  const requested = clamp(Number(recipe.filters?.limit || 100), 1, 5000);
  const rejected: Array<{ rule: string; estimatedTracks: number; explanation: string }> = [];
  let remaining = profile.totalTracks;
  const reject = (rule: string, tracks: number, explanation: string) => {
    const bounded = Math.min(remaining, Math.max(0, Math.round(tracks)));
    if (bounded > 0) rejected.push({ rule, estimatedTracks: bounded, explanation });
    remaining -= bounded;
  };
  const negative = recipe.filters?.negativeFilters || {};
  if (negative.excludeExplicit) reject("Explicit content", profile.explicitTracks || 0, "Uses the library's explicit-content flag.");
  if (negative.excludeLive || recipe.variety?.liveVersionHandling === "avoid") reject("Live recordings", Math.round((profile.liveTracks || 0) * remaining / Math.max(1, profile.totalTracks)), "Uses detected live-recording metadata.");
  if (negative.excludeHoliday) reject("Holiday music", Math.round((profile.holidayTracks || 0) * remaining / Math.max(1, profile.totalTracks)), "Uses detected holiday metadata.");
  if (recipe.bpmFlow?.mode && recipe.bpmFlow.mode !== "DISABLED") {
    const coverage = profile.bpmTracks / Math.max(1, profile.totalTracks);
    if (recipe.bpmFlow.missingBpmFallback === "exclude") reject("Missing BPM", remaining * (1 - coverage), "Strict missing-BPM behavior rejects tracks without tempo metadata.");
    reject("BPM target range", remaining * (1 - rangeSelectivity(recipe.bpmFlow.minimumBpm, recipe.bpmFlow.maximumBpm, 30, 300)) * coverage, "Estimated from the requested BPM span, without generating a playlist.");
  }
  const hasEnergyTarget = recipe.targets?.minimumEnergy != null || recipe.targets?.maximumEnergy != null || recipe.targets?.targetEnergy != null;
  if (hasEnergyTarget) {
    const coverage = profile.energyTracks / Math.max(1, profile.totalTracks);
    if (recipe.targets.missingEnergyFallback === "exclude") reject("Missing energy", remaining * (1 - coverage), "Strict missing-energy behavior rejects tracks without audio analysis.");
    reject("Energy target", remaining * (1 - rangeSelectivity(recipe.targets.minimumEnergy, recipe.targets.maximumEnergy, 0, 1)) * coverage, "Estimated from energy coverage and the requested range.");
  }
  if (recipe.targets?.strictMoodMatching && recipe.targets?.selectedMoods?.length) {
    const coverage = profile.moodTracks / Math.max(1, profile.totalTracks);
    if (recipe.targets.missingMoodFallback === "exclude") reject("Missing mood", remaining * (1 - coverage), "Strict mood matching requires mood metadata.");
    reject("Mood requirements", remaining * clamp(0.35 + recipe.targets.selectedMoods.length * 0.06, 0.35, 0.75) * coverage, "Estimated from mood coverage and selected mood count.");
  }
  const finalCandidates = Math.max(0, Math.round(remaining));
  const capacity = Math.min(finalCandidates, Math.max(1, profile.uniqueArtists) * Math.max(1, Number(recipe.variety?.maximumTracksPerArtist || 3)), Math.max(1, profile.uniqueAlbums) * Math.max(1, Number(recipe.variety?.maximumTracksPerAlbum || 2)));
  const headroom = requested > 0 ? Number((finalCandidates / requested).toFixed(1)) : 0;
  return {
    estimated: true,
    evaluatedTracks: profile.totalTracks,
    matchingCandidates: finalCandidates,
    rejected,
    uniqueArtists: Math.min(profile.uniqueArtists, finalCandidates),
    uniqueAlbums: Math.min(profile.uniqueAlbums, finalCandidates),
    requestedPlaylistSize: requested,
    estimatedPlaylistCapacity: capacity,
    achievable: capacity >= requested,
    fallbackLikely: capacity < requested || headroom < 2,
    headroom,
    confidence: profile.totalTracks === 0 ? "unavailable" : profile.bpmTracks + profile.energyTracks + profile.moodTracks > profile.totalTracks ? "medium" : "low",
    analyzedAt: profile.analyzedAt || new Date().toISOString(),
  };
}

export function analyzeRecipeCompatibility(recipe: Record<string, any>, profile: LibraryAnalysisProfile) {
  const findings: StudioFinding[] = [...validateBpmFlow(recipe.bpmFlow || {})];
  const candidate = estimateRecipeCandidates(recipe, profile);
  const bpmCoverage = percent(profile.bpmTracks, profile.totalTracks);
  const energyCoverage = percent(profile.energyTracks, profile.totalTracks);
  const moodCoverage = percent(profile.moodTracks, profile.totalTracks);
  if (profile.totalTracks === 0) findings.push({ code: "library.empty", severity: "error", title: "Library is unavailable", message: "No active tracks are available in the selected library.", remediation: "Run a Plex library sync or choose another library." });
  if (recipe.bpmFlow?.mode !== "DISABLED" && bpmCoverage < 80) findings.push({ code: "metadata.bpm", severity: bpmCoverage < 50 ? "warning" : "recommendation", title: "BPM coverage is incomplete", message: `BPM metadata is available for ${bpmCoverage}% of active tracks.`, remediation: "Run audio analysis or allow the missing-BPM fallback." });
  if ((recipe.targets?.minimumEnergy != null || recipe.targets?.maximumEnergy != null) && energyCoverage < 80) findings.push({ code: "metadata.energy", severity: "warning", title: "Energy coverage is incomplete", message: `Energy metadata is available for ${energyCoverage}% of active tracks.`, remediation: "Run audio analysis or relax the energy requirement." });
  if (recipe.targets?.strictMoodMatching && moodCoverage < 80) findings.push({ code: "metadata.mood", severity: "warning", title: "Mood coverage is incomplete", message: `Mood metadata is available for ${moodCoverage}% of active tracks.`, remediation: "Run audio analysis or use a non-strict mood fallback." });
  if (!candidate.achievable) findings.push({ code: "candidate.insufficient", severity: "error", title: "Requested size is unlikely", message: `The estimated capacity is ${candidate.estimatedPlaylistCapacity} tracks for a requested ${candidate.requestedPlaylistSize}.`, remediation: "Reduce playlist size, relax a required filter, or enable fallback behavior." });
  else if (candidate.headroom < 3) findings.push({ code: "candidate.low_headroom", severity: "recommendation", title: "Candidate headroom is narrow", message: `Estimated headroom is ${candidate.headroom}x. Results may repeat more often.`, remediation: "Relax one filter or reduce the requested playlist size." });
  const requiredIntegrations = Array.isArray(recipe.governance?.dependencies) ? recipe.governance.dependencies.filter((item: any) => item.required && item.status !== "AVAILABLE") : [];
  requiredIntegrations.forEach((item: any) => findings.push({ code: "dependency.missing", severity: "error", title: "Missing dependency", message: item.message || `${item.name} is unavailable.`, remediation: `Configure ${item.name} or choose the declared fallback.` }));
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const status = errors ? (profile.totalTracks === 0 ? "requires_configuration" : "partially_compatible") : warnings ? "compatible_with_warnings" : "fully_compatible";
  return { status, score: clamp(100 - errors * 25 - warnings * 10 - findings.filter((item) => item.severity === "recommendation").length * 3, 0, 100), findings, coverage: { bpm: bpmCoverage, energy: energyCoverage, mood: moodCoverage, popularity: percent(profile.popularityTracks, profile.totalTracks) } };
}

export function previewScoringImpact(recipe: Record<string, any>) {
  const labels: Record<string, string> = { moodMatchWeight: "Mood match", energyMatchWeight: "Energy match", bpmCompatibilityWeight: "BPM compatibility", popularityWeight: "Popularity", discoveryWeight: "Discovery", playlistIdentityWeight: "Playlist identity", historicalAcceptanceWeight: "Historical acceptance", historicalRejectionPenalty: "Historical rejection", artistPreferenceWeight: "Artist preference", recencyPenalty: "Recency penalty", repeatPenalty: "Repeat penalty", metadataConfidenceWeight: "Metadata confidence", transitionQualityWeight: "Transition quality" };
  const negative = new Set(["historicalRejectionPenalty", "recencyPenalty", "repeatPenalty"]);
  const active = Object.entries(recipe.scoring || {}).filter(([key, value]) => labels[key] && Number(value) > 0).map(([key, value]) => ({ key, label: labels[key], weight: Number(value), influence: negative.has(key) ? "negative" : "positive", approximateContribution: Number((Number(value) / 100).toFixed(2)) })).sort((left, right) => right.weight - left.weight);
  const conflicts: StudioFinding[] = [];
  if (Number(recipe.scoring?.popularityWeight) >= 75 && Number(recipe.scoring?.discoveryWeight) >= 75) conflicts.push({ code: "scoring.popularity_discovery", severity: "recommendation", title: "Competing scoring goals", message: "High popularity and discovery weights can pull rankings in opposite directions.", remediation: "Choose which behavior should dominate or lower both weights." });
  if (Number(recipe.scoring?.repeatPenalty) >= 80 && Number(recipe.variety?.repeatTolerance) >= 70) conflicts.push({ code: "scoring.repeat", severity: "recommendation", title: "Repeat settings conflict", message: "The scoring penalty avoids repeats while the variety rule permits them.", remediation: "Align repeat tolerance with the repeat penalty." });
  const ineffective = active.filter((factor) => factor.weight <= 5).map((factor) => factor.label);
  return { estimated: true, activeFactors: active, conflicts, ineffective, explanation: "Contributions describe relative influence before eligibility, tie-breaking, and transition ordering; they do not guarantee final track positions." };
}

export function previewDiscoveryAndVariety(recipe: Record<string, any>, profile: LibraryAnalysisProfile) {
  const exploratory = clamp(100 - Number(recipe.discovery?.familiarityBalance ?? 50), 0, 100);
  const rediscovery = Math.round(exploratory * 0.4);
  const newOrRare = exploratory - rediscovery;
  const familiar = 100 - exploratory;
  const size = Number(recipe.filters?.limit || 100);
  const maximumPerArtist = Math.max(1, Number(recipe.variety?.maximumTracksPerArtist || 3));
  const maximumPerAlbum = Math.max(1, Number(recipe.variety?.maximumTracksPerAlbum || 2));
  const estimatedArtists = Math.min(profile.uniqueArtists, size, Math.ceil(size / maximumPerArtist * 1.25));
  const estimatedAlbums = Math.min(profile.uniqueAlbums, size, Math.ceil(size / maximumPerAlbum * 1.2));
  const varietyScore = clamp(Math.round((estimatedArtists / Math.max(1, size) * 70) + (estimatedAlbums / Math.max(1, size) * 30)), 0, 100);
  return { estimated: true, familiarFavorites: familiar, rediscovery, newOrRare, recentlyAdded: Math.round(newOrRare * Number(recipe.discovery?.recentlyAddedPreference || 0) / 100), olderLibrary: 100 - Math.round(newOrRare * Number(recipe.discovery?.recentlyAddedPreference || 0) / 100), estimatedArtists, estimatedAlbums, maximumTracksPerArtist: maximumPerArtist, maximumTracksPerAlbum: maximumPerAlbum, discoveryPercentage: exploratory, varietyScore };
}

export type RecipeDifference = { path: string; before: unknown; after: unknown; section: string };

export function compareRecipeDocuments(before: unknown, after: unknown): RecipeDifference[] {
  const differences: RecipeDifference[] = [];
  const walk = (left: any, right: any, path: string) => {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    const leftObject = left && typeof left === "object" && !Array.isArray(left);
    const rightObject = right && typeof right === "object" && !Array.isArray(right);
    if (leftObject && rightObject) {
      for (const key of Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort()) walk(left[key], right[key], path ? `${path}.${key}` : key);
      return;
    }
    differences.push({ path, before: left, after: right, section: path.split(".")[0] || "metadata" });
  };
  walk(before, after, "");
  return differences;
}

export function hasAdvancedRecipeSettings(recipe: Record<string, any>) {
  return Boolean(recipe.filters?.ruleTree || (recipe.filters?.rules || []).length > 3 || (recipe.bpmFlow?.sections || []).length > 0 || recipe.inheritanceEnabled || (recipe.localOverrides || []).length > 0 || ![DEFAULT_SCORING_MODEL, undefined].includes(recipe.scoring?.scoringModel));
}

export function analyzeRecipeStudio(recipe: Record<string, any>, profile: LibraryAnalysisProfile) {
  return {
    candidateEstimate: estimateRecipeCandidates(recipe, profile),
    compatibility: analyzeRecipeCompatibility(recipe, profile),
    scoringImpact: previewScoringImpact(recipe),
    discoveryPreview: previewDiscoveryAndVariety(recipe, profile),
    profile,
  };
}
