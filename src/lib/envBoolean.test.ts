import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ENV_BOOLEAN_FALSE_VALUES,
  ENV_BOOLEAN_TRUE_VALUES,
  describeEnvBooleanIssue,
  envBoolean,
  envFlag,
} from "./envBoolean";

/**
 * Regression guard for boolean environment parsing.
 *
 * Background: `.env.example` documents two conventions in the same file —
 * numeric (`DEEZER_TAGS_ENABLED=1`, `DISCOGS_TAGS_ENABLED=0`) and textual
 * (`COMMUNITY_RECIPES_ENABLED=true`). Several fail-open flags were compared only
 * against the literal string "false", so an administrator who followed the
 * numeric convention and wrote `AI_PLAYLIST_SUMMARIES_ENABLED=0` left the
 * feature switched on: AI requests kept being issued and billed against a
 * feature the operator believed disabled.
 */
describe("environment boolean parsing", () => {
  it("treats every documented falsey spelling as disabled", () => {
    for (const value of ENV_BOOLEAN_FALSE_VALUES) {
      assert.equal(envBoolean(value, true), false, `"${value}" must disable a default-enabled flag`);
      assert.equal(envBoolean(value.toUpperCase(), true), false, `"${value}" must be case-insensitive`);
      assert.equal(envBoolean(`  ${value}  `, true), false, `"${value}" must tolerate surrounding whitespace`);
    }
  });

  it("treats every documented truthy spelling as enabled", () => {
    for (const value of ENV_BOOLEAN_TRUE_VALUES) {
      assert.equal(envBoolean(value, false), true, `"${value}" must enable a default-disabled flag`);
      assert.equal(envBoolean(value.toUpperCase(), false), true, `"${value}" must be case-insensitive`);
    }
  });

  it("keeps the caller's default for unset, blank, and unrecognized values", () => {
    for (const value of [undefined, null, "", "   "]) {
      assert.equal(envBoolean(value, true), true);
      assert.equal(envBoolean(value, false), false);
    }
    // An unrecognized value must never be guessed into the opposite of the
    // documented default; it is surfaced separately instead.
    assert.equal(envBoolean("maybe", true), true);
    assert.equal(envBoolean("maybe", false), false);
  });

  it("reports unrecognized values without echoing the configured value", () => {
    assert.equal(describeEnvBooleanIssue("SOME_FLAG", "true", true), null);
    assert.equal(describeEnvBooleanIssue("SOME_FLAG", "", true), null);
    const issue = describeEnvBooleanIssue("SOME_FLAG", "sekrit-typo", true);
    assert.ok(issue);
    assert.match(issue!, /SOME_FLAG is not a recognized boolean/);
    assert.doesNotMatch(issue!, /sekrit-typo/, "the raw value may be a pasted secret and must not be echoed");
  });

  it("reads process.env through the same rules", () => {
    assert.equal(envFlag("EXAMPLE_FLAG", true, { EXAMPLE_FLAG: "0" }), false);
    assert.equal(envFlag("EXAMPLE_FLAG", true, { EXAMPLE_FLAG: "off" }), false);
    assert.equal(envFlag("EXAMPLE_FLAG", false, { EXAMPLE_FLAG: "1" }), true);
    assert.equal(envFlag("EXAMPLE_FLAG", false, {}), false);
  });
});

describe("boolean flags use the shared reader", () => {
  const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

  it("no longer compares flags against the bare string literals", () => {
    const sources: Array<[string, string]> = [
      ["aiAdvisory/core.ts", read("src", "lib", "aiAdvisory", "core.ts")],
      ["communityRecipes/service.ts", read("src", "lib", "communityRecipes", "service.ts")],
      ["integrations/scheduler.ts", read("src", "lib", "integrations", "scheduler.ts")],
      ["integrations/service.ts", read("src", "lib", "integrations", "service.ts")],
      ["metrics.ts", read("src", "lib", "metrics.ts")],
      ["tautulli/import/route.ts", read("src", "app", "api", "integrations", "tautulli", "import", "route.ts")],
      ["webhooks/route.ts", read("src", "app", "api", "integrations", "webhooks", "route.ts")],
    ];
    for (const [name, source] of sources) {
      assert.doesNotMatch(source, /process\.env\.[A-Z_0-9]+\s*(?:!==|===)\s*"(?:true|false)"/, `${name} must resolve boolean flags through envFlag`);
      assert.match(source, /envFlag\(/, `${name} must import and use the shared reader`);
    }
  });

  it("preserves each flag's documented default", () => {
    assert.match(read("src", "lib", "aiAdvisory", "core.ts"), /envFlag\("AI_PLAYLIST_SUMMARIES_ENABLED", true\)/);
    assert.match(read("src", "lib", "aiAdvisory", "core.ts"), /envFlag\("AI_METADATA_SUGGESTIONS_ENABLED", true\)/);
    assert.match(read("src", "lib", "communityRecipes", "service.ts"), /envFlag\("COMMUNITY_RECIPES_ENABLED", true\)/);
    assert.match(read("src", "lib", "integrations", "scheduler.ts"), /envFlag\("INTEGRATION_SCHEDULER_ENABLED", true\)/);
    // Private-network egress and unauthenticated metrics stay opt-in.
    assert.match(read("src", "lib", "integrations", "service.ts"), /envFlag\("MIXARR_ALLOW_PRIVATE_WEBHOOKS", false\)/);
    assert.match(read("src", "lib", "metrics.ts"), /envFlag\("METRICS_ALLOW_UNAUTHENTICATED", false\)/);
  });
});
