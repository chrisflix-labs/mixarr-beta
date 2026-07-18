import type { PlaylistOverlapResult } from "./types";
import prisma from "../prisma";
import { safeFinishJobHistory, safeStartJobHistory, type StartedJobHistory } from "../jobHistory";
import { calculatePlaylistOverlap, canonicalTrackKey } from "./overlap";
import { loadPlaylistFacts } from "./service";
import { DEFAULT_VARIETY_POLICY, canonicalPlaylistPair, getCrossPlaylistVarietySettings } from "./policy";
import { mapWithConcurrency } from "../concurrency";

type AnalysisRequest = {
  playlistIds?: string[];
  trigger?: "manual" | "scheduled" | "retry";
  batchSize?: number;
  forceAll?: boolean;
};

function summaryData(overlap: PlaylistOverlapResult, sourcePlaylistId: string, targetPlaylistId: string) {
  const { playlistAId, playlistBId } = canonicalPlaylistPair(sourcePlaylistId, targetPlaylistId);
  return {
    playlistAId,
    playlistBId,
    sharedTrackCount: overlap.sharedTrackCount,
    sharedTrackPercentage: overlap.sharedTrackPercentage,
    jaccardSimilarity: overlap.jaccardSimilarity,
    sharedArtistCount: overlap.sharedArtistCount,
    sharedArtistPercentage: overlap.sharedArtistPercentage,
    sharedAlbumCount: overlap.sharedAlbumCount,
    sharedAlbumPercentage: overlap.sharedAlbumPercentage,
    sharedCoreTrackCount: overlap.sharedCoreTrackCount,
    similarityScore: overlap.similarityScore,
    playlistASize: playlistAId === sourcePlaylistId ? overlap.sourceTrackCount : overlap.targetTrackCount,
    playlistBSize: playlistBId === targetPlaylistId ? overlap.targetTrackCount : overlap.sourceTrackCount,
    overlapPercentA: playlistAId === sourcePlaylistId ? overlap.overlapPercentOfSource : overlap.overlapPercentOfTarget,
    overlapPercentB: playlistBId === targetPlaylistId ? overlap.overlapPercentOfTarget : overlap.overlapPercentOfSource,
    uniquePercentA: playlistAId === sourcePlaylistId ? overlap.sourceUniqueTrackPercentage : overlap.targetUniqueTrackPercentage,
    uniquePercentB: playlistBId === targetPlaylistId ? overlap.targetUniqueTrackPercentage : overlap.sourceUniqueTrackPercentage,
    policySharedTrackCount: overlap.policySharedTrackCount,
    excessSharedTrackCount: overlap.excessSharedTrackCount,
    tracksFromSharedArtists: overlap.tracksFromSharedArtists,
    artistConcentrationScore: overlap.artistConcentrationScore,
    albumsDominatingCount: overlap.dominatingAlbumKeys.length,
    withinPolicy: overlap.withinPolicy,
    policySnapshotJson: overlap.policy,
    warningsJson: overlap.warnings,
    stale: false,
    calculatedAt: new Date(),
  };
}

async function cancelled(jobId: string) {
  const job = await prisma.jobHistory.findUnique({ where: { id: jobId }, select: { status: true } });
  return job?.status === "cancelled";
}

