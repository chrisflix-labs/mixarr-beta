import { createHash } from "crypto";
import { z } from "zod";
import prisma from "../prisma";
import { decryptSecret, encryptSecret, isSecretEncryptionConfigured, maskSecret } from "../secretStorage";
import { analyzePlaylistHealth } from "./core";
import { DEFAULT_PLAYLIST_HEALTH_THRESHOLDS, type PlaylistHealthResult, type PlaylistHealthSeverity } from "./types";

const severityRank: Record<string, number> = { INFO: 0, WARNING: 1, ERROR: 2, CRITICAL: 3 };
const settingsSchema = z.object({
  enabled: z.boolean().optional(), analyzeDuringNightlySync: z.boolean().optional(),
  staleAfterDays: z.coerce.number().int().min(1).max(365).optional(),
  artistConcentrationPercent: z.coerce.number().int().min(5).max(100).optional(), albumConcentrationPercent: z.coerce.number().int().min(5).max(100).optional(),
  excessiveBpmJump: z.coerce.number().int().min(5).max(120).optional(), moodConflictDelta: z.coerce.number().min(.1).max(1).optional(),
  metadataDeclinePercent: z.coerce.number().int().min(1).max(100).optional(), minimumAlertSeverity: z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]).optional(),
  inAppNotifications: z.boolean().optional(), discordNotifications: z.boolean().optional(), webhookNotifications: z.boolean().optional(),
  discordWebhookUrl: z.string().trim().max(2000).optional(), webhookUrl: z.string().trim().max(2000).optional(), clearDiscordWebhook: z.boolean().optional(), clearWebhookUrl: z.boolean().optional(),
}).strict();

export class PlaylistHealthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

