import crypto from "crypto";
import prisma from "../prisma";
import { decryptSecret, encryptSecret, isSecretEncryptionConfigured } from "../secretStorage";
import { sanitizeErrorText } from "../supportRedaction";
import { APP_VERSION } from "../appVersion";
import {
  API_TOKEN_SCOPES, ApiTokenScope, INTEGRATION_EVENTS, checkMountDependency, classifyAvailability,
  classifyPlaylistChange, createEventEnvelope, diffPlaylistState, generateApiToken, hasRequiredScope,
  hashApiToken, playlistFingerprint, sanitizePayload, signWebhookPayload, validatePublicDestination,
} from "./core";

const db = prisma as any;
const globalRateLimits = globalThis as typeof globalThis & { __mixarrApiRateLimits?: Map<string, { windowStartedAt: number; count: number }> };
const apiRateLimits = globalRateLimits.__mixarrApiRateLimits || new Map<string, { windowStartedAt: number; count: number }>();
globalRateLimits.__mixarrApiRateLimits = apiRateLimits;

export class IntegrationError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

function jsonObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function jsonArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export function serverAccessToken(server: { accessToken?: string | null; accessTokenEncrypted?: string | null }) {
  if (server.accessTokenEncrypted) return decryptSecret(server.accessTokenEncrypted);
  if (server.accessToken) return server.accessToken;
  throw new IntegrationError("PLEX_TOKEN_MISSING", "The Plex server has no authentication token.", 409);
}

export async function migrateLegacyPlexSecret(serverId: string) {
  const server = await db.server.findUnique({ where: { id: serverId }, select: { accessToken: true, accessTokenEncrypted: true } });
  if (!server?.accessToken || server.accessTokenEncrypted || !isSecretEncryptionConfigured()) return false;
  await db.server.update({ where: { id: serverId }, data: { accessTokenEncrypted: encryptSecret(server.accessToken) } });
  return true;
}

async function plexRequest(server: any, pathname: string, init: RequestInit = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(new URL(pathname, server.uri.endsWith("/") ? server.uri : `${server.uri}/`), {
      ...init, signal: controller.signal, cache: "no-store",
      headers: { Accept: "application/json", "X-Plex-Token": serverAccessToken(server), "X-Plex-Client-Identifier": process.env.PLEX_CLIENT_IDENTIFIER || "mixarr", ...(init.headers || {}) },
    });
    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
    if (!response.ok) throw Object.assign(new Error(`Plex returned HTTP ${response.status}.`), { httpStatus: response.status, responseBody: text.slice(0, 500) });
    return { data, latencyMs: Date.now() - started, status: response.status };
  } finally { clearTimeout(timer); }
}

function plexRows(data: any, key: "Directory" | "Metadata") {
  const rows = data?.MediaContainer?.[key];
  return Array.isArray(rows) ? rows : [];
}

