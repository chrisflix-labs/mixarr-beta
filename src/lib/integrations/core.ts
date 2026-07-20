import crypto from "crypto";
import fs from "fs";
import path from "path";

export const INTEGRATION_EVENTS = [
  "playlist.created", "playlist.updated", "playlist.health_changed", "playlist.reconciliation_required",
  "playlist.reconciled", "playlist.sync_failed", "playlist.deleted", "collection.created", "collection.updated",
  "collection.sync_failed", "recipe.imported", "recipe.shared", "smart_action.pending", "smart_action.completed",
  "smart_action.failed", "experiment.completed", "automation.failed", "automation.recovered", "plex.unavailable",
  "plex.recovered", "plex.failover_activated", "mount.unavailable", "mount.recovered", "integration.failed",
  "integration.recovered",
] as const;

export const API_TOKEN_SCOPES = [
  "status.read", "health.read", "playlists.read", "collections.read", "automations.read", "activity.read",
  "integrations.read", "widget.read", "home_assistant.read", "metrics.read", "recipes.read", "webhooks.manage",
  "integrations.manage",
] as const;

export type ApiTokenScope = typeof API_TOKEN_SCOPES[number];
export type AvailabilityState =
  | "AVAILABLE" | "AUTHENTICATION_FAILED" | "SERVER_UNREACHABLE" | "DNS_FAILURE" | "TIMEOUT"
  | "PLEX_STARTING" | "PLEX_DATABASE_UNAVAILABLE" | "MUSIC_LIBRARY_UNAVAILABLE" | "LIBRARY_SCANNING"
  | "STORAGE_MOUNT_UNAVAILABLE" | "PARTIAL_AVAILABILITY" | "RATE_LIMITED" | "UNKNOWN_FAILURE";

export type PlaylistExternalState = {
  itemIds: string[];
  title: string;
  summary?: string | null;
  artwork?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  updatedAt?: string | null;
  ratingKey?: string | null;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

export function playlistFingerprint(state: PlaylistExternalState) {
  const normalized = {
    itemIds: state.itemIds.map(String), title: state.title.trim(), summary: state.summary?.trim() || null,
    artwork: state.artwork || null, ownerId: state.ownerId || null, ownerName: state.ownerName || null,
    updatedAt: state.updatedAt || null, ratingKey: state.ratingKey || null,
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable(normalized))).digest("hex");
}

export function diffPlaylistState(before: PlaylistExternalState, after: PlaylistExternalState) {
  const beforeSet = new Set(before.itemIds);
  const afterSet = new Set(after.itemIds);
  const added = after.itemIds.filter((id) => !beforeSet.has(id));
  const removed = before.itemIds.filter((id) => !afterSet.has(id));
  const commonBefore = before.itemIds.filter((id) => afterSet.has(id));
  const commonAfter = after.itemIds.filter((id) => beforeSet.has(id));
  const moved = commonBefore.flatMap((id, index) => commonAfter[index] === id ? [] : [{ id, from: before.itemIds.indexOf(id), to: after.itemIds.indexOf(id) }]);
  const metadata = ["title", "summary", "artwork"]
    .flatMap((field) => before[field as keyof PlaylistExternalState] === after[field as keyof PlaylistExternalState] ? [] : [{ field, before: before[field as keyof PlaylistExternalState] ?? null, after: after[field as keyof PlaylistExternalState] ?? null }]);
  const ownerChanged = (before.ownerId || before.ownerName) !== (after.ownerId || after.ownerName);
  return { added, removed, moved, metadata, ownerChanged };
}

export function classifyPlaylistChange(before: PlaylistExternalState | null, after: PlaylistExternalState | null) {
  if (before && !after) return "PLAYLIST_DELETED";
  if (!before && after) return "PLAYLIST_RECREATED";
  if (!before || !after) return "AMBIGUOUS_EXTERNAL_CHANGE";
  if (playlistFingerprint(before) === playlistFingerprint(after)) return "NO_CHANGE";
  const diff = diffPlaylistState(before, after);
  if (diff.ownerChanged) return "OWNERSHIP_CHANGED";
  if (diff.added.length && !diff.removed.length && !diff.metadata.length) return "ITEMS_ADDED_MANUALLY";
  if (diff.removed.length && !diff.added.length && !diff.metadata.length) return "ITEMS_REMOVED_MANUALLY";
  if (!diff.added.length && !diff.removed.length && diff.moved.length && !diff.metadata.length) return "ITEM_ORDER_CHANGED_MANUALLY";
  if (!diff.added.length && !diff.removed.length && diff.metadata.length) return "METADATA_CHANGED_MANUALLY";
  return "AMBIGUOUS_EXTERNAL_CHANGE";
}

