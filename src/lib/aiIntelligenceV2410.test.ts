import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { templateVariables } from "../ai/intelligence/templates";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("v2.4.10 version references and inert migration are consistent", () => {
  assert.equal(JSON.parse(read("package.json")).version, "2.4.20");
  assert.match(read("Dockerfile"), /NEXT_PUBLIC_APP_VERSION=2\.4\.20/);
  const migration = read("prisma/migrations/20260728010000_ai_intelligence_polish_v2410/migration.sql");
  for (const table of ["AiOnboardingProgress", "AiRequestTemplate", "AiQualityFeedback"]) assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  assert.doesNotMatch(migration, /UPDATE\s+"Ai(GlobalSetting|ProviderConfig|FeatureSetting)"/i);
  assert.match(migration, /does not enable AI/i);
});

test("v2.4.10 template variables are normalized, unique, and bounded by service validation", () => {
  assert.deepEqual(templateVariables("Create a {{Duration}} mix from {{genres}} and {{ duration }}"), ["duration", "genres"]);
  assert.deepEqual(templateVariables("No variables"), []);
  const service = read("src/ai/intelligence/service.ts");
  assert.match(service, /variableName = \/\^\[a-z\]/);
  assert.match(service, /missing\.length \|\| extra\.length/);
  assert.match(service, /privacyReviewRequired: true/);
});

test("v2.4.10 onboarding enables AI only after provider, model, privacy, cost, test, and recipe checks", () => {
  const source = read("src/ai/intelligence/service.ts");
  const service = source.slice(source.indexOf("export async function activateAiOnboarding"), source.indexOf("const variableName"));
  const providerCheck = service.indexOf("!provider.enabled || !provider.approved");
  const healthCheck = service.indexOf("lastSuccessfulInferenceAt");
  const recipeCheck = service.indexOf("reviewedRecipeRequestId");
  const governanceUpdate = service.indexOf("await updateAiGovernanceSettings");
  const globalEnable = service.indexOf("await updateAiGlobalSettings({ enabled: true");
  assert.ok(providerCheck > 0 && healthCheck > providerCheck && recipeCheck > healthCheck);
  assert.ok(governanceUpdate > recipeCheck && globalEnable > governanceUpdate, "global enablement must be last");
  assert.match(service, /mode === "LOCAL_ONLY" && provider\.locationClassification !== "LOCAL"/);
  assert.match(service, /allowPaidProviderFallback: configuration\.mode === "EXTERNAL_PROVIDER"/);
});

test("v2.4.10 APIs are authenticated and onboarding remains administrator-only", () => {
  for (const file of ["src/app/api/ai/dashboard/route.ts", "src/app/api/ai/request-history/route.ts", "src/app/api/ai/templates/route.ts", "src/app/api/ai/feedback/route.ts"]) assert.match(read(file), /requireAiPermissionedUser/);
  assert.match(read("src/app/api/ai/onboarding/route.ts"), /requireAiAdmin/);
  const dashboardService = read("src/ai/intelligence/service.ts");
  assert.doesNotMatch(dashboardService, /encryptedSecretPayload|encryptedSecretHeaders|accessToken/);
});

test("v2.4.10 Ollama setup uses container-aware defaults and never claims localhost is the host", () => {
  assert.match(read("src/ai/registry/providerRegistry.ts"), /defaultBaseUrl: "http:\/\/ollama:11434"/);
  const providerUi = read("src/components/AiProviderDashboard.tsx");
  assert.match(providerUi, /host\.docker\.internal:11434/);
  assert.match(providerUi, /container localhost is not the Docker host/);
  assert.match(read("docs/AI_ASSISTED_MIX_INTELLIGENCE_V2410.md"), /localhost.*Mixarr container, not the Docker host/);
});

test("v2.4.10 AI center exposes semantic, responsive, production routes without browser alert dialogs", () => {
  const ui = read("src/components/AiIntelligenceCenter.tsx");
  assert.match(ui, /role="tablist"/);
  assert.match(ui, /aria-live="polite"/);
  assert.match(ui, /role="dialog" aria-modal="true"/);
  assert.match(ui, /aria-label="This AI result was helpful"/);
  assert.doesNotMatch(ui, /window\.(alert|confirm)|\balert\(|\bconfirm\(/);
  assert.match(read("src/components/AiIntelligenceCenter.module.css"), /@media\(max-width:520px\)/);
  assert.match(read("src/components/Sidebar.tsx"), /href: "\/ai", label: "AI Intelligence"/);
});
