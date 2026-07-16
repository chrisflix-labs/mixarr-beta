import type { ArtistFeedbackState, PlaylistFitState, TrackFeedbackState } from "./types";

export const FEEDBACK_SCORING = Object.freeze({
  track: Object.freeze({ LIKED: 3, DISLIKED: -18, NEVER_RECOMMEND: -1000, NEUTRAL: 0 }),
  artist: Object.freeze({ PREFER: 2.5, RECOMMEND_LESS: -3.5, NEUTRAL: 0 }),
  playlistFit: Object.freeze({ GOOD_FIT: 4, POOR_FIT: -5 }),
  transition: Object.freeze({ explicitPair: -14, reversePair: -7, similar: -2.5 }),
  caps: Object.freeze({ explicitPositive: 7, explicitNegative: -24, artist: 3.5, playlistFit: 5 }),
});

export function trackFeedbackAdjustment(state: TrackFeedbackState) {
  return FEEDBACK_SCORING.track[state];
}

export function artistFeedbackAdjustment(state: ArtistFeedbackState) {
  return FEEDBACK_SCORING.artist[state];
}

export function playlistFitAdjustment(state: PlaylistFitState) {
  return FEEDBACK_SCORING.playlistFit[state];
}

export function resolveExplicitFeedback(input: {
  trackState?: TrackFeedbackState | null;
  artistState?: ArtistFeedbackState | null;
  fitState?: PlaylistFitState | null;
}) {
  const track = input.trackState ? trackFeedbackAdjustment(input.trackState) : 0;
  const artistRaw = input.artistState ? artistFeedbackAdjustment(input.artistState) : 0;
  const fit = input.fitState ? playlistFitAdjustment(input.fitState) : 0;
  const excluded = input.trackState === "NEVER_RECOMMEND";
  // Track-level intent wins. A recommend-less artist cannot cancel an explicit like,
  // and no artist preference can rescue a disliked or excluded track.
  const artist = input.trackState === "DISLIKED" || excluded || (input.trackState === "LIKED" && artistRaw < 0) ? 0 : artistRaw;
  return { excluded, track, artist, fit, total: excluded ? track : track + artist + fit };
}

export function transitionPairKey(previousTrackId: string, currentTrackId: string) {
  return `${previousTrackId}:${currentTrackId}`;
}
