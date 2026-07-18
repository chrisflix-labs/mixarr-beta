export const EXPERIMENT_CONFIGURATION_SCHEMA_VERSION = 1;

export type ExperimentVariantKey = "A" | "B";
export type ExperimentStatus = "DRAFT" | "READY" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED" | "ARCHIVED" | "INCONCLUSIVE";

export type ConfigurationDifference = {
  path: string;
  label: string;
  valueA: unknown;
  valueB: unknown;
};

const LABELS: Record<string, string> = {
  "tuningConfig.familiarityDiscoveryBalance": "Discovery balance",
  "tuningConfig.discovery.deepCutTarget": "Deep-cut target",
  "tuningConfig.recommendationStrength": "Recommendation strength",
  "tuningConfig.moodWeight": "Mood weight",
  "tuningConfig.energyWeight": "Energy weight",
  "tuningConfig.bpmWeight": "BPM weight",
  "tuningConfig.artistVariety": "Artist variety",
  "tuningConfig.albumVariety": "Album variety",
  "tuningConfig.bpmFlow.mode": "BPM transition strategy",
  "tuningConfig.bpmFlow.maxPreferredGap": "Maximum BPM gap",
  "tuningConfig.bpmFlow.halfDoubleTimeMatching": "Half/double-time matching",
  moodBlendMode: "Mood blend mode",
  moodStrength: "Mood strength",
  transitionSmoothness: "Transition smoothness",
  "safetyRules.maxTracksPerArtist": "Maximum tracks per artist",
  "safetyRules.limitTracksPerArtist": "Artist limit",
  personalizationEnabled: "Personalized scoring",
  personalizationInfluence: "Personalization influence",
};

const IDENTITY_PATHS = new Set([
  "rules", "ruleTree", "serverId", "libraryId", "limit", "pinnedTrackIds", "excludedTrackIds",
  "smartPresetId", "smartPresetName", "moodPresetId", "moodPresetName", "bpmPresetId", "bpmPresetName",
  "engineVersion", "scoringModel", "duplicateStrategy", "negativeFilters", "safetyRules.avoidSameArtistBackToBack",
]);

