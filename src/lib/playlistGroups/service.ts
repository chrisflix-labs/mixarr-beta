import { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { calculateGroupHealth, compactSortOrders, resolveSettingsLayers, type InheritanceState, type SettingsRecord } from "./core";

export class PlaylistGroupError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

const json = (value: unknown) => value as Prisma.InputJsonValue;
const object = (value: unknown): SettingsRecord => value && typeof value === "object" && !Array.isArray(value) ? value as SettingsRecord : {};

async function ownedGroup(userId: string, groupId: string) {
  const group = await prisma.playlistGroup.findFirst({ where: { id: groupId, userId } });
  if (!group) throw new PlaylistGroupError("GROUP_NOT_FOUND", "Collection not found.", 404);
  return group;
}

async function activity(userId: string, playlistGroupId: string, action: string, summary: string, metadata?: unknown) {
  await prisma.playlistGroupActivity.create({ data: { userId, playlistGroupId, action, summary, metadataJson: metadata == null ? undefined : json(metadata) } });
}

export async function listPlaylistGroups(userId: string, input: { search?: string; status?: string; sort?: string } = {}) {
  const groups = await prisma.playlistGroup.findMany({
    where: { userId, ...(input.search ? { OR: [{ name: { contains: input.search, mode: "insensitive" } }, { description: { contains: input.search, mode: "insensitive" } }] } : {}), ...(input.status === "paused" ? { isPaused: true } : input.status === "active" ? { isPaused: false } : {}) },
    include: { memberships: { select: { playlistId: true, playlist: { select: { qualityScoreJson: true, trackCount: true, engineVersion: true } } } }, exclusionRules: { where: { isEnabled: true }, select: { id: true } } },
  });
  const rows = groups.map((group) => {
    const health = calculateGroupHealth(group.memberships.map((membership) => { const quality = object(membership.playlist.qualityScoreJson); return { id: membership.playlistId, qualityScore: typeof quality.overallScore === "number" ? quality.overallScore : null, isEmpty: membership.playlist.trackCount === 0, engineVersion: membership.playlist.engineVersion, configurationWarnings: membership.playlist.engineVersion === "v2" ? 0 : 1 }; }));
    return { ...group, settingsJson: object(group.settingsJson), playlistCount: group.memberships.length, health, warningCount: Object.values(health.affected).reduce((sum, ids) => sum + ids.length, 0), memberships: undefined };
  });
  const sort = input.sort || "custom";
  rows.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "health" ? b.health.overallScore - a.health.overallScore : sort === "playlistCount" ? b.playlistCount - a.playlistCount : sort === "updated" ? b.updatedAt.getTime() - a.updatedAt.getTime() : a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return rows;
}

export async function getPlaylistGroup(userId: string, groupId: string): Promise<any> {
  await ownedGroup(userId, groupId);
  const group = await prisma.playlistGroup.findUnique({ where: { id: groupId }, include: {
    memberships: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { playlist: { include: { _count: { select: { tracks: true } }, automationSettings: true, managedPlaylist: true } } } },
    exclusionRules: { orderBy: { createdAt: "asc" } }, activities: { orderBy: { createdAt: "desc" }, take: 30 },
  } });
  if (!group) throw new PlaylistGroupError("GROUP_NOT_FOUND", "Collection not found.", 404);
  const health: any = await getPlaylistGroupHealth(userId, groupId, group);
  return { ...group, settingsJson: object(group.settingsJson), health };
}

export async function createPlaylistGroup(userId: string, input: { name: string; description?: string; artworkUrl?: string | null; artworkSource?: string | null; settings?: SettingsRecord; schedule?: unknown }) {
  const max = await prisma.playlistGroup.aggregate({ where: { userId }, _max: { sortOrder: true } });
  const group = await prisma.playlistGroup.create({ data: { userId, name: input.name, description: input.description || "", artworkUrl: input.artworkUrl, artworkSource: input.artworkSource, settingsJson: json(input.settings || {}), scheduleJson: input.schedule == null ? undefined : json(input.schedule), sortOrder: (max._max.sortOrder || 0) + 1_000 } });
  await activity(userId, group.id, "created", `Created collection “${group.name}”.`);
  return group;
}

