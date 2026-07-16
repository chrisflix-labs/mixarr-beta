import { getTrackBpm, getTrackEnergy, getTrackPopularity } from "../smartMixEngine/v2/metadataFallbacks";
import { scorePlaylistIdentityTrack } from "../playlistIdentity/scoring";
import {
  ADAPTIVE_SCORING_VERSION,
  type AdaptiveComponentKey,
  type AdaptiveConfidenceLabel,
  type AdaptiveScoreComponent,
  type AdaptiveScoreReason,
  type AdaptiveScoreResult,
  type AdaptiveScoringContext,
  type AdaptiveStatistic,
} from "./types";

const COMPONENT_LABELS: Record<AdaptiveComponentKey, string> = {
  personalPreference: "Personal preference",
  playlistIdentity: "Playlist identity",
  historicalAcceptance: "Historical acceptance",
  historicalRejection: "Historical rejection",
  artistPreference: "Artist preference",
  moodPreference: "Mood preference",
  discoveryTolerance: "Discovery tolerance",
  repeatTolerance: "Repeat tolerance",
};

const minimumConfidenceValues = { very_low: 0, low: 0.2, medium: 0.45, high: 0.7 } as const;
const round = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function adaptiveConfidenceLabel(value: number): AdaptiveConfidenceLabel {
  if (value < 0.2) return "Very low";
  if (value < 0.45) return "Low";
  if (value < 0.7) return "Medium";
  if (value < 0.9) return "High";
  return "Very high";
}

function confidenceMultiplier(value: number) {
  if (value < 0.2) return 0.1;
  if (value < 0.45) return 0.3;
  if (value < 0.7) return 0.6;
  if (value < 0.9) return 0.85;
  return 1;
}

function metadataConfidence(track: Record<string, any>) {
  const values = [
    finite(track.bpmConfidence),
    finite(track.audioFeature?.audioFeatureConfidence),
    finite(track.audioFeature?.confidence),
    finite(track.popularity?.confidence),
  ].filter((value): value is number => value !== null).map((value) => value > 1 ? value / 100 : value);
  return values.length ? clamp(Math.min(...values), 0, 1) : 0.15;
}

function trackMoods(track: Record<string, any>) {
  return Array.from(new Set(
    [...(track.tags || []), ...(track.artist?.tags || [])]
      .filter((tag: any) => String(tag.type || "").toLowerCase() === "mood")
      .map((tag: any) => String(tag.name || "").trim().toLowerCase())
      .filter(Boolean),
  ));
}

function statistic(context: AdaptiveScoringContext, dimension: string, featureKey: string) {
  return context.statistics[`${context.playlistId || "global"}:${dimension}:${featureKey}`]
    || context.statistics[`global:${dimension}:${featureKey}`];
}

function statisticAdjustment(row: AdaptiveStatistic | undefined, scale: number) {
  if (!row) return 0;
  const total = row.positiveWeight + row.negativeWeight;
  return total > 0 ? clamp((row.positiveWeight - row.negativeWeight) / total * scale, -scale, scale) : 0;
}

function reason(message: string, adjustment: number, source: string, scope: AdaptiveScoreReason["scope"], confidence: number, explicit = false): AdaptiveScoreReason {
  return {
    message,
    adjustment: round(adjustment),
    source,
    scope,
    confidence: adaptiveConfidenceLabel(confidence),
    confidenceValue: round(confidence),
    explicit,
  };
}

function component(
  key: AdaptiveComponentKey,
  rawAdjustment: number,
  confidence: number,
  reasons: AdaptiveScoreReason[],
  context: AdaptiveScoringContext,
  explicit = false,
): AdaptiveScoreComponent {
  const accepted = explicit || confidence >= minimumConfidenceValues[context.settings.minimumConfidence];
  const scale = explicit ? 1 : confidenceMultiplier(confidence);
  const weighted = accepted ? rawAdjustment * scale * clamp(context.settings.componentWeights[key], 0, 2) : 0;
  const ratio = rawAdjustment === 0 ? 0 : weighted / rawAdjustment;
  return {
    key,
    label: COMPONENT_LABELS[key],
    rawAdjustment: round(rawAdjustment),
    appliedAdjustment: round(weighted),
    confidence: adaptiveConfidenceLabel(confidence),
    confidenceValue: round(confidence),
    reasons: reasons.map((item) => ({ ...item, adjustment: round(item.adjustment * ratio) })),
  };
}

