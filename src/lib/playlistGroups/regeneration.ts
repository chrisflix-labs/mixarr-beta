import { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { safeFinishJobHistory, safeStartJobHistory } from "../jobHistory";
import { previewGeneratedPlaylistRegeneration, regenerateGeneratedPlaylistFromPreview } from "../playlistService";
import { mapWithConcurrency } from "../concurrency";
import { PlaylistGroupError, getPlaylistGroup, resolvePlaylistSettings } from "./service";

type Runtime = { controllers: Map<string, AbortController> };
declare global { var mixarrPlaylistGroupRuntime: Runtime | undefined; }
const runtime = globalThis.mixarrPlaylistGroupRuntime ?? { controllers: new Map() };
globalThis.mixarrPlaylistGroupRuntime = runtime;

const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function previewGroupRegeneration(userId: string, groupId: string, input: { playlistIds?: string[]; only?: "all" | "unhealthy" | "warnings" } = {}) {
  const group: any = await getPlaylistGroup(userId, groupId);
  const requested = input.playlistIds?.length ? new Set(input.playlistIds) : null;
  let memberships: any[] = group.memberships.filter((membership: any) => !requested || requested.has(membership.playlistId));
  if (requested && memberships.length !== requested.size) throw new PlaylistGroupError("INVALID_PLAYLIST_SELECTION", "One or more selected playlists are not part of this collection.");
  if (input.only === "unhealthy") memberships = memberships.filter((membership: any) => group.health.affected.generation.includes(membership.playlistId));
  if (input.only === "warnings") memberships = memberships.filter((membership: any) => (Object.values(group.health.affected) as string[][]).some((ids) => ids.includes(membership.playlistId)));
  const lockedTracks = memberships.length
    ? await prisma.generatedPlaylistTrack.count({
        where: {
          generatedPlaylistId: { in: memberships.map((membership: any) => membership.playlistId) },
          locked: true,
        },
      })
    : 0;
  return { group: { id: group.id, name: group.name, isPaused: group.isPaused }, playlistIds: memberships.map((membership: any) => membership.playlistId), playlistCount: memberships.length, estimatedPlaylistsAffected: memberships.length, lockedTracksPreserved: lockedTracks, versionSnapshots: true, warnings: [...(group.isPaused ? ["This collection is paused. Confirm the one-time manual run to continue."] : []), ...(memberships.length === 0 ? ["No playlists match this regeneration filter."] : [])] };
}

async function runGroupRegeneration(parent: NonNullable<Awaited<ReturnType<typeof safeStartJobHistory>>>, userId: string, groupId: string, playlistIds: string[], controller: AbortController) {
  const group: any = await getPlaylistGroup(userId, groupId);
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  const collectionArtistUsage = new Map<string, number>();
  const results = await mapWithConcurrency(playlistIds, Math.max(1, Math.min(4, Number(process.env.MIXARR_GROUP_REGENERATION_CONCURRENCY || 2))), async (playlistId) => {
    if (controller.signal.aborted) { cancelled += 1; return { playlistId, status: "cancelled" }; }
    const membership = group.memberships.find((row: any) => row.playlistId === playlistId)!;
    const child = await safeStartJobHistory({ userId, type: "playlist_group_child", name: `${group.name}: ${membership.playlist.plexPlaylistTitle}`, trigger: "manual", lockKey: `playlist-group:${groupId}:playlist:${playlistId}`, metadata: json({ parentJobId: parent.id, playlistGroupId: groupId, playlistId }) });
    try {
      const resolution = await resolvePlaylistSettings({ userId, playlistId, groupId });
      const previewResult = await previewGeneratedPlaylistRegeneration({ userId, generatedPlaylistId: playlistId, mode: "replace_all", effectiveGroupSettings: resolution.effectiveSettings, groupContext: { id: group.id, name: group.name } });
      if (controller.signal.aborted) throw new Error("Group regeneration cancelled before playlist write.");
      const preview = (previewResult as any).preview;
      const candidates: any[] = Array.isArray(preview?.tracks) ? preview.tracks : [];
      const excludedReasons: string[] = [];
      const normalized = (value: unknown) => String(value || "").trim().toLowerCase();
      const included = candidates.filter((track) => {
        const artist = normalized(track.artist?.title || track.artist);
        for (const rule of group.exclusionRules.filter((item: any) => item.isEnabled)) {
          const value = normalized(rule.ruleValue);
          const title = normalized(track.title); const album = normalized(track.album?.title || track.album); const genres = (track.tags || track.genres || []).map((item: any) => normalized(item.name || item));
          const matched = rule.ruleType === "track" ? [normalized(track.id), normalized(track.ratingKey), title].includes(value)
            : rule.ruleType === "artist" ? artist === value : rule.ruleType === "album" ? album === value
            : rule.ruleType === "genre" ? genres.includes(value) : rule.ruleType === "mood" ? genres.includes(value)
            : rule.ruleType === "live" ? /\blive\b/.test(title) || track.isLive === true
            : rule.ruleType === "remix" ? /\bremix\b/.test(title) : rule.ruleType === "instrumental" ? /\binstrumental\b/.test(title)
            : rule.ruleType === "explicit" ? track.isExplicit === true : false;
          if (matched) { excludedReasons.push(`Rejected by group rule: ${group.name} excludes ${rule.ruleType} ${rule.ruleValue}.`); return false; }
        }
        if (resolution.effectiveSettings.groupWideArtistDistribution && artist) {
          const limit = Math.max(1, Number(resolution.effectiveSettings.maximumTracksPerArtist || 2));
          const used = collectionArtistUsage.get(artist) || 0;
          if (used >= limit) { excludedReasons.push(`Artist limit inherited from ${group.name} was reached across this collection regeneration.`); return false; }
          collectionArtistUsage.set(artist, used + 1);
        }
        return true;
      });
      const trackIds = included.length ? included.map((track) => track.id).filter(Boolean) : Array.isArray(preview?.trackIds) && !candidates.length ? preview.trackIds : [];
      if (!trackIds.length) throw new Error("Regeneration preview did not produce any eligible tracks.");
      const result = await regenerateGeneratedPlaylistFromPreview({ userId, generatedPlaylistId: playlistId, trackIds, previewId: preview.previewId || null, mode: "replace_all", regeneration: preview.regeneration, warnings: [...(preview.warnings || []), ...Array.from(new Set(excludedReasons)).slice(0, 25), `Effective collection settings source: ${group.name}.`] });
      completed += 1;
      await safeFinishJobHistory({ job: child, status: "completed", summary: `Regenerated ${membership.playlist.plexPlaylistTitle} from ${group.name}.`, counts: { attempted: 1, processed: 1, failed: 0 }, metadata: json({ parentJobId: parent.id, playlistGroupId: groupId, playlistId, effectiveSettings: resolution.effectiveSettings, sources: resolution.sources, result }) });
      return { playlistId, status: "completed" };
    } catch (error) {
      const wasCancelled = controller.signal.aborted;
      wasCancelled ? cancelled += 1 : failed += 1;
      await safeFinishJobHistory({ job: child, status: wasCancelled ? "cancelled" : "failed", summary: wasCancelled ? `Cancelled ${membership.playlist.plexPlaylistTitle}.` : `Failed to regenerate ${membership.playlist.plexPlaylistTitle}.`, error, counts: { attempted: 1, processed: 0, failed: wasCancelled ? 0 : 1 }, metadata: json({ parentJobId: parent.id, playlistGroupId: groupId, playlistId }) });
      return { playlistId, status: wasCancelled ? "cancelled" : "failed", error: error instanceof Error ? error.message : String(error) };
    } finally {
      await prisma.jobHistory.updateMany({ where: { id: parent.id }, data: { processed: completed, failed, skipped: cancelled, currentItemLabel: `${completed + failed + cancelled} of ${playlistIds.length} playlists finished`, lastProgressAt: new Date(), progress: json({ total: playlistIds.length, completed, failed, cancelled, percent: Math.round((completed + failed + cancelled) / Math.max(1, playlistIds.length) * 100) }) } });
    }
  });
  const status = controller.signal.aborted ? "cancelled" : failed ? "completed_with_warnings" : "completed";
  await safeFinishJobHistory({ job: parent, status, summary: controller.signal.aborted ? `${group.name} regeneration cancelled. ${completed} completed, ${failed} failed, ${cancelled} cancelled.` : `${group.name} regeneration ${failed ? "completed with warnings" : "completed"}. ${completed} succeeded, ${failed} failed.`, counts: { attempted: playlistIds.length, processed: completed, failed, skipped: cancelled }, metadata: json({ playlistGroupId: groupId, results }) });
  if (completed) await prisma.playlistGroup.update({ where: { id: groupId }, data: { lastRegeneratedAt: new Date() } });
  await prisma.playlistGroupActivity.create({ data: { userId, playlistGroupId: groupId, action: "regenerated", summary: `${completed} succeeded, ${failed} failed, ${cancelled} cancelled.`, metadataJson: json({ parentJobId: parent.id, results }) } });
  runtime.controllers.delete(parent.id);
}

export async function queueGroupRegeneration(userId: string, groupId: string, input: { playlistIds?: string[]; only?: "all" | "unhealthy" | "warnings"; confirmPaused?: boolean }) {
  const preview = await previewGroupRegeneration(userId, groupId, input);
  if (preview.group.isPaused && !input.confirmPaused) throw new PlaylistGroupError("GROUP_PAUSED_CONFIRMATION_REQUIRED", "This group is paused. Run regeneration once anyway?", 409);
  if (!preview.playlistIds.length) throw new PlaylistGroupError("NO_PLAYLISTS_SELECTED", "No playlists match this regeneration request.");
  const parent = await safeStartJobHistory({ userId, type: "playlist_group", name: `${preview.group.name} regeneration`, trigger: "manual", lockKey: `playlist-group:${groupId}`, metadata: json({ playlistGroupId: groupId, playlistIds: preview.playlistIds }) });
  if (!parent) throw new PlaylistGroupError("JOB_CREATE_FAILED", "The collection regeneration job could not be queued.", 500);
  const controller = new AbortController();
  runtime.controllers.set(parent.id, controller);
  await prisma.jobHistory.update({ where: { id: parent.id }, data: { status: "queued", attempted: preview.playlistIds.length, processed: 0, failed: 0, skipped: 0, currentItemLabel: "Queued", progress: json({ total: preview.playlistIds.length, completed: 0, failed: 0, cancelled: 0, percent: 0 }) } });
  setImmediate(() => { void runGroupRegeneration(parent, userId, groupId, preview.playlistIds, controller).catch(async (error) => { runtime.controllers.delete(parent.id); await safeFinishJobHistory({ job: parent, status: "failed", error, summary: `${preview.group.name} regeneration failed before child jobs completed.` }); }); });
  return { jobId: parent.id, status: "queued", preview };
}

export async function getGroupRegenerationJob(userId: string, groupId: string, jobId: string) {
  const row = await prisma.jobHistory.findFirst({ where: { id: jobId, userId, type: "playlist_group" } });
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, any> : {};
  if (!row || metadata.playlistGroupId !== groupId) throw new PlaylistGroupError("JOB_NOT_FOUND", "Collection regeneration job not found.", 404);
  const children = await prisma.jobHistory.findMany({ where: { userId, type: "playlist_group_child", metadata: { path: ["parentJobId"], equals: jobId } }, orderBy: { startedAt: "asc" }, take: 500 });
  return { ...row, children };
}

export async function cancelGroupRegeneration(userId: string, groupId: string, jobId: string) {
  const job = await getGroupRegenerationJob(userId, groupId, jobId);
  if (["completed", "completed_with_warnings", "failed", "cancelled"].includes(job.status)) throw new PlaylistGroupError("JOB_NOT_CANCELLABLE", "This collection job has already finished.", 409);
  runtime.controllers.get(jobId)?.abort("Cancelled by user");
  await prisma.jobHistory.update({ where: { id: jobId }, data: { currentItemLabel: "Cancelling" } });
  return { cancelled: true };
}