function safeHttpsUrl(raw: string, channel: "discord" | "webhook") {
  let url: URL;
  try { url = new URL(raw); } catch { throw new PlaylistHealthError("INVALID_ENDPOINT", "Notification endpoint must be a valid HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new PlaylistHealthError("INVALID_ENDPOINT", "Notification endpoints must use HTTPS and cannot include credentials.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1") {
    throw new PlaylistHealthError("INVALID_ENDPOINT", "Private and local notification endpoints are not allowed.");
  }
  if (channel === "discord" && (!(["discord.com", "discordapp.com"].includes(host)) || !url.pathname.startsWith("/api/webhooks/"))) {
    throw new PlaylistHealthError("INVALID_DISCORD_WEBHOOK", "Use a Discord HTTPS webhook URL from discord.com/api/webhooks.");
  }
  return url.toString();
}

function publicSettings(row: any) {
  return {
    ...row, discordWebhookEncrypted: undefined, webhookUrlEncrypted: undefined,
    discordWebhookConfigured: Boolean(row.discordWebhookEncrypted), webhookUrlConfigured: Boolean(row.webhookUrlEncrypted),
    discordWebhookMasked: row.discordWebhookEncrypted ? maskSecret("saved") : null, webhookUrlMasked: row.webhookUrlEncrypted ? maskSecret("saved") : null,
    encryptionConfigured: isSecretEncryptionConfigured(),
  };
}

export async function getPlaylistHealthSettings(userId: string) {
  const row = await prisma.playlistHealthSetting.upsert({ where: { userId }, update: {}, create: { userId } });
  return publicSettings(row);
}

export async function updatePlaylistHealthSettings(userId: string, input: unknown) {
  const parsed = settingsSchema.parse(input);
  const data: Record<string, unknown> = { ...parsed };
  delete data.discordWebhookUrl; delete data.webhookUrl; delete data.clearDiscordWebhook; delete data.clearWebhookUrl;
  if ((parsed.discordWebhookUrl || parsed.webhookUrl) && !isSecretEncryptionConfigured()) throw new PlaylistHealthError("ENCRYPTION_REQUIRED", "Configure MIXARR_SECRET_KEY before saving notification endpoints.");
  if (parsed.discordWebhookUrl) data.discordWebhookEncrypted = encryptSecret(safeHttpsUrl(parsed.discordWebhookUrl, "discord"));
  if (parsed.webhookUrl) data.webhookUrlEncrypted = encryptSecret(safeHttpsUrl(parsed.webhookUrl, "webhook"));
  if (parsed.clearDiscordWebhook) { data.discordWebhookEncrypted = null; data.discordNotifications = false; }
  if (parsed.clearWebhookUrl) { data.webhookUrlEncrypted = null; data.webhookNotifications = false; }
  const row = await prisma.playlistHealthSetting.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  return publicSettings(row);
}

function fingerprint(result: PlaylistHealthResult) {
  return createHash("sha256").update(JSON.stringify({ score: result.overallScore, checks: result.checks.map((item) => [item.type, item.severity, item.value]) })).digest("hex");
}

async function deliverNotification(alert: any, settings: any, playlistName: string) {
  if (severityRank[alert.severity] < severityRank[settings.minimumAlertSeverity]) return;
  const destinations: Array<{ channel: string; encrypted: string | null; body: unknown }> = [];
  const common = { event: "playlist_health_alert", alert: { id: alert.id, type: alert.alertType, severity: alert.severity, title: alert.title, message: alert.message }, playlist: { id: alert.playlistId, name: playlistName }, url: `/playlist-health?playlistId=${alert.playlistId}` };
  if (settings.discordNotifications && settings.discordWebhookEncrypted) destinations.push({ channel: "DISCORD", encrypted: settings.discordWebhookEncrypted, body: { content: `**${alert.severity}: ${alert.title}**\n${playlistName}: ${alert.message}`.slice(0, 2000) } });
  if (settings.webhookNotifications && settings.webhookUrlEncrypted) destinations.push({ channel: "WEBHOOK", encrypted: settings.webhookUrlEncrypted, body: common });
  for (const destination of destinations) {
    let status = "FAILED"; let responseCode: number | null = null; let error: string | null = null;
    try {
      const endpoint = decryptSecret(destination.encrypted!);
      safeHttpsUrl(endpoint, destination.channel === "DISCORD" ? "discord" : "webhook");
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mixarr-Playlist-Health/2.2.9" }, body: JSON.stringify(destination.body), signal: AbortSignal.timeout(8000), redirect: "error" });
      responseCode = response.status; status = response.ok ? "DELIVERED" : "FAILED"; if (!response.ok) error = `Endpoint returned HTTP ${response.status}`;
    } catch (caught) { error = caught instanceof Error ? caught.message.slice(0, 500) : "Notification delivery failed"; }
    await prisma.playlistHealthNotificationDelivery.create({ data: { alertId: alert.id, channel: destination.channel, status, responseCode, error } });
  }
}

async function persistResult(userId: string, result: PlaylistHealthResult, settings: any) {
  const snapshot = await prisma.playlistHealthSnapshot.create({ data: {
    userId, playlistId: result.playlistId, overallScore: result.overallScore, status: result.status,
    warningCount: result.checks.filter((item) => item.severity === "WARNING").length,
    criticalCount: result.checks.filter((item) => ["ERROR", "CRITICAL"].includes(item.severity)).length,
    metadataConfidence: result.metadataConfidence, identityScore: result.identityScore, checksJson: result as any, fingerprint: fingerprint(result),
  } });
  const activeTypes = new Set(result.checks.map((item) => item.type));
  for (const item of result.checks) {
    const existing = await prisma.playlistHealthAlert.findUnique({ where: { userId_playlistId_alertType: { userId, playlistId: result.playlistId, alertType: item.type } } });
    const shouldNotify = !existing || existing.status === "RESOLVED" || severityRank[item.severity] > severityRank[existing.severity];
    const alert = await prisma.playlistHealthAlert.upsert({
      where: { userId_playlistId_alertType: { userId, playlistId: result.playlistId, alertType: item.type } },
      create: { userId, playlistId: result.playlistId, snapshotId: snapshot.id, alertType: item.type, severity: item.severity, title: item.title, message: item.message, detailsJson: (item.details || {}) as any },
      update: { snapshotId: snapshot.id, severity: item.severity, status: existing?.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : "OPEN", title: item.title, message: item.message, detailsJson: (item.details || {}) as any, lastDetectedAt: new Date(), occurrenceCount: { increment: 1 }, ...(existing?.status === "RESOLVED" ? { resolvedAt: null, resolutionNote: null, acknowledgedAt: null, acknowledgedBy: null } : {}) },
    });
    if (!existing || existing.status === "RESOLVED" || existing.severity !== item.severity) await prisma.playlistHealthAlertEvent.create({ data: { alertId: alert.id, eventType: !existing ? "DETECTED" : existing.status === "RESOLVED" ? "REOPENED" : "SEVERITY_CHANGED", previousStatus: existing?.status, newStatus: alert.status, detailsJson: { severity: item.severity } } });
    if (shouldNotify) await deliverNotification(alert, settings, result.playlistName);
  }
  const resolved = await prisma.playlistHealthAlert.findMany({ where: { userId, playlistId: result.playlistId, status: { in: ["OPEN", "ACKNOWLEDGED"] }, alertType: { notIn: Array.from(activeTypes) } } });
  for (const alert of resolved) {
    await prisma.$transaction([
      prisma.playlistHealthAlert.update({ where: { id: alert.id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolutionNote: "Automatically resolved by a healthy analysis." } }),
      prisma.playlistHealthAlertEvent.create({ data: { alertId: alert.id, eventType: "AUTO_RESOLVED", previousStatus: alert.status, newStatus: "RESOLVED", note: "The condition was not present in the latest analysis." } }),
    ]);
  }
  return snapshot;
}

export async function analyzePlaylist(userId: string, playlistId: string) {
  const settings = await prisma.playlistHealthSetting.upsert({ where: { userId }, update: {}, create: { userId } });
  if (!settings.enabled) throw new PlaylistHealthError("MONITORING_DISABLED", "Playlist health monitoring is disabled.", 409);
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, userId }, include: { tracks: { orderBy: { position: "asc" } }, identity: true } });
  if (!playlist) throw new PlaylistHealthError("NOT_FOUND", "Playlist not found.", 404);
  const trackIds = playlist.tracks.map((track) => track.trackId).filter((id): id is string => Boolean(id));
  const libraryTracks = await prisma.track.findMany({ where: { id: { in: trackIds } }, include: { artist: { select: { id: true, title: true } }, album: { select: { id: true, title: true } }, audioFeature: true, tags: { select: { name: true, type: true } } } });
  const byId = new Map(libraryTracks.map((track) => [track.id, track]));
  const previous = await prisma.playlistHealthSnapshot.findFirst({ where: { userId, playlistId }, orderBy: { analyzedAt: "desc" } });
  const failedActivities = await prisma.automationActivity.findMany({ where: { userId, generatedPlaylistId: playlistId, status: { in: ["failed", "FAILED", "error", "ERROR"] }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 10 });
  const profile = playlist.identity?.effectiveProfileJson as any;
  const result = analyzePlaylistHealth({
    playlist: { id: playlist.id, name: playlist.plexPlaylistTitle, plexPlaylistRatingKey: playlist.plexPlaylistRatingKey, serverId: playlist.serverId, expectedTrackCount: playlist.trackCount, lastChangedAt: playlist.lastRegeneratedAt || playlist.lastGeneratedAt || playlist.updatedAt },
    tracks: playlist.tracks.map((row) => {
      const track = row.trackId ? byId.get(row.trackId) : null;
      const feature = track?.audioFeature;
      return { id: row.id, trackId: row.trackId, ratingKey: row.plexTrackRatingKey, title: row.title, artistId: track?.artistId, artist: track?.artist.title || row.artist, albumId: track?.albumId, album: track?.album.title || row.album, bpm: track?.effectiveBpm ?? track?.bpm ?? feature?.tempo, mood: feature?.effectiveMood ?? feature?.apiMood ?? feature?.valence, moodTags: track?.tags.filter((tag) => tag.type.toLowerCase() === "mood").map((tag) => tag.name) || [], energy: feature?.effectiveEnergy ?? feature?.energy, metadataConfidence: feature?.audioFeatureConfidence ?? feature?.confidence ?? track?.bpmConfidence, syncStatus: track?.syncStatus, localFileStatus: track?.localFileStatus, present: Boolean(track), position: row.position };
    }),
    thresholds: { staleAfterDays: settings.staleAfterDays, artistConcentrationPercent: settings.artistConcentrationPercent, albumConcentrationPercent: settings.albumConcentrationPercent, excessiveBpmJump: settings.excessiveBpmJump, moodConflictDelta: settings.moodConflictDelta, metadataDeclinePercent: settings.metadataDeclinePercent },
    previousMetadataConfidence: previous?.metadataConfidence,
    identityProfile: playlist.identity ? { confidence: playlist.identity.confidence, averageBpm: profile?.averageBpm, bpmRange: profile?.bpmRange, averageEnergy: profile?.averageEnergy, energyRange: profile?.energyRange, moodDistribution: profile?.moodDistribution } : null,
    failedAutomation: failedActivities.length ? { count: failedActivities.length, latestMessage: failedActivities[0].error || failedActivities[0].summary } : null,
  });
  await persistResult(userId, result, settings);
  if (!previous || previous.status !== result.status) {
    const { emitIntegrationEvent } = await import("../integrations/service");
    await emitIntegrationEvent("playlist.health_changed", { playlist: { id: playlist.id, title: playlist.plexPlaylistTitle }, previousStatus: previous?.status || null, status: result.status, score: result.overallScore }, { actorType: "system" }, `playlist.health_changed:${playlist.id}:${result.status}:${result.overallScore}`);
  }
  return result;
}

