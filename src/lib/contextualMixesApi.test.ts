import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("Contextual Mixes persistence and API contracts", () => {
  it("uses an additive indexed migration with compact versioned snapshots", () => {
    const migration = read("prisma", "migrations", "20260716040000_contextual_mixes", "migration.sql");
    assert.match(migration, /CREATE TABLE "ContextProfile"/);
    assert.match(migration, /CREATE TABLE "ContextualMixSetting"/);
    assert.match(migration, /ContextProfile_userId_isEnabled_updatedAt_idx/);
    assert.match(migration, /contextSnapshotJson/);
    assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/);
  });

  it("requires cookie authentication on list, mutation, apply, clone, reset, and settings routes", () => {
    const routes = [
      ["src", "app", "api", "contextual-mixes", "route.ts"],
      ["src", "app", "api", "contextual-mixes", "[id]", "route.ts"],
      ["src", "app", "api", "contextual-mixes", "[id]", "clone", "route.ts"],
      ["src", "app", "api", "contextual-mixes", "[id]", "reset", "route.ts"],
      ["src", "app", "api", "contextual-mixes", "apply", "route.ts"],
      ["src", "app", "api", "contextual-mixes", "settings", "route.ts"],
    ];
    for (const route of routes) {
      const source = read(...route);
      assert.match(source, /mixarr_session/);
      assert.match(source, /Unauthorized/);
    }
  });

  it("enforces ownership and protects built-ins from mutation", () => {
    const service = read("src", "lib", "contextualMixProfileService.ts");
    const detailRoute = read("src", "app", "api", "contextual-mixes", "[id]", "route.ts");
    assert.match(service, /where: \{ id, userId \}/);
    assert.match(service, /deleteMany\(\{ where: \{ id, userId \} \}\)/);
    assert.match(detailRoute, /Built-in contexts are read-only/);
    assert.match(detailRoute, /Built-in contexts cannot be deleted/);
  });

  it("exposes accessible selection, confirmation, override, empty, and responsive UI states", () => {
    const panel = read("src", "components", "ContextualMixesPanel.tsx");
    const builder = read("src", "app", "builder", "page.tsx");
    const css = read("src", "components", "ContextualMixesPanel.module.css");
    assert.match(panel, /aria-pressed/);
    assert.match(panel, /role="dialog"/);
    assert.match(panel, /Apply only unset values/);
    assert.match(panel, /Restore context default/);
    assert.match(panel, /No custom contexts yet/);
    assert.match(builder, /Context confidence/);
    assert.match(css, /@media \(max-width: 680px\)/);
  });
});
