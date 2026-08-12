import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { evaluateRequestLimit } from "../ai/governance/requestLimits";

const repository = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

/**
 * Container installations upgrade with `prisma db push`, which reconciles schema
 * shape only — it never executes the SQL in `prisma/migrations`. Any migration
 * that also backfills data therefore needs a companion idempotent file wired
 * into the Dockerfile CMD, the pattern already used by
 * `db-push-preflight.sql` and `db-push-v2.1.1-backfill.sql`.
 *
 * The v2.4.13 request-limit migration was missing that companion. `db push`
 * added "dailyRequestLimitMode" to "AiGovernanceSetting" with its column default
 * 'UNLIMITED' and left every existing row there, so a global daily AI request
 * limit configured before v2.4.13 silently stopped being enforced while still
 * being displayed as a stored number.
 */
describe("db push upgrade backfills", () => {
  const dockerfile = repository("Dockerfile");

  it("runs the v2.4.13 request-limit backfill after db push", () => {
    const command = dockerfile.split("\n").find((line) => line.startsWith("CMD "));
    assert.ok(command, "the Dockerfile must declare a CMD");
    const pushIndex = command!.indexOf("prisma db push");
    const backfillIndex = command!.indexOf("db-push-v2.4.13-request-limit-backfill.sql");
    assert.ok(backfillIndex > -1, "the v2.4.13 request-limit backfill must run on the container upgrade path");
    assert.ok(backfillIndex > pushIndex, "the backfill must run after db push has added the mode columns");
  });

  it("only promotes rows that could not have been set deliberately", () => {
    const sql = repository("prisma", "db-push-v2.4.13-request-limit-backfill.sql");
    // Choosing Unlimited in the interface clears the stored number, so a row
    // holding both Unlimited and a positive limit can only be un-backfilled.
    assert.match(sql, /UPDATE "AiGovernanceSetting" SET "dailyRequestLimitMode" = 'LIMITED'/);
    assert.match(sql, /"dailyRequestLimit" > 0/);
    for (const statement of sql.split(";").filter((part) => /SET "dailyRequestLimitMode" = 'LIMITED'/.test(part))) {
      assert.match(statement, /"dailyRequestLimit" IS NOT NULL AND "dailyRequestLimit" > 0/, "a limit must never be invented where none was stored");
      assert.match(statement, /"dailyRequestLimitMode" (?:=|IN)/, "the promotion must be guarded by the current mode so it stays idempotent");
    }
    assert.doesNotMatch(sql, /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i, "an upgrade backfill must never remove data");
  });

  it("every migration that backfills data has a db-push companion", () => {
    const migrations = join(process.cwd(), "prisma", "migrations");
    const command = dockerfile.split("\n").find((line) => line.startsWith("CMD ")) || "";
    const companionSql = readdirSync(join(process.cwd(), "prisma"))
      .filter((name) => name.endsWith(".sql"))
      .map((name) => repository("prisma", name))
      .join("\n");
    const unaccounted: string[] = [];
    for (const name of readdirSync(migrations)) {
      let sql: string;
      try { sql = repository("prisma", "migrations", name, "migration.sql"); } catch { continue; }
      // Data statements, ignoring the schema-only DDL that db push reproduces.
      const dataStatements = sql.split(";").filter((statement) => /^\s*(UPDATE|INSERT)\s/im.test(statement));
      if (!dataStatements.length) continue;
      const executedDirectly = command.includes(`migrations/${name}/migration.sql`);
      // A companion covers the migration when the same tables are backfilled.
      const tables = Array.from(new Set(dataStatements.flatMap((statement) => statement.match(/(?:UPDATE|INTO)\s+"([A-Za-z]+)"/g) || [])));
      const covered = tables.length > 0 && tables.every((table) => companionSql.includes(table.replace(/^(?:UPDATE|INTO)\s+/, "")));
      if (!executedDirectly && !covered) unaccounted.push(name);
    }
    // This is the audited backlog recorded in docs/quality/full-bug-audit.md:
    // 13 migrations still backfill data that container upgrades never receive.
    // Each needs individual review (many only restate a column DEFAULT that
    // `db push` already applies). The count must shrink, never grow.
    assert.ok(
      unaccounted.length <= 13,
      `migrations backfilling data without a db-push companion grew to ${unaccounted.length}: ${unaccounted.join(", ")}`,
    );
  });
});

describe("request-limit mode semantics the backfill restores", () => {
  it("an Unlimited mode ignores a stored positive limit", () => {
    // The state a container upgrade produced without the backfill.
    const evaluation = evaluateRequestLimit({ period: "DAILY", scopes: [{ scope: "GLOBAL", mode: "UNLIMITED", limit: 500, usage: 99_999 }] });
    assert.equal(evaluation.unlimited, true);
    assert.equal(evaluation.allowed, true, "this is exactly the silent loss of the administrator's throttle");
  });

  it("the backfilled Limited mode enforces the same stored limit", () => {
    const evaluation = evaluateRequestLimit({ period: "DAILY", scopes: [{ scope: "GLOBAL", mode: "LIMITED", limit: 500, usage: 99_999 }] });
    assert.equal(evaluation.unlimited, false);
    assert.equal(evaluation.allowed, false);
    assert.equal(evaluation.effective?.effectiveMode, "LIMITED");
    assert.equal(evaluation.limit, 500);
  });

  it("legacy INHERIT rows kept enforcing, which is why only the global scope regressed", () => {
    const evaluation = evaluateRequestLimit({ period: "DAILY", scopes: [{ scope: "USER", mode: "INHERIT", limit: 500, usage: 99_999 }] });
    assert.equal(evaluation.allowed, false);
  });
});