function inRange(value: number | null, min: number | null, max: number | null) {
  return value !== null && (min !== null || max !== null) && (min === null || value >= min) && (max === null || value <= max);
}

export function scoreAdaptiveSmartMixTrack(baseScore: number, track: Record<string, any>, context?: AdaptiveScoringContext): AdaptiveScoreResult {
  const settings = context?.settings;
  const empty = (statusMessage: string): AdaptiveScoreResult => ({
    baseScore: round(baseScore),
    rawPersonalizedScore: round(baseScore),
    personalizedScore: round(baseScore),
    rawAdjustment: 0,
    appliedAdjustment: 0,
    cappedAdjustment: 0,
    adjustmentWasCapped: false,
    maximumInfluence: settings?.maximumInfluence || 0,
    maximumAdjustment: 0,
    confidence: "Very low",
    confidenceValue: 0,
    components: [],
    positiveReasons: [],
    negativeReasons: [],
    enabled: Boolean(settings?.enabled),
    explanationsDefaultOpen: Boolean(settings?.showExplanationsByDefault),
    statusMessage,
    excluded: false,
    exclusionReason: null,
    baseEngineVersion: "v2",
    adaptiveScoringVersion: ADAPTIVE_SCORING_VERSION,
  });
  if (!context || !settings?.enabled || settings.maximumInfluence <= 0) return empty("Personalization disabled");

  const personalization = context.personalization;
  const profile = personalization?.profile;
  const explicit = personalization?.explicitFeedback;
  const trackId = String(track.id || "");
  const artistId = String(track.artistId || track.artist?.id || "");
  const trackPreference = explicit?.trackPreferences[trackId];
  if (trackPreference?.state === "NEVER_RECOMMEND" || explicit?.hardExcludedTrackIds.includes(trackId)) {
    return { ...empty("Hard exclusion"), enabled: true, excluded: true, exclusionReason: "Never recommend", confidence: "Very high", confidenceValue: 1 };
  }

  const identityResult = scorePlaylistIdentityTrack(track, context.playlistIdentity);
  if (identityResult.excluded) {
    return { ...empty("Hard playlist exclusion"), enabled: true, excluded: true, exclusionReason: identityResult.exclusionReason, confidence: "Very high", confidenceValue: 1 };
  }

  const components: AdaptiveScoreComponent[] = [];
  const energy = getTrackEnergy(track);
  const bpm = getTrackBpm(track);
  const popularity = getTrackPopularity(track);
  const profileConfidence = clamp(profile?.confidence || 0, 0, 1);
  const personalReasons: AdaptiveScoreReason[] = [];
  let personalRaw = 0;
  if (profile && settings.includeInferredBehavior) {
    if (inRange(energy, profile.preferredEnergyMin, profile.preferredEnergyMax)) {
      personalRaw += 2;
      personalReasons.push(reason("Energy matches your preferred range", 2, "Learned recommendation profile", "user", profileConfidence));
    }
    if (inRange(bpm, profile.preferredBpmMin, profile.preferredBpmMax)) {
      personalRaw += 1.4;
      personalReasons.push(reason("BPM is within your usual range", 1.4, "Learned recommendation profile", "user", profileConfidence));
    }
    if (profile.avoidLiveRecordings && track.isLive) {
      personalRaw -= 2.5;
      personalReasons.push(reason("You usually avoid live recordings", -2.5, "Learned recommendation profile", "user", profileConfidence));
    }
    if (profile.avoidLowConfidenceMetadata && metadataConfidence(track) < 0.5) {
      personalRaw -= 1.5;
      personalReasons.push(reason("Metadata confidence is below your usual preference", -1.5, "Metadata confidence preference", "user", Math.min(profileConfidence, metadataConfidence(track))));
    }
  }
  components.push(component("personalPreference", personalRaw, profileConfidence, personalReasons, context));

  const playlistPreference = personalization?.playlistProfile;
  const identityConfidence = clamp(context.playlistIdentity?.confidence ?? 0, 0, 1);
  const identityReasons = identityResult.reasons.map((message) => reason(message, identityResult.adjustment / Math.max(1, identityResult.reasons.length), "Playlist identity", "playlist", identityConfidence));
  let identityRaw = settings.includePlaylistIdentity ? identityResult.adjustment : 0;
  if (playlistPreference?.enabled && playlistPreference.mode === "PLAYLIST_SPECIFIC") {
    const preferenceConfidence = playlistPreference.isLearned ? playlistPreference.confidence : 1;
    if (inRange(energy, playlistPreference.energyMin, playlistPreference.energyMax)) {
      identityRaw += 2;
      identityReasons.push(reason("Energy matches this playlist's preference", 2, "Playlist-specific personalization", "playlist", preferenceConfidence, !playlistPreference.isLearned));
    }
    if (inRange(bpm, playlistPreference.bpmMin, playlistPreference.bpmMax)) {
      identityRaw += 1.5;
      identityReasons.push(reason("BPM fits this playlist's preferred range", 1.5, "Playlist-specific personalization", "playlist", preferenceConfidence, !playlistPreference.isLearned));
    }
  }
  const playlistConfidence = identityConfidence || (playlistPreference?.isLearned ? playlistPreference.confidence : playlistPreference ? 1 : 0);
  components.push(component("playlistIdentity", identityRaw, playlistConfidence, identityReasons, context, Boolean(playlistPreference && !playlistPreference.isLearned)));

  const trackStat = statistic(context, "track", trackId);
  const memory = context.playlistIdentity?.trackMemory[trackId];
  const fit = explicit?.playlistFits[trackId];
  const liked = trackPreference?.state === "LIKED" ? 3 : 0;
  const goodFit = fit?.state === "GOOD_FIT" ? 4 : 0;
  const explicitlyRejected = trackPreference?.state === "DISLIKED" || fit?.state === "POOR_FIT";
  const historicalAcceptance = settings.includeInferredBehavior && settings.includePlaylistHistory && !(settings.preferExplicitFeedback && explicitlyRejected)
    ? Math.max(0, statisticAdjustment(trackStat, 4)) + Math.max(0, memory?.acceptanceScore || 0)
    : 0;
  const acceptanceRaw = liked + goodFit + historicalAcceptance;
  const acceptanceConfidence = liked || goodFit ? 1 : Math.max(trackStat?.confidence || 0, memory ? Math.min(0.95, 0.25 + Math.abs(memory.acceptanceScore) * 0.1) : 0);
  components.push(component("historicalAcceptance", acceptanceRaw, acceptanceConfidence, [
    ...(liked ? [reason("You explicitly liked this track", liked, "Track feedback", "user", 1, true)] : []),
    ...(goodFit ? [reason("You marked this track as a good playlist fit", goodFit, "Playlist feedback", "playlist", 1, true)] : []),
    ...(memory?.acceptanceScore ? [reason("This track was retained in this playlist's history", memory.acceptanceScore, "Playlist history", "playlist", acceptanceConfidence)] : []),
    ...(trackStat && statisticAdjustment(trackStat, 4) > 0 ? [reason("Historical recommendations for this track were accepted", statisticAdjustment(trackStat, 4), "Aggregated interaction history", trackStat.playlistId ? "playlist" : "user", trackStat.confidence)] : []),
  ], context, Boolean(liked || goodFit)));

  const disliked = trackPreference?.state === "DISLIKED" ? -9 : 0;
  const poorFit = fit?.state === "POOR_FIT" ? -5 : 0;
  const memoryRejection = memory?.rejectionState === "STRONG_NEGATIVE" ? -6 : memory?.rejectionState === "WEAK_NEGATIVE" ? -2.5 : 0;
  const statisticRejection = Math.min(0, statisticAdjustment(trackStat, 7));
  const explicitlyAccepted = Boolean(liked || goodFit);
  const inferredRejection = settings.includeInferredBehavior && settings.includePlaylistHistory && !(settings.preferExplicitFeedback && explicitlyAccepted)
    ? memoryRejection + statisticRejection
    : 0;
  const rejectionRaw = disliked + poorFit + inferredRejection;
  const rejectionConfidence = disliked || poorFit ? 1 : Math.max(trackStat?.confidence || 0, memory?.inferenceConfidence || 0);
  components.push(component("historicalRejection", rejectionRaw, rejectionConfidence, [
    ...(disliked ? [reason("You disliked this track", disliked, "Track feedback", "user", 1, true)] : []),
    ...(poorFit ? [reason("You marked this track as a poor playlist fit", poorFit, "Playlist feedback", "playlist", 1, true)] : []),
    ...(memoryRejection ? [reason(`This track was rejected ${memory?.rejectionCount || 1} time${memory?.rejectionCount === 1 ? "" : "s"} in this playlist`, memoryRejection, "Playlist rejection history", "playlist", rejectionConfidence)] : []),
    ...(statisticRejection ? [reason("Historical interactions with this track were mostly negative", statisticRejection, "Aggregated interaction history", trackStat?.playlistId ? "playlist" : "user", trackStat?.confidence || 0)] : []),
  ], context, Boolean(disliked || poorFit)));

  const artistPreference = explicit?.artistPreferences[artistId];
  const artistStat = statistic(context, "artist", artistId);
  const artistExplicit = artistPreference?.state === "PREFER" ? 3.2 : artistPreference?.state === "RECOMMEND_LESS" ? -3.5 : 0;
  const artistHistorical = settings.includeInferredBehavior && settings.includeArtistPreferences && !(settings.preferExplicitFeedback && artistExplicit)
    ? statisticAdjustment(artistStat, 3)
    : 0;
  components.push(component("artistPreference", artistExplicit + artistHistorical, artistExplicit ? 1 : artistStat?.confidence || 0, [
    ...(artistPreference ? [reason(artistPreference.state === "PREFER" ? "You prefer this artist" : "You asked for less from this artist", artistExplicit, "Artist feedback", "user", 1, true)] : []),
    ...(artistHistorical ? [reason(artistHistorical > 0 ? "Tracks from this artist are often accepted" : "Tracks from this artist are often rejected", artistHistorical, "Artist acceptance history", artistStat?.playlistId ? "playlist" : "user", artistStat?.confidence || 0)] : []),
  ], context, Boolean(artistExplicit)));

  const moodRows = trackMoods(track).map((mood) => statistic(context, "mood", mood)).filter(Boolean) as AdaptiveStatistic[];
  const bestMood = moodRows.sort((left, right) => Math.abs(statisticAdjustment(right, 2.8)) - Math.abs(statisticAdjustment(left, 2.8)))[0];
  const moodRaw = settings.includeMoodPreferences ? statisticAdjustment(bestMood, 2.8) : 0;
  const moodConfidence = bestMood ? Math.min(bestMood.confidence, metadataConfidence(track)) : 0;
  components.push(component("moodPreference", moodRaw, moodConfidence, moodRaw ? [
    reason(moodRaw > 0 ? `You frequently accept ${bestMood.featureKey} tracks` : `You frequently reject ${bestMood.featureKey} tracks`, moodRaw, "Mood preference history", bestMood.playlistId ? "playlist" : "user", moodConfidence),
  ] : [], context));

  const discoveryTarget = playlistPreference?.discoveryPreference
    ?? context.playlistIdentity?.profile.discoveryPreference
    ?? profile?.preferredDiscoveryLevel
    ?? 0.5;
  const deepCut = popularity !== null && popularity <= 40;
  let discoveryRaw = 0;
  if (settings.includeDiscoveryTolerance && popularity !== null) {
    if (deepCut && discoveryTarget >= 0.6) discoveryRaw = 2.1;
    else if (deepCut && discoveryTarget <= 0.35) discoveryRaw = -1.8;
    else if (!deepCut && popularity >= 70 && discoveryTarget >= 0.75) discoveryRaw = -0.8;
    else if (!deepCut && popularity >= 70 && discoveryTarget <= 0.35) discoveryRaw = 0.8;
  }
  const discoveryConfidence = playlistPreference && !playlistPreference.isLearned ? 1 : Math.max(profileConfidence, identityConfidence);
  components.push(component("discoveryTolerance", discoveryRaw, discoveryConfidence, discoveryRaw ? [
    reason(
      discoveryRaw > 0 ? (deepCut ? "This playlist accepts more discovery and deep cuts" : "This playlist currently favors familiar tracks") : (deepCut ? "This playlist usually favors familiar tracks" : "This playlist has a stronger discovery preference"),
      discoveryRaw,
      playlistPreference ? "Playlist discovery preference" : context.playlistIdentity ? "Playlist identity" : "Learned discovery tolerance",
      playlistPreference || context.playlistIdentity ? "playlist" : "user",
      discoveryConfidence,
      Boolean(playlistPreference && !playlistPreference.isLearned),
    ),
  ] : [], context, Boolean(playlistPreference && !playlistPreference.isLearned)));

  const recentTracks = new Set(personalization?.recentlyUsedTrackIds || []);
  const recentArtists = new Set(personalization?.recentlyUsedArtistIds || []);
  const lockedOverride = ["LOCKED", "ANCHOR", "IMPORTANT"].includes(memory?.importance || "");
  let repeatRaw = 0;
  const repeatReasons: AdaptiveScoreReason[] = [];
  if (settings.includeInferredBehavior && settings.includeRepeatTolerance) {
    if (recentTracks.has(trackId)) {
      repeatRaw -= 2.4;
      repeatReasons.push(reason("Track appeared in recent recommendation history", -2.4, "Recent playlist history", "user", 0.75));
    }
    if (recentArtists.has(artistId)) {
      repeatRaw -= 1.4;
      repeatReasons.push(reason("Artist appeared in recent recommendation history", -1.4, "Recent playlist history", "user", 0.7));
    }
    if (lockedOverride && repeatRaw < 0) {
      repeatRaw += 0.8;
      repeatReasons.push(reason("Important playlist track partially overrides repeat penalties", 0.8, "Playlist identity", "playlist", 1, true));
    }
  }
  components.push(component("repeatTolerance", repeatRaw, repeatReasons.length ? 0.75 : 0, repeatReasons, context, lockedOverride));

  const enabledComponents = components.filter((item) => item.appliedAdjustment !== 0);
  const rawAdjustment = round(components.reduce((sum, item) => sum + item.rawAdjustment, 0));
  const uncappedAdjustment = round(enabledComponents.reduce((sum, item) => sum + item.appliedAdjustment, 0));
  const maximumAdjustment = round(20 * clamp(settings.maximumInfluence, 0, 1));
  const directionalLimit = uncappedAdjustment >= 0
    ? Math.min(maximumAdjustment, settings.positiveAdjustmentLimit)
    : Math.min(maximumAdjustment, settings.negativeAdjustmentLimit);
  const cappedAdjustment = round(clamp(uncappedAdjustment, -directionalLimit, directionalLimit));
  const allReasons = enabledComponents.flatMap((item) => item.reasons).filter((item) => item.adjustment !== 0);
  const totalWeight = enabledComponents.reduce((sum, item) => sum + Math.abs(item.appliedAdjustment), 0);
  const combinedConfidence = totalWeight
    ? enabledComponents.reduce((sum, item) => sum + item.confidenceValue * Math.abs(item.appliedAdjustment), 0) / totalWeight
    : 0;
  const capped = cappedAdjustment !== uncappedAdjustment;
  return {
    baseScore: round(baseScore),
    rawPersonalizedScore: round(baseScore + uncappedAdjustment),
    personalizedScore: round(baseScore + cappedAdjustment),
    rawAdjustment,
    appliedAdjustment: uncappedAdjustment,
    cappedAdjustment,
    adjustmentWasCapped: capped,
    maximumInfluence: settings.maximumInfluence,
    maximumAdjustment,
    confidence: adaptiveConfidenceLabel(combinedConfidence),
    confidenceValue: round(combinedConfidence),
    components,
    positiveReasons: allReasons.filter((item) => item.adjustment > 0).sort((left, right) => right.adjustment - left.adjustment),
    negativeReasons: allReasons.filter((item) => item.adjustment < 0).sort((left, right) => left.adjustment - right.adjustment),
    enabled: true,
    explanationsDefaultOpen: settings.showExplanationsByDefault,
    statusMessage: capped
      ? `Personalization adjustment was limited from ${uncappedAdjustment >= 0 ? "+" : ""}${uncappedAdjustment} to ${cappedAdjustment >= 0 ? "+" : ""}${cappedAdjustment} by your ${Math.round(settings.maximumInfluence * 100)}% influence setting.`
      : enabledComponents.length ? "Adaptive scoring applied" : "Not enough matching personalization evidence",
    excluded: false,
    exclusionReason: null,
    baseEngineVersion: "v2",
    adaptiveScoringVersion: context.modelVersion || ADAPTIVE_SCORING_VERSION,
  };
}
