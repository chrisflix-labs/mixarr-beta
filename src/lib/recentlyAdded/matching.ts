import prisma from "../prisma";
import { metadataCorrectionRelations } from "../metadataCorrections";
import { playlistConfigSchema } from "../playlistService";
import { scoreSmartMixTrack } from "../smartMixEngine/v2/scoring";
import { getAdaptiveScoringSettings } from "../adaptiveScoring";
import { loadPlaybackScoringContext } from "../playbackAwareness";
import { scoreNewMusic } from "./scoring";
import { getRecentlyAddedSettings } from "./settings";

function clamp(value: number) { return Math.min(100, Math.max(0, value)); }

function explainMatch(scored: any) {
  const reasons: string[] = [];
  if ((scored.scoreBreakdown?.mood || 0) > 0) reasons.push("Mood profile matches the Smart Mix intent");
  if ((scored.scoreBreakdown?.bpm || 0) > 0) reasons.push("BPM fits the configured tempo range");
  if ((scored.scoreBreakdown?.energy || 0) > 0) reasons.push("Energy fits the playlist target");
  if ((scored.scoreBreakdown?.popularity || 0) >= 5) reasons.push("Meets the playlist discovery and popularity preference");
  if ((scored.scoreBreakdown?.recentlyUsedPenalty || 0) === 0) reasons.push("No recent-use penalty was applied");
  return reasons.length ? reasons : ["Compatible with the playlist's saved Smart Mix configuration"];
}

function recommendedSection(track: any) {
  const energy = track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy;
  if (typeof energy !== "number") return "Middle";
  return energy < 0.4 ? "Opening" : energy > 0.75 ? "Peak" : "Middle";
}

export async function findRecentlyAddedPlaylistMatches({ userId, batchId }: { userId: string; batchId?: string | null }) {
  const settings = await getRecentlyAddedSettings(userId);
  const profile = await prisma.userRecommendationProfile.findUnique({ where: { userId }, select: { enabled: true } });
  const [states, playlists] = await Promise.all([
    prisma.recentlyAddedTrackState.findMany({
      where: {
        ...(batchId ? { batchId } : {}),
        status: { in: ["ready_for_matching", "low_confidence", "suggested"] },
        ignored: false,
        doNotSuggest: false,
        track: { library: { server: { userId } }, syncStatus: "active", ...(profile?.enabled ? { userPreferences: { none: { userId, state: "NEVER_RECOMMEND" } } } : {}) },
      },
      take: settings.maxTracksPerRun,
      include: { track: { include: { artist: true, album: true, tags: true, audioFeature: true, popularity: true, recentlyAddedMatches: { select: { generatedPlaylistId: true, status: true } }, ...metadataCorrectionRelations } } },
    }),
    prisma.generatedPlaylist.findMany({
      where: { userId, engineVersion: "v2", OR: [{ automationSettings: null }, { automationSettings: { is: { mode: { not: "off" } } } }] },
      include: { automationSettings: true, tracks: { orderBy: { position: "asc" } } },
    }),
  ]);
  // A missing playlist-level row intentionally means the documented default: Suggestions Only.
  const eligiblePlaylists = playlists.filter((playlist) => playlist.automationSettings?.mode !== "off");
  const adaptive = await getAdaptiveScoringSettings(userId).catch(() => null);
  const playbackScoring = await loadPlaybackScoringContext({
    userId,
    trackIds: states.map((state) => state.trackId),
    maximumPersonalizationInfluence: adaptive?.settings.maximumInfluence ?? 1,
  });
  let created = 0;
  let strong = 0;
  for (const state of states) {
    let bestCompatibility = 0;
    let trackMatches = 0;
    for (const playlist of eligiblePlaylists) {
      if (playlist.tracks.some((item) => item.trackId === state.trackId)) continue;
      const parsed = playlistConfigSchema.safeParse(playlist.filtersJson);
      if (!parsed.success) {
        console.warn("[RecentlyAdded] playlist skipped", { playlistId: playlist.id, reason: "invalid_smart_mix_configuration" });
        continue;
      }
      const scored = scoreSmartMixTrack(state.track, { ...parsed.data, ...(playbackScoring ? { playbackScoring } : {}) });
      if (scored.exclusionReason === "PLAYBACK_RECENT") continue;
      const compatibilityScore = Math.round(clamp((scored.score - 40) * 3));
      bestCompatibility = Math.max(bestCompatibility, compatibilityScore);
      const newMusic = scoreNewMusic(state.track, compatibilityScore);
      const reasons = explainMatch(scored);
      const warnings = [
        ...(scored.metadataStatus?.missingFields || []).map((field: string) => `Missing ${field} metadata`),
        ...(state.status === "low_confidence" ? ["Track has low metadata confidence and is suggestion-only"] : []),
      ];
      const existingStatus = state.track.recentlyAddedMatches.find((item) => item.generatedPlaylistId === playlist.id)?.status;
      const status = existingStatus === "applied" || existingStatus === "ignored" ? existingStatus : compatibilityScore >= settings.matchThreshold ? "suggested" : "pending";
      await prisma.recentlyAddedPlaylistMatch.upsert({
        where: { trackId_generatedPlaylistId: { trackId: state.trackId, generatedPlaylistId: playlist.id } },
        update: {
          batchId: batchId || state.batchId,
          compatibilityScore,
          newMusicScore: newMusic.score,
          confidenceScore: newMusic.confidenceScore,
          recommendedSection: recommendedSection(state.track),
          matchReasonsJson: reasons,
          warningsJson: warnings,
          expectedScoreChange: Math.round((compatibilityScore - 70) / 10 * 10) / 10,
          status,
        },
        create: {
          batchId: batchId || state.batchId,
          trackId: state.trackId,
          generatedPlaylistId: playlist.id,
          compatibilityScore,
          newMusicScore: newMusic.score,
          confidenceScore: newMusic.confidenceScore,
          recommendedSection: recommendedSection(state.track),
          matchReasonsJson: reasons,
          warningsJson: warnings,
          expectedScoreChange: Math.round((compatibilityScore - 70) / 10 * 10) / 10,
          status,
        },
      });
      created += 1;
      trackMatches += 1;
      if (compatibilityScore >= settings.matchThreshold) strong += 1;
      console.info("[RecentlyAdded] match calculated", { trackId: state.trackId, playlistId: playlist.id, compatibilityScore, reasons });
    }
    const scored = scoreNewMusic(state.track, bestCompatibility || 50);
    await prisma.recentlyAddedTrackState.update({ where: { id: state.id }, data: { status: trackMatches && state.status !== "low_confidence" ? "suggested" : state.status, newMusicScore: scored.score, scoreBreakdownJson: scored.breakdown, matchedAt: new Date() } });
  }
  return { tracks: states.length, playlists: eligiblePlaylists.length, matches: created, strong };
}
