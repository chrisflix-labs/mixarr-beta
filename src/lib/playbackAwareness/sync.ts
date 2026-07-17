import axios from "axios";
import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { acquireJobLock, attachJobHistoryToLock, setJobPhase } from "../jobLock";
import { safeFinishJobHistory, safeRecordJobHistory, safeStartJobHistory } from "../jobHistory";
import { normalizePlaybackEvent } from "./normalization";
import { ensurePlaybackSettings, rebuildPlaybackProfilesForUser } from "./service";

const HISTORY_PAGE_SIZE = 250;
const LOOKUP_BATCH = 500;
const MAX_PAGES_PER_ACCOUNT = 4_000;

function plexHeaders(token: string) {
  return {
    "X-Plex-Token": token,
    "X-Plex-Client-Identifier": (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr-default-client").trim(),
    "X-Plex-Product": (process.env.PLEX_PRODUCT_NAME || "Mixarr").trim(),
    "X-Plex-Version": "2.1.9",
    Accept: "application/json",
  };
}

function rowsFromContainer(payload: any, key: string) {
  const value = payload?.MediaContainer?.[key] ?? payload?.[key] ?? [];
  return Array.isArray(value) ? value : value ? [value] : [];
}

export class PlexPlaybackHistoryClient {
  constructor(private server: { uri: string; accessToken: string }) {}

  async listAccounts(owner: { plexId: number; username: string; email: string | null; thumb: string | null }) {
    try {
      const response = await axios.get(`${this.server.uri}/accounts`, { headers: plexHeaders(this.server.accessToken), timeout: 20_000 });
      const accounts = rowsFromContainer(response.data, "Account");
      if (accounts.length) return accounts.map((account: any) => ({
        plexUserId: String(account.id ?? account.accountID ?? account.key),
        username: String(account.name ?? account.title ?? account.username ?? `Plex user ${account.id}`),
        email: account.email ? String(account.email) : null,
        thumb: account.thumb ? String(account.thumb) : null,
        accountType: account.autoSelectAudio ? "managed" : "account",
      }));
    } catch (error) {
      console.warn("[PlaybackHistorySync] Plex account discovery unavailable; using the server owner only", {
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return [{
      plexUserId: String(owner.plexId),
      username: owner.username,
      email: owner.email,
      thumb: owner.thumb,
      accountType: "owner",
    }];
  }

  async historyPage(input: { plexUserId: string; start: number; since?: Date | null }) {
    const response = await axios.get(`${this.server.uri}/status/sessions/history/all`, {
      headers: {
        ...plexHeaders(this.server.accessToken),
        "X-Plex-Container-Start": input.start,
        "X-Plex-Container-Size": HISTORY_PAGE_SIZE,
      },
      params: {
        type: 10,
        sort: "viewedAt:asc",
        accountID: input.plexUserId,
        ...(input.since ? { "viewedAt>": Math.floor(input.since.getTime() / 1000) } : {}),
      },
      timeout: 30_000,
    });
    const container = response.data?.MediaContainer || {};
    return {
      items: rowsFromContainer(response.data, "Metadata"),
      totalSize: Number(container.totalSize ?? container.size ?? 0),
      size: Number(container.size ?? rowsFromContainer(response.data, "Metadata").length),
    };
  }
}

async function matchAndPersistEvents(server: any, normalized: ReturnType<typeof normalizePlaybackEvent>[]) {
  const events = normalized.filter(Boolean) as NonNullable<ReturnType<typeof normalizePlaybackEvent>>[];
  if (!events.length) return { imported: 0, unmatched: 0, newest: null as Date | null, oldest: null as Date | null };
  const libraries = await prisma.library.findMany({ where: { serverId: server.id }, select: { id: true, plexId: true } });
  const libraryByPlex = new Map(libraries.map((library) => [library.plexId, library.id]));
  const ratingKeys = Array.from(new Set(events.map((event) => event.plexRatingKey).filter((value): value is string => Boolean(value))));
  const tracks: Array<{ id: string; ratingKey: string; library: { plexId: string } }> = [];
  for (let index = 0; index < ratingKeys.length; index += LOOKUP_BATCH) {
    tracks.push(...await prisma.track.findMany({
      where: { library: { serverId: server.id }, ratingKey: { in: ratingKeys.slice(index, index + LOOKUP_BATCH) } },
      select: { id: true, ratingKey: true, library: { select: { plexId: true } } },
    }));
  }
  const exact = new Map(tracks.map((track) => [`${track.library.plexId}:${track.ratingKey}`, track.id]));
  const byRating = new Map<string, string | null>();
  for (const track of tracks) {
    const existing = byRating.get(track.ratingKey);
    byRating.set(track.ratingKey, existing === undefined ? track.id : existing === track.id ? track.id : null);
  }
  const rows = events.map((event) => {
    const libraryId = event.plexLibraryId ? libraryByPlex.get(event.plexLibraryId) || null : null;
    const trackId = event.plexRatingKey
      ? exact.get(`${event.plexLibraryId}:${event.plexRatingKey}`) || byRating.get(event.plexRatingKey) || null
      : null;
    const unmatchedReason = trackId ? null : !event.plexRatingKey ? "missing_rating_key" : libraryId ? "track_not_found" : "library_not_configured";
    return {
      importKey: event.importKey,
      serverId: server.id,
      libraryId,
      plexUserId: event.plexUserId,
      plexUsername: event.plexUsername,
      trackId,
      plexRatingKey: event.plexRatingKey,
      playedAt: event.playedAt,
      durationMs: event.durationMs,
      viewOffsetMs: event.viewOffsetMs,
      completionPercent: event.completionPercent,
      completed: event.completed,
      skipped: event.skipped,
      playCountContribution: event.playCountContribution,
      source: event.source,
      rawEventType: event.rawEventType,
      unmatchedReason,
      rawJson: event.raw as Prisma.InputJsonValue,
    };
  });
  const result = await prisma.plexPlaybackEvent.createMany({ data: rows, skipDuplicates: true });
  return {
    imported: result.count,
    unmatched: rows.filter((row) => row.unmatchedReason).length,
    newest: rows.reduce<Date | null>((latest, row) => !latest || row.playedAt > latest ? row.playedAt : latest, null),
    oldest: rows.reduce<Date | null>((oldest, row) => !oldest || row.playedAt < oldest ? row.playedAt : oldest, null),
  };
}

export async function syncPlaybackHistoryForServer(input: { serverId: string; mode?: "incremental" | "full" }) {
  const startedAt = Date.now();
  const mode = input.mode || "incremental";
  const server = await prisma.server.findUnique({
    where: { id: input.serverId },
    include: { user: { select: { id: true, plexId: true, username: true, email: true, thumb: true } }, playbackSyncState: true },
  });
  if (!server) throw new Error("Plex server was not found");
  const state = await prisma.playbackSyncState.upsert({
    where: { serverId: server.id },
    create: { serverId: server.id, currentState: "syncing", lastAttemptedSyncAt: new Date(), syncMode: mode },
    update: { currentState: "syncing", lastAttemptedSyncAt: new Date(), syncMode: mode, errorMessage: null },
  });
  const client = new PlexPlaybackHistoryClient(server);
  let imported = 0;
  let unmatched = 0;
  let warnings = 0;
  let newest = state.lastImportedPlexHistoryAt;
  let oldest = state.oldestAvailablePlexHistoryAt;
  try {
    const accounts = await client.listAccounts(server.user);
    for (const account of accounts) {
      await prisma.plexAccount.upsert({
        where: { serverId_plexUserId: { serverId: server.id, plexUserId: account.plexUserId } },
        create: { serverId: server.id, ...account },
        update: { username: account.username, email: account.email, thumb: account.thumb, accountType: account.accountType, lastSeenAt: new Date() },
      });
      await prisma.plexUserMapping.updateMany({
        where: { serverId: server.id, plexUserId: account.plexUserId },
        data: { plexUsername: account.username },
      });
    }
    const setting = await ensurePlaybackSettings(server.userId);
    const since = mode === "incremental" && state.lastImportedPlexHistoryAt
      ? new Date(state.lastImportedPlexHistoryAt.getTime() - 5 * 60_000)
      : null;
    for (const account of accounts) {
      let start = 0;
      for (let page = 0; page < MAX_PAGES_PER_ACCOUNT; page += 1) {
        const response = await client.historyPage({ plexUserId: account.plexUserId, start, since });
        const normalized = response.items.map((item: any) => normalizePlaybackEvent({
          serverId: server.id,
          plexUserId: account.plexUserId,
          plexUsername: account.username,
          item,
          completionThreshold: setting.completionThreshold,
          skipThreshold: setting.skipThreshold,
          minimumSkipDurationMs: setting.minimumSkipDurationMs,
        })).filter(Boolean);
        const persisted = await matchAndPersistEvents(server, normalized);
        imported += persisted.imported;
        unmatched += persisted.unmatched;
        if (persisted.newest && (!newest || persisted.newest > newest)) newest = persisted.newest;
        if (persisted.oldest && (!oldest || persisted.oldest < oldest)) oldest = persisted.oldest;
        start += response.size || response.items.length;
        if (!response.items.length || response.items.length < HISTORY_PAGE_SIZE || (response.totalSize && start >= response.totalSize)) break;
      }
    }
    const retentionThreshold = new Date(Date.now() - setting.historyRetentionDays * 86_400_000);
    const pruned = await prisma.plexPlaybackEvent.deleteMany({ where: { serverId: server.id, playedAt: { lt: retentionThreshold } } });
    if (pruned.count) warnings += 1;
    const mappings = await prisma.plexUserMapping.findMany({ where: { serverId: server.id, enabled: true }, select: { userId: true } });
    let profilesUpdated = 0;
    for (const userId of Array.from(new Set(mappings.map((mapping) => mapping.userId)))) {
      const rebuilt = await rebuildPlaybackProfilesForUser(userId);
      profilesUpdated += rebuilt.profilesUpdated;
    }
    const durationMs = Date.now() - startedAt;
    const nextScheduledSyncAt = new Date(Date.now() + setting.syncIntervalHours * 3_600_000);
    await prisma.playbackSyncState.update({
      where: { serverId: server.id },
      data: {
        currentState: warnings ? "warning" : "idle",
        lastSuccessfulSyncAt: new Date(),
        lastImportedPlexHistoryAt: newest,
        importedEventCount: { increment: imported },
        updatedProfileCount: profilesUpdated,
        warningCount: warnings,
        errorMessage: null,
        syncDurationMs: durationMs,
        oldestAvailablePlexHistoryAt: oldest,
        discoveredUserCount: accounts.length,
        unmatchedEventCount: unmatched,
        nextScheduledSyncAt,
      },
    });
    console.log(`[PlaybackHistorySync] Imported events=${imported} users=${accounts.length} unmatchedTracks=${unmatched}`);
    console.log(`[PlaybackHistorySync] Updated profiles=${profilesUpdated} warnings=${warnings}`);
    console.log(`[PlaybackHistorySync] Completed durationMs=${durationMs}`);
    return {
      attempted: imported + unmatched,
      processed: imported,
      skipped: 0,
      failed: 0,
      status: warnings || unmatched ? "warning" : "completed",
      message: `Playback history sync imported ${imported.toLocaleString()} events and updated ${profilesUpdated.toLocaleString()} profiles.`,
      metadata: { serverId: server.id, mode, imported, profilesUpdated, unmatched, warnings, discoveredUsers: accounts.length, durationMs, pruned: pruned.count },
    };
  } catch (error) {
    await prisma.playbackSyncState.update({
      where: { serverId: server.id },
      data: { currentState: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown playback sync error", syncDurationMs: Date.now() - startedAt },
    });
    throw error;
  }
}

export async function startPlaybackHistorySync(input: {
  serverId: string;
  userId?: string | null;
  source?: "manual" | "scheduled" | "retry" | "system";
  mode?: "incremental" | "full";
  background?: boolean;
}) {
  const source = input.source || "manual";
  const lock = acquireJobLock({
    name: "Plex playback history sync",
    keys: ["playback-history-sync", `playback-history-sync:${input.serverId}`],
    source,
  });
  if (!lock.acquired) {
    await safeRecordJobHistory({
      userId: input.userId,
      type: "playback_history",
      name: "Plex playback history sync",
      status: "blocked",
      trigger: source,
      summary: `Playback history sync skipped because ${lock.activeJob.name} is already running.`,
      counts: { attempted: 1, skipped: 1 },
    });
    return { started: false as const, activeJob: lock.activeJob };
  }
  const run = async () => {
    const history = await safeStartJobHistory({
      userId: input.userId,
      type: "playback_history",
      name: "Plex playback history sync",
      trigger: source,
      metadata: { serverId: input.serverId, mode: input.mode || "incremental", lockKey: lock.job.lockKey },
      lockKey: lock.job.lockKey,
      workerId: lock.job.workerId,
    });
    attachJobHistoryToLock(lock.job, history, "playback_history");
    try {
      setJobPhase(lock.job, "Importing paginated Plex history");
      const result = await syncPlaybackHistoryForServer({ serverId: input.serverId, mode: input.mode });
      await safeFinishJobHistory({
        job: history,
        status: result.status === "warning" ? "completed_with_warnings" : "completed",
        result,
        summary: result.message,
        metadata: result.metadata,
      });
      return result;
    } catch (error) {
      await safeFinishJobHistory({ job: history, status: "failed", error, summary: "Plex playback history sync failed. Existing playback data was preserved." });
      throw error;
    } finally {
      lock.release();
    }
  };
  if (input.background !== false) {
    void run().catch((error) => console.error("[PlaybackHistorySync] Background job failed", error));
    return { started: true as const, job: lock.job };
  }
  return { started: true as const, job: lock.job, result: await run() };
}
