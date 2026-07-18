export type OpportunityInput = {
  eligible: boolean;
  analyzed: boolean;
  selectionCount: number;
  rejectionCount: number;
  baseQualityScore: number;
  personalizedQualityScore?: number | null;
  metadataConfidence: number;
  audioFeatureConfidence: number;
  compatibilityPotential: number;
  artistUnused?: boolean;
  albumUnused?: boolean;
  underrepresentedSegment?: boolean;
  daysSinceAdded?: number | null;
  daysSinceSelected?: number | null;
};

export type OveruseInput = {
  selectionCount: number;
  uniquePlaylistCount: number;
  recentSelectionCount: number;
  averageSelectionCount: number;
  generationVolume: number;
  intentionallyFavored?: boolean;
  locked?: boolean;
  liked?: boolean;
};

export type RotationInfluence = {
  enabled: boolean;
  maximumBoost: number;
  opportunityScore: number;
  overuseScore: number;
  eligible: boolean;
  qualityPassed: boolean;
};

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

export function calculateMetadataConfidence(input: {
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  year?: unknown;
  bpm?: unknown;
  genres?: unknown[];
  moods?: unknown[];
  audioFeatureConfidence?: unknown;
}) {
  const checks = [
    Boolean(input.title),
    Boolean(input.artist),
    Boolean(input.album),
    Number.isFinite(Number(input.year)),
    Number.isFinite(Number(input.bpm)),
    Boolean(input.genres?.length),
    Boolean(input.moods?.length),
  ];
  const completeness = checks.filter(Boolean).length / checks.length;
  const audio = clamp(Number(input.audioFeatureConfidence) || 0, 0, 1);
  return round(clamp((completeness * 0.8 + audio * 0.2) * 100), 1);
}

export function calculateOpportunityScore(input: OpportunityInput) {
  if (!input.eligible || !input.analyzed) return { score: 0, reasons: ["Basic eligibility or analysis requirements are not met"] };
  const reasons: string[] = [];
  const quality = clamp(input.baseQualityScore);
  const personalized = clamp(input.personalizedQualityScore ?? quality);
  const metadata = clamp(input.metadataConfidence);
  const audio = clamp(input.audioFeatureConfidence);
  const compatibility = clamp(input.compatibilityPotential);
  let score = quality * 0.27 + personalized * 0.13 + metadata * 0.17 + audio * 0.08 + compatibility * 0.2;

  if (input.selectionCount === 0) {
    score += 8;
    reasons.push("Has never appeared in a Smart Mix playlist");
  } else if (input.selectionCount <= 2) {
    score += 4;
    reasons.push("Has had very little Smart Mix usage");
  }
  if (input.artistUnused) { score += 3; reasons.push("Artist is underrepresented"); }
  if (input.albumUnused) { score += 2; reasons.push("Album is underrepresented"); }
  if (input.underrepresentedSegment) { score += 3; reasons.push("Library segment is underrepresented"); }
  if ((input.daysSinceAdded ?? 0) >= 180) { score += 2; reasons.push("Has been in the library for at least six months"); }
  if ((input.daysSinceSelected ?? 0) >= 90) { score += 2; reasons.push("Has not been selected recently"); }
  const rejectionPenalty = Math.min(18, input.rejectionCount * 2.5);
  if (rejectionPenalty) { score -= rejectionPenalty; reasons.push("Recent or repeated rejection history reduced the score"); }
  if (metadata >= 80) reasons.unshift("Strong metadata confidence");
  if (compatibility >= 75) reasons.unshift("Strong playlist compatibility potential");
  return { score: round(clamp(score), 1), reasons };
}

export function calculateOveruseScore(input: OveruseInput) {
  if (input.selectionCount <= 1 || input.generationVolume <= 1) return { score: 0, exempt: false, reasons: ["Usage is not concentrated"] };
  const average = Math.max(0.1, input.averageSelectionCount);
  const relativeFrequency = clamp((input.selectionCount / average - 1) * 18);
  const generationDensity = clamp((input.selectionCount / Math.max(1, input.generationVolume)) * 100);
  const playlistBreadth = clamp(input.uniquePlaylistCount * 8);
  const recentDensity = clamp(input.recentSelectionCount * 12);
  let score = relativeFrequency * 0.38 + generationDensity * 0.27 + playlistBreadth * 0.15 + recentDensity * 0.2;
  const intentionallyFavored = Boolean(input.intentionallyFavored || input.locked || input.liked);
  const reasons = ["Selection frequency is above the library average"];
  if (input.recentSelectionCount >= 3) reasons.push("Repeated use is concentrated in the recent period");
  if (input.uniquePlaylistCount >= 3) reasons.push("Appears across several distinct playlists");
  if (intentionallyFavored) {
    score *= 0.55;
    reasons.push("Liked, locked, or explicitly preferred status explains part of the repeated use");
  }
  return { score: round(clamp(score), 1), exempt: intentionallyFavored, reasons };
}