export async function analyzeUserPlaylists(userId: string, options?: { limit?: number; playlistId?: string }) {
  const ids = await prisma.generatedPlaylist.findMany({ where: { userId, ...(options?.playlistId ? { id: options.playlistId } : {}) }, select: { id: true }, orderBy: { updatedAt: "desc" }, take: Math.min(500, Math.max(1, options?.limit || 100)) });
  const results: PlaylistHealthResult[] = []; const errors: Array<{ playlistId: string; error: string }> = [];
  for (const row of ids) { try { results.push(await analyzePlaylist(userId, row.id)); } catch (error) { errors.push({ playlistId: row.id, error: error instanceof Error ? error.message : "Analysis failed" }); } }
  return { analyzed: results.length, failed: errors.length, results, errors };
}

export async function runPlaylistHealthBatch(limitPerUser = 100) {
  const users = await prisma.user.findMany({
    where: { generatedPlaylists: { some: {} }, OR: [{ playlistHealthSetting: { is: null } }, { playlistHealthSetting: { is: { enabled: true, analyzeDuringNightlySync: true } } }] },
    select: { id: true },
  });
  const runs = []; for (const user of users) runs.push({ userId: user.id, ...(await analyzeUserPlaylists(user.id, { limit: limitPerUser })) });
  return runs;
}

