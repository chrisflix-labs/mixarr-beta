import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkMountDependency, chooseFailoverServer, classifyAvailability, classifyPlaylistChange, createEventEnvelope,
  destructiveSyncDecision, diffPlaylistState, generateApiToken, hasRequiredScope, healthState, normalizeTautulliSignal,
  playlistFingerprint, preservePlaylistMetadata, reconcileTrackIds, retryDelayMs, sanitizePayload, signWebhookPayload,
  suggestPlexUserMappings, validatePublicDestination,
} from "./integrations/core";

const base = { itemIds: ["1", "2", "3"], title: "Mix", summary: "Description", artwork: "/art", ownerId: "owner", ownerName: "Alex", updatedAt: "1", ratingKey: "10" };

describe("v2.3.7 Plex external-state intelligence", () => {
  it("generates stable fingerprints and detects manual change classes", () => {
    assert.equal(playlistFingerprint(base), playlistFingerprint({ ...base }));
    assert.equal(classifyPlaylistChange(base, { ...base, itemIds: [...base.itemIds, "4"] }), "ITEMS_ADDED_MANUALLY");
    assert.equal(classifyPlaylistChange(base, { ...base, itemIds: ["1", "3"] }), "ITEMS_REMOVED_MANUALLY");
    assert.equal(classifyPlaylistChange(base, { ...base, itemIds: ["2", "1", "3"] }), "ITEM_ORDER_CHANGED_MANUALLY");
    assert.equal(classifyPlaylistChange(base, { ...base, summary: "Changed" }), "METADATA_CHANGED_MANUALLY");
    assert.equal(classifyPlaylistChange(base, { ...base, ownerId: "other" }), "OWNERSHIP_CHANGED");
    assert.equal(classifyPlaylistChange(base, null), "PLAYLIST_DELETED");
  });

  it("produces comparisons and deterministic reconciliation outcomes", () => {
    const changed = { ...base, itemIds: ["2", "3", "4"], title: "New" };
    const diff = diffPlaylistState(base, changed);
    assert.deepEqual(diff.added, ["4"]); assert.deepEqual(diff.removed, ["1"]); assert.equal(diff.metadata[0].field, "title");
    assert.deepEqual(reconcileTrackIds("MERGE_PLEX_ADDITIONS", base.itemIds, changed.itemIds), ["1", "2", "3", "4"]);
    assert.deepEqual(reconcileTrackIds("KEEP_PLEX", base.itemIds, changed.itemIds), changed.itemIds);
  });

  it("preserves unrelated metadata during item-only synchronization", () => {
    const next = preservePlaylistMetadata(base, ["8", "9"]);
    assert.equal(next.title, base.title); assert.equal(next.summary, base.summary); assert.equal(next.artwork, base.artwork); assert.deepEqual(next.itemIds, ["8", "9"]);
  });
});