export function calculateRotationFairness(selectionCounts: number[], qualityWeights?: number[]) {
  if (!selectionCounts.length || selectionCounts.every((count) => count <= 0)) {
    return { score: 0, label: "Highly concentrated", topShare: 0, explanation: "No Smart Mix selection history is available yet." };
  }
  const weighted = selectionCounts.map((count, index) => Math.max(0, count) / Math.max(0.25, (qualityWeights?.[index] ?? 100) / 100));
  const sorted = [...weighted].sort((a, b) => b - a);
  const total = sorted.reduce((sum, count) => sum + count, 0);
  const topCount = Math.max(1, Math.ceil(sorted.length * 0.02));
  const topShare = sorted.slice(0, topCount).reduce((sum, count) => sum + count, 0) / Math.max(1, total);
  const ascending = [...sorted].reverse();
  const giniNumerator = ascending.reduce((sum, value, index) => sum + (2 * (index + 1) - ascending.length - 1) * value, 0);
  const gini = giniNumerator / Math.max(1, ascending.length * total);
  const score = round(clamp(100 - gini * 72 - Math.max(0, topShare - 0.12) * 75), 1);
  const label = score < 40 ? "Highly concentrated" : score < 60 ? "Limited rotation" : score < 75 ? "Balanced" : score < 90 ? "Broad rotation" : "Very broad rotation";
  return {
    score,
    label,
    topShare: round(topShare * 100, 1),
    explanation: `The top 2% of eligible tracks account for ${round(topShare * 100, 1)}% of quality-weighted selections.`,
  };
}

export function applyCoverageInfluence(baseScore: number, input: RotationInfluence) {
  if (!input.enabled || !input.eligible || !input.qualityPassed) return { finalScore: baseScore, boost: 0, penalty: 0, reasons: [] as string[] };
  const maximum = clamp(input.maximumBoost, 0, 10);
  const boost = round(Math.min(maximum, clamp(input.opportunityScore) / 100 * maximum), 3);
  const penalty = round(Math.min(maximum, clamp(input.overuseScore) / 100 * maximum), 3);
  const reasons: string[] = [];
  if (boost > 0) reasons.push(`Coverage opportunity added ${boost.toFixed(2)} points within the configured cap`);
  if (penalty > 0) reasons.push(`Recent overuse removed ${penalty.toFixed(2)} points within the configured cap`);
  return { finalScore: round(baseScore + boost - penalty, 3), boost, penalty, reasons };
}

export function decadeForYear(year: number | null | undefined) {
  if (!Number.isFinite(year)) return { key: "unknown", label: "Unknown year" };
  const value = Number(year);
  if (value < 1950) return { key: "pre-1950", label: "Pre-1950" };
  const decade = Math.floor(value / 10) * 10;
  return { key: String(decade), label: `${decade}s` };
}

export const NEGLECTED_MIX_PRESETS = {
  safe_discovery: { label: "Safe Discovery", minimumOpportunityScore: 75, minimumMetadataConfidence: 80, neverSelectedTarget: 60, underusedTarget: 30, familiarAnchorPercentage: 10, maximumLowConfidenceTracks: 0 },
  balanced: { label: "Balanced Neglected Mix", minimumOpportunityScore: 68, minimumMetadataConfidence: 70, neverSelectedTarget: 50, underusedTarget: 35, familiarAnchorPercentage: 15, maximumLowConfidenceTracks: 2 },
  deep_library: { label: "Deep Library Dive", minimumOpportunityScore: 60, minimumMetadataConfidence: 60, neverSelectedTarget: 75, underusedTarget: 20, familiarAnchorPercentage: 5, maximumLowConfidenceTracks: 4 },
  recently_added: { label: "Recently Added Opportunities", minimumOpportunityScore: 68, minimumMetadataConfidence: 70, neverSelectedTarget: 65, underusedTarget: 25, familiarAnchorPercentage: 10, maximumLowConfidenceTracks: 2 },
  underused_quality: { label: "Underused High Quality", minimumOpportunityScore: 78, minimumMetadataConfidence: 80, neverSelectedTarget: 45, underusedTarget: 45, familiarAnchorPercentage: 10, maximumLowConfidenceTracks: 0 },
} as const;