export async function getPlaylistHealthDashboard(userId: string) {
  const playlists = await prisma.generatedPlaylist.findMany({ where: { userId }, select: { id: true, plexPlaylistTitle: true, trackCount: true, healthSnapshots: { orderBy: { analyzedAt: "desc" }, take: 1 } }, orderBy: { plexPlaylistTitle: "asc" } });
  const [openAlertRows, acknowledgedAlerts] = await Promise.all([
    prisma.playlistHealthAlert.findMany({ where: { userId, status: "OPEN" }, orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }], include: { playlist: { select: { plexPlaylistTitle: true } } } }),
    prisma.playlistHealthAlert.count({ where: { userId, status: "ACKNOWLEDGED" } }),
  ]);
  const openAlerts = openAlertRows.sort((left, right) => severityRank[right.severity] - severityRank[left.severity] || right.lastDetectedAt.getTime() - left.lastDetectedAt.getTime());
  const items = playlists.map((playlist) => ({ id: playlist.id, name: playlist.plexPlaylistTitle, trackCount: playlist.trackCount, health: playlist.healthSnapshots[0] || null, openAlerts: openAlerts.filter((alert) => alert.playlistId === playlist.id).length }));
  const scored = items.filter((item) => item.health);
  return { summary: { monitored: scored.length, unmonitored: items.length - scored.length, averageScore: scored.length ? Math.round(scored.reduce((sum, item) => sum + Number(item.health?.overallScore || 0), 0) / scored.length) : null, healthy: scored.filter((item) => Number(item.health?.overallScore) >= 75).length, attention: scored.filter((item) => Number(item.health?.overallScore) < 75).length, openAlerts: openAlerts.length, criticalAlerts: openAlerts.filter((alert) => ["ERROR", "CRITICAL"].includes(alert.severity)).length, acknowledgedAlerts }, playlists: items, alerts: openAlerts.slice(0, 50) };
}

