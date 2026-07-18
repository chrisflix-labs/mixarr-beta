import type { Prisma } from "@prisma/client";
import prisma from "../../prisma";
import { APP_VERSION } from "../../appVersion";
import { capturePlaylistSnapshot, engineFamilyFor, readPlaylistSnapshot, snapshotJson } from "./playlist-version-snapshot";
import { diffPlaylistVersions } from "./playlist-version-diff";
import { cleanupPlaylistVersions } from "./playlist-version-retention";
import type { PlaylistVersionReason } from "./playlist-version-types";

export function describePlaylistVersion(reason: PlaylistVersionReason, context?: { count?: number; sourceRevision?: number; mode?: string }) {
  const count = context?.count || 0;
  const descriptions: Record<PlaylistVersionReason, string> = {
    initial_generation: "Initial playlist generation",
    full_regeneration: "Regenerated entire playlist",
    advanced_regeneration: context?.mode ? `Advanced regeneration — ${context.mode.replaceAll("_", " ")}` : `Advanced regeneration replaced ${count} track${count === 1 ? "" : "s"}`,
    manual_track_add: `Added ${count} track${count === 1 ? "" : "s"} manually`,
    manual_track_remove: `Removed ${count} track${count === 1 ? "" : "s"} manually`,
    manual_reorder: "Reordered playlist",
    manual_edit: "Manual playlist edit",
    settings_change: "Updated playlist settings",
    restore: context?.sourceRevision ? `Restored Version ${context.sourceRevision}` : "Restored a previous version",
    undo: context?.sourceRevision ? `Undid restore using Version ${context.sourceRevision}` : "Undid playlist change",
    import: "Imported playlist",
    system_migration: "Baseline version created for legacy playlist",
    recently_added_automation: `Recently Added Automation added ${count} track${count === 1 ? "" : "s"}`,
    automation_backup: "Recoverable version before an automated playlist update",
    cross_playlist_overlap_repair: "Cross-playlist overlap repair",
    smart_action: "Protected version before an approved Smart Action",
  };
  return descriptions[reason];
}

type CreateVersionInput = {
  generatedPlaylistId: string;
  reason: PlaylistVersionReason;
  label?: string | null;
  description?: string | null;
  regenerationId?: string | null;
  restoredFromVersionId?: string | null;
  isPinned?: boolean;
  isAutomatic?: boolean;
  syncStatus?: "pending" | "synced" | "failed";
  force?: boolean;
  smartActionId?: string | null;
};

