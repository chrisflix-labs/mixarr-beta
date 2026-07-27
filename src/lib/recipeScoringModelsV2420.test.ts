import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseStructuredResponseWithProviderRepair } from "../ai/validation";
import { recipeCopilotUserPrompt } from "../ai/recipeCopilot/prompts";
import { playlistRecipeValidationResponse } from "./playlistRecipeApiValidation";
import {
  recipeCopilotJsonSchema,
  recipeCopilotResponseSchema,
} from "./recipeCopilot/contracts";
import {
  applyRecipeProposalChanges,
  stableRecipeProposalChangeId,
  type RecipeProposalChange,
} from "./recipeCopilot/proposalApply";
import { defaultRecipeStudioDraft } from "./recipeStudio";
import {
  parseCanonicalPlaylistRecipeDraft,
  validatePlaylistRecipeDraft,
} from "./playlistRecipes";
import {
  DEFAULT_SCORING_MODEL,
  LEGACY_SCORING_MODEL_ALIASES,
  SCORING_MODEL_OPTIONS,
  SCORING_MODELS,
  normalizeScoringModel,
  scoringModelSchema,
} from "./scoringModelCatalog";
import { getScoringModel, scoringModelRegistry } from "./scoringModels";
import { diagnoseAndMigrateRecipeScoringModels } from "./scoringModelMigration";

function response(scoringModel: string) {
  return {
    schemaVersion: "1.0",
    action: "create",
    proposedPatch: { scoring: { scoringModel } },
    intent: { summary: "Test", primaryGoals: [], secondaryGoals: [], conflicts: [] },
    analysis: { confidence: 0.9, assumptions: [], warnings: [], unsupportedRequests: [], expectedBehavioralChanges: [], compatibilityNotes: [] },
    recommendations: { parentRecipes: [], inheritance: [], missingRules: [], saferSettings: [] },
    changeRationales: [],
    explanation: null,
    diagnoses: [],
    behaviorComparison: null,
    nameSuggestions: [],
    onboarding: [],
  };
}

function change(proposalId: string, path: string, proposedValue: unknown): RecipeProposalChange {
  return {
    id: stableRecipeProposalChangeId(proposalId, path),
    path,
    proposedValue,
    selected: true,
  };
}

describe("v2.4.20 canonical scoring-model catalog", () => {
  it("exposes exactly the engine-backed values to schemas, options, and dispatch", () => {
    assert.deepEqual(SCORING_MODELS, ["stable-v2", "experimental-balanced"]);
    assert.equal(DEFAULT_SCORING_MODEL, "stable-v2");
    assert.deepEqual(scoringModelSchema.options, SCORING_MODELS);
    assert.deepEqual(SCORING_MODEL_OPTIONS.map((option) => option.value), SCORING_MODELS);
    assert.deepEqual(scoringModelRegistry.map((model) => model.id), SCORING_MODELS);
    for (const value of SCORING_MODELS) {
      const implementation = getScoringModel(value);
      assert.ok(implementation, `${value} must have an execution implementation`);
      assert.equal(typeof implementation.apply, "function");
    }
  });

  it("has no undocumented alias and classifies popularity_heavy as unsupported", () => {
    assert.deepEqual(LEGACY_SCORING_MODEL_ALIASES, {});
    assert.deepEqual(normalizeScoringModel("popularity_heavy"), {
      status: "unsupported",
      receivedValue: "popularity_heavy",
    });
    assert.equal(scoringModelSchema.safeParse("popularity_heavy").success, false);
  });

  it("uses the canonical enum in Recipe Copilot runtime and JSON schemas", () => {
    assert.equal(recipeCopilotResponseSchema.safeParse(response("stable-v2")).success, true);
    const invalid = recipeCopilotResponseSchema.safeParse(response("popularity_heavy"));
    assert.equal(invalid.success, false);
    if (!invalid.success) assert.equal(invalid.error.issues[0]?.path.join("."), "proposedPatch.scoring.scoringModel");
    const jsonSchema = JSON.stringify(recipeCopilotJsonSchema);
    for (const model of SCORING_MODELS) assert.match(jsonSchema, new RegExp(model));
    assert.doesNotMatch(jsonSchema, /popularity_heavy/);
  });

  it("generates the prompt values and behavior from the catalog", () => {
    const prompt = recipeCopilotUserPrompt({ action: "create", instruction: "test", context: {} });
    assert.match(prompt, /For scoring\.scoringModel, use exactly one of: stable-v2, experimental-balanced/);
    assert.doesNotMatch(prompt, /popularity_heavy/);
    for (const option of SCORING_MODEL_OPTIONS) {
      assert.match(prompt, new RegExp(option.value));
      assert.match(prompt, new RegExp(option.label, "i"));
    }
  });

  it("permits one schema repair and revalidates the complete output", async () => {
    let repairs = 0;
    const parsed = await parseStructuredResponseWithProviderRepair({
      content: JSON.stringify(response("popularity_heavy")),
      format: { type: "json", name: "recipe", schema: recipeCopilotResponseSchema },
      maxBytes: 100_000,
      providerRepairAttempts: 1,
      repair: async () => {
        repairs += 1;
        return JSON.stringify(response("stable-v2"));
      },
    });
    assert.equal(repairs, 1);
    assert.equal(parsed.providerRepairUsed, true);
    assert.equal(parsed.data.proposedPatch?.scoring?.scoringModel, "stable-v2");
  });
});