describe("availability, failover, scan, and mount safety", () => {
  it("classifies actionable Plex failures", () => {
    assert.equal(classifyAvailability(new Error(), 401), "AUTHENTICATION_FAILED");
    assert.equal(classifyAvailability(Object.assign(new Error("lookup"), { code: "ENOTFOUND" })), "DNS_FAILURE");
    assert.equal(classifyAvailability(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })), "TIMEOUT");
    assert.equal(classifyAvailability(new Error("library scanning")), "LIBRARY_SCANNING");
    assert.equal(classifyAvailability(new Error(), 429), "RATE_LIMITED");
  });

  it("selects failover only after threshold and enforces write policy", () => {
    const primary = { id: "p", enabled: true, priority: 1, availabilityState: "TIMEOUT", role: "PRIMARY", failureCount: 3, minimumFailures: 3, failoverWritePolicy: "ALLOW_WRITES" };
    const secondary = { id: "s", enabled: true, priority: 2, availabilityState: "AVAILABLE", role: "SECONDARY", failureCount: 0, minimumFailures: 3, failoverWritePolicy: "READ_ONLY" };
    assert.equal(chooseFailoverServer([primary, secondary], "read").server?.id, "s");
    assert.equal(chooseFailoverServer([primary, secondary], "write").server, null);
    assert.equal(chooseFailoverServer([{ ...primary, failureCount: 2 }, secondary], "read").server, null);
  });

  it("defers destructive work during scans, grace periods, and mount loss", () => {
    const now = new Date("2026-07-19T20:00:00Z");
    assert.equal(destructiveSyncDecision({ scanning: true, mountAvailable: true, now }).state, "WAITING_FOR_PLEX_SCAN");
    assert.equal(destructiveSyncDecision({ scanning: false, mountAvailable: false, now }).state, "WAITING_FOR_MOUNT");
    assert.equal(destructiveSyncDecision({ scanning: false, mountAvailable: true, graceUntil: new Date(now.getTime() + 1000), now }).allowed, false);
  });

  it("checks marker files and unexpectedly empty directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mixarr-mount-"));
    try { assert.equal(checkMountDependency({ mountPath: root }).category, "UNEXPECTEDLY_EMPTY"); fs.writeFileSync(path.join(root, ".mixarr-mount"), "ok"); assert.equal(checkMountDependency({ mountPath: root, markerFile: ".mixarr-mount" }).available, true); assert.equal(checkMountDependency({ mountPath: root, markerFile: "missing" }).category, "MARKER_MISSING"); } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe("integration security and contracts", () => {
  it("suggests but does not silently confirm Plex user mappings", () => {
    const suggestions = suggestPlexUserMappings([{ id: "u", username: "Alex", email: "a@example.com" }], [{ id: "p", serverId: "s", username: "other", email: "A@example.com" }]);
    assert.equal(suggestions[0].state, "SUGGESTED"); assert.equal(suggestions[0].confidence, "HIGH");
  });

  it("creates sanitized event envelopes and deterministic HMAC signatures", () => {
    const envelope = createEventEnvelope("playlist.created", { name: "Mix", accessToken: "secret", nested: { password: "no" } }, { actorType: "user" }, new Date("2026-07-19T20:00:00Z"));
    assert.equal(envelope.createdAt, "2026-07-19T20:00:00.000Z"); assert.equal((envelope.data as any).accessToken, undefined); assert.deepEqual((envelope.data as any).nested, {});
    assert.equal(signWebhookPayload("secret", "timestamp", "{}"), signWebhookPayload("secret", "timestamp", "{}"));
  });

  it("hashes one-time tokens and enforces scopes", () => {
    const one = generateApiToken(); const two = generateApiToken(); assert.match(one.raw, /^mixarr_/); assert.notEqual(one.raw, one.hash); assert.notEqual(one.hash, two.hash);
    assert.equal(hasRequiredScope(["widget.read"], "widget.read"), true); assert.equal(hasRequiredScope(["status.read"], "metrics.read"), false); assert.equal(hasRequiredScope(["integrations.manage"], "metrics.read"), true);
  });

  it("sanitizes secrets, blocks SSRF destinations, and calculates retry backoff", () => {
    assert.deepEqual(sanitizePayload({ token: "x", safe: "yes", nested: { authorization: "no" } }), { safe: "yes", nested: {} });
    assert.throws(() => validatePublicDestination("https://127.0.0.1/hook")); assert.throws(() => validatePublicDestination("https://user:pass@example.com/hook"));
    assert.equal(retryDelayMs(1), 1000); assert.equal(retryDelayMs(4), 8000); assert.equal(retryDelayMs(4, "LINEAR"), 4000);
  });

  it("normalizes privacy-minimized Tautulli signals and aggregates health", () => {
    const signal = normalizeTautulliSignal({ row_id: 1, rating_key: 9, user: "Alex", duration: 100, play_duration: 20, date: 1 });
    assert.equal(signal.behavior, "SKIP"); assert.notEqual(signal.plexUserIdHash, "Alex"); assert.equal(signal.trackRatingKey, "9");
    assert.equal(healthState(["HEALTHY", "DEGRADED"]), "degraded"); assert.equal(healthState(["HEALTHY"]), "healthy");
  });
});
