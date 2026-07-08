import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultBetaFeatureFlags,
  getBetaFlags,
  getUnknownBetaFlagNames,
  isExperimentalEnabled,
  isFeatureEnabled,
  normalizeBetaFeatureSettings,
} from "./betaFeatures";

describe("beta feature settings", () => {
  it("defaults experimental access and all flags off", () => {
    const settings = normalizeBetaFeatureSettings(null);

    assert.equal(settings.enableExperimentalFeatures, false);
    assert.deepEqual(settings.flags, defaultBetaFeatureFlags);
    assert.equal(isExperimentalEnabled(settings), false);
    assert.equal(isFeatureEnabled("showBetaCards", settings), false);
  });

  it("lets the master toggle override individual flags", () => {
    const settings = normalizeBetaFeatureSettings({
      enableExperimentalFeatures: false,
      flags: {
        showBetaCards: true,
        enableV2PreviewCards: true,
      },
    });

    assert.deepEqual(getBetaFlags(settings), defaultBetaFeatureFlags);
    assert.equal(isFeatureEnabled("showBetaCards", settings), false);
    assert.equal(isFeatureEnabled("enableV2PreviewCards", settings), false);
  });

  it("enables known flags only when experimental access is enabled", () => {
    const settings = normalizeBetaFeatureSettings({
      enableExperimentalFeatures: true,
      flags: {
        showBetaCards: true,
        enableV2PreviewCards: true,
        unknownFlag: true,
      },
    });

    assert.equal(isFeatureEnabled("showBetaCards", settings), true);
    assert.equal(isFeatureEnabled("enableV2PreviewCards", settings), true);
    assert.equal(isFeatureEnabled("unknownFlag", settings), false);
    assert.deepEqual(getUnknownBetaFlagNames({ flags: { unknownFlag: true } }), ["unknownFlag"]);
  });

  it("ignores invalid values safely", () => {
    const settings = normalizeBetaFeatureSettings({
      enableExperimentalFeatures: "true",
      flags: {
        showBetaCards: "true",
        enableV2PreviewCards: 1,
      },
    });

    assert.equal(settings.enableExperimentalFeatures, false);
    assert.deepEqual(settings.flags, defaultBetaFeatureFlags);
  });
});
