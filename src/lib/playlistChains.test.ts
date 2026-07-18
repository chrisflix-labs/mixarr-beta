import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeBpmHandoff, analyzeEnergyHandoff, analyzeMoodHandoff, analyzePlaylistHandoff, calculateChainScores } from "./playlistChains/analysis";
import { BUILT_IN_ROLE_PRESETS, resolveRoleGuidance, roleGuidanceDifferences } from "./playlistChains/presets";
import { chainInputSchema, chainSettingsSchema, type PlaylistJourneySummary } from "./playlistChains/types";

const file = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
function summary(overrides: Partial<PlaylistJourneySummary> = {}): PlaylistJourneySummary {
  return {
    playlistId: "playlist", name: "Playlist", trackCount: 3, estimatedDurationMs: 600_000,
    startingBpm: 100, endingBpm: 110, startingBpmRange: [98, 102], endingBpmRange: [108, 112],
    startingEnergy: 0.5, endingEnergy: 0.6, primaryMoods: ["Upbeat"], startingMoods: ["Upbeat"], endingMoods: ["Upbeat"],
    moodIntensityStart: 0.55, moodIntensityEnd: 0.62, metadataConfidence: 100, missing: { bpm: 0, energy: 0, mood: 0, unavailable: 0 },
    familiarityPercent: 60, energyCurve: [0.5, 0.55, 0.6], bpmCurve: [100, 105, 110], moodCurve: [0.55, 0.58, 0.62], tracks: [], ...overrides,
  };
}

describe("playlist role presets", () => {
  it("ships every required built-in role with conservative advisory defaults", () => {
    assert.deepEqual(BUILT_IN_ROLE_PRESETS.map((role) => role.name), ["Intro", "Warm-up", "Main", "Peak Energy", "Recovery", "Cooldown", "Discovery", "Intermission", "After-Hours", "Archive", "Custom"]);
    assert.equal(BUILT_IN_ROLE_PRESETS.find((role) => role.key === "archive")?.settings.automaticChanges, false);
  });
  it("resolves explicit overrides without mutating role defaults", () => {
    const role = BUILT_IN_ROLE_PRESETS[0]; const resolved = resolveRoleGuidance(role, { bpmMax: 112, settings: { artistVariety: 0.9 } });
    assert.equal(resolved.bpmMax, 112); assert.equal(resolved.energyStart, role.energyStart); assert.equal(resolved.settings.artistVariety, 0.9); assert.equal(role.bpmMax, 105);
    assert.deepEqual(roleGuidanceDifferences(role, resolved), ["bpmMax"]);
  });
  it("defaults user settings to suggestions and disables automatic repair", () => {
    const settings = chainSettingsSchema.parse({});
    assert.equal(settings.defaultRoleBehavior, "SUGGEST"); assert.equal(settings.automaticallyRepairWeakHandoffs, false); assert.equal(settings.preserveLockedBoundaryTracks, true);
  });
});