export function reconcileTrackIds(action: string, mixarrIds: string[], plexIds: string[]) {
  if (action === "KEEP_PLEX" || action === "ACCEPT_PLEX_REMOVALS" || action === "REORDER_TO_MATCH_PLEX") return [...plexIds];
  if (action === "MERGE_PLEX_ADDITIONS" || action === "MERGE_WITHOUT_REMOVING") return [...mixarrIds, ...plexIds.filter((id) => !mixarrIds.includes(id))];
  return [...mixarrIds];
}

export function classifyAvailability(error: unknown, httpStatus?: number, body = ""): AvailabilityState {
  const code = String((error as any)?.code || "").toUpperCase();
  const message = `${(error as any)?.message || ""} ${body}`.toLowerCase();
  if (httpStatus === 401 || httpStatus === 403) return "AUTHENTICATION_FAILED";
  if (httpStatus === 429) return "RATE_LIMITED";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS_FAILURE";
  if (code === "ETIMEDOUT" || code === "ECONNABORTED" || /timeout|aborted/.test(message)) return "TIMEOUT";
  if (/starting|maintenance/.test(message) || httpStatus === 503) return "PLEX_STARTING";
  if (/database.*(locked|unavailable|corrupt)/.test(message)) return "PLEX_DATABASE_UNAVAILABLE";
  if (/library.*scann/.test(message)) return "LIBRARY_SCANNING";
  if (/library.*(unavailable|missing)/.test(message)) return "MUSIC_LIBRARY_UNAVAILABLE";
  if (/mount|filesystem|storage/.test(message)) return "STORAGE_MOUNT_UNAVAILABLE";
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || /network|unreachable/.test(message)) return "SERVER_UNREACHABLE";
  return "UNKNOWN_FAILURE";
}

export function chooseFailoverServer<T extends { id: string; enabled: boolean; priority: number; availabilityState: string; role: string; failureCount: number; minimumFailures: number; failoverWritePolicy: string }>(servers: T[], operation: "read" | "write") {
  const enabled = servers.filter((server) => server.enabled).sort((a, b) => a.priority - b.priority);
  const primary = enabled.find((server) => server.role === "PRIMARY") || enabled[0];
  if (primary?.availabilityState === "AVAILABLE") return { server: primary, failedOver: false };
  if (primary && primary.failureCount < primary.minimumFailures) return { server: null, failedOver: false };
  const candidate = enabled.find((server) => server.id !== primary?.id && server.availabilityState === "AVAILABLE" && (operation === "read" || server.failoverWritePolicy === "ALLOW_WRITES"));
  return { server: candidate || null, failedOver: !!candidate };
}

export function checkMountDependency(input: { mountPath: string; markerFile?: string | null; expectedFilesystemId?: string | null; minimumEntries?: number }) {
  const resolved = path.resolve(input.mountPath);
  if (!fs.existsSync(resolved)) return { available: false, category: "PATH_MISSING", reason: "Expected mount path does not exist." };
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return { available: false, category: "NOT_DIRECTORY", reason: "Expected mount path is not a directory." };
    if (input.markerFile && !fs.existsSync(path.join(resolved, input.markerFile))) return { available: false, category: "MARKER_MISSING", reason: "The configured mount marker file is missing." };
    const entries = fs.readdirSync(resolved);
    if (entries.length < (input.minimumEntries ?? 1)) return { available: false, category: "UNEXPECTEDLY_EMPTY", reason: "The mount path is unexpectedly empty." };
    const filesystemId = `${stat.dev}`;
    if (input.expectedFilesystemId && input.expectedFilesystemId !== filesystemId) return { available: false, category: "FILESYSTEM_CHANGED", reason: "The filesystem identity changed." };
    return { available: true, category: "AVAILABLE", reason: null, filesystemId };
  } catch (error) {
    return { available: false, category: "UNREADABLE", reason: (error as Error).message };
  }
}

export function createEventEnvelope(event: typeof INTEGRATION_EVENTS[number], data: Record<string, unknown>, context: Record<string, unknown> = {}, now = new Date()) {
  return { id: `evt_${crypto.randomUUID()}`, event, version: "1", createdAt: now.toISOString(), source: "mixarr", mixarrVersion: "2.3.7", data: sanitizePayload(data), context: sanitizePayload(context) };
}

const sensitiveKey = /(token|secret|password|credential|authorization|api.?key|cookie|session|filesystem|path)/i;
export function sanitizePayload(value: unknown): any {
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (!value || typeof value !== "object") return typeof value === "string" ? value.replace(/Bearer\s+\S+/gi, "[REDACTED]") : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !sensitiveKey.test(key)).map(([key, child]) => [key, sanitizePayload(child)]));
}

