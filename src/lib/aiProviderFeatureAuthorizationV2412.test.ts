import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  evaluateProviderFeatureAuthorization,
  externalDataCategoriesForFeature,
  providerSlug,
  type AuthorizationInput,
} from "../ai/governance/authorizationEvaluator";
import {
  AI_FEATURES,
  canonicalFeatureId,
  isKnownFeatureId,
  reportUnknownFeatureIds,
} from "../ai/features/registry";

const read = (path: string) => readFileSync(path, "utf8");

// Fully-authorized DeepSeek external Recipe Copilot request that mirrors the
// documented manual verification steps (external providers on, provider approved
// and approved for recipe_copilot, external requests on, METADATA_LIMITED
// permitted, user_request + recipe_configuration data categories permitted,
// confirmation satisfied, model available and approved with structured output).
function baseInput(): AuthorizationInput {
  return {
    requestedFeature: "recipe_copilot",
    privacyMode: "METADATA_LIMITED",
    externalConfirmation: true,
    requiredCapabilities: ["chat_messages", "structured_json"],
    aiEnvDisabled: false,
    globalEnabled: true,
    emergencyShutdown: false,
    featureImplemented: true,
    featureEnabled: true,
    externalProvidersAllowed: true,
    requireExternalConfirmation: true,
    allowedExternalDataJson: ["user_request", "recipe_configuration"],
    provider: {
      id: "provider-deepseek", displayName: "DeepSeek", providerType: "deepseek",
      enabled: true, approved: true, deleted: false,
      allowedFeaturesJson: ["recipe_copilot"], privacyModesJson: ["METADATA_LIMITED"],
      allowExternalRequests: true, allowLibraryMetadata: false, allowDiagnosticData: false,
      locationClassification: "REMOTE", administratorConfirmedLocal: false, trustedNetwork: false,
    },
    model: {
      availabilityStatus: "AVAILABLE", deprecated: false, enabled: true, approved: true,
      allowedFeaturesJson: ["recipe_copilot"], capabilitiesJson: ["chat_messages"],
      structuredOutput: true, jsonMode: false, toolCalling: false,
    },
  };
}

function withProvider(patch: Partial<AuthorizationInput["provider"]>, rest: Partial<AuthorizationInput> = {}): AuthorizationInput {
  const base = baseInput();
  return { ...base, ...rest, provider: { ...base.provider, ...patch } };
}

describe("v2.4.12 canonical AI feature registry", () => {
  it("normalizes capitalization, hyphens, spaces, and legacy names to canonical IDs", () => {
    assert.equal(canonicalFeatureId("Recipe Copilot"), AI_FEATURES.RECIPE_COPILOT);
    assert.equal(canonicalFeatureId("recipe-copilot"), AI_FEATURES.RECIPE_COPILOT);
    assert.equal(canonicalFeatureId("RECIPE_COPILOT"), AI_FEATURES.RECIPE_COPILOT);
    assert.equal(canonicalFeatureId("  recipe_generation  "), AI_FEATURES.RECIPE_COPILOT);
    assert.equal(canonicalFeatureId("natural_language_playlist_requests"), AI_FEATURES.NATURAL_LANGUAGE_PLAYLIST_REQUESTS);
  });
  it("never conflates Recipe Copilot with natural-language playlist requests", () => {
    assert.notEqual(canonicalFeatureId("recipe_copilot"), canonicalFeatureId("natural_language_playlist_requests"));
  });
  it("recognizes known features and reports unknown ones without throwing", () => {
    assert.equal(isKnownFeatureId("Recipe Copilot"), true);
    assert.equal(isKnownFeatureId("totally_made_up_feature"), false);
    assert.deepEqual(reportUnknownFeatureIds(["recipe_copilot", "made_up"], "test"), ["made_up"]);
  });
  it("maps the five implemented features to canonical external data categories", () => {
    assert.deepEqual(externalDataCategoriesForFeature("recipe_copilot"), ["user_request", "recipe_configuration"]);
    assert.deepEqual(externalDataCategoriesForFeature("natural_language_playlist_requests"), ["user_request"]);
  });
});