export async function createPlaylistVersionInTransaction(tx: Prisma.TransactionClient, input: CreateVersionInput & { force: true }): Promise<NonNullable<Awaited<ReturnType<typeof tx.playlistRevision.create>>>>;
export async function createPlaylistVersionInTransaction(tx: Prisma.TransactionClient, input: CreateVersionInput): Promise<Awaited<ReturnType<typeof tx.playlistRevision.create>> | null>;
export async function createPlaylistVersionInTransaction(tx: Prisma.TransactionClient, input: CreateVersionInput) {
  const owner = await tx.generatedPlaylist.findUnique({ where: { id: input.generatedPlaylistId }, select: { userId: true } });
  if (!owner) throw new Error("Generated playlist not found");
  const preferences = await tx.syncSettings.findUnique({
    where: { userId: owner.userId },
    select: { playlistVersionHistoryEnabled: true, saveManualPlaylistVersions: true, savePlaylistScoreSnapshots: true, cleanupPlaylistVersionsAutomatically: true, playlistVersionRetention: true },
  });
  const manualAllowed = input.reason !== "manual_edit" || preferences?.saveManualPlaylistVersions !== false || input.isAutomatic === false;
  if (!input.force && input.isAutomatic !== false && (preferences?.playlistVersionHistoryEnabled === false || !manualAllowed)) return null;
  const playlist = await tx.generatedPlaylist.update({
    where: { id: input.generatedPlaylistId },
    data: { revisionCounter: { increment: 1 } },
    select: { revisionCounter: true, engineVersion: true, sourceType: true },
  });
  const snapshot = await capturePlaylistSnapshot(tx, input.generatedPlaylistId);
  if (preferences?.savePlaylistScoreSnapshots === false) snapshot.data.scores = null;
  const serialized = JSON.stringify(snapshot);
  await tx.playlistRevision.updateMany({ where: { generatedPlaylistId: input.generatedPlaylistId, isCurrent: true }, data: { isCurrent: false } });
  const version = await tx.playlistRevision.create({
    data: {
      generatedPlaylistId: input.generatedPlaylistId,
      revisionNumber: playlist.revisionCounter,
      regenerationId: input.regenerationId || null,
      reason: input.reason,
      label: input.label?.trim() || null,
      description: input.description?.trim() || describePlaylistVersion(input.reason),
      engineFamily: snapshot.data.playlist.engineFamily || engineFamilyFor(playlist.engineVersion, playlist.sourceType),
      engineVersion: snapshot.data.playlist.engineVersion,
      applicationVersion: APP_VERSION,
      snapshotSchemaVersion: snapshot.schemaVersion,
      settingsSnapshot: snapshot.data.playlist.generationSettings as unknown as Prisma.InputJsonValue,
      trackSnapshot: snapshotJson(snapshot),
      scoreSnapshot: preferences?.savePlaylistScoreSnapshots === false ? undefined : snapshot.data.scores as Prisma.InputJsonValue | undefined,
      betaMetadata: snapshot.data.playlist.betaMetadata as Prisma.InputJsonValue | undefined,
      trackCount: snapshot.data.summary.trackCount,
      durationMs: snapshot.data.summary.durationMs,
      restoredFromVersionId: input.restoredFromVersionId || null,
      smartActionId: input.smartActionId || null,
      isPinned: Boolean(input.isPinned),
      isAutomatic: input.isAutomatic !== false,
      isCurrent: true,
      syncStatus: input.syncStatus || "synced",
      snapshotSizeBytes: Buffer.byteLength(serialized, "utf8"),
    },
  });
  const identity = await tx.playlistIdentity.findUnique({ where: { playlistId: input.generatedPlaylistId } });
  if (identity?.effectiveProfileJson) {
    await tx.playlistIdentitySnapshot.create({
      data: {
        playlistIdentityId: identity.id,
        playlistVersionId: version.id,
        reason: input.reason,
        profileJson: identity.effectiveProfileJson as Prisma.InputJsonValue,
        confidenceJson: { overall: identity.confidence, state: identity.confidenceState, mood: identity.moodConfidence, energy: identity.energyConfidence, bpm: identity.bpmConfidence, artist: identity.artistConfidence, genre: identity.genreConfidence } as Prisma.InputJsonValue,
        summaryJson: { trainingSampleCount: identity.trainingSampleCount, historicalTrackCount: identity.historicalTrackCount, currentTrackCount: identity.currentTrackCount } as Prisma.InputJsonValue,
      },
    });
  }
  if (preferences?.cleanupPlaylistVersionsAutomatically) await cleanupPlaylistVersions(tx, input.generatedPlaylistId, preferences.playlistVersionRetention);
  console.info("[PlaylistVersions] version created", { playlistId: input.generatedPlaylistId, versionId: version.id, revisionNumber: version.revisionNumber, reason: input.reason, trackCount: version.trackCount, snapshotSizeBytes: version.snapshotSizeBytes });
  return version;
}

export async function createPlaylistVersion(input: CreateVersionInput) {
  return prisma.$transaction((tx) => createPlaylistVersionInTransaction(tx, input));
}

export async function ensurePlaylistBaseline(userId: string, generatedPlaylistId: string) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, select: { id: true } });
  if (!playlist) return null;
  const current = await prisma.playlistRevision.findFirst({ where: { generatedPlaylistId, isCurrent: true }, select: { id: true } });
  if (current) return current;
  return createPlaylistVersion({ generatedPlaylistId, reason: "system_migration" });
}

const summarySelect = {
  id: true, revisionNumber: true, reason: true, label: true, description: true,
  engineFamily: true, engineVersion: true, applicationVersion: true, trackCount: true,
  betaMetadata: true,
  durationMs: true, isPinned: true, isAutomatic: true, isCurrent: true, syncStatus: true,
  restoredFromVersionId: true, snapshotSizeBytes: true, createdAt: true,
} satisfies Prisma.PlaylistRevisionSelect;

export async function listPlaylistVersions(userId: string, generatedPlaylistId: string, input?: { cursor?: number; limit?: number; filter?: string }) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, select: { id: true, plexPlaylistTitle: true } });
  if (!playlist) return null;
  await ensurePlaylistBaseline(userId, generatedPlaylistId);
  const limit = Math.min(50, Math.max(1, input?.limit || 25));
  const reasonFilter: Record<string, string[]> = {
    generation: ["initial_generation"], regeneration: ["full_regeneration", "advanced_regeneration"],
    manual: ["manual_track_add", "manual_track_remove", "manual_reorder", "manual_edit", "settings_change"], restore: ["restore", "undo"],
  };
  const versions = await prisma.playlistRevision.findMany({
    where: {
      generatedPlaylistId,
      ...(input?.cursor ? { revisionNumber: { lt: input.cursor } } : {}),
      ...(input?.filter === "pinned" ? { isPinned: true } : input?.filter && reasonFilter[input.filter] ? { reason: { in: reasonFilter[input.filter] } } : {}),
    },
    orderBy: { revisionNumber: "desc" }, take: limit + 1, select: summarySelect,
  });
  const hasMore = versions.length > limit;
  const items = versions.slice(0, limit);
  return { playlist, versions: items, nextCursor: hasMore ? items.at(-1)?.revisionNumber || null : null };
}

