import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildProviderPayload, validateProviderWizard } from "./aiProviderWizard";

const validForm = (patch: Record<string, unknown> = {}) => ({
  providerType: "ollama",
  displayName: "Local Ollama",
  enabled: true,
  locationClassification: "LOCAL",
  administratorConfirmedLocal: true,
  trustedNetwork: true,
  baseUrl: "http://localhost:11434/",
  authenticationType: "NONE",
  apiKey: "",
  removeApiKey: false,
  secretHeadersText: "{}",
  removeSecretHeaders: false,
  nonSecretHeadersText: "{}",
  defaultModel: "llama3",
  fastModel: "",
  reasoningModel: "",
  fallbackProviderId: "",
  requestTimeoutMs: 30000,
  retryCount: 2,
  initialRetryDelayMs: 500,
  maximumRetryDelayMs: 10000,
  retryBackoffMultiplier: 2,
  sslVerification: true,
  modelDiscoveryEnabled: true,
  healthCheckEnabled: true,
  healthCheckIntervalMinutes: 15,
  monthlyBudget: "",
  notes: "",
  id: "must-not-leak-into-create-payload",
  ...patch,
});

describe("AI provider wizard save flow", () => {
  it("accepts remote providers without local-only confirmations and normalizes hidden confirmation state", () => {
    const form = validForm({ providerType: "openrouter", displayName: "OpenRouter", locationClassification: "REMOTE", baseUrl: "https://openrouter.ai/api/v1/", authenticationType: "BEARER", apiKey: "test-key", administratorConfirmedLocal: false, trustedNetwork: false });
    assert.equal(validateProviderWizard(form).valid, true);
    const payload = buildProviderPayload(form);
    assert.equal(payload.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(payload.administratorConfirmedLocal, false);
    assert.equal(payload.trustedNetwork, false);
    assert.equal(payload.apiKeyAction, "replace");
    assert.equal("id" in payload, false);
    assert.equal("secretHeadersText" in payload, false);
  });

  it("requires both local safety confirmations and returns Step 4 as the invalid step", () => {
    const validation = validateProviderWizard(validForm({ administratorConfirmedLocal: false, trustedNetwork: false }));
    assert.equal(validation.valid, false);
    assert.equal(validation.firstInvalidStep, 4);
    assert.match(validation.fieldErrors.administratorConfirmedLocal, /inspected/i);
    assert.match(validation.fieldErrors.trustedNetwork, /trusted network/i);
  });

  it("moves validation to the earliest invalid step and identifies the exact field", () => {
    const validation = validateProviderWizard(validForm({ displayName: "", nonSecretHeadersText: "[]", requestTimeoutMs: 1 }));
    assert.equal(validation.firstInvalidStep, 1);
    assert.equal(validation.firstInvalidField, "displayName");
    assert.ok(validation.fieldErrors.nonSecretHeadersText);
    assert.ok(validation.fieldErrors.requestTimeoutMs);
  });

  it("rejects secret-like non-secret headers and non-string header values before sending", () => {
    const nonSecret = validateProviderWizard(validForm({ nonSecretHeadersText: '{"Authorization":"Bearer value"}' }));
    const secret = validateProviderWizard(validForm({ secretHeadersText: '{"X-Api-Key":42}' }));
    assert.match(nonSecret.fieldErrors.nonSecretHeadersText, /secret header/i);
    assert.match(secret.fieldErrors.secretHeadersText, /string values/i);
  });

  it("includes both confirmed local fields and preserves explicit secret actions", () => {
    const payload = buildProviderPayload(validForm({ removeSecretHeaders: true }), true);
    assert.equal(payload.administratorConfirmedLocal, true);
    assert.equal(payload.trustedNetwork, true);
    assert.equal(payload.apiKeyAction, "keep");
    assert.equal(payload.secretHeadersAction, "remove");
  });

  it("uses one guarded submit function and enforces local confirmations again on the server", () => {
    const dashboard = readFileSync(join(process.cwd(), "src/components/AiProviderDashboard.tsx"), "utf8");
    const service = readFileSync(join(process.cwd(), "src/ai/services/providerService.ts"), "utf8");
    assert.match(dashboard, /async function handleSaveProvider\(\)/);
    assert.match(dashboard, /if \(isSaving \|\| savingRef\.current\) return/);
    assert.match(dashboard, /finally \{ savingRef\.current = false; setIsSaving\(false\); \}/);
    assert.match(dashboard, /type="submit"/);
    assert.match(dashboard, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); void handleSaveProvider\(\); \}\}/);
    assert.match(service, /assertLocalSafety\(input\)/);
    assert.match(service, /administratorConfirmedLocal !== true/);
    assert.match(service, /trustedNetwork !== true/);
    assert.match(service, /invalidProviderField\("nonSecretHeaders"/);
    assert.match(service, /invalidProviderField\("secretHeaders"/);
  });
});
