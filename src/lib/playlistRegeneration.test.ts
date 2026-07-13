import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzePlaylistWeakness,
  durationWithinTolerance,
  playlistRegenerationRequestSchema,
  regeneratePlaylist,
  scoreReplacementCandidate,
  sectionPositionRange,
  type PlaylistTrackState,
} from "./smartMixEngine/v2/regeneration";
import { normalizeBpmFlowConfig, scoreBpmTransition } from "./smartMixEngine/v2/bpmFlow";

function track(id: string, options: { bpm?: number; energy?: number; mood?: number; popularity?: number; score?: number; duration?: number; artist?: string; album?: string } = {}) {
  return {
    id,
    title: `Track ${id}`,
    score: options.score ?? 70,
    effectiveBpm: options.bpm,
    duration: options.duration ?? 180_000,
    artist: { id: options.artist || `artist-${id}`, title: options.artist || `Artist ${id}` },
    album: { id: options.album || `album-${id}`, title: options.album || `Album ${id}` },
    popularity: options.popularity == null ? null : { score: options.popularity, confidence: 0.9 },
    audioFeature: options.energy == null && options.mood == null ? null : {
      effectiveEnergy: options.energy,
      effectiveMood: options.mood,
      audioFeatureConfidence: 0.9,
    },
    bpmConfidence: options.bpm == null ? null : 0.9,
  };
}

function states(tracks: Array<{ id: string }>, overrides: Partial<PlaylistTrackState> = {}) {
  return tracks.map((item, index) => ({ trackId: item.id, position: index + 1, locked: false, liked: false, ...overrides }));
}

function request(input: Record<string, unknown> = {}) {
  return playlistRegenerationRequestSchema.parse({ mode: "manual_selection", ...input });
}

describe("advanced playlist regeneration", () => {
  it("does not mark a healthy track weak solely because metadata is missing", () => {
    const tracks = [track("one", { score: 100 }), track("two", { score: 100 })];
    const result = analyzePlaylistWeakness({ tracks, states: states(tracks), request: request() });
    assert.ok(result.every((item) => item.overallWeakness < 45));
    assert.ok(result.every((item) => item.confidenceReasons.length > 0));
  });

  it("excludes locked and liked tracks from replacement", () => {
    const tracks = [track("one", { bpm: 90, energy: 0.2, mood: 0.2, score: 10 }), track("two", { bpm: 140, energy: 0.9, mood: 0.9 })];
    const candidates = [track("candidate", { bpm: 110, energy: 0.5, mood: 0.5, score: 100 })];
    const locked = regeneratePlaylist({ playlistId: "playlist", tracks, states: states(tracks, { locked: true }), candidates, request: request({ targetTrackIds: ["one"] }) });
    const likedStates = states(tracks); likedStates[0].liked = true;
    const liked = regeneratePlaylist({ playlistId: "playlist", tracks, states: likedStates, candidates, request: request({ targetTrackIds: ["one"] }) });
    assert.equal(locked.changes.length, 0);
    assert.equal(liked.changes.length, 0);
    assert.ok(locked.warnings.some((warning) => warning.includes("locked")));
  });

  it("scores exact-position mood, BPM, and energy curve matches above poor fits", () => {
    const original = track("original", { bpm: 120, energy: 0.6, mood: 0.55, popularity: 50, score: 45 });
    const previous = track("previous", { bpm: 116, energy: 0.55, mood: 0.5, popularity: 55 });
    const next = track("next", { bpm: 124, energy: 0.65, mood: 0.6, popularity: 45 });
    const playlist = [previous, original, next];
    const matching = scoreReplacementCandidate({ candidate: track("matching", { bpm: 121, energy: 0.61, mood: 0.56, popularity: 48, score: 90 }), original, previous, next, playlist, position: 1, request: request() });
    const poor = scoreReplacementCandidate({ candidate: track("poor", { bpm: 175, energy: 0.05, mood: 0.05, popularity: 99, score: 90 }), original, previous, next, playlist, position: 1, request: request() });
    assert.ok(matching.totalScore > poor.totalScore);
    assert.ok(matching.previousTransitionScore > poor.previousTransitionScore);
    assert.ok(matching.nextTransitionScore > poor.nextTransitionScore);
  });

  it("raises energy targets and lowers discovery popularity targets without flattening the curve", () => {
    const original = track("original", { bpm: 120, energy: 0.45, mood: 0.5, popularity: 80, score: 50 });
    const playlist = [track("previous", { bpm: 118, energy: 0.4, mood: 0.48, popularity: 70 }), original, track("next", { bpm: 122, energy: 0.5, mood: 0.52, popularity: 65 })];
    const energetic = scoreReplacementCandidate({ candidate: track("energetic", { bpm: 120, energy: 0.62, mood: 0.5, popularity: 70, score: 90 }), original, previous: playlist[0], next: playlist[2], playlist, position: 1, request: request({ mode: "increase_energy", energyAdjustment: 0.16 }) });
    const flat = scoreReplacementCandidate({ candidate: track("flat", { bpm: 120, energy: 0.95, mood: 0.5, popularity: 70, score: 90 }), original, previous: playlist[0], next: playlist[2], playlist, position: 1, request: request({ mode: "increase_energy", energyAdjustment: 0.16 }) });
    const discovery = scoreReplacementCandidate({ candidate: track("discovery", { bpm: 120, energy: 0.45, mood: 0.5, popularity: 65, score: 90 }), original, previous: playlist[0], next: playlist[2], playlist, position: 1, request: request({ mode: "increase_discovery", discoveryAdjustment: 0.3 }) });
    assert.ok(energetic.energyCurveScore > flat.energyCurveScore);
    assert.ok(discovery.discoveryScore >= 90);
  });

  it("keeps the original when no candidate clears the improvement threshold", () => {
    const tracks = [track("one", { bpm: 120, energy: 0.5, mood: 0.5, score: 70 })];
    const preview = regeneratePlaylist({ playlistId: "playlist", tracks, states: states(tracks), candidates: [track("candidate", { bpm: 121, energy: 0.5, mood: 0.5, score: 75 })], request: request({ targetTrackIds: ["one"], minimumReplacementImprovement: 50 }) });
    assert.equal(preview.changes.length, 0);
    assert.deepEqual(preview.finalTrackIds, ["one"]);
    assert.ok(preview.warnings.some((warning) => warning.includes("enough")));
  });

  it("maps section boundaries and preserves duration tolerance", () => {
    assert.deepEqual(sectionPositionRange({ type: "intro" }, 10), { start: 0, end: 0 });
    assert.deepEqual(sectionPositionRange({ type: "middle" }, 10), { start: 3, end: 6 });
    assert.deepEqual(sectionPositionRange({ type: "ending" }, 3), { start: 2, end: 2 });
    assert.equal(durationWithinTolerance(6_000_000, 6_240_000, 0.05), true);
    assert.equal(durationWithinTolerance(6_000_000, 6_600_000, 0.05), false);
  });

  it("recognizes half-time and double-time BPM matches", () => {
    const config = normalizeBpmFlowConfig({ enabled: true, mode: "NATURAL", halfDoubleTimeMatching: true });
    const result = scoreBpmTransition({ fromTrack: track("half", { bpm: 75 }), toTrack: track("double", { bpm: 150 }), config });
    assert.equal(result.relationship === "half-time" || result.relationship === "double-time", true);
    assert.equal(result.effectiveGap, 0);
  });
});
