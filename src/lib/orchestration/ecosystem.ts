import { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { healthStateFor, relationshipStrength } from "./dashboardCore";

function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }

export async function getOrchestrationGroups(userId: string) {
  const groups = await prisma.playlistGroup.findMany({ where: { userId }, take: 100, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: {
    id: true, name: true, description: true, isPaused: true, scheduleJson: true, lastRegeneratedAt: true, lastHealthCalculatedAt: true,
    memberships: { orderBy: { sortOrder: "asc" }, select: { playlistId: true, playlist: { select: { id: true, plexPlaylistTitle: true, trackCount: true, managedPlaylist: { select: { id: true, automationState: true, plexAvailable: true, lastCompletedAt: true } }, healthSnapshots: { orderBy: { analyzedAt: "desc" }, take: 1, select: { overallScore: true, status: true, warningCount: true, criticalCount: true } } } } } },
  } });
  const playlistIds = Array.from(new Set(groups.flatMap((group) => group.memberships.map((membership) => membership.playlistId))));
  const managedIds = groups.flatMap((group) => group.memberships.map((membership) => membership.playlist.managedPlaylist?.id).filter((id): id is string => Boolean(id)));
  const [overlaps, actions, experiments, jobs, coverage, groupCoverageRows] = await Promise.all([
    playlistIds.length ? prisma.playlistOverlapSummary.findMany({ where: { playlistAId: { in: playlistIds }, playlistBId: { in: playlistIds }, stale: false }, take: 5_000, select: { playlistAId: true, playlistBId: true, sharedTrackPercentage: true } }) : [],
    playlistIds.length ? prisma.smartAction.findMany({ where: { userId, playlistId: { in: playlistIds }, status: { in: ["PENDING", "APPROVED", "SCHEDULED"] } }, take: 5_000, select: { playlistId: true } }) : [],
    playlistIds.length ? prisma.smartExperiment.findMany({ where: { userId, sourcePlaylistId: { in: playlistIds }, status: { in: ["RUNNING", "PAUSED"] } }, take: 1_000, select: { sourcePlaylistId: true } }) : [],
    managedIds.length ? prisma.playlistOrchestrationJob.findMany({ where: { userId, managedPlaylistId: { in: managedIds } }, orderBy: { scheduledFor: "desc" }, take: 5_000, select: { managedPlaylistId: true, status: true, scheduledFor: true, completedAt: true } }) : [],
    prisma.libraryCoverageSnapshot.findFirst({ where: { userId, libraryId: null }, orderBy: { createdAt: "desc" }, select: { eligibleTracks: true } }),
    groups.length ? prisma.$queryRaw<Array<{ playlistGroupId: string; usedTracks: bigint }>>(Prisma.sql`
      SELECT pgm."playlistGroupId", COUNT(DISTINCT gpt."trackId") AS "usedTracks"
      FROM "PlaylistGroupMembership" pgm
      INNER JOIN "GeneratedPlaylistTrack" gpt ON gpt."generatedPlaylistId" = pgm."playlistId"
      WHERE pgm."playlistGroupId" IN (${Prisma.join(groups.map((group) => group.id))})
        AND gpt."trackId" IS NOT NULL
      GROUP BY pgm."playlistGroupId"
    `) : [],
  ]);
  const coverageByGroup = new Map(groupCoverageRows.map((row) => [row.playlistGroupId, Number(row.usedTracks)]));
  return { items: groups.map((group) => {
    const ids = new Set(group.memberships.map((membership) => membership.playlistId));
    const playlistHealth = group.memberships.map((membership) => {
      const snapshot = membership.playlist.healthSnapshots[0];
      return healthStateFor({ automationState: membership.playlist.managedPlaylist?.automationState, plexAvailable: membership.playlist.managedPlaylist?.plexAvailable, snapshotStatus: snapshot?.status, score: snapshot?.overallScore, warningCount: snapshot?.warningCount, criticalCount: snapshot?.criticalCount });
    });
    const scores = group.memberships.map((membership) => membership.playlist.healthSnapshots[0]?.overallScore).filter((score): score is number => score != null);
    const groupOverlaps = overlaps.filter((row) => ids.has(row.playlistAId) && ids.has(row.playlistBId)).map((row) => row.sharedTrackPercentage);
    const groupManagedIds = new Set(group.memberships.map((membership) => membership.playlist.managedPlaylist?.id).filter(Boolean));
    const groupJobs = jobs.filter((job) => job.managedPlaylistId && groupManagedIds.has(job.managedPlaylistId));
    const lastSuccess = groupJobs.filter((job) => job.status === "SUCCEEDED" && job.completedAt).sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())[0]?.completedAt || null;
    const nextRun = groupJobs.filter((job) => ["QUEUED", "WAITING", "BLOCKED"].includes(job.status) && job.scheduledFor >= new Date()).sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())[0]?.scheduledFor || object(group.scheduleJson).nextRunAt || null;
    const critical = playlistHealth.filter((state) => state === "CRITICAL").length;
    const warnings = playlistHealth.filter((state) => ["WARNING", "NEEDS_ATTENTION"].includes(state)).length;
    const paused = playlistHealth.filter((state) => state === "PAUSED").length;
    const healthy = playlistHealth.filter((state) => state === "HEALTHY").length;
    const state = group.isPaused ? "PAUSED" : critical ? "CRITICAL" : warnings ? "NEEDS_ATTENTION" : scores.length ? "HEALTHY" : "NOT_ENOUGH_DATA";
    const groupUsedTracks = coverageByGroup.get(group.id);
    const libraryCoverage = coverage?.eligibleTracks && groupUsedTracks != null ? Math.round((groupUsedTracks / coverage.eligibleTracks) * 10_000) / 100 : null;
    return { id: group.id, name: group.name, description: group.description, state, playlistCount: group.memberships.length, healthyPlaylistCount: healthy, warningCount: warnings, criticalIssueCount: critical, pausedPlaylistCount: paused, averageHealthScore: average(scores), averageOverlap: average(groupOverlaps), libraryCoverage, coverageDenominator: coverage?.eligibleTracks ?? null, coveredTracks: groupUsedTracks ?? null, pendingSmartActions: actions.filter((action) => action.playlistId && ids.has(action.playlistId)).length, activeExperiments: experiments.filter((experiment) => ids.has(experiment.sourcePlaylistId)).length, lastSuccessfulAutomationRun: lastSuccess, nextScheduledAutomationRun: nextRun, playlists: group.memberships.map((membership) => ({ id: membership.playlist.id, name: membership.playlist.plexPlaylistTitle })) };
  }) };
}

