import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Plex user mapping integration UI", () => {
  const component = readFileSync(join(process.cwd(), "src", "components", "IntegrationCenter.tsx"), "utf8");

  it("loads accounts once when the integrations page opens and exposes refresh", () => {
    assert.match(component, /useEffect\(\(\) => \{/);
    assert.match(component, /discoveryStarted\.current/);
    assert.match(component, /void loadPlexAccounts\(\)/);
    assert.match(component, /Refresh Plex accounts/);
    assert.match(component, /loadPlexAccounts\(true\)/);
  });

  it("shows loading, empty, not-configured, and retryable failure states", () => {
    assert.match(component, /Loading Plex accounts…/);
    assert.match(component, /No Plex accounts were returned by the connected Plex server\./);
    assert.match(component, /Configure and connect Plex before mapping users\./);
    assert.match(component, /Unable to load Plex accounts\./);
    assert.match(component, />Retry</);
  });

  it("populates stable account options with owner and managed-user labels", () => {
    assert.match(component, /formatPlexAccountLabel\(account\)/);
    assert.match(component, /value=\{account\.id\}/);
    assert.match(component, /plexUserId: account\.id/);
  });

  it("preselects stored mappings and marks missing accounts unavailable", () => {
    assert.match(component, /value=\{mapping\?\.plexUserId \|\| ""\}/);
    assert.match(component, /Unavailable from current discovery/);
    assert.match(component, /Stored Plex account[\s\S]*Unavailable/);
  });

  it("updates saves and removals locally without a page reload", () => {
    assert.match(component, /setData\(\(current: any\) =>/);
    assert.match(component, /Remove mapping/);
    assert.match(component, /method: "DELETE"/);
    assert.doesNotMatch(component, /location\.reload/);
    assert.match(component, /Saving mapping…/);
  });
});