async function runCrossPlaylistAnalysis(userId: string, job: StartedJobHistory, request: AnalysisRequest) {
  const started = Date.now();
  const global = await getCrossPlaylistVarietySettings(userId);
  const batchSize = Math.min(50, Math.max(5, request.batchSize || global.analysisBatchSize || 20));
  const concurrency = Math.min(4, Math.max(1, global.analysisConcurrency || 2));
  const playlists = await prisma.generatedPlaylist.findMany({ where: { userId }, select: { id: true, plexPlaylistTitle: true }, orderBy: { id: "asc" } });
  const explicitlyRequestedIds = request.playlistIds?.length ? new Set(request.playlistIds) : null;
  if (explicitlyRequestedIds) {
    const owned = playlists.filter((playlist) => explicitlyRequestedIds.has(playlist.id));
    if (owned.length !== explicitlyRequestedIds.size) throw new Error("One or more requested playlists were not found or are not accessible.");
  }
  const [playlistSettings, pairPolicies, designations, legacyCore] = await Promise.all([
    prisma.playlistCoordinationSetting.findMany({ where: { playlist: { userId } } }),
    prisma.playlistPairPolicy.findMany({ where: { userId } }),
    prisma.playlistTrackDesignation.findMany({ where: { userId, OR: [{ isCore: true }, { isSharedAllowed: true }] }, select: { playlistId: true, trackId: true, isCore: true, isSharedAllowed: true } }),
    prisma.playlistSharedCoreTrack.findMany({ where: { userId }, select: { playlistId: true, trackId: true } }),
  ]);
  const previousSummaries = await prisma.playlistOverlapSummary.findMany({ where: { playlistAId: { in: playlists.map((playlist) => playlist.id) }, playlistBId: { in: playlists.map((playlist) => playlist.id) } } });
  const expectedPairCount = playlists.length * Math.max(0, playlists.length - 1) / 2;
  let requestedIds = explicitlyRequestedIds;
  if (!requestedIds && !request.forceAll && previousSummaries.length >= expectedPairCount) {
    requestedIds = new Set<string>();
    for (const summary of previousSummaries) if (summary.stale) { requestedIds.add(summary.playlistAId); requestedIds.add(summary.playlistBId); }
    for (const settings of playlistSettings) if (settings.analysisStale) requestedIds.add(settings.playlistId);
  }
  const previousByPair = new Map(previousSummaries.map((summary) => [`${summary.playlistAId}:${summary.playlistBId}`, summary]));
  const settingsByPlaylist = new Map(playlistSettings.map((settings) => [settings.playlistId, settings]));
  const pairPolicyByKey = new Map(pairPolicies.map((policy) => [`${policy.playlistAId}:${policy.playlistBId}`, policy]));
  const designationByPlaylist = new Map<string, typeof designations>();
  for (const designation of designations) designationByPlaylist.set(designation.playlistId, (designationByPlaylist.get(designation.playlistId) || []).concat(designation));
  const coreByPlaylist = new Map<string, Set<string>>();
  for (const core of legacyCore) {
    if (!coreByPlaylist.has(core.playlistId)) coreByPlaylist.set(core.playlistId, new Set());
    coreByPlaylist.get(core.playlistId)!.add(core.trackId);
  }
  for (const designation of designations) if (designation.isCore) {
    if (!coreByPlaylist.has(designation.playlistId)) coreByPlaylist.set(designation.playlistId, new Set());
    coreByPlaylist.get(designation.playlistId)!.add(designation.trackId);
  }
  const totalPairs = playlists.reduce((count, playlist, index) => count + playlists.slice(index + 1).filter((target) => !requestedIds || requestedIds.has(playlist.id) || requestedIds.has(target.id)).length, 0);
  let processed = 0;
  let aboveLimit = 0;
  let tracksEvaluated = 0;
  let cancellationRequested = false;
  let progressQueue: Promise<void> = Promise.resolve();
  const persistProgress = (label: string, checkpoint: { sourcePlaylistId: string; targetOffset: number }) => {
    const snapshot = { processed, aboveLimit, tracksEvaluated, elapsedMs: Date.now() - started };
    progressQueue = progressQueue.then(() => prisma.jobHistory.update({
      where: { id: job.id },
      data: {
        status: "processing", processed: snapshot.processed, attempted: totalPairs, currentItemLabel: label,
        lastHeartbeatAt: new Date(), lastProgressAt: new Date(),
        progress: { playlistPairsProcessed: snapshot.processed, playlistPairsTotal: totalPairs, tracksEvaluated: snapshot.tracksEvaluated, pairsAboveLimit: snapshot.aboveLimit, elapsedMs: snapshot.elapsedMs },
        metadata: { checkpoint, batchSize, concurrency },
      },
    }).then(() => undefined));
    return progressQueue;
  };
  console.info(`[CrossPlaylistAnalysis] Started userId=${userId} playlists=${playlists.length} pairs=${totalPairs} batchSize=${batchSize} concurrency=${concurrency}`);

  await mapWithConcurrency(playlists, concurrency, async (source, sourceIndex) => {
    const targets = playlists.slice(sourceIndex + 1).filter((target) => !requestedIds || requestedIds.has(source.id) || requestedIds.has(target.id));
    if (!targets.length || cancellationRequested) return;
    const sourceFacts = (await loadPlaylistFacts([source.id])).get(source.id) || [];
    for (let offset = 0; offset < targets.length; offset += batchSize) {
      if (await cancelled(job.id)) {
        cancellationRequested = true;
        return;
      }
      const targetBatch = targets.slice(offset, offset + batchSize);
      const targetFacts = await loadPlaylistFacts(targetBatch.map((target) => target.id));
      const writes = [];
      for (const target of targetBatch) {
        const targetRows = targetFacts.get(target.id) || [];
        const { playlistAId, playlistBId } = canonicalPlaylistPair(source.id, target.id);
        const pairPolicy = pairPolicyByKey.get(`${playlistAId}:${playlistBId}`);
        const sourceSettings = settingsByPlaylist.get(source.id);
        const maximumTrackOverlapPercent = pairPolicy?.allowedTrackOverlapPercent ?? sourceSettings?.maximumSharedTrackPercentage ?? global.maximumTrackOverlapPercent ?? DEFAULT_VARIETY_POLICY.maximumTrackOverlapPercent;
        const maximumArtistOverlapPercent = pairPolicy?.allowedArtistOverlapPercent ?? sourceSettings?.maximumSharedArtistPercentage ?? global.maximumArtistOverlapPercent ?? DEFAULT_VARIETY_POLICY.maximumArtistOverlapPercent;
        const maximumAlbumOverlapPercent = pairPolicy?.allowedAlbumOverlapPercent ?? sourceSettings?.maximumSharedAlbumPercentage ?? global.maximumAlbumOverlapPercent ?? DEFAULT_VARIETY_POLICY.maximumAlbumOverlapPercent;
        const coreIds = new Set(Array.from(coreByPlaylist.get(source.id) || []).concat(Array.from(coreByPlaylist.get(target.id) || [])));
        const coreKeys = sourceFacts.concat(targetRows).filter((track) => track.trackId && coreIds.has(track.trackId)).map(canonicalTrackKey);
        const allowedIds = new Set((designationByPlaylist.get(source.id) || []).concat(designationByPlaylist.get(target.id) || []).filter((row) => row.isSharedAllowed).map((row) => row.trackId));
        const allowedKeys = sourceFacts.concat(targetRows).filter((track) => track.trackId && allowedIds.has(track.trackId)).map(canonicalTrackKey);
        const overlap = calculatePlaylistOverlap(sourceFacts, targetRows, coreKeys, {
          maximumTrackOverlapPercent,
          maximumArtistOverlapPercent,
          maximumAlbumOverlapPercent,
          maximumSharedTrackCount: pairPolicy?.maximumSharedTrackCount ?? sourceSettings?.maximumSharedTrackCount ?? global.maximumSharedTrackCount,
          minimumUniqueTrackPercent: sourceSettings?.minimumUniqueTrackPercentage ?? global.minimumUniqueTrackPercent,
          minimumUniqueTrackCount: sourceSettings?.minimumUniqueTrackCount ?? global.minimumUniqueTrackCount,
          sharedTrackAllowance: pairPolicy?.sharedTrackAllowance ?? sourceSettings?.sharedTrackAllowance ?? global.sharedTrackAllowance,
          coreTrackKeys: coreKeys,
          allowedSharedTrackKeys: allowedKeys,
          allowedArtistKeys: Array.isArray(pairPolicy?.allowedArtistIdsJson) ? pairPolicy.allowedArtistIdsJson.filter((item): item is string => typeof item === "string").map((id) => `artist:${id}`) : [],
          allowedAlbumKeys: Array.isArray(pairPolicy?.allowedAlbumIdsJson) ? pairPolicy.allowedAlbumIdsJson.filter((item): item is string => typeof item === "string").map((id) => `album:${id}`) : [],
        });
        if (pairPolicy?.ignored || sourceSettings?.excludedFromEnforcement) {
          overlap.withinPolicy = true;
          overlap.warnings = [];
        }
        if (!overlap.withinPolicy) aboveLimit += 1;
        tracksEvaluated += sourceFacts.length + targetRows.length;
        const data = summaryData(overlap, source.id, target.id);
        writes.push(prisma.playlistOverlapSummary.upsert({ where: { playlistAId_playlistBId: { playlistAId, playlistBId } }, create: data, update: data }));
        const previous = previousByPair.get(`${playlistAId}:${playlistBId}`);
        if (!previous || Math.abs(previous.sharedTrackPercentage - overlap.sharedTrackPercentage) >= 0.01 || Math.abs(previous.sharedArtistPercentage - overlap.sharedArtistPercentage) >= 0.01 || Math.abs(previous.sharedAlbumPercentage - overlap.sharedAlbumPercentage) >= 0.01 || previous.withinPolicy !== overlap.withinPolicy) {
          writes.push(prisma.playlistOverlapSnapshot.create({ data: {
            userId, playlistAId, playlistBId, sharedTrackCount: overlap.sharedTrackCount, sharedTrackPercentage: overlap.sharedTrackPercentage,
            sharedArtistPercentage: overlap.sharedArtistPercentage, sharedAlbumPercentage: overlap.sharedAlbumPercentage,
            uniquePercentA: data.uniquePercentA, uniquePercentB: data.uniquePercentB, withinPolicy: overlap.withinPolicy,
          } }));
        }
        processed += 1;
      }
      await prisma.$transaction(writes);
      await persistProgress(`${source.plexPlaylistTitle} (${Math.min(offset + batchSize, targets.length)}/${targets.length})`, { sourcePlaylistId: source.id, targetOffset: offset + targetBatch.length });
    }
  });
  if (cancellationRequested) {
    console.info(`[CrossPlaylistAnalysis] Cancelled userId=${userId} processed=${processed} total=${totalPairs}`);
    return { cancelled: true, processed, totalPairs, aboveLimit, tracksEvaluated };
  }
  await prisma.playlistCoordinationSetting.updateMany({ where: { playlist: { userId }, ...(requestedIds ? { playlistId: { in: Array.from(requestedIds) } } : {}) }, data: { analysisStale: false } });
  await prisma.playlistOverlapSnapshot.deleteMany({ where: { userId, calculatedAt: { lt: new Date(Date.now() - 180 * 86_400_000) } } });
  console.info(`[CrossPlaylistAnalysis] Completed userId=${userId} playlists=${playlists.length} pairs=${processed} aboveLimit=${aboveLimit} durationMs=${Date.now() - started}`);
  return { cancelled: false, processed, totalPairs, aboveLimit, tracksEvaluated };
}

