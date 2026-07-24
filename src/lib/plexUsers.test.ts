import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyPlexDiscoveryFailure, formatPlexAccountLabel, normalizePlexUsers } from "./plexUsers";
import { discoverPlexAccountsForServer, discoverPlexUsers, IntegrationError } from "./integrations/service";

const owner = { id: 12345, username: "cvarano84", email: "owner@example.com", avatarUrl: null };
const server = {
  id: "server-1",
  name: "Music Plex",
  uri: "http://plex.invalid:32400",
  accessToken: "server-side-only",
  accessTokenEncrypted: null,
  user: { plexId: owner.id, username: owner.username, email: owner.email, thumb: null },
};

function discoveryRequest(accountRows: unknown[]) {
  return async (_server: any, pathname: string) => ({
    data: pathname === "/accounts" ? { MediaContainer: { Account: accountRows } } : { MediaContainer: { Directory: [] } },
  });
}

describe("Plex account normalization", () => {
  it("returns the connected Plex owner with stable identity", () => {
    const result = normalizePlexUsers([], owner);
    assert.equal(result.users.length, 1);
    assert.deepEqual(result.users[0], {
      id: "12345",
      username: "cvarano84",
      email: "owner@example.com",
      title: "cvarano84",
      avatarUrl: null,
      isOwner: true,
      isManaged: false,
      isHomeUser: true,
      accountType: "OWNER",
    });
  });

  it("retains managed Plex Home users without email addresses", () => {
    const result = normalizePlexUsers([{ id: 20, title: "Family User", managed: true }], owner);
    const managed = result.users.find((user) => user.id === "20")!;
    assert.equal(managed.email, null);
    assert.equal(managed.isManaged, true);
    assert.equal(managed.isHomeUser, true);
    assert.equal(formatPlexAccountLabel(managed), "Family User — Managed user");
  });

  it("returns shared users when the server supplies them", () => {
    const result = normalizePlexUsers([{ accountID: "30", name: "PlexFriend", email: "friend@example.com" }], owner);
    const friend = result.users.find((user) => user.id === "30")!;
    assert.equal(friend.accountType, "SHARED");
    assert.equal(friend.isOwner, false);
    assert.equal(formatPlexAccountLabel(friend), "PlexFriend — friend@example.com");
  });

  it("deduplicates records by stable account ID and keeps richer fields", () => {
    const result = normalizePlexUsers([
      { id: "30", name: "PlexFriend" },
      { accountId: "30", title: "Plex Friend", email: "friend@example.com", thumb: "https://example.invalid/avatar" },
    ], owner);
    assert.equal(result.users.filter((user) => user.id === "30").length, 1);
    assert.equal(result.users.find((user) => user.id === "30")?.email, "friend@example.com");
  });

  it("skips malformed records without emitting undefined labels", () => {
    const result = normalizePlexUsers([null, {}, { id: "40" }, { name: "No ID" }], null);
    assert.deepEqual(result.users, []);
    assert.equal(result.malformedRecordsSkipped, 4);
  });
});

describe("Plex account discovery failures and edge states", () => {
  it("normalizes owner, managed, and shared records returned by the configured server", async () => {
    const result = await discoverPlexAccountsForServer(server, discoveryRequest([
      { id: "20", name: "Family User", managed: true },
      { id: "30", name: "PlexFriend", email: "friend@example.com" },
    ]));
    assert.equal(result.users.length, 3);
    assert.equal(result.supported, true);
    assert.equal(result.remoteUserCount, 2);
  });

  it("handles an empty Plex result by retaining the owner and reporting zero remote users", async () => {
    const result = await discoverPlexAccountsForServer(server, discoveryRequest([]));
    assert.equal(result.users.length, 1);
    assert.equal(result.users[0].isOwner, true);
    assert.equal(result.remoteUserCount, 0);
  });

  it("returns a useful error when Plex is not configured", async () => {
    const database = { server: { findMany: async () => [] } };
    await assert.rejects(() => discoverPlexUsers("admin", database), (error: any) => {
      assert.equal(error.code, "PLEX_NOT_CONFIGURED");
      assert.equal(error.status, 409);
      return true;
    });
  });

  it("classifies rejected authentication without leaking the token", async () => {
    const request = async () => { throw Object.assign(new Error("HTTP 401"), { httpStatus: 401 }); };
    await assert.rejects(() => discoverPlexAccountsForServer(server, request), (error: any) => {
      assert.equal(error.code, "PLEX_AUTH_REJECTED");
      assert.doesNotMatch(error.message, /server-side-only/);
      return true;
    });
  });

  it("classifies timeouts and unreachable servers safely", () => {
    assert.deepEqual(classifyPlexDiscoveryFailure(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })), {
      code: "PLEX_TIMEOUT",
      status: 504,
      message: "The Plex server did not respond before the discovery timeout.",
    });
    assert.equal(classifyPlexDiscoveryFailure(Object.assign(new Error("refused"), { code: "ECONNREFUSED" })).code, "PLEX_UNREACHABLE");
  });

  it("handles unsupported account discovery without failing owner mapping", async () => {
    const request = async (_server: any, pathname: string) => {
      if (pathname === "/accounts") throw Object.assign(new Error("not found"), { httpStatus: 404 });
      return { data: { MediaContainer: {} } };
    };
    const result = await discoverPlexAccountsForServer(server, request);
    assert.equal(result.supported, false);
    assert.equal(result.users[0].isOwner, true);
  });
});

