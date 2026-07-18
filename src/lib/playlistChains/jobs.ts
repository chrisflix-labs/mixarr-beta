import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { safeFinishJobHistory, safeStartJobHistory } from "../jobHistory";
import { sanitizeErrorText } from "../supportRedaction";
import { analyzePlaylistChain, applyChainOptimization, createChainOptimizationPreview } from "./service";

type ChainJob = { jobId: string; userId: string; chainId: string; concurrency: number; controller: AbortController };
type Runtime = { queue: ChainJob[]; active: Map<string, ChainJob>; pumping: boolean };
const globalRuntime = globalThis as typeof globalThis & { mixarrPlaylistChainRuntime?: Runtime };
const runtime: Runtime = globalRuntime.mixarrPlaylistChainRuntime || { queue: [], active: new Map<string, ChainJob>(), pumping: false };
globalRuntime.mixarrPlaylistChainRuntime = runtime;

const stages = [
  "Preparing chain", "Analyzing playlist roles", "Calculating playlist summaries", "Evaluating energy handoffs",
  "Evaluating BPM handoffs", "Evaluating mood handoffs", "Finding transition candidates", "Building optimization preview", "Finalizing chain score",
];

async function updateProgress(item: ChainJob, stage: string, processed: number) {
  if (item.controller.signal.aborted) throw new Error("Chain analysis was cancelled.");
  const stageIndex = Math.max(0, stages.indexOf(stage));
  const progress = { stage, stageIndex, stageCount: stages.length, percent: Math.round((stageIndex + 1) / stages.length * 100), handoffsAnalyzed: processed };
  const now = new Date();
  await prisma.jobHistory.updateMany({ where: { id: item.jobId, status: { in: ["queued", "running", "processing"] } }, data: { status: "processing", currentItemLabel: stage, processed, progress: progress as Prisma.InputJsonValue, lastHeartbeatAt: now, lastProgressAt: now } });
}

async function execute(item: ChainJob) {
  const row = await prisma.jobHistory.findUnique({ where: { id: item.jobId }, select: { startedAt: true, status: true, metadata: true } });
  if (!row || row.status === "cancelled") return;
  try {
    await prisma.jobHistory.update({ where: { id: item.jobId }, data: { status: "running", currentItemLabel: stages[0] } });
    let result = await analyzePlaylistChain(item.userId, item.chainId, (stage, processed) => updateProgress(item, stage, processed));
    const [settings, chain] = await Promise.all([
      prisma.playlistChainSetting.findUnique({ where: { userId: item.userId } }),
      prisma.playlistProgressionChain.findUnique({ where: { id: item.chainId }, select: { autoMaintenanceEnabled: true, sharedTransitionMode: true } }),
    ]);
    if (settings?.automaticallyRepairWeakHandoffs && chain?.autoMaintenanceEnabled) {
      await updateProgress(item, "Building optimization preview", result.handoffs.length);
      const preview = await createChainOptimizationPreview(item.userId, item.chainId);
      const selected = preview.suggestions.filter((suggestion: any) => suggestion.improvement >= settings.minimumAutomaticRepairImprovement && (suggestion.type !== "ADD_SHARED_TRANSITION" || chain.sharedTransitionMode === "AUTOMATIC")).slice(0, settings.maximumTracksReplacedAutomatically).map((suggestion: any) => suggestion.id);
      if (selected.length) result = (await applyChainOptimization(item.userId, item.chainId, preview.id, selected)).analysis;
    }
    await safeFinishJobHistory({ job: { id: item.jobId, startedAt: row.startedAt }, status: result.warnings.length ? "completed_with_warnings" : "completed", summary: `Analyzed ${result.summaries.length} playlists and ${result.handoffs.length} handoffs in the progression chain.`, counts: { attempted: result.handoffs.length, processed: result.handoffs.length, skipped: 0, failed: 0 }, metadata: { ...((row.metadata || {}) as object), result, playlistCount: result.summaries.length, trackCount: result.totalTracks, handoffsAnalyzed: result.handoffs.length } as Prisma.InputJsonValue });
  } catch (error) {
    const cancelled = item.controller.signal.aborted;
    await safeFinishJobHistory({ job: { id: item.jobId, startedAt: row.startedAt }, status: cancelled ? "cancelled" : "failed", summary: cancelled ? "Playlist-chain analysis was cancelled." : `Playlist-chain analysis failed: ${sanitizeErrorText(error)}`, error, counts: { attempted: 1, processed: 0, skipped: cancelled ? 1 : 0, failed: cancelled ? 0 : 1 }, metadata: row.metadata as Prisma.InputJsonValue });
  }
}