export async function updatePlaylistGroup(userId: string, groupId: string, patch: { name?: string; description?: string; artworkUrl?: string | null; artworkSource?: string | null; settings?: SettingsRecord; schedule?: unknown; isPaused?: boolean; sortOrder?: number }) {
  const current = await ownedGroup(userId, groupId);
  const group = await prisma.playlistGroup.update({ where: { id: groupId }, data: { name: patch.name, description: patch.description, artworkUrl: patch.artworkUrl, artworkSource: patch.artworkSource, settingsJson: patch.settings ? json(patch.settings) : undefined, scheduleJson: patch.schedule === null ? Prisma.JsonNull : patch.schedule === undefined ? undefined : json(patch.schedule), isPaused: patch.isPaused, sortOrder: patch.sortOrder } });
  const action = patch.isPaused === true ? "paused" : patch.isPaused === false && current.isPaused ? "resumed" : "updated";
  await activity(userId, groupId, action, action === "paused" ? "Paused collection automation." : action === "resumed" ? "Resumed collection automation." : "Updated collection settings.");
  return group;
}

export async function deletePlaylistGroup(userId: string, groupId: string) {
  const group = await ownedGroup(userId, groupId);
  const playlistCount = await prisma.playlistGroupMembership.count({ where: { playlistGroupId: groupId } });
  await prisma.playlistGroup.delete({ where: { id: groupId } });
  return { deleted: true, groupName: group.name, playlistsPreserved: playlistCount };
}

export async function addPlaylistsToGroup(userId: string, groupId: string, playlistIds: string[]) {
  const group = await ownedGroup(userId, groupId);
  const owned = await prisma.generatedPlaylist.findMany({ where: { id: { in: playlistIds }, userId }, select: { id: true, plexPlaylistTitle: true } });
  if (owned.length !== new Set(playlistIds).size) throw new PlaylistGroupError("PLAYLIST_PERMISSION_DENIED", "You do not have permission to manage one or more selected playlists.", 403);
  const existing = await prisma.playlistGroupMembership.findMany({ where: { playlistGroupId: groupId, playlistId: { in: playlistIds } }, select: { playlistId: true } });
  if (existing.length) throw new PlaylistGroupError("DUPLICATE_MEMBERSHIP", "This playlist is already part of the collection.", 409);
  const max = await prisma.playlistGroupMembership.aggregate({ where: { playlistGroupId: groupId }, _max: { sortOrder: true } });
  await prisma.playlistGroupMembership.createMany({ data: owned.map((playlist, index) => ({ playlistGroupId: groupId, playlistId: playlist.id, sortOrder: (max._max.sortOrder || 0) + (index + 1) * 1_000 })) });
  await activity(userId, groupId, "playlists_added", `Added ${owned.length} playlist${owned.length === 1 ? "" : "s"} to ${group.name}.`, { playlistIds: owned.map((p) => p.id) });
  return { added: owned.length };
}

export async function removePlaylistFromGroup(userId: string, groupId: string, playlistId: string) {
  await ownedGroup(userId, groupId);
  const membership = await prisma.playlistGroupMembership.findFirst({ where: { playlistGroupId: groupId, playlistId, playlist: { userId } } });
  if (!membership) throw new PlaylistGroupError("MEMBERSHIP_NOT_FOUND", "Playlist membership not found.", 404);
  await prisma.playlistGroupMembership.delete({ where: { id: membership.id } });
  await activity(userId, groupId, "playlist_removed", "Removed a playlist from the collection. Its playlist data and settings were preserved.", { playlistId, primarySettingsGroupRemoved: membership.isPrimarySettingsGroup });
  return { removed: true, primarySettingsGroupRemoved: membership.isPrimarySettingsGroup };
}

