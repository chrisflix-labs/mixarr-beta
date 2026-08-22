import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { evaluateProviderLifecycleAuthorization, type AiProviderOperation } from "../ai/governance/providerLifecycle";
import { evaluateProviderFeatureAuthorization, type AuthorizationInput } from "../ai/governance/authorizationEvaluator";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const setupOperations: AiProviderOperation[] = ["PROVIDER_AUTHENTICATION", "PROVIDER_DISCOVERY", "PROVIDER_HEALTH_CHECK", "PROVIDER_TEST_INFERENCE"];
const providerState = { exists: true, deleted: false, enabled: true, approved: false };

function productionInput(approved: boolean): AuthorizationInput {
  return {
    requestedFeature: "recipe_copilot", privacyMode: "LOCAL_ONLY", requiredCapabilities: ["chat_messages"],
    aiEnvDisabled: false, globalEnabled: true, emergencyShutdown: false, featureImplemented: true, featureEnabled: true,
    externalProvidersAllowed: false, requireExternalConfirmation: true, allowedExternalDataJson: [],
    provider: { id: "ollama-provider", displayName: "Ollama", providerType: "ollama", enabled: true, approved, deleted: false, allowedFeaturesJson: ["recipe_copilot"], privacyModesJson: ["LOCAL_ONLY"], allowExternalRequests: false, allowLibraryMetadata: false, allowDiagnosticData: false, locationClassification: "LOCAL", administratorConfirmedLocal: true, trustedNetwork: true },
    model: { availabilityStatus: "AVAILABLE", deprecated: false, enabled: true, approved: true, allowedFeaturesJson: ["recipe_copilot"], capabilitiesJson: ["chat_messages"], structuredOutput: false, jsonMode: false, toolCalling: false },
  };
}

describe("AI provider lifecycle authorization", () => {
  it("allows every required setup operation for an enabled provider before production approval", () => {
    for (const operation of setupOperations) {
      const decision = evaluateProviderLifecycleAuthorization(operation, providerState);
      assert.equal(decision.allowed, true, operation);
      assert.equal(decision.reason, "setup_operation_permitted");
    }
  });

  it("blocks feature inference until approval and permits it after approval", () => {
    const blocked = evaluateProviderLifecycleAuthorization("FEATURE_INFERENCE", providerState);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.code, "AI_PROVIDER_NOT_APPROVED");
    assert.equal(evaluateProviderFeatureAuthorization(productionInput(false)).code, "AI_PROVIDER_NOT_APPROVED");
    assert.equal(evaluateProviderFeatureAuthorization(productionInput(true)).allowed, true);
  });

  it("blocks disabled providers consistently for setup and production", () => {
    for (const operation of [...setupOperations, "FEATURE_INFERENCE"] as AiProviderOperation[]) {
      const decision = evaluateProviderLifecycleAuthorization(operation, { ...providerState, enabled: false, approved: true });
      assert.equal(decision.allowed, false, operation);
      assert.equal(decision.code, "PROVIDER_DISABLED", operation);
    }
  });

  it("keeps remote-provider feature governance unchanged", () => {
    const remote = productionInput(true);
    remote.privacyMode = "METADATA_LIMITED";
    remote.provider.privacyModesJson = ["METADATA_LIMITED"];
    remote.provider.locationClassification = "REMOTE";
    remote.provider.administratorConfirmedLocal = false;
    remote.provider.trustedNetwork = false;
    const decision = evaluateProviderFeatureAuthorization(remote);
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "AI_EXTERNAL_PROVIDER_BLOCKED");
  });

  it("routes administrative endpoints through explicit operations instead of the production approval guard", () => {
    const governance = read("src/ai/governance/service.ts");
    const health = read("src/ai/health/service.ts");
    assert.doesNotMatch(governance, /if \(!providerRow\.approved\) throw new AiError\("AI_PROVIDER_NOT_APPROVED"\)/);
    for (const operation of setupOperations) assert.match(`${governance}\n${health}`, new RegExp(operation));
    assert.match(governance, /Provider operation authorization/);
    assert.match(governance, /approvalStatus/);
  });

  it("preserves provider configuration and discovered-model persistence across updates", () => {
    const providerService = read("src/ai/services/providerService.ts");
    const health = read("src/ai/health/service.ts");
    assert.match(providerService, /prisma\.aiProviderConfig\.update\(\{ where: \{ id \}, data \}\)/);
    assert.match(health, /aiProviderModel\.upsert/);
    assert.match(health, /availabilityStatus: "AVAILABLE"/);
    assert.match(providerService, /defaultModel: row\.defaultModel/);
    assert.match(providerService, /approved: row\.approved/);
  });
});