describe("v2.4.12 provider feature authorization evaluator", () => {
  it("1. allows Recipe Copilot when every required control is genuinely enabled", () => {
    const decision = evaluateProviderFeatureAuthorization(baseInput());
    assert.equal(decision.allowed, true);
    assert.equal(decision.code, null);
    assert.equal(decision.failedCheck, null);
    assert.equal(decision.requestedFeature, "recipe_copilot");
    assert.equal(decision.providerSlug, "deepseek");
  });

  it("2. returns AI_PROVIDER_FEATURE_BLOCKED only for a real provider-feature approval failure", () => {
    const decision = evaluateProviderFeatureAuthorization(withProvider({ allowedFeaturesJson: [] }));
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "AI_PROVIDER_FEATURE_BLOCKED");
    assert.equal(decision.failedCheck, "provider_feature_approval");
    assert.equal(decision.requestedFeature, "recipe_copilot");
  });

  it("3. approval for natural_language_playlist_requests alone does not approve recipe_copilot", () => {
    const decision = evaluateProviderFeatureAuthorization(withProvider({ allowedFeaturesJson: ["natural_language_playlist_requests"] }));
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "AI_PROVIDER_FEATURE_BLOCKED");
  });

  it("4. accepts legacy/variant provider feature IDs via canonicalization", () => {
    for (const alias of ["recipe-copilot", "RECIPE_COPILOT", "Recipe Copilot", "recipe_generation"]) {
      const decision = evaluateProviderFeatureAuthorization(withProvider({ allowedFeaturesJson: [alias] }));
      assert.equal(decision.allowed, true, `alias ${alias} should authorize`);
    }
  });

  it("5. provider display-name capitalization and requested-feature spelling do not affect authorization", () => {
    const decision = evaluateProviderFeatureAuthorization(withProvider({ displayName: "DEEPSEEK", providerType: "DeepSeek" }, { requestedFeature: "Recipe-Copilot" }));
    assert.equal(decision.allowed, true);
    assert.equal(decision.providerSlug, "deepseek");
    assert.equal(providerSlug({ slug: null, providerType: "Open AI", displayName: "x" }), "open_ai");
  });

  it("6. is deterministic across repeated evaluations of identical inputs (stable after restart)", () => {
    const a = evaluateProviderFeatureAuthorization(baseInput());
    const b = evaluateProviderFeatureAuthorization(baseInput());
    assert.deepEqual(a, b);
  });

  it("7. reflects an updated permission immediately with no internal caching", () => {
    assert.equal(evaluateProviderFeatureAuthorization(withProvider({ allowedFeaturesJson: [] })).allowed, false);
    assert.equal(evaluateProviderFeatureAuthorization(withProvider({ allowedFeaturesJson: ["recipe_copilot"] })).allowed, true);
  });

  it("9. authorizes independently of any recipe identity (unsaved recipes work)", () => {
    // The evaluator has no recipe/recipeId input at all; a fully-enabled request
    // is allowed regardless of whether a recipe has ever been saved.
    assert.equal(evaluateProviderFeatureAuthorization(baseInput()).allowed, true);
  });

  it("10. a disabled global external-provider setting blocks with the external-access code, not feature-blocked", () => {
    const decision = evaluateProviderFeatureAuthorization({ ...baseInput(), externalProvidersAllowed: false });
    assert.equal(decision.code, "AI_EXTERNAL_PROVIDER_BLOCKED");
    assert.equal(decision.failedCheck, "external_requests_allowed");
    assert.notEqual(decision.code, "AI_PROVIDER_FEATURE_BLOCKED");
  });

  it("11a. a disallowed privacy mode returns the privacy-mode-specific error", () => {
    const decision = evaluateProviderFeatureAuthorization(withProvider({ privacyModesJson: ["FULL_METADATA"] }));
    assert.equal(decision.code, "PRIVACY_MODE_INCOMPATIBLE");
    assert.notEqual(decision.code, "AI_PROVIDER_FEATURE_BLOCKED");
  });

  it("11b. a missing external data category returns the privacy-policy error with the category", () => {
    const decision = evaluateProviderFeatureAuthorization({ ...baseInput(), allowedExternalDataJson: ["user_request"] });
    assert.equal(decision.code, "AI_PRIVACY_POLICY_BLOCKED");
    assert.equal(decision.details.data_category, "recipe_configuration");
  });

  it("12. a model lacking structured_json capability returns the capability-specific error", () => {
    const base = baseInput();
    const decision = evaluateProviderFeatureAuthorization({ ...base, model: { ...base.model!, structuredOutput: false, capabilitiesJson: ["chat_messages"] } });
    assert.equal(decision.code, "CAPABILITY_UNAVAILABLE");
    assert.deepEqual(decision.details.missing_capabilities, ["structured_json"]);
  });

  it("13. disabling Recipe Copilot blocks only Recipe Copilot, not other features", () => {
    const recipeBlocked = evaluateProviderFeatureAuthorization({ ...baseInput(), featureEnabled: false });
    assert.equal(recipeBlocked.code, "FEATURE_DISABLED");
    // A different, still-enabled feature on a provider approved for it is unaffected.
    const summariesOk = evaluateProviderFeatureAuthorization(withProvider(
      { allowedFeaturesJson: ["playlist_ai_summaries"], allowLibraryMetadata: true },
      { requestedFeature: "playlist_ai_summaries", featureEnabled: true, allowedExternalDataJson: ["library_metadata", "playlist_metadata"], model: { availabilityStatus: "AVAILABLE", deprecated: false, enabled: true, approved: true, allowedFeaturesJson: ["playlist_ai_summaries"], capabilitiesJson: ["chat_messages", "structured_json"], structuredOutput: true, jsonMode: false, toolCalling: false } },
    ));
    assert.equal(summariesOk.allowed, true);
  });

  it("14. multiple providers retain independent per-feature permissions", () => {
    const approved = evaluateProviderFeatureAuthorization(withProvider({ id: "p1", allowedFeaturesJson: ["recipe_copilot"] }));
    const notApproved = evaluateProviderFeatureAuthorization(withProvider({ id: "p2", allowedFeaturesJson: ["metadata_suggestions"] }));
    assert.equal(approved.allowed, true);
    assert.equal(notApproved.allowed, false);
    assert.equal(notApproved.code, "AI_PROVIDER_FEATURE_BLOCKED");
  });

  it("8/regression. provider approval is not feature approval", () => {
    // Provider approved=true but not approved for the feature must still block.
    const decision = evaluateProviderFeatureAuthorization(withProvider({ approved: true, allowedFeaturesJson: [] }));
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "AI_PROVIDER_FEATURE_BLOCKED");
  });

  it("returns a structured decision with the fields the API and UI rely on", () => {
    const decision = evaluateProviderFeatureAuthorization(withProvider({ allowedFeaturesJson: [] }));
    for (const key of ["allowed", "code", "failedCheck", "requestedFeature", "providerId", "providerSlug"]) {
      assert.ok(key in decision, `decision must expose ${key}`);
    }
  });
});