export async function testPlexServer(serverId: string, userId?: string | null) {
  const server = await db.server.findFirst({ where: { id: serverId, ...(userId ? { userId } : {}) }, include: { libraries: true } });
  if (!server) throw new IntegrationError("PLEX_SERVER_NOT_FOUND", "Plex server not found.", 404);
  const started = Date.now();
  const results: Array<{ key: string; label: string; status: string; durationMs: number; message: string }> = [];
  const run = async (key: string, label: string, fn: () => Promise<string>) => {
    const testStarted = Date.now();
    try { results.push({ key, label, status: "PASSED", durationMs: Date.now() - testStarted, message: await fn() }); }
    catch (error: any) { results.push({ key, label, status: "FAILED", durationMs: Date.now() - testStarted, message: sanitizeErrorText(error) || "Test failed." }); }
  };
  let identity: any = null;
  await run("reachable", "Server reachable", async () => { const result = await plexRequest(server, "/identity"); identity = result.data.MediaContainer || result.data; return `Responded in ${result.latencyMs} ms.`; });
  await run("authentication", "Authentication token", async () => { const result = await plexRequest(server, "/library/sections"); return `${plexRows(result.data, "Directory").length} libraries visible.`; });
  await run("identity", "Server identity", async () => {
    if (!identity) identity = (await plexRequest(server, "/identity")).data.MediaContainer;
    const machine = identity?.machineIdentifier || identity?.machineIdentifier;
    if (!machine) throw new Error("Plex did not return a machine identifier.");
    if (server.machineIdentifier && machine !== server.machineIdentifier) throw new Error("The responding Plex server identity does not match this configuration.");
    return `Verified ${server.name}.`;
  });
  await run("libraries", "Configured music libraries", async () => {
    const remote = plexRows((await plexRequest(server, "/library/sections")).data, "Directory");
    const missing = server.libraries.filter((library: any) => library.type === "artist" && !remote.some((entry: any) => String(entry.key) === library.plexId));
    if (missing.length) throw new Error(`${missing.length} configured music libraries are unavailable.`);
    return `${server.libraries.filter((library: any) => library.type === "artist").length} configured music libraries verified.`;
  });
  await run("playlists_read", "Playlist read access", async () => `${plexRows((await plexRequest(server, "/playlists?playlistType=audio")).data, "Metadata").length} audio playlists readable.`);
  await run("collections_read", "Collection read access", async () => {
    const music = server.libraries.filter((library: any) => library.type === "artist");
    for (const library of music) await plexRequest(server, `/library/sections/${encodeURIComponent(library.plexId)}/collections`);
    return `Collections readable in ${music.length} music libraries.`;
  });
  const passed = results.every((result) => result.status === "PASSED");
  const latency = Date.now() - started;
  const availabilityState = passed ? "AVAILABLE" : classifyAvailability(new Error(results.find((result) => result.status === "FAILED")?.message));
  await db.server.update({ where: { id: server.id }, data: passed ? { availabilityState, failureCount: 0, lastSuccessAt: new Date(), responseLatencyMs: latency, lastFailureReason: null } : { availabilityState, failureCount: { increment: 1 }, lastFailureAt: new Date(), lastFailureReason: results.find((result) => result.status === "FAILED")?.message, responseLatencyMs: latency } });
  await db.integrationTestResult.create({ data: { testKey: "plex.connection", status: passed ? "PASSED" : "FAILED", safe: true, durationMs: latency, responseSummary: sanitizePayload({ server: server.name, results }), message: passed ? "All Plex connection tests passed." : "One or more Plex connection tests failed.", actorId: userId } });
  return { server: { id: server.id, name: server.name }, status: passed ? "PASSED" : "FAILED", durationMs: latency, results };
}

export async function runPlexWriteTest(input: { serverId: string; libraryId: string; type: "playlist" | "collection"; userId: string }) {
  const server = await db.server.findFirst({ where: { id: input.serverId, userId: input.userId } });
  const library = await db.library.findFirst({ where: { id: input.libraryId, serverId: input.serverId } });
  if (!server || !library) throw new IntegrationError("PLEX_TEST_TARGET_INVALID", "The Plex test server or library is unavailable.", 404);
  const started = Date.now(); const title = `Mixarr integration test ${crypto.randomUUID().slice(0, 8)}`;
  let createdId: string | null = null;
  try {
    const sample = plexRows((await plexRequest(server, `/library/sections/${encodeURIComponent(library.plexId)}/all?type=10&X-Plex-Container-Start=0&X-Plex-Container-Size=1`)).data, "Metadata")[0];
    if (!sample?.ratingKey) throw new Error("The target music library has no track available for a temporary write test.");
    const uri = `server://${server.machineIdentifier}/com.plexapp.plugins.library/library/metadata/${sample.ratingKey}`;
    const pathname = input.type === "playlist" ? `/playlists?${new URLSearchParams({ type: "audio", title, smart: "0", uri })}` : `/library/collections?${new URLSearchParams({ type: "10", title, smart: "0", sectionId: library.plexId, uri })}`;
    const result = await plexRequest(server, pathname, { method: "POST" });
    createdId = String(plexRows(result.data, "Metadata")[0]?.ratingKey || "");
    if (!createdId) throw new Error(`Plex did not confirm temporary ${input.type} creation.`);
    await plexRequest(server, input.type === "playlist" ? `/playlists/${createdId}` : `/library/collections/${createdId}`, { method: "DELETE" });
    await db.integrationTestResult.create({ data: { testKey: `plex.${input.type}_write`, status: "PASSED", safe: false, durationMs: Date.now() - started, responseSummary: { created: true, cleanedUp: true }, message: `Temporary Plex ${input.type} was created and removed successfully.`, actorId: input.userId } });
    return { status: "PASSED", type: input.type, durationMs: Date.now() - started, temporaryResourceCreated: true, cleanedUp: true };
  } catch (error) {
    if (createdId) await plexRequest(server, input.type === "playlist" ? `/playlists/${createdId}` : `/library/collections/${createdId}`, { method: "DELETE" }).catch(() => null);
    await db.integrationTestResult.create({ data: { testKey: `plex.${input.type}_write`, status: "FAILED", safe: false, durationMs: Date.now() - started, responseSummary: { created: !!createdId, cleanedUp: !!createdId }, errorCategory: "PLEX_WRITE_FAILED", message: sanitizeErrorText(error) || "Plex write test failed.", actorId: input.userId } });
    throw error;
  }
}