describe("v2.4.20 Recipe Copilot apply and save regression", () => {
  const proposalId = "reported-v2420";
  const reportedChanges = (model: string) => [
    change(proposalId, "description", "A high-energy, familiar mix."),
    change(proposalId, "discovery.avoidOverplayedTracks", false),
    change(proposalId, "discovery.familiarityBalance", 70),
    change(proposalId, "discovery.level", "low"),
    change(proposalId, "discovery.maximumHighPopularityPercentage", 70),
    change(proposalId, "filters.duplicateStrategy", "avoid_recordings"),
    change(proposalId, "filters.negativeFilters.excludeHoliday", true),
    change(proposalId, "filters.negativeFilters.excludeIntroOutro", true),
    change(proposalId, "filters.negativeFilters.excludeLive", true),
    change(proposalId, "filters.rules", [{ field: "popularity", operator: "gte", value: "65" }]),
    change(proposalId, "name", "Familiar Favorites"),
    change(proposalId, "playlistIdentity.avoidedGenres", ["Country"]),
    change(proposalId, "scoring.discoveryWeight", 30),
    change(proposalId, "scoring.popularityWeight", 80),
    change(proposalId, "scoring.scoringModel", model),
  ];

  it("applies all 15 supported changes and passes the canonical save/execution validator", () => {
    const source = defaultRecipeStudioDraft();
    source.discovery.avoidOverplayedTracks = true;
    const result = applyRecipeProposalChanges(source, reportedChanges("experimental-balanced"));
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(reportedChanges("experimental-balanced").length, 15);
    assert.equal(result.appliedCount, 15);
    assert.equal(result.appliedPaths.length, 15);
    assert.equal(JSON.stringify(source) === JSON.stringify(result.draft), false);
    const validation = validatePlaylistRecipeDraft(result.draft);
    assert.equal(validation.success, true);
    if (!validation.success) return;
    assert.equal(validation.data.scoring?.scoringModel, "experimental-balanced");
    assert.equal(validation.data.filters.scoringModel, "experimental-balanced");
    assert.ok(getScoringModel(validation.data.scoring?.scoringModel));
  });

  it("rejects popularity_heavy before application and never partially applies other fields", () => {
    const source = defaultRecipeStudioDraft();
    const snapshot = JSON.stringify(source);
    const result = applyRecipeProposalChanges(source, reportedChanges("popularity_heavy"));
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.failures[0]?.path, "scoring.scoringModel");
    assert.equal(result.failures[0]?.code, "AI_RECIPE_PROPOSAL_UNSUPPORTED_ENUM");
    assert.equal(JSON.stringify(source), snapshot);
  });

  it("returns a path-specific canonical save issue for unknown models", () => {
    const source = defaultRecipeStudioDraft();
    source.scoring.scoringModel = "unknown" as any;
    const result = validatePlaylistRecipeDraft(source);
    assert.equal(result.success, false);
    if (result.success) return;
    assert.deepEqual(result.issues[0], {
      path: "scoring.scoringModel",
      code: "RECIPE_SCORING_MODEL_UNSUPPORTED",
      message: "The selected scoring model is not supported.",
      receivedValue: "unknown",
      supportedValues: [...SCORING_MODELS],
    });
  });

  it("synchronizes the derived generation model before persistence and execution", () => {
    const source = defaultRecipeStudioDraft();
    source.filters.scoringModel = "stable-v2";
    source.scoring.scoringModel = "experimental-balanced";
    const prepared = parseCanonicalPlaylistRecipeDraft(source);
    assert.equal(prepared.data.scoring?.scoringModel, "experimental-balanced");
    assert.equal(prepared.data.filters.scoringModel, "experimental-balanced");
    assert.equal(prepared.recipe.generation.scoringModel, "experimental-balanced");
  });
});