const TYPE_PREFIXES: Record<string, string[]> = {
  SCORING_CONFIGURATION: ["tuningConfig"],
  PERSONALIZED_VS_BASE: ["personalizationEnabled", "personalizationInfluence"],
  DISCOVERY_LEVEL: ["tuningConfig.familiarityDiscoveryBalance", "tuningConfig.discovery"],
  BPM_TRANSITION: ["tuningConfig.bpmFlow", "bpmPreset"],
  MOOD_BLEND: ["moodBlendMode", "moodStrength", "transitionSmoothness", "moodStrictness", "fallbackTolerance", "bridgeTrackPreference", "moodVariety", "selectedMood"],
  ARTIST_VARIETY: ["tuningConfig.artistVariety", "safetyRules.limitTracksPerArtist", "safetyRules.maxTracksPerArtist"],
  CUSTOM: [""],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function stableConfigurationSnapshot(value: unknown) {
  return { schemaVersion: EXPERIMENT_CONFIGURATION_SCHEMA_VERSION, settings: stable(value) };
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function walkDifferences(a: unknown, b: unknown, path = "", output: ConfigurationDifference[] = []) {
  if (same(a, b)) return output;
  if (isObject(a) && isObject(b)) {
    for (const key of Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort()) {
      walkDifferences(a[key], b[key], path ? `${path}.${key}` : key, output);
    }
    return output;
  }
  output.push({ path, label: LABELS[path] || path.split(".").at(-1)?.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()) || "Setting", valueA: a, valueB: b });
  return output;
}

export function diffExperimentConfigurations(configurationA: unknown, configurationB: unknown) {
  return walkDifferences(configurationA, configurationB);
}

export function validateControlledExperiment(input: { experimentType: string; configurationA: unknown; configurationB: unknown; allowMultiVariable?: boolean }) {
  const differences = diffExperimentConfigurations(input.configurationA, input.configurationB);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (differences.length === 0) errors.push("Version A and Version B must have at least one meaningful configuration difference.");
  const identityDifferences = differences.filter((difference) => IDENTITY_PATHS.has(difference.path) || Array.from(IDENTITY_PATHS).some((path) => difference.path.startsWith(`${path}.`)));
  if (identityDifferences.length) errors.push(`Controlled playlist identity settings must remain constant: ${identityDifferences.map((difference) => difference.label).join(", ")}.`);
  const allowedPrefixes = TYPE_PREFIXES[input.experimentType] || TYPE_PREFIXES.CUSTOM;
  const unrelated = input.experimentType === "CUSTOM" ? [] : differences.filter((difference) => !allowedPrefixes.some((prefix) => difference.path === prefix || difference.path.startsWith(`${prefix}.`)));
  if (unrelated.length) errors.push(`These changes do not belong to the selected experiment type: ${unrelated.map((difference) => difference.label).join(", ")}.`);
  if (differences.length > 3) warnings.push(`${differences.length} settings differ. The result may be harder to interpret because several variables changed together.`);
  if (differences.length > 1 && input.allowMultiVariable === false) errors.push("Multi-variable experiments are disabled in Smart Experiment settings.");
  return { valid: errors.length === 0, differences, errors, warnings };
}

export function calculateOverlap(trackIdsA: string[], trackIdsB: string[]) {
  const a = new Set(trackIdsA);
  const b = new Set(trackIdsB);
  const sharedTrackIds = Array.from(a).filter((id) => b.has(id));
  const denominator = Math.max(1, Math.min(a.size, b.size));
  return {
    sharedTrackIds,
    sharedTracks: sharedTrackIds.length,
    uniqueToA: Array.from(a).filter((id) => !b.has(id)).length,
    uniqueToB: Array.from(b).filter((id) => !a.has(id)).length,
    overlapPercentage: Math.round((sharedTrackIds.length / denominator) * 1000) / 10,
  };
}

export type OutcomeCounts = {
  evaluated: number; kept?: number; liked?: number; goodPlaylistFit?: number;
  removed?: number; disliked?: number; neverRecommend?: number; repeatedEarlySkips?: number;
  positiveUnique?: number; explicitRejectionsUnique?: number;
};

export function calculateOutcomeRates(counts: OutcomeCounts) {
  const evaluated = Math.max(0, counts.evaluated);
  const positive = Math.min(evaluated, Math.max(0, counts.positiveUnique ?? ((counts.kept || 0) + (counts.liked || 0) + (counts.goodPlaylistFit || 0))));
  const explicitRejections = Math.min(evaluated, Math.max(0, counts.explicitRejectionsUnique ?? ((counts.removed || 0) + (counts.disliked || 0) + (counts.neverRecommend || 0))));
  const inferredRejections = Math.min(Math.max(0, evaluated - explicitRejections), Math.max(0, counts.repeatedEarlySkips || 0));
  return {
    evaluated,
    positive,
    explicitRejections,
    inferredRejections,
    acceptanceRate: evaluated ? Math.round((positive / evaluated) * 1000) / 10 : 0,
    rejectionRate: evaluated ? Math.round(((explicitRejections + inferredRejections) / evaluated) * 1000) / 10 : 0,
  };
}

export type RecommendationEvidence = {
  acceptanceRate: number; rejectionRate: number; completionRate?: number; earlySkipRate?: number;
  playlistScore?: number; discoveryScore?: number; sessions: number; interactions: number;
};

export function recommendExperimentWinner(input: {
  a: RecommendationEvidence; b: RecommendationEvidence; elapsedHours: number;
  thresholds?: { minimumSessions?: number; minimumInteractions?: number; minimumDurationHours?: number; minimumDifference?: number };
}) {
  const thresholds = { minimumSessions: 3, minimumInteractions: 10, minimumDurationHours: 24, minimumDifference: 5, ...input.thresholds };
  const sessions = Math.min(input.a.sessions, input.b.sessions);
  const interactions = Math.min(input.a.interactions, input.b.interactions);
  const missing: string[] = [];
  if (sessions < thresholds.minimumSessions) missing.push(`${thresholds.minimumSessions - sessions} more listening session${thresholds.minimumSessions - sessions === 1 ? "" : "s"}`);
  if (interactions < thresholds.minimumInteractions) missing.push(`${thresholds.minimumInteractions - interactions} more track interaction${thresholds.minimumInteractions - interactions === 1 ? "" : "s"}`);
  if (input.elapsedHours < thresholds.minimumDurationHours) missing.push(`${Math.ceil(thresholds.minimumDurationHours - input.elapsedHours)} more experiment hour${Math.ceil(thresholds.minimumDurationHours - input.elapsedHours) === 1 ? "" : "s"}`);
  const acceptanceDelta = input.b.acceptanceRate - input.a.acceptanceRate;
  const rejectionDelta = input.a.rejectionRate - input.b.rejectionRate;
  const completionDelta = (input.b.completionRate || 0) - (input.a.completionRate || 0);
  const skipDelta = (input.a.earlySkipRate || 0) - (input.b.earlySkipRate || 0);
  const scoreDelta = (input.b.playlistScore || 0) - (input.a.playlistScore || 0);
  const discoveryDelta = (input.b.discoveryScore || 0) - (input.a.discoveryScore || 0);
  const combinedDelta = acceptanceDelta * 0.45 + rejectionDelta * 0.2 + completionDelta * 0.15 + skipDelta * 0.1 + scoreDelta * 0.07 + discoveryDelta * 0.03;
  const explanation = [
    { signal: "acceptance rate", delta: acceptanceDelta }, { signal: "rejection rate", delta: rejectionDelta },
    { signal: "completion rate", delta: completionDelta }, { signal: "early skips", delta: skipDelta },
    { signal: "playlist score", delta: scoreDelta }, { signal: "discovery coverage", delta: discoveryDelta },
  ].filter((item) => Math.abs(item.delta) >= 0.5).map((item) => ({ ...item, favors: item.delta > 0 ? "B" : "A" }));
  if (missing.length) return { suggestedWinner: null, outcome: "MORE_DATA_REQUIRED", confidence: "VERY_LOW", combinedDelta, missingEvidence: missing, explanation };
  if (Math.abs(combinedDelta) < thresholds.minimumDifference) return { suggestedWinner: null, outcome: "NO_CLEAR_WINNER", confidence: interactions >= thresholds.minimumInteractions * 3 ? "MODERATE" : "LOW", combinedDelta, missingEvidence: [], explanation };
  const evidenceScale = Math.min(sessions / thresholds.minimumSessions, interactions / thresholds.minimumInteractions);
  const confidence = evidenceScale >= 4 && Math.abs(combinedDelta) >= thresholds.minimumDifference * 2 ? "HIGH" : evidenceScale >= 2 ? "MODERATE" : "LOW";
  return { suggestedWinner: combinedDelta > 0 ? "B" : "A", outcome: "SUGGESTED_WINNER", confidence, combinedDelta, missingEvidence: [], explanation };
}

export function experimentCompletionState(input: { status: string; durationType: string; durationTarget?: number | null; startAt?: Date | null; now?: Date; pausedDurationSeconds?: number; sessions?: number; completedPlays?: number; interactions?: number }) {
  if (input.status !== "RUNNING") return { complete: false, remaining: null };
  const target = input.durationTarget || 0;
  const now = input.now || new Date();
  if (input.durationType === "DAYS" && input.startAt) {
    const elapsed = Math.floor((now.getTime() - input.startAt.getTime() - (input.pausedDurationSeconds || 0) * 1000) / 86_400_000);
    return { complete: elapsed >= target, remaining: Math.max(0, target - elapsed) };
  }
  const current = input.durationType === "SESSIONS" ? input.sessions || 0 : input.durationType === "COMPLETED_PLAYS" ? input.completedPlays || 0 : input.durationType === "INTERACTIONS" ? input.interactions || 0 : 0;
  if (["SESSIONS", "COMPLETED_PLAYS", "INTERACTIONS"].includes(input.durationType)) return { complete: current >= target, remaining: Math.max(0, target - current) };
  return { complete: false, remaining: null };
}

function getPath(source: unknown, path: string) {
  return path.split(".").reduce<unknown>((value, key) => isObject(value) ? value[key] : undefined, source);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let node = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const existing = node[keys[index]];
    node[keys[index]] = isObject(existing) ? { ...existing } : {};
    node = node[keys[index]] as Record<string, unknown>;
  }
  node[keys.at(-1)!] = value;
}

export function mergeExperimentSettings(configurationA: unknown, configurationB: unknown, selections: Record<string, ExperimentVariantKey>) {
  const base = structuredClone((isObject(configurationA) ? configurationA : {}) as Record<string, unknown>);
  const differences = diffExperimentConfigurations(configurationA, configurationB);
  for (const difference of differences) setPath(base, difference.path, getPath(selections[difference.path] === "B" ? configurationB : configurationA, difference.path));
  return { configuration: base, differences: differences.map((difference) => ({ ...difference, selectedVariant: selections[difference.path] || "A" })) };
}