export async function listPlexCollections(serverId: string, libraryId?: string) {
  const server = await db.server.findUnique({ where: { id: serverId }, include: { libraries: true } });
  if (!server) throw new IntegrationError("PLEX_SERVER_NOT_FOUND", "Plex server not found.", 404);
  const libraries = server.libraries.filter((library: any) => library.type === "artist" && (!libraryId || library.id === libraryId));
  const output: any[] = [];
  for (const library of libraries) {
    const result = await plexRequest(server, `/library/sections/${encodeURIComponent(library.plexId)}/collections`);
    for (const item of plexRows(result.data, "Metadata")) output.push({ id: String(item.ratingKey), title: item.title, summary: item.summary || null, itemCount: Number(item.childCount || item.leafCount || 0), type: item.subtype || item.type || "artist", thumb: item.thumb || null, updatedAt: item.updatedAt ? new Date(Number(item.updatedAt) * 1000).toISOString() : null, library: { id: library.id, name: library.name }, server: { id: server.id, name: server.name }, available: true });
  }
  return output;
}

export async function importPlexCollection(input: { userId: string; serverId: string; libraryId: string; collectionId: string; name?: string; sourceMode: string }) {
  const server = await db.server.findUnique({ where: { id: input.serverId } });
  const library = await db.library.findFirst({ where: { id: input.libraryId, serverId: input.serverId } });
  if (!server || !library) throw new IntegrationError("COLLECTION_TARGET_INVALID", "The Plex server or library is unavailable.", 404);
  const metadata = (await plexRequest(server, `/library/collections/${encodeURIComponent(input.collectionId)}/children`)).data;
  const remoteItems = plexRows(metadata, "Metadata");
  const ratingKeys = remoteItems.map((item: any) => String(item.ratingKey));
  const tracks = await db.track.findMany({ where: { libraryId: library.id, ratingKey: { in: ratingKeys } }, select: { id: true, ratingKey: true, title: true, artist: { select: { title: true } }, album: { select: { title: true } } } });
  const created = await db.generatedPlaylist.create({ data: { userId: input.userId, serverId: server.id, plexPlaylistTitle: input.name || metadata?.MediaContainer?.title2 || "Imported Plex collection", sourceType: `plex_collection_${input.sourceMode.toLowerCase()}`, filtersJson: { plexCollectionId: input.collectionId, libraryId: library.id, sourceMode: input.sourceMode, plexItemIds: ratingKeys }, importedFromPlex: true, managedByMixarr: false, trackCount: tracks.length, tracks: { create: tracks.map((track: any, index: number) => ({ trackId: track.id, position: index + 1, plexTrackRatingKey: track.ratingKey, title: track.title, artist: track.artist.title, album: track.album.title })) } } });
  await db.plexCollectionState.upsert({ where: { serverId_plexCollectionId: { serverId: server.id, plexCollectionId: input.collectionId } }, update: { available: true, itemCount: remoteItems.length }, create: { serverId: server.id, libraryId: library.id, plexCollectionId: input.collectionId, name: created.plexPlaylistTitle, itemCount: remoteItems.length, available: true } });
  return { playlist: created, matchedTracks: tracks.length, unmatchedTracks: ratingKeys.length - tracks.length };
}

