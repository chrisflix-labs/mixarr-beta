import type { SmartMixScoredTrack } from "../smartMixEngine/v2/types";
import { SMART_MIX_EXPLANATION_SCHEMA_VERSION, type SmartMixConfidenceExplanation, type SmartMixDecision, type SmartMixDecisionExplanation, type SmartMixExplanationFactor, type SmartMixFallbackExplanation, type SmartMixGenerationInsights, type SmartMixMissingMetadataExplanation } from "./types";

export type SmartMixSelectionTrace = {
  position: number;
  selectionScore: number;
  transitionAdjustment: number;
  transitionFeedbackAdjustment: number;
  varietyPenalty: number;
  discoveryAdjustment: number;
  moodAdjustment: number;
  coordinationAdjustment: number;
  comparisonCandidateId?: string | null;
  comparisonCandidateTitle?: string | null;
  scoreMargin?: number | null;
  previousTrackId?: string | null;
  previousTrackTitle?: string | null;
};

export type TraceableSmartMixTrack = SmartMixScoredTrack<any> & {
  smartMixSelectionTrace?: SmartMixSelectionTrace;
  bpmTransitionFromPrevious?: Record<string, any> | null;
};

const factorDefinitions: Record<string, { code: string; label: string; category: string; source: SmartMixExplanationFactor["source"] }> = {
  base: { code: "BASE_COMPATIBILITY", label: "Base compatibility", category: "global", source: "global" },
  bpm: { code: "BPM_MATCH", label: "BPM match", category: "bpm", source: "global" },
  mood: { code: "MOOD_MATCH", label: "Mood match", category: "mood", source: "global" },
  energy: { code: "ENERGY_MATCH", label: "Energy match", category: "energy", source: "global" },
  popularity: { code: "POPULARITY_FIT", label: "Popularity fit", category: "popularity", source: "global" },
  tuning: { code: "TUNING_ADJUSTMENT", label: "Tuning preferences", category: "global", source: "global" },
  moodBlend: { code: "MOOD_BLEND_FIT", label: "Mood path fit", category: "mood", source: "global" },
  recentlyUsedPenalty: { code: "RECENT_PLAYLIST_USE", label: "Recently used in playlists", category: "recently_used", source: "global" },
  discoveryScore: { code: "DISCOVERY_FIT", label: "Discovery fit", category: "discovery", source: "global" },
  underplayedScore: { code: "UNDERPLAYED_TRACK", label: "Underplayed track", category: "discovery", source: "global" },
  playlistFreshnessScore: { code: "PLAYLIST_FRESHNESS", label: "Playlist freshness", category: "discovery", source: "global" },
  hiddenGemScore: { code: "HIDDEN_GEM", label: "Deep-cut fit", category: "discovery", source: "global" },
  overplayedPenalty: { code: "OVERPLAYED_PENALTY", label: "Overplayed track", category: "recently_played", source: "global" },
  recentPlaylistPenalty: { code: "RECENT_PLAYLIST_PENALTY", label: "Recent playlist use", category: "recently_used", source: "global" },
  fallbackPenalty: { code: "METADATA_FALLBACK_PENALTY", label: "Missing metadata", category: "metadata", source: "metadata" },
  diversity: { code: "VARIETY_ADJUSTMENT", label: "Artist and album variety", category: "variety", source: "global" },
  playlistPreference: { code: "PLAYLIST_PREFERENCE", label: "Playlist preference", category: "personalization", source: "personalization" },
  personalization: { code: "PERSONALIZATION_TOTAL", label: "Personalization", category: "personalization", source: "personalization" },
  trackFeedback: { code: "TRACK_FEEDBACK", label: "Track feedback", category: "track_feedback", source: "personalization" },
  artistFeedback: { code: "ARTIST_PREFERENCE", label: "Artist preference", category: "artist", source: "personalization" },
  playlistFitFeedback: { code: "PLAYLIST_FIT_FEEDBACK", label: "Playlist fit feedback", category: "personalization", source: "personalization" },
  learnedProfile: { code: "LEARNED_PROFILE", label: "Learned preferences", category: "personalization", source: "personalization" },
  transitionFeedback: { code: "TRANSITION_FEEDBACK", label: "Transition feedback", category: "transition", source: "transition" },
  playlistIdentity: { code: "PLAYLIST_IDENTITY_MATCH", label: "Playlist identity", category: "playlist_identity", source: "playlist_identity" },
  personalPreference: { code: "PERSONAL_PREFERENCE", label: "Personal preference", category: "personalization", source: "personalization" },
  historicalAcceptance: { code: "HISTORICAL_ACCEPTANCE", label: "Historical acceptance", category: "history", source: "personalization" },
  historicalRejection: { code: "HISTORICAL_REJECTION", label: "Historical rejection", category: "history", source: "personalization" },
  artistPreference: { code: "ADAPTIVE_ARTIST_PREFERENCE", label: "Learned artist preference", category: "artist", source: "personalization" },
  moodPreference: { code: "ADAPTIVE_MOOD_PREFERENCE", label: "Learned mood preference", category: "mood", source: "personalization" },
  discoveryTolerance: { code: "DISCOVERY_TOLERANCE", label: "Discovery tolerance", category: "discovery", source: "personalization" },
  repeatTolerance: { code: "REPEAT_TOLERANCE", label: "Repeat tolerance", category: "variety", source: "personalization" },
  playback: { code: "PLAYBACK_AWARENESS", label: "Playback history", category: "recently_played", source: "personalization" },
  recentlyPlayedPlayback: { code: "RECENTLY_PLAYED", label: "Recently played", category: "recently_played", source: "personalization" },
  playbackCompletion: { code: "PLAYBACK_COMPLETION", label: "Completion history", category: "history", source: "personalization" },
  playbackReplay: { code: "PLAYBACK_REPLAY", label: "Replay history", category: "history", source: "personalization" },
  playbackSkip: { code: "PLAYBACK_SKIP", label: "Skip history", category: "history", source: "personalization" },
  forgottenFavorite: { code: "FORGOTTEN_FAVORITE", label: "Forgotten favorite", category: "discovery", source: "personalization" },
  playbackDiscovery: { code: "PLAYBACK_DISCOVERY", label: "Playback discovery", category: "discovery", source: "personalization" },
  context: { code: "CONTEXT_MATCH", label: "Context fit", category: "context", source: "global" },
  coordination: { code: "PLAYLIST_COORDINATION", label: "Related playlist coordination", category: "coordination", source: "global" },
  coverageBoost: { code: "LIBRARY_COVERAGE_OPPORTUNITY", label: "Neglected library opportunity", category: "discovery", source: "global" },
  overusePenalty: { code: "LIBRARY_ROTATION_OVERUSE", label: "Library rotation overuse", category: "recently_used", source: "global" },
};

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;