export async function updateMembershipSettings(userId: string, groupId: string, playlistId: string, patch: { inheritsSettings?: boolean; isPrimarySettingsGroup?: boolean; inheritance?: Record<string, InheritanceState> }) {
  await ownedGroup(userId, groupId);
  const membership = await prisma.playlistGroupMembership.findFirst({ where: { playlistGroupId: groupId, playlistId, playlist: { userId } } });
  if (!membership) throw new PlaylistGroupError("MEMBERSHIP_NOT_FOUND", "Playlist membership not found.", 404);
  await prisma.$transaction(async (tx) => {
    if (patch.isPrimarySettingsGroup) await tx.playlistGroupMembership.updateMany({ where: { playlistId, isPrimarySettingsGroup: true, NOT: { id: membership.id } }, data: { isPrimarySettingsGroup: false } });
    await tx.playlistGroupMembership.update({ where: { id: membership.id }, data: { inheritsSettings: patch.inheritsSettings, isPrimarySettingsGroup: patch.isPrimarySettingsGroup, inheritanceJson: patch.inheritance ? json(patch.inheritance) : undefined } });
  });
  await activity(userId, groupId, "inheritance_updated", "Updated playlist inheritance settings.", { playlistId, ...patch });
  return prisma.playlistGroupMembership.findUnique({ where: { id: membership.id } });
}

export async function reorderGroupPlaylists(userId: string, groupId: string, playlistIds: string[]) {
  await ownedGroup(userId, groupId);
  const memberships = await prisma.playlistGroupMembership.findMany({ where: { playlistGroupId: groupId }, select: { id: true, playlistId: true } });
  if (memberships.length !== playlistIds.length || new Set(playlistIds).size !== playlistIds.length || memberships.some((row) => !playlistIds.includes(row.playlistId))) throw new PlaylistGroupError("INVALID_ORDER", "The playlist order must include every collection playlist exactly once.");
  const memberByPlaylist = new Map(memberships.map((row) => [row.playlistId, row.id]));
  const orders = compactSortOrders(playlistIds.map((id) => memberByPlaylist.get(id)!));
  await prisma.$transaction(orders.map((row) => prisma.playlistGroupMembership.update({ where: { id: row.id }, data: { sortOrder: row.sortOrder } })));
  await activity(userId, groupId, "reordered", "Reordered collection playlists.");
  return { reordered: orders.length };
}

export async function createGroupExclusionRule(userId: string, groupId: string, input: { ruleType: string; ruleValue: string; isEnabled: boolean; reason?: string | null; allowOverride: boolean }) {
  await ownedGroup(userId, groupId);
  const rule = await prisma.playlistGroupExclusionRule.create({ data: { playlistGroupId: groupId, ruleType: input.ruleType, ruleValue: input.ruleValue, isEnabled: input.isEnabled, reason: input.reason, allowOverride: input.allowOverride } });
  await activity(userId, groupId, "exclusion_added", `Added ${input.ruleType} exclusion “${input.ruleValue}”.`, { ruleId: rule.id });
  return rule;
}

export async function deleteGroupExclusionRule(userId: string, groupId: string, ruleId: string) {
  await ownedGroup(userId, groupId);
  const rule = await prisma.playlistGroupExclusionRule.findFirst({ where: { id: ruleId, playlistGroupId: groupId } });
  if (!rule) throw new PlaylistGroupError("EXCLUSION_NOT_FOUND", "Collection exclusion rule not found.", 404);
  await prisma.playlistGroupExclusionRule.delete({ where: { id: ruleId } });
  await activity(userId, groupId, "exclusion_removed", `Removed ${rule.ruleType} exclusion “${rule.ruleValue}”.`, { ruleId });
  return { deleted: true };
}

export async function clonePlaylistGroup(userId: string, groupId: string, options: { name?: string; includeSettings: boolean; includeMemberships: boolean; includeArtwork: boolean; includeSchedule: boolean }) {
  const source = await getPlaylistGroup(userId, groupId);
  return prisma.$transaction(async (tx) => {
    const max = await tx.playlistGroup.aggregate({ where: { userId }, _max: { sortOrder: true } });
    const clone = await tx.playlistGroup.create({ data: { userId, name: options.name || `${source.name} Copy`, description: source.description, artworkUrl: options.includeArtwork ? source.artworkUrl : null, artworkSource: options.includeArtwork ? source.artworkSource : null, settingsJson: json(options.includeSettings ? object(source.settingsJson) : {}), scheduleJson: options.includeSchedule && source.scheduleJson ? json(source.scheduleJson) : undefined, sortOrder: (max._max.sortOrder || 0) + 1_000 } });
    if (options.includeMemberships && source.memberships.length) await tx.playlistGroupMembership.createMany({ data: source.memberships.map((membership: any) => ({ playlistGroupId: clone.id, playlistId: membership.playlistId, sortOrder: membership.sortOrder, inheritsSettings: false, isPrimarySettingsGroup: false, inheritanceJson: membership.inheritanceJson ? json(membership.inheritanceJson) : undefined })) });
    await tx.playlistGroupActivity.create({ data: { userId, playlistGroupId: clone.id, action: "cloned", summary: `Cloned from “${source.name}”.`, metadataJson: json({ sourceGroupId: source.id }) } });
    return clone;
  });
}

