import type {
  PersonalizationScoreReason,
  PersonalizationScoreResult,
  PersonalizationScoringContext,
  PlaylistPreferenceSnapshot,
  RecommendationProfileSnapshot,
} from "./types";
import { resolveExplicitFeedback } from "./feedbackRules";

export const DEFAULT_MAX_PERSONALIZATION_ADJUSTMENT = 8;
const MAX_USER_ADJUSTMENT = 5;
const MAX_PLAYLIST_ADJUSTMENT = 3;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function trackEnergy(track: Record<string, any>) {
  return finite(track.audioFeature?.effectiveEnergy)
    ?? finite(track.audioFeature?.energy)
    ?? finite(track.energy);
}

function trackBpm(track: Record<string, any>) {
  return finite(track.effectiveBpm)
    ?? finite(track.bpm)
    ?? finite(track.audioFeature?.tempo);
}

function trackPopularity(track: Record<string, any>) {
  return finite(track.popularity?.score) ?? finite(track.popularityScore);
}

function metadataConfidence(track: Record<string, any>) {
  const values = [
    finite(track.bpmConfidence),
    finite(track.audioFeature?.audioFeatureConfidence),
    finite(track.audioFeature?.confidence),
    finite(track.popularity?.confidence),
  ].filter((value): value is number => value !== null);
  if (!values.length) return null;
  return Math.min(...values.map((value) => value > 1 ? value / 100 : value));
}

function inRange(value: number | null, min: number | null, max: number | null) {
  if (value === null || (min === null && max === null)) return false;
  return (min === null || value >= min) && (max === null || value <= max);
}

function addReason(
  reasons: PersonalizationScoreReason[],
  layer: "playlist" | "user",
  feature: string,
  adjustment: number,
  message: string,
) {
  if (adjustment === 0) return 0;
  reasons.push({ layer, feature, adjustment: round(adjustment), message });
  return adjustment;
}

function scorePreferences({
  track,
  layer,
  confidence,
  energyMin,
  energyMax,
  bpmMin,
  bpmMax,
  deepCutPreference,
  avoidLiveRecordings,
  avoidLowConfidenceMetadata,
  avoidRecentlyPlayed,
  avoidRecentlyUsedArtists,
  recentTracks,
  recentArtists,
  skippedFeatures,
  reasons,
}: {
  track: Record<string, any>;
  layer: "playlist" | "user";
  confidence: number;
  energyMin: number | null;
  energyMax: number | null;
  bpmMin: number | null;
  bpmMax: number | null;
  deepCutPreference: number | null;
  avoidLiveRecordings: boolean;
  avoidLowConfidenceMetadata: boolean;
  avoidRecentlyPlayed: boolean;
  avoidRecentlyUsedArtists: boolean;
  recentTracks: Set<string>;
  recentArtists: Set<string>;
  skippedFeatures?: Set<string>;
  reasons: PersonalizationScoreReason[];
}) {
  let score = 0;
  const scale = clamp(confidence, 0, 1);
  const energy = trackEnergy(track);
  const bpm = trackBpm(track);
  const popularity = trackPopularity(track);
  const trackId = String(track.id || "");
  const artistId = String(track.artistId || track.artist?.id || "");

  if (!skippedFeatures?.has("energy") && inRange(energy, energyMin, energyMax)) {
    score += addReason(reasons, layer, "energy", 1.6 * scale, layer === "playlist" ? "Matches this playlist's energy preference" : "Matches your preferred energy range");
  }
  if (!skippedFeatures?.has("bpm") && inRange(bpm, bpmMin, bpmMax)) {
    score += addReason(reasons, layer, "bpm", 1 * scale, layer === "playlist" ? "Matches this playlist's BPM preference" : "Matches your preferred BPM range");
  }
  if (!skippedFeatures?.has("deep_cut") && deepCutPreference !== null && deepCutPreference >= 0.55 && popularity !== null && popularity <= 40) {
    score += addReason(reasons, layer, "deep_cut", 1.25 * scale, "Supports your deep-cut preference");
  }
  if (!skippedFeatures?.has("live") && avoidLiveRecordings && Boolean(track.isLive)) {
    score += addReason(reasons, layer, "live", -2.5 * scale, "Live recording avoidance");
  }
  if (!skippedFeatures?.has("metadata") && avoidLowConfidenceMetadata) {
    const confidenceValue = metadataConfidence(track);
    if (confidenceValue === null || confidenceValue < 0.5) {
      score += addReason(reasons, layer, "metadata", -2 * scale, "Low-confidence metadata");
    }
  }
  if (!skippedFeatures?.has("recent_track") && avoidRecentlyPlayed && trackId && recentTracks.has(trackId)) {
    score += addReason(reasons, layer, "recent_track", -1.5 * scale, "Track was used recently");
  }
  if (!skippedFeatures?.has("recent_artist") && avoidRecentlyUsedArtists && artistId && recentArtists.has(artistId)) {
    score += addReason(reasons, layer, "recent_artist", -1.25 * scale, "Artist appeared recently");
  }
  return score;
}