function factorExplanation(label: string, contribution: number) {
  if (contribution > 0) return `${label} increased this candidate's ranking by ${round(contribution, 1)} points.`;
  if (contribution < 0) return `${label} reduced this candidate's ranking by ${round(Math.abs(contribution), 1)} points.`;
  return `${label} did not materially change this candidate's ranking.`;
}

export function factorsFromScoredTrack(track: TraceableSmartMixTrack): SmartMixExplanationFactor[] {
  const hasDetailedPersonalization = Boolean(track.adaptiveScore || track.personalizationScore?.components);
  const hasDetailedPlayback = Boolean(track.playbackScore?.reasons?.length);
  const factors: SmartMixExplanationFactor[] = Object.entries(track.scoreBreakdown || {}).flatMap(([key, raw]) => {
    if ((key === "personalization" && hasDetailedPersonalization) || (key === "playback" && hasDetailedPlayback)) return [];
    if (track.adaptiveScore && ["trackFeedback", "artistFeedback", "playlistFitFeedback", "learnedProfile", "playlistPreference"].includes(key)) return [];
    const definition = factorDefinitions[key];
    if (!definition || typeof raw !== "number" || !Number.isFinite(raw)) return [];
    return [{
      ...definition,
      impact: raw > 0 ? "positive" as const : raw < 0 ? "negative" as const : "neutral" as const,
      rawValue: raw,
      normalizedContribution: round(raw),
      weightedContribution: round(raw),
      weight: 1,
      explanation: factorExplanation(definition.label, raw),
      eligibilityEffect: "ranking" as const,
      sourceConfidence: definition.source === "metadata" ? 0.6 : 1,
    }];
  });
  const selection = track.smartMixSelectionTrace;
  if (selection?.transitionAdjustment) factors.push({ code: "BPM_TRANSITION", label: "BPM transition", category: "transition", impact: selection.transitionAdjustment > 0 ? "positive" : "negative", rawValue: track.bpmTransitionFromPrevious || null, normalizedContribution: round(selection.transitionAdjustment), weightedContribution: round(selection.transitionAdjustment), weight: 1, explanation: factorExplanation("BPM transition", selection.transitionAdjustment), source: "transition", eligibilityEffect: "ranking", sourceConfidence: track.bpmTransitionFromPrevious?.score == null ? 0.4 : 1 });
  if (selection?.varietyPenalty) factors.push({ code: "ARTIST_ALBUM_REPETITION", label: "Artist or album repetition", category: "variety", impact: "negative", rawValue: selection.varietyPenalty, normalizedContribution: round(-selection.varietyPenalty), weightedContribution: round(-selection.varietyPenalty), weight: 1, explanation: `Artist or album repetition reduced this candidate by ${round(selection.varietyPenalty, 1)} points.`, source: "global", eligibilityEffect: "ranking", sourceConfidence: 1 });
  if (selection?.discoveryAdjustment) factors.push({ code: "DISCOVERY_SLOT_ADJUSTMENT", label: "Discovery target", category: "discovery", impact: selection.discoveryAdjustment > 0 ? "positive" : "negative", rawValue: selection.discoveryAdjustment, normalizedContribution: round(selection.discoveryAdjustment), weightedContribution: round(selection.discoveryAdjustment), weight: 1, explanation: factorExplanation("Discovery target", selection.discoveryAdjustment), source: "global", eligibilityEffect: "ranking", sourceConfidence: 1 });
  const adaptiveScale = track.adaptiveScore?.appliedAdjustment
    ? track.adaptiveScore.cappedAdjustment / track.adaptiveScore.appliedAdjustment
    : 1;
  for (const component of track.adaptiveScore?.components || []) {
    const definition = factorDefinitions[component.key];
    const existing = definition ? factors.find((factor) => factor.code === definition.code) : null;
    if (!existing) continue;
    const applied = round(component.appliedAdjustment * adaptiveScale);
    existing.rawValue = component.rawAdjustment;
    existing.normalizedContribution = round(component.appliedAdjustment);
    existing.weightedContribution = applied;
    existing.impact = applied > 0 ? "positive" : applied < 0 ? "negative" : "neutral";
    existing.explanation = component.reasons?.map((reason: any) => reason.message).filter(Boolean).join(" ") || factorExplanation(component.label, applied);
    if (track.adaptiveScore.adjustmentWasCapped) existing.detail = `The component was proportionally limited by the generation's maximum personalization influence.`;
    existing.sourceConfidence = component.confidenceValue;
  }
  return factors.sort((a, b) => Math.abs(b.weightedContribution) - Math.abs(a.weightedContribution));
}

