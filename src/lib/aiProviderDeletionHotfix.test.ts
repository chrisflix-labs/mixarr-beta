import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AiError, statusForCategory } from "../ai/errors";

const read = (path: string) => readFileSync(path, "utf8");

describe("v2.4.8 AI provider deletion hotfix", () => {
  it("uses an additive soft-delete migration and preserves restrictive history relations", () => {
    const migration = read("prisma/migrations/20260726020000_ai_provider_deletion_hotfix_v248/migration.sql");
    const schema = read("prisma/schema.prisma");
    assert.match(migration, /ADD COLUMN "deletedAt"/);
    assert.match(migration, /ADD COLUMN "disabledAt"/);
    assert.match(migration, /ADD COLUMN "resolutionReason"/);
    assert.match(migration, /AiProviderConfig_deletedAt_idx/);
    assert.doesNotMatch(migration, /^\s*(DROP|DELETE|TRUNCATE|UPDATE)\b/im);
    assert.match(schema, /AiBudgetReservation[\s\S]*provider\s+AiProviderConfig\s+@relation\([^\n]*onDelete: Restrict/);
    assert.match(schema, /AiProviderAttempt[\s\S]*provider\s+AiProviderConfig\s+@relation\([^\n]*onDelete: Restrict/);
    assert.doesNotMatch(migration, /ON DELETE CASCADE/i);
  });

  it("retires a referenced provider transactionally instead of physically deleting it", () => {
    const service = read("src/ai/services/providerService.ts");
    assert.match(service, /prisma\.\$transaction/);
    assert.match(service, /deletedAt: now/);
    assert.match(service, /encryptedSecretPayload: null/);
    assert.match(service, /encryptedSecretHeaders: null/);
    assert.match(service, /releaseAiBudgetReservationsForProvider/);
    assert.match(service, /AI_PROVIDER_DELETED/);
    assert.match(service, /status: "already_deleted"/);
    assert.doesNotMatch(service, /aiProviderConfig\.delete\s*\(/);
    assert.doesNotMatch(service, /aiBudgetReservation\.delete/);
    assert.doesNotMatch(service, /aiRequestAudit\.delete/);
  });

  it("cleans active configuration and keeps historical provider snapshots readable", () => {
    const service = read("src/ai/services/providerService.ts");
    for (const marker of ["defaultProviderId: null", "preferredProviderId: null", "fallbackProviderId: null", "availabilityStatus: \"UNAVAILABLE\"", "providerDisplayName: deletedLabel", "healthState: \"DELETED\""]) assert.match(service, new RegExp(marker));
    assert.match(service, /allowedProviderIdsJson\.filter/);
    assert.match(read("src/app/api/ai/audit/route.ts"), /providerDeleted/);
    assert.match(read("src/ai/services/usageService.ts"), /\(Deleted\)/);
  });

  it("filters retired providers from configuration, routing, fallback, and health queries", () => {
    const providerService = read("src/ai/services/providerService.ts");
    const coordinator = read("src/ai/request-coordinator/index.ts");
    const health = read("src/ai/health/service.ts");
    const governance = read("src/ai/governance/service.ts");
    assert.match(providerService, /listAiProviders[\s\S]*deletedAt: null/);
    assert.match(providerService, /resolveAiProvider[\s\S]*deletedAt: null/);
    assert.match(coordinator, /provider: \{ enabled: true, deletedAt: null \}/);
    assert.match(health, /enabled: true, deletedAt: null, healthCheckEnabled: true/);
    assert.match(governance, /providerRow\.deletedAt \|\| !providerRow\.enabled/);
  });

  it("releases budget exactly once and leaves executing reservations to reconcile", () => {
    const governance = read("src/ai/governance/service.ts");
    const service = read("src/ai/services/providerService.ts");
    assert.match(governance, /providerConfigId: providerId, status: "ACTIVE"/);
    assert.match(governance, /resolutionReason: "provider_deleted"/);
    assert.match(governance, /excludedAuditIds/);
    assert.match(service, /activeAuditStatuses/);
    assert.match(service, /activeRequestsDraining/);
  });

  it("returns provider-management responses and sanitized error codes", () => {
    const route = read("src/app/api/ai/providers/[providerId]/route.ts");
    assert.match(route, /NextResponse\.json\(await deleteAiProvider/);
    assert.match(route, /actorUserId/);
    assert.equal(statusForCategory("AI_PROVIDER_NOT_FOUND"), 404);
    assert.equal(statusForCategory("AI_PROVIDER_DELETE_FORBIDDEN"), 403);
    assert.equal(statusForCategory("AI_PROVIDER_DELETE_CONFLICT"), 409);
    const payload = new AiError("AI_PROVIDER_DELETE_FAILED").toSafePayload();
    assert.equal(payload.code, "AI_PROVIDER_DELETE_FAILED");
    assert.equal(payload.message, "The AI provider could not be deleted. No settings were changed.");
    assert.doesNotMatch(JSON.stringify(payload), /Prisma|foreign key|AiBudgetReservation_providerConfigId_fkey/i);
  });

  it("keeps the confirmation open on failure and refreshes state after confirmed success", () => {
    const ui = read("src/components/AiProviderDashboard.tsx");
    assert.match(ui, /role="alertdialog"/);
    assert.match(ui, /disabled=\{busyId === `delete:/);
    assert.match(ui, /Historical audit and usage records were retained/);
    assert.match(ui, /await load\(\)/);
    assert.match(ui, /if \(kind === "delete"\) setDeleteTarget\(null\)/);
    assert.doesNotMatch(ui, /confirm\(`Delete/);
    assert.doesNotMatch(ui, /The AI request could not be completed/);
  });
});
