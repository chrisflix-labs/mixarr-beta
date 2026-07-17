import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { PlaylistGroupError } from "./service";
import { playlistGroupSettingsSchema } from "./schemas";

const exportSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("mixarr-playlist-groups"),
  groups: z.array(z.object({
    name: z.string().min(1).max(100), description: z.string().max(2000), artworkUrl: z.string().url().nullable(), artworkSource: z.string().nullable(), isPaused: z.boolean(),
    settings: playlistGroupSettingsSchema, schedule: z.record(z.unknown()).nullable(),
    memberships: z.array(z.object({ playlistId: z.string(), plexPlaylistRatingKey: z.string().nullable(), playlistName: z.string(), sortOrder: z.number().int(), inheritsSettings: z.boolean(), isPrimarySettingsGroup: z.boolean(), inheritance: z.record(z.unknown()).nullable() })).max(500),
    exclusions: z.array(z.object({ ruleType: z.string(), ruleValue: z.string(), isEnabled: z.boolean(), reason: z.string().nullable(), source: z.string(), allowOverride: z.boolean() })).max(500),
  })).max(100),
});

const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function exportPlaylistGroups(userId: string) {
  const groups = await prisma.playlistGroup.findMany({ where: { userId }, orderBy: { sortOrder: "asc" }, include: { memberships: { orderBy: { sortOrder: "asc" }, include: { playlist: { select: { id: true, plexPlaylistRatingKey: true, plexPlaylistTitle: true } } } }, exclusionRules: true } });
  return { schemaVersion: 1 as const, kind: "mixarr-playlist-groups" as const, exportedAt: new Date().toISOString(), groups: groups.map((group) => ({ name: group.name, description: group.description, artworkUrl: group.artworkUrl, artworkSource: group.artworkSource, isPaused: group.isPaused, settings: object(group.settingsJson), schedule: group.scheduleJson ? object(group.scheduleJson) : null, memberships: group.memberships.map((membership) => ({ playlistId: membership.playlistId, plexPlaylistRatingKey: membership.playlist.plexPlaylistRatingKey, playlistName: membership.playlist.plexPlaylistTitle, sortOrder: membership.sortOrder, inheritsSettings: membership.inheritsSettings, isPrimarySettingsGroup: membership.isPrimarySettingsGroup, inheritance: membership.inheritanceJson ? object(membership.inheritanceJson) : null })), exclusions: group.exclusionRules.map(({ ruleType, ruleValue, isEnabled, reason, source, allowOverride }) => ({ ruleType, ruleValue, isEnabled, reason, source, allowOverride })) })) };
}

export async function importPlaylistGroups(userId: string, value: unknown, dryRun = true) {
  const parsed = exportSchema.safeParse(value);
  if (!parsed.success) throw new PlaylistGroupError("INVALID_IMPORT", parsed.error.issues[0]?.message || "Invalid Playlist Groups export.");
  const references = parsed.data.groups.flatMap((group) => group.memberships);
  const ids = Array.from(new Set(references.map((reference) => reference.playlistId)));
  const ratingKeys = Array.from(new Set(references.map((reference) => reference.plexPlaylistRatingKey).filter((key): key is string => Boolean(key))));
  const playlists = await prisma.generatedPlaylist.findMany({ where: { userId, OR: [{ id: { in: ids } }, { plexPlaylistRatingKey: { in: ratingKeys } }] }, select: { id: true, plexPlaylistRatingKey: true, plexPlaylistTitle: true } });
  const byId = new Map(playlists.map((playlist) => [playlist.id, playlist])); const byRatingKey = new Map(playlists.filter((playlist) => playlist.plexPlaylistRatingKey).map((playlist) => [playlist.plexPlaylistRatingKey!, playlist]));
  const unmatched = references.filter((reference) => !byId.get(reference.playlistId) && !(reference.plexPlaylistRatingKey && byRatingKey.get(reference.plexPlaylistRatingKey))).map((reference) => ({ playlistId: reference.playlistId, playlistName: reference.playlistName }));
  const report = { groups: parsed.data.groups.length, memberships: references.length - unmatched.length, exclusions: parsed.data.groups.reduce((sum, group) => sum + group.exclusions.length, 0), unmatched, dryRun };
  if (dryRun) return report;
  await prisma.$transaction(async (tx) => {
    const maximum = await tx.playlistGroup.aggregate({ where: { userId }, _max: { sortOrder: true } }); let groupOffset = maximum._max.sortOrder || 0;
    for (const source of parsed.data.groups) {
      groupOffset += 1_000;
      const group = await tx.playlistGroup.create({ data: { userId, name: source.name, description: source.description, artworkUrl: source.artworkUrl, artworkSource: source.artworkSource, isPaused: source.isPaused, settingsJson: json(source.settings), scheduleJson: source.schedule ? json(source.schedule) : undefined, sortOrder: groupOffset } });
      const seen = new Set<string>();
      for (const membership of source.memberships) { const playlist = byId.get(membership.playlistId) || (membership.plexPlaylistRatingKey ? byRatingKey.get(membership.plexPlaylistRatingKey) : undefined); if (!playlist || seen.has(playlist.id)) continue; seen.add(playlist.id); const hasPrimary = membership.isPrimarySettingsGroup ? await tx.playlistGroupMembership.count({ where: { playlistId: playlist.id, isPrimarySettingsGroup: true } }) : 0; await tx.playlistGroupMembership.create({ data: { playlistGroupId: group.id, playlistId: playlist.id, sortOrder: membership.sortOrder, inheritsSettings: membership.inheritsSettings, isPrimarySettingsGroup: membership.isPrimarySettingsGroup && hasPrimary === 0, inheritanceJson: membership.inheritance ? json(membership.inheritance) : undefined } }); }
      if (source.exclusions.length) await tx.playlistGroupExclusionRule.createMany({ data: source.exclusions.map((rule) => ({ playlistGroupId: group.id, ...rule })) });
      await tx.playlistGroupActivity.create({ data: { userId, playlistGroupId: group.id, action: "imported", summary: "Imported collection from a v2.2.1 export." } });
    }
  });
  return report;
}