function fallbackCode(value: string) {
  const text = value.toLowerCase();
  if (/energy (unavailable|missing)/.test(text)) return "ENERGY_UNAVAILABLE";
  if (/mood (unavailable|missing)/.test(text)) return "MOOD_UNAVAILABLE";
  if (/popularity (unavailable|missing)/.test(text)) return "POPULARITY_UNAVAILABLE";
  if (text.includes("bpm")) return "BPM_UNAVAILABLE";
  if (text.includes("mood")) return "MOOD_UNAVAILABLE";
  if (text.includes("energy")) return "ENERGY_UNAVAILABLE";
  if (text.includes("popularity")) return "POPULARITY_UNAVAILABLE";
  if (text.includes("recently used")) return "RECENT_USE_SOFTENED";
  if (text.includes("context")) return "CONTEXT_METADATA_INCOMPLETE";
  return `ENGINE_${text.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase().slice(0, 56) || "FALLBACK"}`;
}

export function fallbacksFromScoredTrack(track: TraceableSmartMixTrack): SmartMixFallbackExplanation[] {
  const applied = (track.fallbacksApplied || []) as string[];
  return Array.from(new Set(applied)).map((trigger) => ({ code: fallbackCode(trigger), trigger, expectedBehavior: "Use the configured scoring signal directly.", behaviorUsed: trigger, confidenceImpact: -5, relaxedRule: /soft|relax/i.test(trigger), actionRecommended: /missing|unavailable|failed/i.test(trigger) }));
}

