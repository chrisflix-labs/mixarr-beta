export const betaAccessLevels = ["STABLE", "PUBLIC_BETA", "PRIVATE_BETA", "DEVELOPER"] as const;
export type BetaAccessLevel = typeof betaAccessLevels[number];
export type BetaRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type FeatureFlagDefinition = {
  key: string;
  name: string;
  description: string;
  category: "Smart Mix" | "Automation" | "Diagnostics" | "Interface";
  minimumAccessLevel: BetaAccessLevel;
  adminOnly: boolean;
  defaultEnabled: boolean;
  serverOverride: string | null;
  riskLevel: BetaRiskLevel;
  warningText: string;
  introducedVersion: string;
  expiresAfterVersion: string | null;
  feedbackCategory: string;
  stableFallback: string;
};

const feature = (definition: FeatureFlagDefinition) => definition;

export const featureFlagRegistry = [
  feature({ key: "showBetaCards", name: "Beta dashboard cards", description: "Display the Smart Mix Beta Lab dashboard card.", category: "Interface", minimumAccessLevel: "PUBLIC_BETA", adminOnly: false, defaultEnabled: false, serverOverride: null, riskLevel: "LOW", warningText: "Informational preview content may change between releases.", introducedVersion: "1.5.0", expiresAfterVersion: null, feedbackCategory: "beta-interface", stableFallback: "Hide beta-only dashboard cards." }),
  feature({ key: "enableV2PreviewCards", name: "v2 preview cards", description: "Display early Smart Mix v2 preview cards.", category: "Interface", minimumAccessLevel: "PUBLIC_BETA", adminOnly: false, defaultEnabled: false, serverOverride: null, riskLevel: "LOW", warningText: "Preview cards describe work that may change.", introducedVersion: "1.5.0", expiresAfterVersion: "2.1.0", feedbackCategory: "beta-interface", stableFallback: "Hide preview cards." }),
  feature({ key: "smartMix.experimentalScoring", name: "Experimental Scoring Models", description: "Test alternative Smart Mix compatibility scoring models.", category: "Smart Mix", minimumAccessLevel: "PUBLIC_BETA", adminOnly: false, defaultEnabled: false, serverOverride: "MIXARR_FEATURE_EXPERIMENTAL_SCORING", riskLevel: "MEDIUM", warningText: "Track selection and ordering may differ from Stable v2.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "experimental-scoring", stableFallback: "Use Stable v2 scoring." }),
  feature({ key: "smartMix.adaptiveWeighting", name: "Adaptive Scoring Weights", description: "Adjust mood, energy, BPM and discovery weights for the available library.", category: "Smart Mix", minimumAccessLevel: "PUBLIC_BETA", adminOnly: false, defaultEnabled: false, serverOverride: null, riskLevel: "MEDIUM", warningText: "Adaptive weights can change results as the library changes.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "adaptive-weighting", stableFallback: "Use saved static scoring weights." }),
  feature({ key: "smartMix.sectionAwareMatching", name: "Section-aware Track Placement", description: "Place tracks according to playlist-section mood and energy targets.", category: "Smart Mix", minimumAccessLevel: "PRIVATE_BETA", adminOnly: false, defaultEnabled: false, serverOverride: null, riskLevel: "MEDIUM", warningText: "Section placement is still being tuned and may create unexpected ordering.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "section-aware", stableFallback: "Use standard Smart Mix ordering." }),
  feature({ key: "smartMix.multiPassOptimization", name: "Multi-pass Playlist Optimization", description: "Run additional selection and ordering passes before preview.", category: "Smart Mix", minimumAccessLevel: "PRIVATE_BETA", adminOnly: false, defaultEnabled: false, serverOverride: null, riskLevel: "HIGH", warningText: "This can take longer and may substantially change playlist ordering.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "multi-pass", stableFallback: "Use the single stable selection pass." }),
  feature({ key: "smartMix.experimentalMoodGraph", name: "Experimental Mood Graph", description: "Use an experimental relationship graph for multi-mood transitions.", category: "Smart Mix", minimumAccessLevel: "PRIVATE_BETA", adminOnly: false, defaultEnabled: false, serverOverride: null, riskLevel: "MEDIUM", warningText: "Mood relationships may produce unexpected track transitions.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "mood-graph", stableFallback: "Use standard mood compatibility rules." }),
  feature({ key: "smartMix.dynamicBpmTolerance", name: "Dynamic BPM Tolerance", description: "Adjust BPM tolerance from the candidate pool and target curve.", category: "Smart Mix", minimumAccessLevel: "PUBLIC_BETA", adminOnly: false, defaultEnabled: false, serverOverride: null, riskLevel: "LOW", warningText: "Tempo transitions may be looser than the saved static setting.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "dynamic-bpm", stableFallback: "Use the saved BPM tolerance." }),
  feature({ key: "smartMix.autoReplaceWeakTracks", name: "Automatic Weak-track Replacement", description: "Apply high-confidence weak-track replacements automatically.", category: "Smart Mix", minimumAccessLevel: "PRIVATE_BETA", adminOnly: true, defaultEnabled: false, serverOverride: null, riskLevel: "HIGH", warningText: "This feature can replace tracks in an existing playlist. A version is saved before changes.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "auto-replace", stableFallback: "Generate suggestions without replacing tracks." }),
  feature({ key: "smartMix.recentlyAddedAutomation", name: "Recently Added Experimental Automation", description: "Enable beta sub-features for Recently Added Automation.", category: "Automation", minimumAccessLevel: "PUBLIC_BETA", adminOnly: false, defaultEnabled: false, serverOverride: null, riskLevel: "MEDIUM", warningText: "Scheduled results can change as new tracks arrive.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "recently-added", stableFallback: "Keep stable Recently Added analysis and manual review." }),
  feature({ key: "smartMix.recentlyAddedAutoAdd", name: "Recently Added Auto-add", description: "Allow high-confidence recently added matches to be applied automatically.", category: "Automation", minimumAccessLevel: "PRIVATE_BETA", adminOnly: true, defaultEnabled: false, serverOverride: null, riskLevel: "HIGH", warningText: "Tracks may be added to Plex playlists automatically after a version snapshot.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "recently-added-auto-add", stableFallback: "Leave matches as reviewable suggestions." }),
  feature({ key: "smartMix.experimentalScheduledRegeneration", name: "Experimental Scheduled Regeneration", description: "Use eligible beta scoring during scheduled regeneration.", category: "Automation", minimumAccessLevel: "PRIVATE_BETA", adminOnly: true, defaultEnabled: false, serverOverride: null, riskLevel: "HIGH", warningText: "Scheduled jobs can change existing playlists with experimental logic.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "scheduled-regeneration", stableFallback: "Run scheduled work with stable behavior or skip the beta request." }),
  feature({ key: "smartMix.aggressiveDiscovery", name: "Aggressive Discovery", description: "Favor lower-use and less familiar candidates more strongly.", category: "Smart Mix", minimumAccessLevel: "PRIVATE_BETA", adminOnly: false, defaultEnabled: false, serverOverride: null, riskLevel: "MEDIUM", warningText: "Results may contain more unfamiliar or weakly matched tracks.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "aggressive-discovery", stableFallback: "Use the saved discovery balance." }),
  feature({ key: "smartMix.debugScoreBreakdown", name: "Detailed Score Debugging", description: "Expose per-track scoring diagnostics for local debugging.", category: "Diagnostics", minimumAccessLevel: "DEVELOPER", adminOnly: true, defaultEnabled: false, serverOverride: null, riskLevel: "HIGH", warningText: "Developer diagnostics can be verbose and may expose library structure on screen.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "score-debug", stableFallback: "Hide detailed score diagnostics." }),
  feature({ key: "smartMix.compareScoringModels", name: "Compare Scoring Models", description: "Preview the same request through two scoring models without saving it.", category: "Diagnostics", minimumAccessLevel: "PUBLIC_BETA", adminOnly: false, defaultEnabled: false, serverOverride: null, riskLevel: "LOW", warningText: "Comparison performs two preview generations and can take longer.", introducedVersion: "2.0.10", expiresAfterVersion: null, feedbackCategory: "model-comparison", stableFallback: "Generate one stable preview." }),
] as const satisfies readonly FeatureFlagDefinition[];

export type FeatureKey = typeof featureFlagRegistry[number]["key"];
export const featureFlagKeys = featureFlagRegistry.map((item) => item.key) as FeatureKey[];
export const featureFlagByKey = new Map<string, FeatureFlagDefinition>(featureFlagRegistry.map((item) => [item.key, item]));
const implementedFeatureKeys = new Set<string>([
  "showBetaCards", "enableV2PreviewCards", "smartMix.experimentalScoring",
  "smartMix.experimentalMoodGraph", "smartMix.compareScoringModels",
  "smartMix.recentlyAddedAutoAdd",
  "smartMix.experimentalScheduledRegeneration",
]);
export function isFeatureImplemented(featureKey: string) { return implementedFeatureKeys.has(featureKey); }

export function accessLevelRank(level: BetaAccessLevel) {
  return betaAccessLevels.indexOf(level);
}

export function normalizeBetaAccessLevel(value: unknown): BetaAccessLevel {
  const normalized = typeof value === "string" ? value.trim().toUpperCase().replaceAll(" ", "_") : "";
  return betaAccessLevels.includes(normalized as BetaAccessLevel) ? normalized as BetaAccessLevel : "STABLE";
}

export function betaAccessLevelLabel(level: BetaAccessLevel) {
  return level === "PUBLIC_BETA" ? "Public Beta" : level === "PRIVATE_BETA" ? "Private Beta" : level === "DEVELOPER" ? "Developer" : "Stable";
}