function pump() {
  if (runtime.pumping) return;
  runtime.pumping = true;
  setImmediate(async () => {
    try {
      while (runtime.queue.length && runtime.active.size < runtime.queue[0].concurrency) {
        const item = runtime.queue.shift()!;
        runtime.active.set(item.jobId, item);
        void execute(item).finally(() => { runtime.active.delete(item.jobId); pump(); });
      }
    } finally {
      runtime.pumping = false;
      if (runtime.queue.length && runtime.active.size < runtime.queue[0].concurrency) pump();
    }
  });
}

export async function queueChainAnalysis(userId: string, chainId: string) {
  const [chain, settings] = await Promise.all([
    prisma.playlistProgressionChain.findFirst({ where: { id: chainId, userId }, select: { id: true, name: true, members: { select: { id: true } } } }),
    prisma.playlistChainSetting.findUnique({ where: { userId }, select: { analysisConcurrency: true } }),
  ]);
  if (!chain) throw new Error("Progression chain not found.");
  const active = await prisma.jobHistory.findFirst({ where: { userId, type: "playlist_chain", status: { in: ["queued", "running", "processing"] }, metadata: { path: ["chainId"], equals: chainId } }, select: { id: true, status: true, progress: true } });
  if (active) return { jobId: active.id, status: active.status, progress: active.progress, reused: true };
  const job = await safeStartJobHistory({ userId, type: "playlist_chain", name: `Analyze chain: ${chain.name}`, trigger: "manual", lockKey: `playlist-chain:${chainId}`, metadata: { chainId, chainName: chain.name, playlistCount: chain.members.length } as Prisma.InputJsonValue });
  if (!job) throw new Error("Unable to create the chain analysis job.");
  const progress = { stage: stages[0], stageIndex: 0, stageCount: stages.length, percent: 0, handoffsAnalyzed: 0 };
  await prisma.jobHistory.update({ where: { id: job.id }, data: { status: "queued", currentItemLabel: "Waiting to analyze chain", progress: progress as Prisma.InputJsonValue } });
  runtime.queue.push({ jobId: job.id, userId, chainId, concurrency: Math.min(4, Math.max(1, settings?.analysisConcurrency || 1)), controller: new AbortController() });
  pump();
  return { jobId: job.id, status: "queued", progress, reused: false };
}

export async function getChainAnalysisJob(userId: string, jobId: string) {
  const row = await prisma.jobHistory.findFirst({ where: { id: jobId, userId, type: "playlist_chain" } });
  if (!row) return null;
  const metadata = (row.metadata || {}) as Record<string, any>;
  return { id: row.id, status: row.status, progress: row.progress, summary: row.summary, error: row.error, result: metadata.result || null, startedAt: row.startedAt, finishedAt: row.finishedAt };
}

export async function cancelChainAnalysis(userId: string, jobId: string) {
  const row = await prisma.jobHistory.findFirst({ where: { id: jobId, userId, type: "playlist_chain" }, select: { id: true, status: true, startedAt: true, metadata: true } });
  if (!row) return null;
  const queued = runtime.queue.find((item) => item.jobId === jobId); const active = runtime.active.get(jobId);
  queued?.controller.abort(); active?.controller.abort(); runtime.queue = runtime.queue.filter((item) => item.jobId !== jobId);
  if (!active && queued) await safeFinishJobHistory({ job: { id: row.id, startedAt: row.startedAt }, status: "cancelled", summary: "Playlist-chain analysis was cancelled before it started.", counts: { attempted: 0, processed: 0, skipped: 1, failed: 0 }, metadata: row.metadata as Prisma.InputJsonValue });
  return { cancelled: Boolean(queued || active), status: active ? "processing" : queued ? "cancelled" : row.status };
}