export function signWebhookPayload(secret: string, timestamp: string, rawBody: string) {
  return `sha256=${crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function generateApiToken() {
  const raw = `mixarr_${crypto.randomBytes(32).toString("base64url")}`;
  return { raw, prefix: raw.slice(0, 14), hash: hashApiToken(raw) };
}

export function hashApiToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function hasRequiredScope(granted: string[], required: ApiTokenScope) {
  return granted.includes(required) || granted.includes("integrations.manage");
}

export function validatePublicDestination(raw: string, allowPrivate = false) {
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) throw new Error("Only HTTPS destinations are allowed.");
  const host = url.hostname.toLowerCase();
  const privateHost = host === "localhost" || host === "127.0.0.1" || host === "::1" || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.endsWith(".local");
  if (privateHost && !allowPrivate) throw new Error("Private-network webhook destinations are blocked.");
  if (url.username || url.password) throw new Error("Credentials in destination URLs are not allowed.");
  return url.toString();
}

export function healthState(statuses: string[]) {
  if (statuses.some((status) => status === "UNAVAILABLE" || status === "ERROR")) return "unavailable";
  if (statuses.some((status) => ["DEGRADED", "WARNING", "UNKNOWN"].includes(status))) return "degraded";
  return "healthy";
}

export function suggestPlexUserMappings(users: Array<{ id: string; username: string; email?: string | null }>, accounts: Array<{ id: string; serverId: string; username: string; email?: string | null }>) {
  return users.flatMap((user) => accounts.flatMap((account) => {
    const emailMatch = !!user.email && !!account.email && user.email.toLowerCase() === account.email.toLowerCase();
    const usernameMatch = user.username.toLowerCase() === account.username.toLowerCase();
    return emailMatch || usernameMatch ? [{ userId: user.id, plexAccountId: account.id, serverId: account.serverId, state: "SUGGESTED", confidence: emailMatch ? "HIGH" : "MEDIUM" }] : [];
  }));
}

export function preservePlaylistMetadata<T extends Record<string, any>>(current: T, itemIds: string[]) {
  return { ...current, itemIds: [...itemIds] };
}

export function retryDelayMs(attempt: number, strategy: "EXPONENTIAL" | "LINEAR" = "EXPONENTIAL", maximumMs = 300000) {
  const base = 1000;
  return Math.min(maximumMs, strategy === "LINEAR" ? base * Math.max(1, attempt) : base * 2 ** Math.max(0, attempt - 1));
}

export function destructiveSyncDecision(input: { scanning: boolean; mountAvailable: boolean; graceUntil?: Date | null; now?: Date }) {
  const now = input.now || new Date();
  if (!input.mountAvailable) return { allowed: false, state: "WAITING_FOR_MOUNT" };
  if (input.scanning) return { allowed: false, state: "WAITING_FOR_PLEX_SCAN" };
  if (input.graceUntil && input.graceUntil > now) return { allowed: false, state: "WAITING_FOR_PLEX_SCAN_GRACE" };
  return { allowed: true, state: "AVAILABLE" };
}

export function normalizeTautulliSignal(row: Record<string, any>, retentionDays = 90) {
  const durationMs = Math.max(0, Number(row.duration || row.media_duration || 0) * 1000);
  const playedMs = Math.max(0, Number(row.play_duration || row.view_offset || 0) * 1000);
  const completionPercentage = durationMs > 0 ? Math.min(1, playedMs / durationMs) : null;
  const behavior = row.was_repeated || Number(row.play_count) > 1 ? "REPEAT" : completionPercentage === null ? "PLAY" : completionPercentage < 0.35 ? "SKIP" : completionPercentage >= 0.9 ? "COMPLETED" : "EARLY_STOP";
  const playedAt = new Date(Number(row.date || row.started || Date.now() / 1000) * 1000);
  return { externalEventId: String(row.row_id || row.id || `${row.rating_key}:${playedAt.getTime()}`), trackRatingKey: String(row.rating_key || row.grandparent_rating_key || ""), plexUserIdHash: row.user_id || row.user ? crypto.createHash("sha256").update(String(row.user_id || row.user)).digest("hex") : null, playedAt, durationMs: durationMs || null, completionPercentage, behavior, recentPlayCount: Math.max(1, Number(row.play_count || 1)), privacyCategory: row.player ? "PLAYER_REDACTED" : null, expiresAt: new Date(playedAt.getTime() + retentionDays * 86400000) };
}