export async function resolvePlaylistSettings(input: { userId: string; playlistId: string; groupId?: string; oneTimeOverrides?: SettingsRecord }) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: input.playlistId, userId: input.userId }, include: { groupMemberships: { include: { playlistGroup: true } } } });
  if (!playlist) throw new PlaylistGroupError("PLAYLIST_NOT_FOUND", "Generated playlist not found.", 404);
  const membership = input.groupId ? playlist.groupMemberships.find((row) => row.playlistGroupId === input.groupId) : playlist.groupMemberships.find((row) => row.isPrimarySettingsGroup);
  if (input.groupId && !membership) throw new PlaylistGroupError("MEMBERSHIP_NOT_FOUND", "The playlist is not part of that collection.", 404);
  const local = { ...object(playlist.filtersJson), ...object(playlist.tuningConfigJson), discoveryConfig: playlist.discoveryConfigJson, adaptiveSettings: playlist.adaptiveSettingsJson };
  return resolveSettingsLayers({ groupDefaults: membership ? object(membership.playlistGroup.settingsJson) : {}, playlistSettings: local, oneTimeOverrides: input.oneTimeOverrides, inheritance: object(membership?.inheritanceJson) as Record<string, InheritanceState>, inheritByDefault: membership?.inheritsSettings || false, group: membership ? { id: membership.playlistGroup.id, name: membership.playlistGroup.name } : null });
}

export async function getPlaylistGroupHealth(userId: string, groupId: string, loaded?: any): Promise<any> {
  await ownedGroup(userId, groupId);
  const memberships: any[] = loaded?.memberships || await prisma.playlistGroupMembership.findMany({ where: { playlistGroupId: groupId }, include: { playlist: { include: { automationSettings: true, managedPlaylist: true } } } });
  const inputs: any[] = memberships.map((membership: any) => { const playlist = membership.playlist; const quality = object(playlist.qualityScoreJson); const warnings = Array.isArray(quality.warnings) ? quality.warnings.length : 0; return { id: playlist.id, qualityScore: typeof quality.overallScore === "number" ? quality.overallScore : null, metadataCompleteness: typeof quality.metadataCompleteness === "number" ? quality.metadataCompleteness : 100, automationHealthy: playlist.managedPlaylist?.automationState !== "ERROR", configurationWarnings: warnings + (playlist.engineVersion === "v2" ? 0 : 1) + (membership.inheritsSettings && !membership.isPrimarySettingsGroup ? 1 : 0), plexSynchronized: playlist.plexPlaylistRatingKey ? playlist.managedPlaylist?.plexAvailable !== false : null, isPaused: playlist.managedPlaylist?.automationState === "PAUSED", isEmpty: playlist.trackCount === 0, engineVersion: playlist.engineVersion }; });
  const score = calculateGroupHealth(inputs);
  const counts: Record<string, number> = { healthy: inputs.filter((p: any) => !score.affected.generation.includes(p.id) && !score.affected.configuration.includes(p.id)).length, warnings: new Set((Object.values(score.affected) as string[][]).flat()).size, failed: inputs.filter((p: any) => p.automationHealthy === false).length, paused: inputs.filter((p: any) => p.isPaused).length, empty: inputs.filter((p: any) => p.isEmpty).length, outdatedEngine: inputs.filter((p: any) => p.engineVersion !== "v2").length };
  await prisma.playlistGroup.update({ where: { id: groupId }, data: { lastHealthCalculatedAt: new Date() } });
  return { ...score, counts, calculatedAt: new Date() };
}

export function playlistGroupErrorResponse(error: unknown) {
  if (error instanceof PlaylistGroupError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: 409, body: { error: { code: "DUPLICATE", message: "That collection item already exists." } } };
  console.error("[PlaylistGroup] Request failed", error);
  return { status: 500, body: { error: { code: "PLAYLIST_GROUP_INTERNAL_ERROR", message: "The collection request could not be completed." } } };
}
