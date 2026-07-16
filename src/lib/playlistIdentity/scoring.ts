import { getTrackBpm, getTrackEnergy, getTrackMood, getTrackPopularity } from "../smartMixEngine/v2/metadataFallbacks";
import type { PlaylistIdentityScoreResult, PlaylistIdentityScoringContext } from "./types";

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const closeness = (value: number | null, range: [number, number] | null, tolerance: number) => {
  if (value == null || !range) return 50;
  if (value >= range[0] && value <= range[1]) return 100;
  return clamp(100 - Math.min(Math.abs(value - range[0]), Math.abs(value - range[1])) / tolerance * 100);
};
const modeScale = { FLEXIBLE: 0.035, BALANCED: 0.065, STRONG: 0.11, STRICT: 0.17 } as const;

export function scorePlaylistIdentityTrack(track: Record<string, any>, context?: PlaylistIdentityScoringContext): PlaylistIdentityScoreResult {
  if (!context?.enabled) return { applied: false, excluded: false, adjustment: 0, matchScore: 50, components: {}, reasons: [] };
  const memory = context.trackMemory[String(track.id)];
  if (memory?.permanentRejection || memory?.rejectionState === "NEVER_USE") {
    return { applied: true, excluded: true, adjustment: -100, matchScore: 0, components: { rejection: -100 }, reasons: ["Previously marked never use in this playlist"], exclusionReason: "Playlist-specific permanent rejection" };
  }
  const profile = context.profile;
  const bpm = getTrackBpm(track);
  const energy = getTrackEnergy(track);
  const mood = getTrackMood(track);
  const popularity = getTrackPopularity(track);
  const moodTargets = Object.entries(profile.moodDistribution).slice(0, 5);
  const trackMoods = new Set([...(track.tags || []), ...(track.artist?.tags || [])].filter((tag: any) => (tag.type || "").toLowerCase() === "mood").map((tag: any) => String(tag.name).toLowerCase()));
  const moodScore = trackMoods.size && moodTargets.length
    ? clamp(moodTargets.reduce((sum, [name, weight]) => sum + (trackMoods.has(name.toLowerCase()) ? weight * 100 : 0), 0) * 1.8)
    : mood == null || profile.averageEnergy == null ? 50 : clamp(100 - Math.abs(mood - (profile.averageEnergy || 0.5)) * 100);
  const energyScore = closeness(energy, profile.energyRange, 0.35);
  const bpmScore = closeness(bpm, profile.bpmRange, 45);
  const popularityScore = closeness(popularity, profile.popularityRange, 45);
  const artistScore = track.artistId ? clamp(50 + (context.artistScores[track.artistId] || 0) * 5) : 50;
  const genres = [...(track.tags || []), ...(track.artist?.tags || [])].filter((tag: any) => ["genre", "style"].includes(String(tag.type).toLowerCase())).map((tag: any) => String(tag.name).toLowerCase());
  const genreScore = genres.length ? clamp(50 + Math.max(...genres.map((genre: string) => context.genreScores[genre] || 0)) * 5) : 50;
  const historyScore = clamp(50 + (memory?.acceptanceScore || 0) * 5 - (memory?.rejectionCount || 0) * 8);
  const importanceScore = memory?.importance === "LOCKED" ? 100 : memory?.importance === "ANCHOR" ? 95 : memory?.importance === "IMPORTANT" ? 85 : memory?.importance === "PREFERRED" ? 70 : 50;
  const components = { mood: moodScore, energy: energyScore, bpm: bpmScore, popularity: popularityScore, artist: artistScore, genre: genreScore, history: historyScore, importance: importanceScore };
  const matchScore = Object.values(components).reduce((sum, value) => sum + value, 0) / Object.keys(components).length;
  let adjustment = (matchScore - 50) * modeScale[context.mode] * Math.max(0.2, context.strength);
  if (memory?.rejectionState === "STRONG_NEGATIVE") adjustment -= context.mode === "STRICT" ? 12 : 7;
  else if (memory?.rejectionState === "WEAK_NEGATIVE") adjustment -= 2.5;
  const reasons = [
    ...(moodScore >= 72 ? ["Strong mood match"] : moodScore < 30 ? ["Weak mood match"] : []),
    ...(bpmScore >= 80 ? ["Fits the playlist BPM range"] : bpmScore < 30 ? ["Outside the preferred BPM character"] : []),
    ...(energyScore >= 80 ? ["Matches the playlist energy character"] : []),
    ...(artistScore >= 65 ? ["Preferred playlist artist"] : []),
    ...(genreScore >= 65 ? ["Preferred playlist genre"] : []),
    ...(historyScore >= 70 ? ["Previously accepted in this playlist"] : []),
    ...(memory?.rejectionCount ? [`Previously rejected ${memory.rejectionCount} time${memory.rejectionCount === 1 ? "" : "s"}`] : []),
  ];
  return { applied: true, excluded: false, adjustment: Number(adjustment.toFixed(3)), matchScore: Math.round(matchScore), components, reasons };
}
