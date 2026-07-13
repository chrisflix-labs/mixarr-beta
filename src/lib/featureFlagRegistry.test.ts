import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { featureFlagByKey, featureFlagRegistry, normalizeBetaAccessLevel } from "./featureFlagRegistry";
import { configuredServerBetaLevel, requiresBetaAcknowledgement, resolveFeatureDecision } from "./featureFlagService";

describe("advanced beta feature registry", () => {
  it("defines complete, uniquely keyed, disabled-by-default flags", () => {
    assert.equal(new Set(featureFlagRegistry.map((feature) => feature.key)).size, featureFlagRegistry.length);
    for (const feature of featureFlagRegistry) {
      assert.equal(feature.defaultEnabled, false);
      assert.ok(feature.name && feature.description && feature.warningText && feature.stableFallback);
      assert.ok(["LOW", "MEDIUM", "HIGH"].includes(feature.riskLevel));
      assert.ok(feature.introducedVersion);
    }
    assert.equal(featureFlagByKey.get("smartMix.experimentalScoring")?.minimumAccessLevel, "PUBLIC_BETA");
    assert.equal(featureFlagByKey.get("smartMix.autoReplaceWeakTracks")?.adminOnly, true);
  });

  it("normalizes access levels and keeps unknown input stable", () => {
    assert.equal(normalizeBetaAccessLevel("Private Beta"), "PRIVATE_BETA");
    assert.equal(normalizeBetaAccessLevel("developer"), "DEVELOPER");
    assert.equal(normalizeBetaAccessLevel("owner"), "STABLE");
  });

  it("keeps the server beta ceiling stable when no environment flag is set", () => {
    const saved = { public: process.env.MIXARR_BETA_PROGRAM_ENABLED, private: process.env.MIXARR_PRIVATE_BETA_ENABLED, developer: process.env.MIXARR_DEVELOPER_FEATURES_ENABLED };
    delete process.env.MIXARR_BETA_PROGRAM_ENABLED; delete process.env.MIXARR_PRIVATE_BETA_ENABLED; delete process.env.MIXARR_DEVELOPER_FEATURES_ENABLED;
    assert.equal(configuredServerBetaLevel(), "STABLE");
    if (saved.public === undefined) delete process.env.MIXARR_BETA_PROGRAM_ENABLED; else process.env.MIXARR_BETA_PROGRAM_ENABLED = saved.public;
    if (saved.private === undefined) delete process.env.MIXARR_PRIVATE_BETA_ENABLED; else process.env.MIXARR_PRIVATE_BETA_ENABLED = saved.private;
    if (saved.developer === undefined) delete process.env.MIXARR_DEVELOPER_FEATURES_ENABLED; else process.env.MIXARR_DEVELOPER_FEATURES_ENABLED = saved.developer;
  });

  it("enforces opt-in, access tiers, admin restrictions, and individual flags server-side", () => {
    const publicFeature = featureFlagByKey.get("smartMix.experimentalScoring")!;
    const privateFeature = featureFlagByKey.get("smartMix.experimentalMoodGraph")!;
    const adminFeature = featureFlagByKey.get("smartMix.recentlyAddedAutoAdd")!;
    const base = { serverAccessLevel: "PRIVATE_BETA" as const, userAccessLevel: "PUBLIC_BETA" as const, betaOptIn: true, isAdmin: false, flagEnabled: true, requireUserEnabled: true, runtimeSupported: true };
    assert.equal(resolveFeatureDecision({ ...base, definition: publicFeature, betaOptIn: false }), "beta_program_disabled");
    assert.equal(resolveFeatureDecision({ ...base, definition: publicFeature, flagEnabled: false }), "disabled_by_default");
    assert.equal(resolveFeatureDecision({ ...base, definition: privateFeature }), "private_beta_unavailable");
    assert.equal(resolveFeatureDecision({ ...base, definition: adminFeature, userAccessLevel: "PRIVATE_BETA" }), "admin_required");
    assert.equal(resolveFeatureDecision({ ...base, definition: publicFeature }), "enabled");
  });

  it("lets server disablement and emergency switches override every user setting", () => {
    const definition = featureFlagByKey.get("smartMix.experimentalScoring")!;
    const enabled = { definition, serverAccessLevel: "PRIVATE_BETA" as const, userAccessLevel: "PRIVATE_BETA" as const, betaOptIn: true, isAdmin: true, flagEnabled: true, requireUserEnabled: true, runtimeSupported: true };
    assert.equal(resolveFeatureDecision({ ...enabled, override: { enabled: false } }), "server_disabled");
    assert.equal(resolveFeatureDecision({ ...enabled, emergencyDisabled: true }), "emergency_disabled");
    assert.equal(resolveFeatureDecision({ ...enabled, override: { forceDisabled: true } }), "emergency_disabled");
  });

  it("grandfathers an enabled v1.5 beta setting without weakening new opt-in acknowledgement", () => {
    assert.equal(requiresBetaAcknowledgement({ enableBetaFeatures: true, acknowledged: false, hasExistingPreference: false, existingAccepted: false, legacyEnabled: true }), false);
    assert.equal(requiresBetaAcknowledgement({ enableBetaFeatures: true, acknowledged: false, hasExistingPreference: false, existingAccepted: false, legacyEnabled: false }), true);
    assert.equal(requiresBetaAcknowledgement({ enableBetaFeatures: true, acknowledged: true, hasExistingPreference: false, existingAccepted: false, legacyEnabled: false }), false);
  });
});