export async function getPlaylistVersion(userId: string, generatedPlaylistId: string, versionId: string) {
  const version = await prisma.playlistRevision.findFirst({
    where: { id: versionId, generatedPlaylistId, generatedPlaylist: { userId } },
    include: { generatedPlaylist: { select: { plexPlaylistTitle: true } }, identitySnapshot: true },
  });
  if (!version) return null;
  const parsed = readPlaylistSnapshot(version.trackSnapshot, { name: version.generatedPlaylist.plexPlaylistTitle, engineVersion: version.engineVersion, settings: version.settingsSnapshot, scores: version.scoreSnapshot });
  if (parsed.error) console.warn("[PlaylistVersions] snapshot validation failed", { playlistId: generatedPlaylistId, versionId, revisionNumber: version.revisionNumber, error: parsed.error });
  const availableIds = parsed.snapshot?.data.tracks.map((track) => track.trackId).filter((id): id is string => Boolean(id)) || [];
  const available = availableIds.length ? new Set((await prisma.track.findMany({ where: { id: { in: availableIds }, library: { server: { userId } }, syncStatus: "active" }, select: { id: true } })).map((track) => track.id)) : new Set<string>();
  const snapshot = parsed.snapshot ? { ...parsed.snapshot, data: { ...parsed.snapshot.data, tracks: parsed.snapshot.data.tracks.map((track) => ({ ...track, availability: track.trackId && available.has(track.trackId) ? "available" : "track_deleted" })) } } : null;
  return { version: { ...version, trackSnapshot: undefined, settingsSnapshot: undefined, scoreSnapshot: undefined, generatedPlaylist: undefined }, snapshot, identitySnapshot: version.identitySnapshot, restorable: Boolean(snapshot), validationError: parsed.error, legacySnapshot: parsed.legacy };
}

export async function comparePlaylistVersions(userId: string, generatedPlaylistId: string, fromVersionId: string, toVersionId: string) {
  const [from, to] = await Promise.all([getPlaylistVersion(userId, generatedPlaylistId, fromVersionId), getPlaylistVersion(userId, generatedPlaylistId, toVersionId)]);
  if (!from || !to) throw new Error("Version no longer exists");
  if (!from.snapshot || !to.snapshot) throw new Error("One of these versions has an incomplete snapshot and cannot be compared.");
  const started = Date.now();
  const diff = diffPlaylistVersions({ fromVersionId, toVersionId, from: from.snapshot.data, to: to.snapshot.data });
  console.info("[PlaylistVersions] versions compared", { playlistId: generatedPlaylistId, fromVersionId, toVersionId, durationMs: Date.now() - started });
  return { from: from.version, to: to.version, diff };
}

export async function updatePlaylistVersion(userId: string, generatedPlaylistId: string, versionId: string, input: { label?: string | null; isPinned?: boolean }) {
  const owned = await prisma.playlistRevision.findFirst({ where: { id: versionId, generatedPlaylistId, generatedPlaylist: { userId } }, select: { id: true } });
  if (!owned) return null;
  return prisma.playlistRevision.update({ where: { id: versionId }, data: { ...(input.label !== undefined ? { label: input.label?.trim() || null } : {}), ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}) }, select: summarySelect });
}

export async function deletePlaylistVersion(userId: string, generatedPlaylistId: string, versionId: string) {
  const version = await prisma.playlistRevision.findFirst({ where: { id: versionId, generatedPlaylistId, generatedPlaylist: { userId } }, select: { id: true, isCurrent: true } });
  if (!version) return null;
  if (version.isCurrent) throw new Error("The current version cannot be deleted.");
  await prisma.playlistRevision.delete({ where: { id: versionId } });
  return { success: true };
}

export async function runPlaylistVersionCleanup(userId: string, generatedPlaylistId: string, keep?: number) {
  const owned = await prisma.generatedPlaylist.findFirst({ where: { id: generatedPlaylistId, userId }, select: { id: true } });
  if (!owned) return null;
  const result = await prisma.$transaction((tx) => cleanupPlaylistVersions(tx, generatedPlaylistId, keep));
  console.info("[PlaylistVersions] cleanup completed", { playlistId: generatedPlaylistId, ...result });
  return result;
}