export function missingMetadataFromScoredTrack(track: TraceableSmartMixTrack): SmartMixMissingMetadataExplanation[] {
  const penalty = finite(track.scoreBreakdown?.fallbackPenalty);
  return ((track.metadataStatus?.missingFields || []) as string[]).map((field) => ({ field, status: "missing", required: false, fallbackUsed: true, scoreImpact: round(penalty / Math.max(1, track.metadataStatus.missingFields.length)), confidenceImpact: -10, suggestedFix: { label: field === "bpm" || field === "energy" || field === "mood" ? "Run Audio Features analysis" : "Review track metadata", href: "/settings/library-health" } }));
}

export function calculateRecommendationConfidence(track: TraceableSmartMixTrack, factors = factorsFromScoredTrack(track), fallbacks = fallbacksFromScoredTrack(track)): SmartMixConfidenceExplanation {
  const deductions: SmartMixConfidenceExplanation["deductions"] = [];
  const missing = track.metadataStatus?.missingFields || [];
  if (missing.length) deductions.push({ code: "MISSING_METADATA", points: Math.min(40, missing.length * 10), explanation: `Missing ${missing.join(", ")} metadata.` });
  if (fallbacks.length) deductions.push({ code: "FALLBACKS_USED", points: Math.min(20, fallbacks.length * 5), explanation: `${fallbacks.length} fallback${fallbacks.length === 1 ? " was" : "s were"} used.` });
  if (track.smartMixSelectionTrace?.scoreMargin != null && track.smartMixSelectionTrace.scoreMargin! < 2) deductions.push({ code: "CLOSE_DECISION", points: 10, explanation: "The leading candidates were within 2 points." });
  const positive = factors.filter((factor) => factor.weightedContribution > 0).reduce((sum, factor) => sum + factor.weightedContribution, 0);
  const negative = Math.abs(factors.filter((factor) => factor.weightedContribution < 0).reduce((sum, factor) => sum + factor.weightedContribution, 0));
  if (positive > 5 && negative > 5) deductions.push({ code: "CONFLICTING_SIGNALS", points: 5, explanation: "Meaningful positive and negative signals conflicted." });
  const identityConfidence = track.adaptiveScore?.components?.find((component: any) => component.key === "playlistIdentity")?.confidenceValue;
  if (track.playlistIdentityScore?.applied && identityConfidence != null && identityConfidence < 0.4) deductions.push({ code: "LIMITED_IDENTITY_HISTORY", points: 8, explanation: "Playlist identity evidence is limited." });
  const personalizationConfidence = track.adaptiveScore?.confidenceValue;
  if (track.adaptiveScore?.enabled && personalizationConfidence != null && personalizationConfidence < 0.4) deductions.push({ code: "LIMITED_PERSONALIZATION_HISTORY", points: 8, explanation: "Personalization history is limited." });
  const score = Math.max(0, Math.min(100, 100 - deductions.reduce((sum, item) => sum + item.points, 0)));
  const label = score >= 90 ? "Very High" : score >= 75 ? "High" : score >= 55 ? "Medium" : score >= 35 ? "Low" : "Very Low";
  const reasons = [missing.length ? `Metadata is incomplete (${missing.join(", ")}).` : "Core BPM, mood, energy, and popularity metadata is complete.", fallbacks.length ? `${fallbacks.length} fallback path${fallbacks.length === 1 ? " was" : "s were"} required.` : "No scoring fallbacks were required.", track.smartMixSelectionTrace?.scoreMargin != null ? `The score margin over the comparison candidate was ${round(track.smartMixSelectionTrace.scoreMargin, 1)} points.` : "No direct runner-up margin was available." ];
  return { score, label, reasons, deductions };
}

function rejectionStage(code?: string | null) {
  if (!code) return "final_ranking";
  if (code.includes("PLAYBACK") || code.includes("NEVER") || code.includes("COORDINATION_HARD")) return "rule_filtering";
  return "candidate_scoring";
}