export async function getOrchestrationRelationships(userId: string, input: { search?: string; groupId?: string; relationshipType?: string; minimumStrength?: number; health?: string; includePaused?: boolean; limit?: number }) {
  const limit = Math.min(250, Math.max(10, input.limit || 120));
  const managed = await prisma.managedPlaylist.findMany({ where: { userId, enabled: true, ...(input.includePaused ? {} : { automationState: { not: "PAUSED" } }), ...(input.search ? { displayName: { contains: input.search, mode: "insensitive" } } : {}), ...(input.groupId ? { generatedPlaylist: { groupMemberships: { some: { playlistGroupId: input.groupId } } } } : {}) }, take: limit, orderBy: { displayName: "asc" }, select: {
    id: true, displayName: true, automationState: true, plexAvailable: true, orchestrationMode: true, generatedPlaylistId: true,
    generatedPlaylist: { select: { trackCount: true, identity: { select: { displayName: true, confidence: true, confidenceState: true } }, healthSnapshots: { orderBy: { analyzedAt: "desc" }, take: 1, select: { overallScore: true, status: true, warningCount: true, criticalCount: true } }, groupMemberships: { take: 5, select: { playlistGroup: { select: { id: true, name: true } } } }, smartActions: { where: { status: { in: ["PENDING", "APPROVED", "SCHEDULED"] } }, select: { id: true } }, sourceExperiments: { where: { status: { in: ["RUNNING", "PAUSED"] } }, select: { id: true } } } },
  } });
  const generatedIds = managed.map((item) => item.generatedPlaylistId).filter((id): id is string => Boolean(id));
  const [explicit, overlaps] = await Promise.all([
    prisma.managedPlaylistRelationship.findMany({ where: { enabled: true, sourceManagedPlaylistId: { in: managed.map((item) => item.id) }, targetManagedPlaylistId: { in: managed.map((item) => item.id) } }, take: 500, select: { id: true, sourceManagedPlaylistId: true, targetManagedPlaylistId: true, relationshipType: true } }),
    generatedIds.length ? prisma.playlistOverlapSummary.findMany({ where: { playlistAId: { in: generatedIds }, playlistBId: { in: generatedIds }, stale: false }, orderBy: { similarityScore: "desc" }, take: 500, select: { id: true, playlistAId: true, playlistBId: true, sharedTrackPercentage: true, sharedArtistPercentage: true, similarityScore: true, withinPolicy: true } }) : [],
  ]);
  const byGenerated = new Map(managed.map((item) => [item.generatedPlaylistId, item.id]));
  const minimum = Math.min(100, Math.max(0, input.minimumStrength || 0));
  const nodes = managed.map((playlist) => {
    const snapshot = playlist.generatedPlaylist?.healthSnapshots[0];
    const health = healthStateFor({ automationState: playlist.automationState, plexAvailable: playlist.plexAvailable, snapshotStatus: snapshot?.status, score: snapshot?.overallScore, warningCount: snapshot?.warningCount, criticalCount: snapshot?.criticalCount });
    const identity = playlist.generatedPlaylist?.identity;
    return { id: playlist.id, generatedPlaylistId: playlist.generatedPlaylistId, name: playlist.displayName, health, healthScore: snapshot?.overallScore ?? null, trackCount: playlist.generatedPlaylist?.trackCount || 0, groups: playlist.generatedPlaylist?.groupMemberships.map((row) => row.playlistGroup) || [], identitySummary: identity ? `${identity.confidenceState.replaceAll("_", " ").toLowerCase()} · ${Math.round(identity.confidence * 100)}% confidence` : null, activeExperiments: playlist.generatedPlaylist?.sourceExperiments.length || 0, pendingActions: playlist.generatedPlaylist?.smartActions.length || 0, paused: playlist.automationState === "PAUSED", managed: true };
  }).filter((node) => !input.health || node.health === input.health);
  const visible = new Set(nodes.map((node) => node.id));
  const edges = [
    ...explicit.map((row) => ({ id: `explicit:${row.id}`, source: row.sourceManagedPlaylistId, target: row.targetManagedPlaylistId, type: row.relationshipType, strength: 100, trackOverlap: null, artistOverlap: null, withinPolicy: true })),
    ...overlaps.map((row) => ({ id: `overlap:${row.id}`, source: byGenerated.get(row.playlistAId)!, target: byGenerated.get(row.playlistBId)!, type: "OVERLAP", strength: relationshipStrength({ track: row.sharedTrackPercentage, artist: row.sharedArtistPercentage, identity: row.similarityScore }), trackOverlap: row.sharedTrackPercentage, artistOverlap: row.sharedArtistPercentage, withinPolicy: row.withinPolicy })),
  ].filter((edge) => edge.source && edge.target && visible.has(edge.source) && visible.has(edge.target) && edge.strength >= minimum && (!input.relationshipType || edge.type === input.relationshipType)).sort((a, b) => b.strength - a.strength).slice(0, 500);
  return { nodes, edges, limits: { nodeLimit: limit, edgeLimit: 500, nodesLimited: managed.length === limit, edgesLimited: explicit.length + overlaps.length > 500 }, accessibleRows: edges.map((edge) => ({ ...edge, sourceName: nodes.find((node) => node.id === edge.source)?.name, targetName: nodes.find((node) => node.id === edge.target)?.name })) };
}