export async function queueCrossPlaylistAnalysis(userId: string, request: AnalysisRequest = {}) {
  const active = await prisma.jobHistory.findFirst({ where: { userId, type: "cross_playlist_analysis", status: { in: ["running", "processing", "retrying", "queued"] } }, select: { id: true, status: true, progress: true } });
  if (active) return { job: active, alreadyRunning: true };
  const job = await safeStartJobHistory({ userId, type: "cross_playlist_analysis", name: "Cross-playlist variety analysis", trigger: request.trigger || "manual", metadata: { requestedPlaylistIds: request.playlistIds || null } });
  if (!job) throw new Error("Analysis could not be queued.");
  void runCrossPlaylistAnalysis(userId, job, request).then(async (result) => {
    if (result.cancelled) return;
    await safeFinishJobHistory({ job, status: result.aboveLimit ? "completed_with_warnings" : "completed", counts: { attempted: result.totalPairs, processed: result.processed, failed: 0 }, summary: `Analyzed ${result.processed} playlist pairs; ${result.aboveLimit} above policy.`, metadata: result });
  }).catch(async (error) => {
    console.error("[CrossPlaylistAnalysis] Failed", { userId, jobId: job.id, error: error instanceof Error ? error.message : String(error) });
    await safeFinishJobHistory({ job, status: "failed", error, summary: "Cross-playlist analysis failed. Retry is available." });
  });
  return { job: { id: job.id, status: "running" }, alreadyRunning: false };
}

export async function getCrossPlaylistAnalysisStatus(userId: string, jobId?: string) {
  const job = jobId
    ? await prisma.jobHistory.findFirst({ where: { id: jobId, userId, type: "cross_playlist_analysis" } })
    : await prisma.jobHistory.findFirst({ where: { userId, type: "cross_playlist_analysis" }, orderBy: { startedAt: "desc" } });
  return job || { status: "not_calculated", summary: "Analysis required" };
}

export async function cancelCrossPlaylistAnalysis(userId: string, jobId: string) {
  const result = await prisma.jobHistory.updateMany({ where: { id: jobId, userId, type: "cross_playlist_analysis", status: { in: ["running", "processing", "retrying", "queued"] } }, data: { status: "cancelled", finishedAt: new Date(), summary: "Cross-playlist analysis cancelled by the user." } });
  if (!result.count) throw new Error("Active analysis job not found.");
  return { cancelled: true, jobId };
}