export function buildDecisionExplanation({ track, generationId, playlistId, decision, rank, rejectionCode, winner }: { track: TraceableSmartMixTrack; generationId: string; playlistId?: string | null; decision: SmartMixDecision; rank?: number; rejectionCode?: string | null; winner?: TraceableSmartMixTrack | null }): SmartMixDecisionExplanation {
  const factors = factorsFromScoredTrack(track);
  const fallbacks = fallbacksFromScoredTrack(track);
  const missingMetadata = missingMetadataFromScoredTrack(track);
  const confidence = calculateRecommendationConfidence(track, factors, fallbacks);
  const selection = track.smartMixSelectionTrace;
  const adaptiveIdentity = track.adaptiveScore?.components?.find((component: any) => component.key === "playlistIdentity")?.appliedAdjustment || 0;
  const adaptiveScale = track.adaptiveScore?.appliedAdjustment ? track.adaptiveScore.cappedAdjustment / track.adaptiveScore.appliedAdjustment : 1;
  const identityAdjustment = track.adaptiveScore
    ? finite(adaptiveIdentity * adaptiveScale)
    : finite(track.playlistIdentityScore?.adjustment ?? track.scoreBreakdown?.playlistIdentity);
  const playbackAdjustment = finite(track.playbackScore?.appliedAdjustment);
  const personalizationAdjustment = track.adaptiveScore
    ? finite(track.adaptiveScore.cappedAdjustment - identityAdjustment + playbackAdjustment)
    : finite(track.personalizationScore?.personalizationAdjustment ?? track.scoreBreakdown?.personalization) + playbackAdjustment;
  const transitionAdjustment = finite(selection?.transitionAdjustment) + finite(selection?.transitionFeedbackAdjustment ?? track.scoreBreakdown?.transitionFeedback);
  const finalScore = finite(selection?.selectionScore ?? track.score);
  const baseScore = finite(track.adaptiveScore?.baseScore ?? track.baseScore ?? (finalScore - personalizationAdjustment));
  const penaltyAdjustment = round(finalScore - baseScore - personalizationAdjustment - identityAdjustment - transitionAdjustment);
  const scoreBeforePenalties = finalScore - penaltyAdjustment;
  const identityInfluence = identityAdjustment >= 6 ? "strongly_supportive" : identityAdjustment > 0 ? "moderately_supportive" : identityAdjustment <= -6 ? "strongly_conflicting" : identityAdjustment < 0 ? "moderately_conflicting" : "neutral";
  const hard = Boolean(rejectionCode && rejectionStage(rejectionCode) === "rule_filtering");
  const comparisons = winner ? [{ candidateId: String(winner.id), candidateTitle: winner.title || null, scoreDifference: round(finite(winner.smartMixSelectionTrace?.selectionScore ?? winner.score) - finalScore), winningFactorCodes: factorsFromScoredTrack(winner).slice(0, 3).map((factor) => factor.code) }] : selection?.comparisonCandidateId ? [{ candidateId: selection.comparisonCandidateId, candidateTitle: selection.comparisonCandidateTitle, scoreDifference: round(selection.scoreMargin || 0), winningFactorCodes: factors.slice(0, 3).map((factor) => factor.code) }] : [];
  const topPositive = factors.find((factor) => factor.impact === "positive" && factor.code !== "BASE_COMPATIBILITY")?.label.toLowerCase();
  const topNegative = factors.find((factor) => factor.impact === "negative")?.label.toLowerCase();
  const summary = decision === "selected"
    ? `Selected${rank ? ` at rank ${rank}` : ""}${topPositive ? ` because ${topPositive} was a leading strength` : " based on its final ranking"}${topNegative ? `, despite ${topNegative}` : ""}.`
    : hard
      ? `Rejected during ${rejectionStage(rejectionCode).replaceAll("_", " ")} because ${String(rejectionCode).replaceAll("_", " ").toLowerCase()}.`
      : `Remained eligible, but ${winner?.title || "another candidate"} ranked ${comparisons[0] ? `${Math.abs(comparisons[0].scoreDifference).toFixed(1)} points higher` : "higher"}.`;
  const transition = track.bpmTransitionFromPrevious ? { previousTrackId: selection?.previousTrackId || null, previousTrackTitle: selection?.previousTrackTitle || null, fromBpm: track.bpmTransitionFromPrevious.fromBpm ?? null, toBpm: track.bpmTransitionFromPrevious.toBpm ?? null, rawBpmDifference: track.bpmTransitionFromPrevious.rawGap ?? null, effectiveBpmDifference: track.bpmTransitionFromPrevious.effectiveGap ?? null, relationship: track.bpmTransitionFromPrevious.relationship || "unknown", direction: track.bpmTransitionFromPrevious.direction || "unknown", difficulty: track.bpmTransitionFromPrevious.difficulty || "Unknown", transitionScore: track.bpmTransitionFromPrevious.score ?? null, directionConflict: Boolean(track.bpmTransitionFromPrevious.directionConflict), warning: track.bpmTransitionFromPrevious.exceedsPreferredGap ? track.bpmTransitionFromPrevious.reason || "This transition exceeds the preferred BPM gap." : null } : null;
  const suggestedFixes = missingMetadata.flatMap((item) => item.suggestedFix ? [{ code: `FIX_${item.field.toUpperCase()}`, ...item.suggestedFix }] : []);
  if (rejectionCode?.includes("NEVER")) suggestedFixes.push({ code: "REVIEW_NEVER_RECOMMEND", label: "Review Never recommend feedback", href: "/settings/personalization" });
  if (confidence.score < 55 && track.playlistIdentityScore?.applied) suggestedFixes.push({ code: "RETRAIN_IDENTITY", label: "Retrain playlist identity", href: playlistId ? `/generated-playlists?playlistId=${playlistId}` : "/generated-playlists" });
  return {
    schemaVersion: SMART_MIX_EXPLANATION_SCHEMA_VERSION, trackId: String(track.id), trackTitle: track.title || "Unknown track", artistName: track.artist?.title || null, ...(playlistId !== undefined ? { playlistId } : {}), generationId, engineVersion: track.engineVersion || "v2", decision, ...(rank !== undefined ? { rank } : {}),
    ...(decision === "rejected" ? { rejectionStage: rejectionStage(rejectionCode), rejectionCode: rejectionCode || "RANKED_BELOW_CUTOFF" } : {}),
    hardFilterResults: [{ code: rejectionCode || "ELIGIBLE", passed: !hard, explanation: hard ? summary : "No retained hard filter rejected this candidate." }],
    softFilterResults: [{ code: "FINAL_RANKING", passed: decision === "selected", explanation: decision === "selected" ? "This candidate ranked inside the selected set." : summary }],
    scores: { baseScore: round(baseScore), scoreBeforePenalties: round(scoreBeforePenalties), personalizationAdjustment: round(personalizationAdjustment), playlistIdentityAdjustment: round(identityAdjustment), transitionAdjustment: round(transitionAdjustment), neglectBonus: round(finite(track.scoreBreakdown?.coverageBoost)), overusePenalty: round(finite(track.scoreBreakdown?.overusePenalty)), penaltyAdjustment: round(penaltyAdjustment), scoreAfterPenalties: round(finalScore), personalizedScore: round(track.adaptiveScore?.personalizedScore ?? track.personalizedScore ?? finalScore), finalScore: round(finalScore) },
    factors, fallbacks, missingMetadata, comparisons, confidence, transition, suggestedFixes,
    personalization: { enabled: Boolean(track.adaptiveScore?.enabled || track.personalizationScore?.applied), maximumInfluence: track.adaptiveScore?.maximumInfluence ?? track.personalizationScore?.boundedBy ?? null, appliedConfidenceLimit: track.adaptiveScore?.confidence || null, adjustmentWasCapped: Boolean(track.adaptiveScore?.adjustmentWasCapped), changedSelection: null, statusMessage: track.adaptiveScore?.statusMessage || (track.personalizationScore?.applied ? "Personalization influenced this score." : "Personalization was disabled or had insufficient evidence for this generation.") },
    playlistIdentity: { applied: Boolean(track.playlistIdentityScore?.applied), influence: identityInfluence, reasons: track.playlistIdentityScore?.reasons || [] },
    summary, createdAt: new Date().toISOString(),
  };
}