describe("v2.4.12 wiring, migration, and version", () => {
  it("routes execution-policy authorization through the centralized evaluator", () => {
    const source = read("src/ai/governance/executionPolicy.ts");
    assert.match(source, /evaluateProviderFeatureAuthorization/);
    assert.match(source, /prisma\.aiProviderConfig\.findUnique/);
  });

  it("removes the duplicate global external-features authorization gate", () => {
    const source = read("src/ai/governance/executionPolicy.ts");
    assert.doesNotMatch(source, /allowedExternalFeaturesJson/);
  });

  it("does not special-case DeepSeek or any provider in the evaluator", () => {
    const source = read("src/ai/governance/authorizationEvaluator.ts");
    assert.doesNotMatch(source, /deepseek/i);
  });

  it("8. queue and worker authorize under the same canonical Recipe Copilot feature as the API", () => {
    const service = read("src/lib/recipeCopilot/service.ts");
    // Same canonical key used for the preflight, the coordinator dispatch, and the audit.
    assert.equal((service.match(/RECIPE_COPILOT_FEATURE_KEY/g) || []).length >= 2, true);
    assert.match(read("src/lib/recipeCopilot/contracts.ts"), /RECIPE_COPILOT_FEATURE_KEY = "recipe_copilot"/);
    const coordinator = read("src/ai/request-coordinator/index.ts");
    assert.match(coordinator, /requireAiFeaturePermission\(userId, request\.featureKey\)/);
  });

  it("9. Recipe Copilot operates on unsaved recipes without a recipe database ID", () => {
    const service = read("src/lib/recipeCopilot/service.ts");
    assert.match(service, /recipeId \? await ownedRecipe\(userId, recipeId\) : null/);
    assert.match(service, /defaultRecipeStudioDraft\(\)/);
  });

  it("15. ships an idempotent, approval-preserving canonicalization migration that grants nothing", () => {
    const migration = read("prisma/migrations/20260731010000_ai_provider_feature_authorization_v2412/migration.sql");
    assert.match(migration, /jsonb_agg\(DISTINCT/);
    assert.match(migration, /IS DISTINCT FROM/);
    assert.match(migration, /recipe_generation/);
    assert.doesNotMatch(migration, /DELETE|TRUNCATE|DROP TABLE/i);
  });

  it("exposes an administrator-safe effective-authorization diagnostic route", () => {
    const route = read("src/app/api/ai/effective-policy/route.ts");
    assert.match(route, /getEffectiveAuthorization/);
    assert.match(route, /VIEW_SANITIZED_AI_DETAILS/);
  });

  it("10. reports version v2.4.12 in package metadata and release notes", () => {
    assert.equal(JSON.parse(read("package.json")).version, "2.4.23");
    assert.match(read("src/lib/releaseNotes.ts"), /version: "2\.4\.12"/);
    assert.match(read("CHANGELOG.md"), /## v2\.4\.12 - AI Provider Feature Authorization Fix/);
  });
});