export async function getPlaylistHealthDetail(userId: string, playlistId: string) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, userId }, select: { id: true, plexPlaylistTitle: true, trackCount: true, healthSnapshots: { orderBy: { analyzedAt: "desc" }, take: 30 }, healthAlerts: { orderBy: { lastDetectedAt: "desc" }, include: { events: { orderBy: { createdAt: "desc" }, take: 25 }, deliveries: { orderBy: { attemptedAt: "desc" }, take: 10 } } } } });
  if (!playlist) throw new PlaylistHealthError("NOT_FOUND", "Playlist not found.", 404);
  return playlist;
}

export async function listPlaylistHealthAlerts(userId: string, options?: { status?: string; severity?: string; playlistId?: string }) {
  return prisma.playlistHealthAlert.findMany({ where: { userId, ...(options?.status ? { status: options.status } : {}), ...(options?.severity ? { severity: options.severity } : {}), ...(options?.playlistId ? { playlistId: options.playlistId } : {}) }, orderBy: [{ lastDetectedAt: "desc" }], include: { playlist: { select: { plexPlaylistTitle: true } }, events: { orderBy: { createdAt: "desc" }, take: 10 } }, take: 500 });
}

export async function transitionPlaylistHealthAlert(userId: string, alertId: string, action: "ACKNOWLEDGE" | "RESOLVE", note?: string) {
  const alert = await prisma.playlistHealthAlert.findFirst({ where: { id: alertId, userId } });
  if (!alert) throw new PlaylistHealthError("NOT_FOUND", "Alert not found.", 404);
  if (action === "ACKNOWLEDGE" && alert.status === "RESOLVED") throw new PlaylistHealthError("INVALID_TRANSITION", "Resolved alerts cannot be acknowledged.", 409);
  const status = action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "RESOLVED";
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.playlistHealthAlert.update({ where: { id: alert.id }, data: action === "ACKNOWLEDGE" ? { status, acknowledgedAt: new Date(), acknowledgedBy: userId } : { status, resolvedAt: new Date(), resolutionNote: note?.slice(0, 1000) || "Resolved by user." } });
    await tx.playlistHealthAlertEvent.create({ data: { alertId: alert.id, actorUserId: userId, eventType: action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "RESOLVED", previousStatus: alert.status, newStatus: status, note: note?.slice(0, 1000) } });
    return next;
  });
  return updated;
}

export const playlistHealthDefaults = DEFAULT_PLAYLIST_HEALTH_THRESHOLDS;
export function meetsMinimumSeverity(severity: PlaylistHealthSeverity, minimum: PlaylistHealthSeverity) { return severityRank[severity] >= severityRank[minimum]; }