export async function exportPlexCollection(input: { userId: string; generatedPlaylistId: string; serverId: string; libraryId: string; name: string; summary?: string; mode: "CREATE_NEW" | "REPLACE" | "MERGE"; keepSynchronized?: boolean }) {
  const [server, library, playlist] = await Promise.all([db.server.findUnique({ where: { id: input.serverId } }), db.library.findFirst({ where: { id: input.libraryId, serverId: input.serverId } }), db.generatedPlaylist.findFirst({ where: { id: input.generatedPlaylistId, userId: input.userId }, include: { tracks: { orderBy: { position: "asc" } } } })]);
  if (!server || !library || !playlist) throw new IntegrationError("COLLECTION_TARGET_INVALID", "The playlist, Plex server, or music library is unavailable.", 404);
  const existing = (await listPlexCollections(server.id, library.id)).find((collection) => collection.title === input.name);
  if (existing && input.mode === "CREATE_NEW") input.name = `${input.name} (${new Date().toISOString().slice(0, 10)})`;
  if (existing && input.mode === "REPLACE") await plexRequest(server, `/library/collections/${encodeURIComponent(existing.id)}`, { method: "DELETE" });
  const ids = playlist.tracks.map((track: any) => track.plexTrackRatingKey).filter(Boolean);
  const uri = `server://${server.machineIdentifier}/com.plexapp.plugins.library/library/metadata/${ids.join(",")}`;
  const query = new URLSearchParams({ type: "10", title: input.name, smart: "0", sectionId: library.plexId, uri });
  const result = await plexRequest(server, `/library/collections?${query}`, { method: "POST" }, 10000);
  const collection = plexRows(result.data, "Metadata")[0] || {};
  const collectionId = String(collection.ratingKey || existing?.id || "");
  if (!collectionId) throw new IntegrationError("PLEX_COLLECTION_CREATE_FAILED", "Plex did not return a collection identifier.", 502);
  if (input.summary) await plexRequest(server, `/library/collections/${encodeURIComponent(collectionId)}?summary.value=${encodeURIComponent(input.summary)}`, { method: "PUT" });
  const state = await db.plexCollectionState.upsert({ where: { serverId_plexCollectionId: { serverId: server.id, plexCollectionId: collectionId } }, update: { name: input.name, summary: input.summary, itemCount: ids.length, managedByMixarr: !!input.keepSynchronized, synchronizationDirection: "MIXARR_TO_PLEX", syncMode: input.mode, lastItemSetJson: ids, lastSuccessfulUpdateAt: new Date(), lastError: null }, create: { serverId: server.id, libraryId: library.id, plexCollectionId: collectionId, name: input.name, summary: input.summary, itemCount: ids.length, managedByMixarr: !!input.keepSynchronized, synchronizationDirection: "MIXARR_TO_PLEX", syncMode: input.mode, lastItemSetJson: ids, lastSuccessfulUpdateAt: new Date() } });
  await emitIntegrationEvent("collection.created", { collection: { id: state.id, name: state.name, itemCount: ids.length }, sourcePlaylistId: playlist.id });
  return state;
}

export async function fetchPlexPlaylistState(server: any, ratingKey: string) {
  const [metadataResult, childrenResult] = await Promise.all([plexRequest(server, `/playlists/${encodeURIComponent(ratingKey)}`), plexRequest(server, `/playlists/${encodeURIComponent(ratingKey)}/items`)]);
  const metadata = plexRows(metadataResult.data, "Metadata")[0];
  if (!metadata) return null;
  return { itemIds: plexRows(childrenResult.data, "Metadata").map((item: any) => String(item.ratingKey)), title: metadata.title || "", summary: metadata.summary || null, artwork: metadata.thumb || metadata.composite || null, ownerId: metadata.accountID ? String(metadata.accountID) : null, ownerName: metadata.username || null, updatedAt: metadata.updatedAt ? String(metadata.updatedAt) : null, ratingKey: String(metadata.ratingKey || ratingKey) };
}

export async function detectPlaylistChange(generatedPlaylistId: string) {
  const playlist = await db.generatedPlaylist.findUnique({ where: { id: generatedPlaylistId }, include: { tracks: { orderBy: { position: "asc" } } } });
  if (!playlist?.serverId || !playlist.plexPlaylistRatingKey) throw new IntegrationError("PLAYLIST_NOT_PLEX_BACKED", "This playlist is not linked to Plex.", 409);
  const server = await db.server.findUnique({ where: { id: playlist.serverId } });
  if (!server) throw new IntegrationError("PLEX_SERVER_NOT_FOUND", "Plex server not found.", 404);
  const previousSnapshot = await db.externalStateSnapshot.findFirst({ where: { generatedPlaylistId }, orderBy: { createdAt: "desc" } });
  const before = previousSnapshot?.stateJson || { itemIds: playlist.tracks.map((item: any) => item.plexTrackRatingKey).filter(Boolean), title: playlist.plexPlaylistTitle, ownerId: playlist.plexOwnerAccountId, ownerName: playlist.plexOwnerName, ratingKey: playlist.plexPlaylistRatingKey };
  let after: any = null;
  try { after = await fetchPlexPlaylistState(server, playlist.plexPlaylistRatingKey); } catch (error: any) { if (error.httpStatus !== 404) throw error; }
  const classification = classifyPlaylistChange(before, after);
  const diff = before && after ? diffPlaylistState(before, after) : { added: [], removed: [], moved: [], metadata: [], ownerChanged: false };
  if (classification !== "NO_CHANGE") {
    await db.$transaction([
      db.generatedPlaylist.update({ where: { id: generatedPlaylistId }, data: { externalChangeState: classification, lastManualChangeAt: new Date() } }),
      db.playlistReconciliation.create({ data: { generatedPlaylistId, changeType: classification, policy: playlist.reconciliationPolicy, beforeJson: before, afterJson: after || {}, diffJson: diff } }),
    ]);
    await emitIntegrationEvent("playlist.reconciliation_required", { playlist: { id: playlist.id, title: playlist.plexPlaylistTitle }, classification, diff }, { actorType: "system" }, `reconcile:${playlist.id}:${after ? playlistFingerprint(after) : "deleted"}`);
  }
  return { playlistId: generatedPlaylistId, classification, diff, before: sanitizePayload(before), after: sanitizePayload(after), requiresReview: classification !== "NO_CHANGE" };
}