describe("playlist handoff analysis", () => {
  it("scores a small energy increase as smooth", () => {
    const result = analyzeEnergyHandoff(summary({ endingEnergy: 0.61 }), summary({ startingEnergy: 0.66 }), "SMOOTH_CONTINUATION");
    assert.equal(result.difference, 5); assert.ok((result.score || 0) >= 85);
  });
  it("respects gradual energy direction and intentional contrast", () => {
    const wrong = analyzeEnergyHandoff(summary({ endingEnergy: 0.7 }), summary({ startingEnergy: 0.45 }), "GRADUAL_INCREASE");
    const contrast = analyzeEnergyHandoff(summary({ endingEnergy: 0.7 }), summary({ startingEnergy: 0.2 }), "INTENTIONAL_CONTRAST");
    assert.ok((wrong.score ?? 100) < 50); assert.equal(contrast.score, 85);
  });
  it("reuses half-time and double-time BPM compatibility", () => {
    const result = analyzeBpmHandoff(summary({ endingBpm: 75 }), summary({ startingBpm: 150 }), "DOUBLE_TIME", 8);
    assert.equal(result.effectiveGap, 0); assert.notEqual(result.relationship, "direct"); assert.ok((result.score || 0) >= 90);
  });
  it("marks missing BPM as unable to evaluate", () => {
    const result = analyzeBpmHandoff(summary({ endingBpm: null }), summary(), "SMOOTH_CONTINUATION");
    assert.equal(result.score, null); assert.match(result.explanation, /missing/i);
  });
  it("uses multi-mood overlap and emotional direction", () => {
    const result = analyzeMoodHandoff(summary({ endingMoods: ["Energetic", "Upbeat"], moodIntensityEnd: 0.6 }), summary({ startingMoods: ["Upbeat", "Party"], moodIntensityStart: 0.72 }), "EMOTIONAL_BUILD");
    assert.deepEqual(result.sharedMoods, ["upbeat"]); assert.ok((result.score || 0) >= 50); assert.equal(result.intensityDifference, 12);
  });
  it("produces explainable category and overall scores", () => {
    const handoff = analyzePlaylistHandoff({ fromMemberId: "from", toMemberId: "to", from: summary({ playlistId: "from" }), to: summary({ playlistId: "to", startingBpm: 112, startingEnergy: 0.64 }), energyMode: "SMOOTH_CONTINUATION", bpmMode: "SMOOTH_CONTINUATION", moodMode: "SMOOTH_CONTINUATION" });
    const scores = calculateChainScores([handoff], ["intro", "main"], [summary(), summary()]);
    assert.ok((scores.overall || 0) > 60); assert.ok((scores.roleProgression || 0) >= 90); assert.equal(typeof handoff.explanations[0], "string");
  });
});

describe("chain contracts and migration", () => {
  it("allows the same playlist at different member positions while requiring two members", () => {
    const playlistId = "11111111-1111-4111-8111-111111111111";
    const value = chainInputSchema.parse({ name: "Repeated set", members: [{ playlistId }, { playlistId }] });
    assert.equal(value.members.length, 2);
    assert.throws(() => chainInputSchema.parse({ name: "Too short", members: [{ playlistId }] }));
  });
  it("uses explicit indexed memberships, handoffs, versions, and idempotent built-ins", () => {
    const migration = file("prisma/migrations/20260718010000_playlist_roles_progression_chains/migration.sql");
    assert.match(migration, /DROP INDEX IF EXISTS "PlaylistProgressionMember_chainId_playlistId_key"/);
    assert.match(migration, /PlaylistChainHandoff_chainId_fromMemberId_toMemberId_key/);
    assert.match(migration, /PlaylistChainVersion_chainId_versionNumber_key/);
    assert.match(migration, /ON CONFLICT \("key"\) DO UPDATE/);
    assert.match(migration, /automaticallyRepairWeakHandoffs" BOOLEAN NOT NULL DEFAULT false/);
  });
  it("keeps optimization preview separate from application and checks ownership", () => {
    const service = file("src/lib/playlistChains/service.ts");
    assert.match(service, /createChainOptimizationPreview/); assert.match(service, /applyChainOptimization/);
    assert.match(service, /baseVersionNumber !== chain\.versionCounter/); assert.match(service, /where: \{ id: chainId, userId \}/);
    assert.match(service, /sourcePlaylistsModified: false/);
  });
  it("provides background progress, cancellation, and bounded track lookup", () => {
    const jobs = file("src/lib/playlistChains/jobs.ts"); const service = file("src/lib/playlistChains/service.ts");
    assert.match(jobs, /Evaluating energy handoffs/); assert.match(jobs, /controller\.abort/); assert.match(jobs, /safeFinishJobHistory/);
    assert.match(service, /queryInBatches\(trackIds/);
  });
  it("exposes the dedicated responsive editor and complete API workflow", () => {
    const ui = file("src/components/PlaylistChainsWorkspace.tsx"); const css = file("src/components/PlaylistChainsWorkspace.module.css");
    assert.match(ui, /Create Progression Chain/); assert.match(ui, /Chain Optimization Preview/); assert.match(ui, /Open next playlist/); assert.match(ui, /Plex clients cannot be forced/);
    assert.match(css, /@media\(max-width:700px\)/);
    for (const route of ["analyze", "preview", "optimize", "apply-optimization", "generate-master", "sync-master"]) assert.ok(file(`src/app/api/playlist-chains/[id]/${route}/route.ts`).length > 0);
  });
});