function playlistOverrides(profile: PlaylistPreferenceSnapshot) {
  const features = new Set<string>();
  if (profile.energyMin !== null || profile.energyMax !== null) features.add("energy");
  if (profile.bpmMin !== null || profile.bpmMax !== null) features.add("bpm");
  if (profile.deepCutPreference !== null || profile.discoveryPreference !== null) features.add("deep_cut");
  if (profile.avoidLiveRecordings !== null) features.add("live");
  if (profile.avoidLowConfidenceMetadata !== null) features.add("metadata");
  if (profile.avoidRecentlyPlayedTracks !== null) features.add("recent_track");
  return features;
}

export function scorePersonalizationAdjustment(
  globalScore: number,
  track: Record<string, any>,
  context?: PersonalizationScoringContext | null,
): PersonalizationScoreResult {
  const maxAdjustment = clamp(context?.maxAdjustment ?? DEFAULT_MAX_PERSONALIZATION_ADJUSTMENT, 0, 10);
  const empty = (message?: string): PersonalizationScoreResult => ({
    globalScore,
    playlistContextScore: 0,
    personalizationAdjustment: 0,
    finalScore: globalScore,
    personalizationReasons: message ? [{ layer: "user", feature: "status", adjustment: 0, message }] : [],
    boundedBy: maxAdjustment,
    applied: false,
    components: { learnedProfileAdjustment: 0, trackFeedbackAdjustment: 0, artistFeedbackAdjustment: 0, playlistFitAdjustment: 0 },
    excluded: false,
    exclusionReason: null,
  });
  if (!context?.profile.enabled) return empty();
  if (context.playlistProfile?.mode === "GLOBAL_ONLY") return empty("No personal adjustment: this playlist uses global scoring only");

  const recentTracks = new Set(context.recentlyUsedTrackIds || []);
  const recentArtists = new Set(context.recentlyUsedArtistIds || []);
  const reasons: PersonalizationScoreReason[] = [];
  const trackId = String(track.id || "");
  const artistId = String(track.artistId || track.artist?.id || "");
  const explicitContext = context.explicitFeedback;
  const trackPreference = explicitContext?.trackPreferences[trackId];
  const artistPreference = explicitContext?.artistPreferences[artistId];
  const playlistFit = explicitContext?.playlistFits[trackId];
  const explicit = resolveExplicitFeedback({ trackState: trackPreference?.state, artistState: artistPreference?.state, fitState: playlistFit?.state });
  if (explicit.excluded) {
    return {
      globalScore, playlistContextScore: 0, personalizationAdjustment: explicit.track,
      finalScore: round(globalScore + explicit.track), personalizationReasons: [{ layer: "user", feature: "never_recommend", adjustment: explicit.track, message: "Excluded because you selected Never recommend for this track" }],
      boundedBy: maxAdjustment, applied: true, excluded: true, exclusionReason: "NEVER_RECOMMEND",
      components: { learnedProfileAdjustment: 0, trackFeedbackAdjustment: explicit.track, artistFeedbackAdjustment: 0, playlistFitAdjustment: 0 },
    };
  }
  if (explicit.track) addReason(reasons, "user", "track_feedback", explicit.track, trackPreference?.state === "LIKED" ? "You liked this track" : "You disliked this track");
  if (explicit.artist) addReason(reasons, "user", "artist_feedback", explicit.artist, artistPreference?.state === "PREFER" ? "You prefer this artist" : "You asked for less from this artist");
  if (explicit.fit) addReason(reasons, "playlist", "playlist_fit_feedback", explicit.fit, playlistFit?.state === "GOOD_FIT" ? "You marked this track as a good fit for this playlist" : "You marked this track as a poor fit for this playlist");
  let playlistScore = 0;
  const playlist = context.playlistProfile;
  const usePlaylist = Boolean(playlist?.enabled && playlist.mode === "PLAYLIST_SPECIFIC");
  const overrides = usePlaylist && playlist ? playlistOverrides(playlist) : new Set<string>();

  if (usePlaylist && playlist) {
    const playlistConfidence = playlist.isLearned ? clamp(playlist.confidence, 0, 1) : 1;
    playlistScore = scorePreferences({
      track,
      layer: "playlist",
      confidence: playlistConfidence,
      energyMin: playlist.energyMin,
      energyMax: playlist.energyMax,
      bpmMin: playlist.bpmMin,
      bpmMax: playlist.bpmMax,
      deepCutPreference: playlist.deepCutPreference ?? playlist.discoveryPreference,
      avoidLiveRecordings: playlist.avoidLiveRecordings === true,
      avoidLowConfidenceMetadata: playlist.avoidLowConfidenceMetadata === true,
      avoidRecentlyPlayed: playlist.avoidRecentlyPlayedTracks === true,
      avoidRecentlyUsedArtists: false,
      recentTracks,
      recentArtists,
      reasons,
    });
    playlistScore = clamp(playlistScore, -MAX_PLAYLIST_ADJUSTMENT, MAX_PLAYLIST_ADJUSTMENT);
  }

  const profile: RecommendationProfileSnapshot = context.profile;
  const evidenceReady = profile.interactionCount >= profile.minimumEventsRequired && profile.confidence >= 0.15;
  if (!evidenceReady) {
    const directTotal = explicit.track + explicit.artist + explicit.fit;
    return {
      globalScore,
      playlistContextScore: round(playlistScore),
      personalizationAdjustment: round(directTotal),
      finalScore: round(globalScore + playlistScore + directTotal),
      personalizationReasons: [...reasons, { layer: "user", feature: "status", adjustment: 0, message: "No personal adjustment: profile is still learning" }],
      boundedBy: maxAdjustment,
      applied: playlistScore !== 0 || directTotal !== 0,
      components: { learnedProfileAdjustment: 0, trackFeedbackAdjustment: explicit.track, artistFeedbackAdjustment: explicit.artist, playlistFitAdjustment: explicit.fit },
      excluded: false, exclusionReason: null,
    };
  }

  let userScore = scorePreferences({
    track,
    layer: "user",
    confidence: profile.confidence,
    energyMin: profile.preferredEnergyMin,
    energyMax: profile.preferredEnergyMax,
    bpmMin: profile.preferredBpmMin,
    bpmMax: profile.preferredBpmMax,
    deepCutPreference: profile.preferredDeepCutWeight ?? profile.preferredDiscoveryLevel,
    avoidLiveRecordings: profile.avoidLiveRecordings,
    avoidLowConfidenceMetadata: profile.avoidLowConfidenceMetadata,
    avoidRecentlyPlayed: profile.avoidRecentlyPlayed,
    avoidRecentlyUsedArtists: profile.avoidRecentlyUsedArtists,
    recentTracks,
    recentArtists,
    skippedFeatures: overrides,
    reasons,
  });
  userScore = clamp(userScore, -MAX_USER_ADJUSTMENT, MAX_USER_ADJUSTMENT);
  const learnedTotal = playlistScore + userScore;
  const boundedTotal = clamp(learnedTotal, -maxAdjustment, maxAdjustment);
  if (boundedTotal !== playlistScore + userScore) {
    userScore = boundedTotal - playlistScore;
  }
  return {
    globalScore,
    playlistContextScore: round(playlistScore),
    personalizationAdjustment: round(userScore + explicit.track + explicit.artist + explicit.fit),
    finalScore: round(globalScore + playlistScore + userScore + explicit.track + explicit.artist + explicit.fit),
    personalizationReasons: reasons,
    boundedBy: maxAdjustment,
    applied: playlistScore !== 0 || userScore !== 0 || explicit.total !== 0,
    components: { learnedProfileAdjustment: round(userScore), trackFeedbackAdjustment: explicit.track, artistFeedbackAdjustment: explicit.artist, playlistFitAdjustment: explicit.fit },
    excluded: false, exclusionReason: null,
  };
}
