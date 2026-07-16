import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const source = (file: string) => readFileSync(join(process.cwd(), "src/lib", file), "utf8");

describe("production logging cleanup", () => {
  it("gates successful per-item enrichment diagnostics behind debug logging", () => {
    assert.match(source("popularityEngine.ts"), /logDebug\(`\[PopularityEngine\] Track/);
    assert.match(source("trackTagEngine.ts"), /logDebug\(`\[TrackTagEngine\] Track/);
    assert.match(source("audioFeatureEngine.ts"), /logDebug\(`\[AudioFeatureEngine\] Track/);
  });

  it("keeps Plex duplicate details at debug and summaries at info", () => {
    const plex = source("syncEngine.ts");
    assert.match(plex, /logDebug\(`\[PlexSync\] Preserved duplicate Plex item/);
    assert.match(plex, /logDebug\(`\[PlexSync\] Saved unresolved Plex item/);
    assert.match(plex, /console\.info\(`\[PlexSync\] Duplicate handling/);
    assert.match(plex, /console\.info\(`\[PlexSync\] Unresolved items/);
  });

  it("gates repeated Library Health and routine lock diagnostics", () => {
    assert.match(source("libraryHealth.ts"), /logDebug\(`\[LibraryHealth\] audio gap audit/);
    assert.match(source("jobLock.ts"), /logDebug\(`\[Worker\] Acquired job/);
    assert.match(source("jobLock.ts"), /logDebug\(`\[Worker\] Released job/);
  });
});