export function buildGenerationInsights(generationId: string, explanations: SmartMixDecisionExplanation[], counts?: { evaluated?: number; eligible?: number; hardRejected?: number }): SmartMixGenerationInsights {
  const selected = explanations.filter((item) => item.decision === "selected");
  const rejected = explanations.filter((item) => item.decision === "rejected");
  const factorTotals = new Map<string, { label: string; totalContribution: number; occurrences: number }>();
  const metadata = new Map<string, number>();
  for (const item of explanations) {
    for (const factor of item.factors) { const value = factorTotals.get(factor.code) || { label: factor.label, totalContribution: 0, occurrences: 0 }; value.totalContribution += Math.abs(factor.weightedContribution); value.occurrences += 1; factorTotals.set(factor.code, value); }
    for (const missing of item.missingMetadata) metadata.set(missing.field, (metadata.get(missing.field) || 0) + 1);
  }
  const rejectionCounts = rejected.reduce<Record<string, number>>((result, item) => { const code = item.rejectionCode || "RANKED_BELOW_CUTOFF"; result[code] = (result[code] || 0) + 1; return result; }, {});
  return {
    generationId, candidatesEvaluated: counts?.evaluated ?? explanations.length, eligibleCandidates: counts?.eligible ?? explanations.length - (counts?.hardRejected || 0), selectedCount: selected.length, hardRejectedCount: counts?.hardRejected ?? rejected.filter((item) => item.rejectionStage !== "final_ranking").length, rankingRejectedCount: rejected.filter((item) => item.rejectionStage === "final_ranking").length,
    averageConfidence: selected.length ? round(selected.reduce((sum, item) => sum + item.confidence.score, 0) / selected.length, 1) : 0,
    fallbackTrackCount: selected.filter((item) => item.fallbacks.length).length, missingMetadataTrackCount: selected.filter((item) => item.missingMetadata.length).length, relaxedConstraintCount: selected.reduce((sum, item) => sum + item.fallbacks.filter((fallback) => fallback.relaxedRule).length, 0), lowConfidenceSelectedCount: selected.filter((item) => item.confidence.score < 55).length,
    personalizationInfluence: round(selected.reduce((sum, item) => sum + Math.abs(item.scores.personalizationAdjustment), 0), 1), playlistIdentityInfluence: round(selected.reduce((sum, item) => sum + Math.abs(item.scores.playlistIdentityAdjustment), 0), 1),
    mostInfluentialFactors: Array.from(factorTotals, ([code, value]) => ({ code, ...value, totalContribution: round(value.totalContribution, 1) })).sort((a, b) => b.totalContribution - a.totalContribution).slice(0, 10), rejectionReasons: Object.entries(rejectionCounts).map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    weakestTransitions: selected.filter((item) => item.transition).sort((a, b) => finite(a.transition?.transitionScore) - finite(b.transition?.transitionScore)).slice(0, 5).map((item) => ({ trackId: item.trackId, trackTitle: item.trackTitle, score: item.transition?.transitionScore ?? null })), lowestConfidenceTracks: [...selected].sort((a, b) => a.confidence.score - b.confidence.score).slice(0, 5).map((item) => ({ trackId: item.trackId, trackTitle: item.trackTitle, confidence: item.confidence.score })),
    closestDecisions: selected.flatMap((item) => item.comparisons.map((comparison) => ({ selectedTrackId: item.trackId, candidateTrackId: comparison.candidateId, margin: Math.abs(comparison.scoreDifference) }))).sort((a, b) => a.margin - b.margin).slice(0, 5), metadataProblems: Array.from(metadata, ([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count),
  };
}

export function compareDecisionExplanations(left: SmartMixDecisionExplanation, right: SmartMixDecisionExplanation) {
  const factorCodes = Array.from(new Set([...left.factors.map((factor) => factor.code), ...right.factors.map((factor) => factor.code)]));
  const rows = factorCodes.map((code) => { const a = left.factors.filter((factor) => factor.code === code).reduce((sum, factor) => sum + factor.weightedContribution, 0); const b = right.factors.filter((factor) => factor.code === code).reduce((sum, factor) => sum + factor.weightedContribution, 0); return { code, label: left.factors.find((factor) => factor.code === code)?.label || right.factors.find((factor) => factor.code === code)?.label || code, candidateA: round(a), candidateB: round(b), difference: round(a - b) }; }).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  const margin = round(left.scores.finalScore - right.scores.finalScore);
  return { candidateA: { trackId: left.trackId, title: left.trackTitle, finalScore: left.scores.finalScore }, candidateB: { trackId: right.trackId, title: right.trackTitle, finalScore: right.scores.finalScore }, margin, closeDecision: Math.abs(margin) < 2, factors: rows, summary: `${margin >= 0 ? left.trackTitle : right.trackTitle} ranked higher by ${Math.abs(margin).toFixed(1)} points, led by ${rows[0]?.label.toLowerCase() || "the final scoring balance"}.` };
}