describe("v2.4.20 API, Studio, persistence, and migration contracts", () => {
  const createRoute = readFileSync("src/app/api/playlist-recipes/route.ts", "utf8");
  const updateRoute = readFileSync("src/app/api/playlist-recipes/[id]/route.ts", "utf8");
  const applyService = readFileSync("src/lib/recipeCopilot/service.ts", "utf8");
  const studio = readFileSync("src/components/RecipeStudio.tsx", "utf8");
  const migration = readFileSync("src/lib/scoringModelMigration.ts", "utf8");

  it("uses the same canonical save validator for create, update, analysis, and apply", () => {
    assert.match(createRoute, /validatePlaylistRecipeDraft/);
    assert.match(updateRoute, /validatePlaylistRecipeDraft/);
    assert.match(applyService, /validatePlaylistRecipeDraft\(patched\.draft\)/);
    assert.match(applyService, /saveSemanticValidationValid/);
    assert.match(applyService, /executionCompatibilityValid/);
  });

  it("returns field-specific 422 responses without stack traces", async () => {
    const api = readFileSync("src/lib/playlistRecipeApiValidation.ts", "utf8");
    assert.match(api, /RECIPE_SCORING_MODEL_UNSUPPORTED/);
    assert.match(api, /field: first\.path/);
    assert.match(api, /status: 422/);
    assert.doesNotMatch(api, /stack/);
    assert.match(api, /\[Playlist Recipe\] Validation rejected/);
    const response = playlistRecipeValidationResponse([{
      path: "scoring.scoringModel",
      code: "RECIPE_SCORING_MODEL_UNSUPPORTED",
      message: "The selected scoring model is not supported.",
      receivedValue: "popularity_heavy",
      supportedValues: SCORING_MODELS,
    }], "test-correlation-id");
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.deepEqual(body.error, {
      code: "RECIPE_SCORING_MODEL_UNSUPPORTED",
      message: "The selected scoring model is not supported.",
      field: "scoring.scoringModel",
      receivedValue: "popularity_heavy",
      supportedValues: [...SCORING_MODELS],
      correlationId: "test-correlation-id",
      issues: [{
        path: "scoring.scoringModel",
        code: "RECIPE_SCORING_MODEL_UNSUPPORTED",
        message: "The selected scoring model is not supported.",
        receivedValue: "popularity_heavy",
        supportedValues: [...SCORING_MODELS],
      }],
    });
  });

  it("derives Studio choices from the catalog and blocks hidden unsupported state", () => {
    assert.match(studio, /SCORING_MODEL_OPTIONS\.map/);
    assert.match(studio, /scoringModelSupported/);
    assert.match(studio, /Unsupported:/);
    assert.match(studio, /\/api\/playlist-recipes\/validate/);
    assert.doesNotMatch(studio, /<option value="popularity_heavy"/);
  });

  it("keeps unknown stored values unchanged while disabling and marking review", async () => {
    assert.match(migration, /normalizeScoringModel/);
    assert.match(migration, /RECIPE_LEGACY_SCORING_MODEL_REVIEW_REQUIRED/);
    assert.match(migration, /enabled: false/);
    assert.match(migration, /requiresReview/);
    assert.doesNotMatch(migration, /similarity|levenshtein|fuzzy/i);
    const updates: Array<Record<string, any>> = [];
    const summary = await diagnoseAndMigrateRecipeScoringModels({
      playlistRecipe: {
        findMany: async () => [
          {
            id: "canonical",
            scoringJson: { scoringModel: "stable-v2" },
            normalizedPayloadJson: {},
            migrationHistoryJson: [],
            quarantineState: "NONE",
            quarantineReason: null,
            enabled: true,
          },
          {
            id: "unknown",
            scoringJson: { scoringModel: "popularity_heavy", popularityWeight: 80 },
            normalizedPayloadJson: {},
            migrationHistoryJson: [],
            quarantineState: "NONE",
            quarantineReason: null,
            enabled: true,
          },
        ],
        update: async (args) => { updates.push(args as Record<string, any>); return {}; },
      },
    });
    assert.deepEqual(summary, { scannedRecipes: 2, normalizedAliases: 0, requiresReview: 1 });
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.where?.id, "unknown");
    assert.equal(updates[0]?.data?.enabled, false);
    assert.equal(updates[0]?.data?.quarantineReason, "RECIPE_LEGACY_SCORING_MODEL_REVIEW_REQUIRED");
    assert.equal("scoringJson" in (updates[0]?.data || {}), false, "unknown scoring JSON must remain unchanged");
  });

  it("ships all v2.4.20 release surfaces", () => {
    assert.equal(JSON.parse(readFileSync("package.json", "utf8")).version, "2.4.22");
    assert.match(readFileSync("Dockerfile", "utf8"), /NEXT_PUBLIC_APP_VERSION=2\.4\.22/);
    assert.match(readFileSync("CHANGELOG.md", "utf8"), /v2\.4\.20 - Canonical Recipe Copilot Scoring Models/);
    assert.match(readFileSync("README.md", "utf8"), /Current release: \*\*v2\.4\.22/);
    assert.match(readFileSync("docs/RECIPE_COPILOT_SCORING_MODELS_V2420.md", "utf8"), /popularity_heavy/);
  });
});