export async function getOrchestrationOverlap(userId: string, input: { metric?: string; groupId?: string; search?: string; excludePaused?: boolean; excludeExperimentVariants?: boolean; problematicOnly?: boolean; minimum?: number; sort?: "name" | "group" | "highest_overlap" }) {
  const generatedPlaylistFilter = { ...(input.groupId ? { groupMemberships: { some: { playlistGroupId: input.groupId } } } : {}), ...(input.excludeExperimentVariants ? { experimentVariants: { none: {} } } : {}) };
  const managed = await prisma.managedPlaylist.findMany({ where: { userId, enabled: true, ...(input.excludePaused ? { automationState: { not: "PAUSED" } } : {}), ...(input.search ? { displayName: { contains: input.search, mode: "insensitive" } } : {}), ...(Object.keys(generatedPlaylistFilter).length ? { generatedPlaylist: generatedPlaylistFilter } : {}) }, take: 60, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, generatedPlaylistId: true, automationState: true, generatedPlaylist: { select: { trackCount: true, groupMemberships: { take: 3, select: { playlistGroup: { select: { id: true, name: true } } } } } } } });
  const ids = managed.map((item) => item.generatedPlaylistId).filter((id): id is string => Boolean(id));
  const metric = ["track", "shared_tracks", "artist", "album", "identity"].includes(input.metric || "") ? input.metric! : "track";
  const rows = ids.length ? await prisma.playlistOverlapSummary.findMany({ where: { playlistAId: { in: ids }, playlistBId: { in: ids }, stale: false, ...(input.problematicOnly ? { withinPolicy: false } : {}) }, take: 2_000, orderBy: { sharedTrackPercentage: "desc" } }) : [];
  const minimum = Math.max(0, Math.min(100, input.minimum || 0));
  const value = (row: typeof rows[number]) => metric === "shared_tracks" ? row.sharedTrackCount : metric === "artist" ? row.sharedArtistPercentage : metric === "album" ? row.sharedAlbumPercentage : metric === "identity" ? row.similarityScore : row.sharedTrackPercentage;
  const cells = rows.map((row) => ({ id: row.id, playlistAId: row.playlistAId, playlistBId: row.playlistBId, value: value(row), sharedTrackCount: row.sharedTrackCount, trackOverlap: row.sharedTrackPercentage, artistOverlap: row.sharedArtistPercentage, albumOverlap: row.sharedAlbumPercentage, identitySimilarity: row.similarityScore, withinPolicy: row.withinPolicy, calculatedAt: row.calculatedAt })).filter((row) => row.value >= minimum);
  const averages = new Map<string, number>();
  for (const id of ids) { const values = cells.filter((cell) => cell.playlistAId === id || cell.playlistBId === id).map((cell) => cell.value); averages.set(id, average(values) || 0); }
  const playlists = managed.map((item) => ({ id: item.generatedPlaylistId!, managedPlaylistId: item.id, name: item.displayName, trackCount: item.generatedPlaylist?.trackCount || 0, paused: item.automationState === "PAUSED", groups: item.generatedPlaylist?.groupMemberships.map((row) => row.playlistGroup) || [], averageOverlap: averages.get(item.generatedPlaylistId!) || 0 }));
  playlists.sort(input.sort === "highest_overlap" ? (a, b) => b.averageOverlap - a.averageOverlap : input.sort === "group" ? (a, b) => (a.groups[0]?.name || "").localeCompare(b.groups[0]?.name || "") || a.name.localeCompare(b.name) : (a, b) => a.name.localeCompare(b.name));
  return { metric, denominator: "Eligible tracks in the smaller playlist for track overlap; distinct artists/albums for their respective metrics.", playlists, cells, limited: managed.length === 60, note: managed.length === 60 ? "Showing the first 60 filtered playlists. Narrow by group or search to explore the rest without rendering thousands of cells." : null };
}