export async function createScopedToken(actorId: string, input: { name: string; description?: string; scopes: string[]; expiresAt?: string | null }) {
  const invalid = input.scopes.filter((scope) => !(API_TOKEN_SCOPES as readonly string[]).includes(scope));
  if (invalid.length) throw new IntegrationError("INVALID_SCOPE", `Unknown API token scopes: ${invalid.join(", ")}`);
  const token = generateApiToken();
  const row = await db.apiToken.create({ data: { userId: actorId, createdById: actorId, name: input.name, description: input.description, prefix: token.prefix, tokenHash: token.hash, scopesJson: input.scopes, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, auditEvents: { create: { eventType: "CREATED", actorId, metadata: { scopes: input.scopes } } } }, select: { id: true, name: true, prefix: true, scopesJson: true, expiresAt: true, createdAt: true } });
  return { ...row, token: token.raw };
}

export async function authorizeApiRequest(request: Request, required: ApiTokenScope) {
  const auth = request.headers.get("authorization") || "";
  const raw = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!raw) throw new IntegrationError("TOKEN_REQUIRED", "A scoped API token is required.", 401);
  const token = await db.apiToken.findUnique({ where: { tokenHash: hashApiToken(raw) } });
  if (!token || !token.enabled || token.revokedAt || (token.expiresAt && token.expiresAt <= new Date())) throw new IntegrationError("TOKEN_INVALID", "The API token is invalid, expired, or revoked.", 401);
  const scopes = jsonArray(token.scopesJson);
  if (!hasRequiredScope(scopes, required)) throw new IntegrationError("SCOPE_REQUIRED", `This endpoint requires ${required}.`, 403);
  const now = Date.now(); const limit = Math.max(10, Number(process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE || 120));
  const bucket = apiRateLimits.get(token.id);
  if (!bucket || now - bucket.windowStartedAt >= 60000) apiRateLimits.set(token.id, { windowStartedAt: now, count: 1 });
  else { bucket.count += 1; if (bucket.count > limit) throw new IntegrationError("RATE_LIMITED", "The API token exceeded its per-minute request limit.", 429); }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const restrictions = jsonArray(token.ipRestrictions);
  if (restrictions.length && (!forwarded || !restrictions.includes(forwarded))) throw new IntegrationError("IP_RESTRICTED", "This token is not permitted from the requesting IP address.", 403);
  await db.$transaction([db.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }), db.apiTokenAuditEvent.create({ data: { tokenId: token.id, eventType: "USED", metadata: { scope: required } } })]);
  return { userId: token.userId, tokenId: token.id, scopes };
}

export async function emitIntegrationEvent(event: typeof INTEGRATION_EVENTS[number], data: Record<string, unknown>, context: Record<string, unknown> = {}, idempotencyKey?: string) {
  const envelope = createEventEnvelope(event, data, context);
  let record: any;
  try { record = await db.integrationEvent.create({ data: { id: envelope.id, event, dataJson: envelope.data, contextJson: envelope.context, idempotencyKey } }); }
  catch (error: any) { if (idempotencyKey && error?.code === "P2002") return db.integrationEvent.findUnique({ where: { idempotencyKey } }); throw error; }
  await queueEventDeliveries(record.id, envelope);
  await db.playlistOrchestrationAuditEvent.create({ data: { eventType: `INTEGRATION_${event.toUpperCase().replace(/\W/g, "_")}`, severity: "INFO", actorType: String(context.actorType || "SYSTEM").toUpperCase(), actorId: context.actorId ? String(context.actorId) : null, message: `Integration event emitted: ${event}`, metadataJson: sanitizePayload({ eventId: envelope.id, data }) } }).catch(() => null);
  return record;
}

async function queueEventDeliveries(eventId: string, envelope: any) {
  const endpoints = await db.webhookEndpoint.findMany({ where: { enabled: true } });
  for (const endpoint of endpoints) {
    const events = jsonArray(endpoint.eventsJson);
    if (events.length && !events.includes(envelope.event)) continue;
    const deliveryId = `dlv_${crypto.randomUUID()}`;
    const row = await db.webhookDelivery.create({ data: { deliveryId, eventId, endpointId: endpoint.id } });
    await deliverWebhook(row.id, envelope).catch(() => null);
  }
  const integrations = await db.integrationConfiguration.findMany({ where: { enabled: true, key: { in: ["discord", "notifiarr"] } } });
  for (const integration of integrations) await deliverNativeIntegration(integration, envelope).catch(() => null);
}

