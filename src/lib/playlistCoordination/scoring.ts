import { albumKey, artistKey, canonicalTrackKey } from "./overlap";
import type { CoordinationScoreBreakdown, CoordinationScoringContext, PlaylistTrackFact } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rounded(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function scoreCrossPlaylistCandidate(
  track: PlaylistTrackFact,
  context?: CoordinationScoringContext,
  selectedRelatedTrackCount = 0,
  selectionPosition?: number,
): CoordinationScoreBreakdown {
  const result: CoordinationScoreBreakdown = {
    alreadyUsedInRelatedPlaylistPenalty: 0,
    globalSmartMixUsagePenalty: 0,
    crossPlaylistArtistPenalty: 0,
    crossPlaylistAlbumPenalty: 0,
    unusedTrackBonus: 0,
    sharedCoreAdjustment: 0,
    progressionFitAdjustment: 0,
    totalAdjustment: 0,
    hardOverlapRejected: false,
    reasons: [],
  };
  if (!context?.settings.coordinationEnabled) return result;
  const key = canonicalTrackKey(track);
  const sharedCore = context.settings.allowSharedCoreTracks && context.sharedCoreTrackKeys.includes(key);
  if (context.excludedTrackKeys.includes(key) && !sharedCore) {
    result.hardOverlapRejected = true;
    result.exclusionReason = "Track appears in a playlist selected as an exclusion source.";
    result.reasons.push(result.exclusionReason);
    return result;
  }

  const relatedUses = context.relatedTrackUsage[key] || 0;
  const globalUses = context.globalActiveUsage[key] || 0;
  const historicalUses = context.globalHistoricalUsage?.[key] || 0;
  if (sharedCore) {
    result.sharedCoreAdjustment = 0;
    result.reasons.push("Shared-core status allows intentional reuse without a track-overlap penalty.");
  } else if (relatedUses > 0 && (context.settings.keepDistinct || !["OFF", "WARNING_ONLY"].includes(context.settings.overlapEnforcement))) {
    result.alreadyUsedInRelatedPlaylistPenalty = -Math.min(8, 4 + relatedUses * 2);
    result.reasons.push(`Already appears in ${relatedUses} related playlist${relatedUses === 1 ? "" : "s"}.`);
  } else if (relatedUses > 0 && context.settings.overlapEnforcement === "WARNING_ONLY") {
    result.reasons.push("Already appears in a related playlist; warning-only mode did not change its score.");
  }

  if (context.settings.preferGloballyUnusedTracks && !sharedCore) {
    const strength = clamp(context.settings.unusedTrackPreferenceStrength, 0, 1);
    if (globalUses === 0) {
      result.unusedTrackBonus = 10 * strength;
      result.reasons.push("Has not appeared in another active Smart Mix playlist.");
    } else {
      result.globalSmartMixUsagePenalty = -Math.min(10, (globalUses === 1 ? 2 : 4 + globalUses) * strength);
      result.reasons.push(`Currently used in ${globalUses} Smart Mix playlist${globalUses === 1 ? "" : "s"}.`);
    }
    if (globalUses === 0 && historicalUses > 0) {
      result.unusedTrackBonus = Math.max(result.unusedTrackBonus, 3 * strength);
      result.reasons.push("Used historically, but not in an active Smart Mix playlist.");
    }
  }

  const artistUses = context.artistUsage[artistKey(track)] || 0;
  if (context.settings.crossPlaylistArtistBalancingEnabled && artistUses > 0) {
    const threshold = context.settings.maximumTracksPerArtistAcrossGroup || 6;
    result.crossPlaylistArtistPenalty = -Math.min(6, artistUses >= threshold ? 6 : artistUses * 0.75);
    result.reasons.push(`Artist already has ${artistUses} track${artistUses === 1 ? "" : "s"} across related playlists.`);
  }
  const albumUses = context.albumUsage[albumKey(track)] || 0;
  if (context.settings.keepDistinct && albumUses > 0) {
    result.crossPlaylistAlbumPenalty = -Math.min(4, albumUses);
    result.reasons.push("Album is already represented in a related playlist.");
  }

  const trackBpm = Number((track as any).effectiveBpm ?? (track as any).bpm ?? (track as any).audioFeature?.tempo);
  const handoffTarget = selectionPosition === 0
    ? context.progression?.previousHandoffBpm
    : selectionPosition != null && selectionPosition >= Math.max(0, context.targetPlaylistSize - 3)
      ? context.progression?.nextHandoffBpm
      : null;
  if (handoffTarget != null && Number.isFinite(trackBpm)) {
    const gap = Math.abs(trackBpm - handoffTarget);
    result.progressionFitAdjustment = gap <= 8 ? 3 : gap <= 20 ? 1 : gap > 35 ? -2 : 0;
    result.reasons.push(gap <= 8 ? "Supports a smooth BPM handoff with the adjacent progression playlist." : `Progression handoff BPM gap is ${Math.round(gap)}.`);
  }

  if (!sharedCore && relatedUses > 0 && context.settings.overlapEnforcement === "HARD_MAXIMUM") {
    const projectedShared = selectedRelatedTrackCount + 1;
    const denominator = Math.max(1, Math.min(context.targetPlaylistSize, context.maximumRelatedPlaylistSize));
    const projectedPercentage = (projectedShared / denominator) * 100;
    if (projectedPercentage > context.settings.maximumSharedTrackPercentage) {
      result.hardOverlapRejected = true;
      result.exclusionReason = `Adding this track would project overlap at ${projectedPercentage.toFixed(1)}%, above the ${context.settings.maximumSharedTrackPercentage}% hard maximum.`;
      result.reasons.push(result.exclusionReason);
    }
  }

  const rawTotal = result.alreadyUsedInRelatedPlaylistPenalty
    + result.globalSmartMixUsagePenalty
    + result.crossPlaylistArtistPenalty
    + result.crossPlaylistAlbumPenalty
    + result.unusedTrackBonus
    + result.sharedCoreAdjustment
    + result.progressionFitAdjustment;
  result.totalAdjustment = rounded(clamp(rawTotal, -context.settings.maximumCoordinationInfluence, context.settings.maximumCoordinationInfluence));
  if (rawTotal !== result.totalAdjustment) result.reasons.push("Coordination influence was capped by the playlist setting.");
  return result;
}
