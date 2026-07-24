import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { removePlexUserMapping, savePlexUserMapping } from "./integrations/service";

function fakeDatabase() {
  const users = [{ id: "mixarr-1", username: "Alex" }, { id: "mixarr-2", username: "Blair" }];
  const servers = [{ id: "server-1", userId: "admin", name: "Plex" }];
  const accounts = [
    { id: "account-1", serverId: "server-1", plexUserId: "plex-1", username: "Owner", email: "owner@example.com", accountType: "OWNER", isAvailable: true },
    { id: "account-2", serverId: "server-1", plexUserId: "plex-2", username: "Family", email: null, accountType: "MANAGED", isAvailable: true },
    { id: "account-stale", serverId: "server-1", plexUserId: "plex-stale", username: "Gone", email: null, accountType: "SHARED", isAvailable: false },
  ];
  const mappings: any[] = [];
  const database: any = {
    server: {
      findFirst: async ({ where }: any) => servers.find((item) => item.id === where.id && item.userId === where.userId) || null,
    },
    user: {
      findUnique: async ({ where }: any) => users.find((item) => item.id === where.id) || null,
    },
    plexAccount: {
      findFirst: async ({ where }: any) => accounts.find((item) => item.serverId === where.serverId && item.isAvailable === where.isAvailable && (where.plexUserId ? item.plexUserId === where.plexUserId : item.id === where.id)) || null,
    },
    plexUserMapping: {
      findFirst: async ({ where }: any) => {
        const row = mappings.find((item) => item.serverId === where.serverId && item.plexUserId === where.plexUserId && item.enabled && item.userId !== where.NOT.userId);
        return row ? { user: { username: users.find((item) => item.id === row.userId)?.username } } : null;
      },
      upsert: async ({ where, create, update }: any) => {
        const row = mappings.find((item) => item.userId === where.userId_serverId.userId && item.serverId === where.userId_serverId.serverId);
        if (row) Object.assign(row, update, { updatedAt: new Date() });
        else mappings.push({ id: `mapping-${mappings.length + 1}`, ...create, createdAt: new Date(), updatedAt: new Date() });
      },
      findUnique: async ({ where }: any) => {
        const row = mappings.find((item) => item.userId === where.userId_serverId.userId && item.serverId === where.userId_serverId.serverId);
        if (!row) return null;
        const account = accounts.find((item) => item.id === row.plexAccountId);
        return { ...row, server: { id: "server-1", name: "Plex" }, plexAccount: account };
      },
      deleteMany: async ({ where }: any) => {
        const index = mappings.findIndex((item) => item.userId === where.userId && item.serverId === where.serverId);
        if (index < 0) return { count: 0 };
        mappings.splice(index, 1);
        return { count: 1 };
      },
    },
  };
  return { database, mappings };
}

describe("Plex user mapping persistence", () => {
  it("uses an additive migration with email backfill, unavailable state, and active-assignment conflict protection", () => {
    const migration = readFileSync(join(process.cwd(), "prisma", "migrations", "20260723210000_plex_user_mapping_reliability", "migration.sql"), "utf8");
    assert.match(migration, /ADD COLUMN "isAvailable" BOOLEAN NOT NULL DEFAULT false/);
    assert.match(migration, /ADD COLUMN "plexEmail" TEXT/);
    assert.match(migration, /SET "plexEmail" = account\."email"/);
    assert.match(migration, /SET "enabled" = false,[\s\S]*"mappingState" = 'CONFLICT'/);
    assert.match(migration, /CREATE UNIQUE INDEX "PlexUserMapping_one_active_assignment_per_account"[\s\S]*WHERE "enabled" = true/);
    assert.doesNotMatch(migration, /DELETE FROM "PlexUserMapping"/);
  });

  it("creates a mapping with stable Plex identity and an email snapshot", async () => {
    const { database, mappings } = fakeDatabase();
    const mapping = await savePlexUserMapping("admin", { userId: "mixarr-1", serverId: "server-1", plexUserId: "plex-1" }, database);
    assert.equal(mapping.plexUserId, "plex-1");
    assert.equal(mapping.plexEmail, "owner@example.com");
    assert.equal(mappings.length, 1);
  });

  it("changes an existing mapping instead of creating another row", async () => {
    const { database, mappings } = fakeDatabase();
    await savePlexUserMapping("admin", { userId: "mixarr-1", serverId: "server-1", plexUserId: "plex-1" }, database);
    const changed = await savePlexUserMapping("admin", { userId: "mixarr-1", serverId: "server-1", plexUserId: "plex-2" }, database);
    assert.equal(changed.plexUserId, "plex-2");
    assert.equal(changed.plexEmail, null);
    assert.equal(mappings.length, 1);
  });

  it("removes a mapping", async () => {
    const { database, mappings } = fakeDatabase();
    await savePlexUserMapping("admin", { userId: "mixarr-1", serverId: "server-1", plexUserId: "plex-1" }, database);
    assert.equal((await removePlexUserMapping("admin", { userId: "mixarr-1", serverId: "server-1" }, database)).removed, true);
    assert.equal(mappings.length, 0);
  });

  it("rejects Plex IDs that are absent or unavailable in the current discovery", async () => {
    const { database } = fakeDatabase();
    await assert.rejects(
      () => savePlexUserMapping("admin", { userId: "mixarr-1", serverId: "server-1", plexUserId: "plex-stale" }, database),
      (error: any) => error.code === "PLEX_ACCOUNT_UNAVAILABLE" && error.status === 422,
    );
  });

  it("returns a conflict instead of assigning one Plex account twice", async () => {
    const { database } = fakeDatabase();
    await savePlexUserMapping("admin", { userId: "mixarr-1", serverId: "server-1", plexUserId: "plex-1" }, database);
    await assert.rejects(
      () => savePlexUserMapping("admin", { userId: "mixarr-2", serverId: "server-1", plexUserId: "plex-1" }, database),
      (error: any) => error.code === "PLEX_ACCOUNT_ALREADY_MAPPED" && error.status === 409,
    );
  });

  it("loads the same stored mapping after a page-refresh style read", async () => {
    const { database } = fakeDatabase();
    const saved = await savePlexUserMapping("admin", { userId: "mixarr-1", serverId: "server-1", plexUserId: "plex-1" }, database);
    const loaded = await database.plexUserMapping.findUnique({ where: { userId_serverId: { userId: "mixarr-1", serverId: "server-1" } } });
    assert.equal(loaded.id, saved.id);
    assert.equal(loaded.plexUserId, "plex-1");
  });
});