export async function deliverWebhook(deliveryRowId: string, suppliedEnvelope?: any) {
  const delivery = await db.webhookDelivery.findUnique({ where: { id: deliveryRowId }, include: { endpoint: true, eventRecord: true } });
  if (!delivery) throw new IntegrationError("DELIVERY_NOT_FOUND", "Webhook delivery not found.", 404);
  const endpoint = delivery.endpoint;
  const envelope = suppliedEnvelope || { id: delivery.eventRecord.id, event: delivery.eventRecord.event, version: delivery.eventRecord.envelopeVersion, createdAt: delivery.eventRecord.createdAt.toISOString(), source: "mixarr", mixarrVersion: APP_VERSION.replace(/^v/, ""), data: delivery.eventRecord.dataJson, context: delivery.eventRecord.contextJson };
  const url = validatePublicDestination(decryptSecret(endpoint.destinationUrlEncrypted), process.env.MIXARR_ALLOW_PRIVATE_WEBHOOKS === "true");
  const secret = decryptSecret(endpoint.secretEncrypted);
  const raw = JSON.stringify(endpoint.includeSensitiveFields ? envelope : sanitizePayload(envelope));
  const timestamp = new Date().toISOString();
  const started = Date.now();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), endpoint.timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "X-Mixarr-Event": envelope.event, "X-Mixarr-Delivery": delivery.deliveryId, "X-Mixarr-Timestamp": timestamp, "X-Mixarr-Signature": signWebhookPayload(secret, timestamp, raw), "X-Mixarr-Version": APP_VERSION.replace(/^v/, ""), ...jsonObject(endpoint.customHeadersJson) }, body: raw });
    const excerpt = sanitizeErrorText((await response.text()).slice(0, 500));
    if (!response.ok) throw Object.assign(new Error(`Destination returned HTTP ${response.status}.`), { httpStatus: response.status, excerpt });
    await db.$transaction([db.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "SUCCEEDED", httpStatus: response.status, durationMs: Date.now() - started, responseExcerpt: excerpt, completedAt: new Date() } }), db.webhookEndpoint.update({ where: { id: endpoint.id }, data: { lastSuccessAt: new Date(), failureCount: 0 } })]);
  } catch (error: any) {
    const category = error?.name === "AbortError" ? "TIMEOUT" : error?.httpStatus ? "HTTP_ERROR" : "NETWORK_ERROR";
    const retry = delivery.attemptNumber <= endpoint.retryCount;
    await db.$transaction([db.webhookDelivery.update({ where: { id: delivery.id }, data: { status: retry ? "RETRY_SCHEDULED" : "FAILED", httpStatus: error?.httpStatus, durationMs: Date.now() - started, responseExcerpt: error?.excerpt, errorCategory: category, errorMessage: sanitizeErrorText(error), nextAttemptAt: retry ? new Date(Date.now() + Math.min(300000, 1000 * 2 ** delivery.attemptNumber)) : null, completedAt: retry ? null : new Date() } }), db.webhookEndpoint.update({ where: { id: endpoint.id }, data: { lastFailureAt: new Date(), failureCount: { increment: 1 } } })]);
    throw error;
  } finally { clearTimeout(timer); }
}

async function deliverNativeIntegration(integration: any, envelope: any) {
  const config = jsonObject(integration.configurationJson);
  const secrets = integration.encryptedSecretJson ? jsonObject(JSON.parse(decryptSecret(integration.encryptedSecretJson))) : {};
  const rawUrl = secrets.webhookUrl || secrets.url;
  if (!rawUrl) return;
  const url = validatePublicDestination(rawUrl, process.env.MIXARR_ALLOW_PRIVATE_WEBHOOKS === "true");
  const body = integration.key === "discord" ? { username: config.displayName || "Mixarr", avatar_url: config.avatarUrl || undefined, content: `**${envelope.event}**`, embeds: [{ title: envelope.data?.recipe?.name || envelope.data?.playlist?.title || "Mixarr event", description: JSON.stringify(sanitizePayload(envelope.data)).slice(0, 3500), footer: { text: `Mixarr ${APP_VERSION}` } }] } : { event: envelope.event, notification: sanitizePayload(envelope.data), severity: config.severityThreshold || "info", source: "Mixarr" };
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(secrets.apiKey ? { "X-API-Key": secrets.apiKey } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${integration.displayName} returned HTTP ${response.status}.`);
  await db.integrationConfiguration.update({ where: { id: integration.id }, data: { status: "HEALTHY", lastSuccessAt: new Date(), failureCount: 0, lastFailureReason: null } });
}

export async function saveIntegrationConfiguration(key: string, input: { displayName: string; enabled: boolean; configuration?: Record<string, unknown>; secrets?: Record<string, string> }) {
  if (input.secrets && Object.keys(input.secrets).length && !isSecretEncryptionConfigured()) throw new IntegrationError("ENCRYPTION_REQUIRED", "Configure MIXARR_SECRET_KEY before saving integration secrets.", 409);
  const encryptedSecretJson = input.secrets && Object.keys(input.secrets).length ? encryptSecret(JSON.stringify(input.secrets)) : undefined;
  return db.integrationConfiguration.upsert({ where: { key }, update: { displayName: input.displayName, enabled: input.enabled, status: input.enabled ? "UNKNOWN" : "DISABLED", configurationJson: sanitizePayload(input.configuration || {}), ...(encryptedSecretJson ? { encryptedSecretJson } : {}) }, create: { key, displayName: input.displayName, enabled: input.enabled, status: input.enabled ? "UNKNOWN" : "DISABLED", configurationJson: sanitizePayload(input.configuration || {}), encryptedSecretJson } });
}

export async function runMountChecks() {
  const mounts = await db.mountDependency.findMany({ where: { enabled: true } });
  const results = [];
  for (const mount of mounts) {
    const result = checkMountDependency({ mountPath: mount.path, markerFile: mount.markerFile, expectedFilesystemId: mount.expectedFilesystemId });
    const recovered = mount.status !== "AVAILABLE" && result.available;
    const unavailable = mount.status === "AVAILABLE" && !result.available;
    await db.mountDependency.update({ where: { id: mount.id }, data: result.available ? { status: mount.consecutiveSuccessCount + 1 >= mount.requiredSuccessCount ? "AVAILABLE" : "RECOVERING", consecutiveSuccessCount: { increment: 1 }, failureCount: 0, lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastFailureReason: null, expectedFilesystemId: mount.expectedFilesystemId || result.filesystemId } : { status: "UNAVAILABLE", consecutiveSuccessCount: 0, failureCount: { increment: 1 }, lastCheckedAt: new Date(), lastFailureAt: new Date(), lastFailureReason: result.reason } });
    if (unavailable) await emitIntegrationEvent("mount.unavailable", { mount: { id: mount.id, name: mount.displayName }, category: result.category });
    if (recovered && mount.consecutiveSuccessCount + 1 >= mount.requiredSuccessCount) await emitIntegrationEvent("mount.recovered", { mount: { id: mount.id, name: mount.displayName } });
    results.push({ id: mount.id, name: mount.displayName, ...result });
  }
  return results;
}

export async function plexLibraryDestructiveSafety(libraryId: string) {
  const library = await db.library.findUnique({ where: { id: libraryId }, include: { server: true } });
  if (!library) throw new IntegrationError("LIBRARY_NOT_FOUND", "Plex library not found.", 404);
  const mounts = await db.mountDependency.findMany({ where: { enabled: true, OR: [{ serverId: library.serverId }, { serverId: null }] } });
  const unavailableMount = mounts.find((mount: any) => mount.status !== "AVAILABLE");
  if (unavailableMount) return { destructiveAllowed: false, state: "WAITING_FOR_MOUNT", reason: `Storage dependency ${unavailableMount.displayName} is ${unavailableMount.status.toLowerCase()}.` };
  const sections = plexRows((await plexRequest(library.server, "/library/sections")).data, "Directory");
  const remote = sections.find((section: any) => String(section.key) === library.plexId);
  if (!remote) return { destructiveAllowed: false, state: "MUSIC_LIBRARY_UNAVAILABLE", reason: "The selected Plex music library is unavailable." };
  const scanning = Boolean(remote.refreshing || remote.scanning);
  const now = new Date();
  if (scanning) {
    await db.library.update({ where: { id: library.id }, data: { scanState: "SCANNING", lastScanDetectedAt: now, destructiveSyncBlockedUntil: null } });
    return { destructiveAllowed: false, state: "WAITING_FOR_PLEX_SCAN", reason: "Plex is scanning this library; destructive reconciliation is deferred." };
  }
  if (library.scanState === "SCANNING") {
    const graceMinutes = Math.max(0, Number(process.env.PLEX_SCAN_GRACE_MINUTES || 10));
    const blockedUntil = new Date(now.getTime() + graceMinutes * 60000);
    await db.library.update({ where: { id: library.id }, data: { scanState: "GRACE_PERIOD", lastScanCompletedAt: now, destructiveSyncBlockedUntil: blockedUntil } });
    return { destructiveAllowed: false, state: "WAITING_FOR_PLEX_SCAN_GRACE", reason: `Plex scan completed; destructive reconciliation is paused for ${graceMinutes} minutes.` };
  }
  if (library.destructiveSyncBlockedUntil && library.destructiveSyncBlockedUntil > now) return { destructiveAllowed: false, state: "WAITING_FOR_PLEX_SCAN_GRACE", reason: "The post-scan safety grace period is still active." };
  if (library.scanState !== "IDLE" || library.destructiveSyncBlockedUntil) await db.library.update({ where: { id: library.id }, data: { scanState: "IDLE", destructiveSyncBlockedUntil: null } });
  return { destructiveAllowed: true, state: "AVAILABLE", reason: null };
}

export async function ecosystemStatus(userId?: string) {
  const wherePlaylist = userId ? { userId } : {};
  const [playlists, pending, failedAutomations, pendingActions, servers, mounts, integrationFailures, lastSync] = await Promise.all([
    db.generatedPlaylist.findMany({ where: wherePlaylist, select: { externalChangeState: true, healthSnapshots: { orderBy: { analyzedAt: "desc" }, take: 1, select: { status: true } } } }),
    db.playlistReconciliation.count({ where: { status: "PENDING", ...(userId ? { playlist: { userId } } : {}) } }),
    db.jobHistory.count({ where: { status: "failed", ...(userId ? { userId } : {}) } }),
    db.smartAction.count({ where: { status: "PENDING", ...(userId ? { userId } : {}) } }),
    db.server.findMany({ where: { enabled: true, ...(userId ? { userId } : {}) }, orderBy: { priority: "asc" }, select: { id: true, name: true, availabilityState: true, role: true } }),
    db.mountDependency.findMany({ where: { enabled: true }, select: { status: true } }),
    db.integrationConfiguration.count({ where: { enabled: true, status: { in: ["DEGRADED", "UNAVAILABLE", "FAILED"] } } }),
    db.syncLog.findFirst({ where: userId ? { library: { server: { userId } }, status: "success" } : { status: "success" }, orderBy: { endedAt: "desc" }, select: { endedAt: true } }),
  ]);
  const healthy = playlists.filter((playlist: any) => ["HEALTHY", "OK"].includes(playlist.healthSnapshots[0]?.status)).length;
  const degraded = playlists.length - healthy;
  const activeServer = servers.find((server: any) => server.availabilityState === "AVAILABLE") || servers[0] || null;
  const plexAvailable = !!servers.some((server: any) => server.availabilityState === "AVAILABLE");
  const mountsAvailable = mounts.every((mount: any) => mount.status === "AVAILABLE");
  const status = !plexAvailable || !mountsAvailable ? "degraded" : degraded || pending || integrationFailures ? "degraded" : "healthy";
  return { status, plexAvailable, activePlexServer: activeServer?.name || null, mountsAvailable, totalPlaylists: playlists.length, healthyPlaylists: healthy, degradedPlaylists: degraded, pendingReconciliations: pending, activeAutomations: await db.playlistAutomationSettings.count({ where: { enabled: true, ...(userId ? { userId } : {}) } }), failedAutomations, pendingSmartActions: pendingActions, recentIntegrationFailures: integrationFailures, lastSyncAt: lastSync?.endedAt?.toISOString() || null, version: APP_VERSION, uptimeSeconds: Math.floor(process.uptime()) };
}

export async function cleanupIntegrationHistory() {
  const now = Date.now();
  const days = (value: number) => new Date(now - value * 86400000);
  const [deliveries, tests, signals, snapshots, health, events] = await Promise.all([
    db.webhookDelivery.deleteMany({ where: { createdAt: { lt: days(Number(process.env.WEBHOOK_HISTORY_RETENTION_DAYS || 30)) } } }),
    db.integrationTestResult.deleteMany({ where: { createdAt: { lt: days(Number(process.env.INTEGRATION_TEST_RETENTION_DAYS || 30)) } } }),
    db.tautulliPlaybackSignal.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    db.externalStateSnapshot.deleteMany({ where: { createdAt: { lt: days(Number(process.env.EXTERNAL_SNAPSHOT_RETENTION_DAYS || 90)) }, synchronized: false } }),
    db.integrationHealthRecord.deleteMany({ where: { checkedAt: { lt: days(Number(process.env.INTEGRATION_HEALTH_RETENTION_DAYS || 30)) } } }),
    db.integrationEvent.deleteMany({ where: { createdAt: { lt: days(Number(process.env.INTEGRATION_EVENT_RETENTION_DAYS || 90)) }, deliveries: { none: { status: { in: ["PENDING", "RETRY_SCHEDULED"] } } } } }),
  ]);
  return { deliveries: deliveries.count, tests: tests.count, signals: signals.count, snapshots: snapshots.count, health: health.count, events: events.count };
}
