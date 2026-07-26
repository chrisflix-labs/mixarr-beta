import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  DEFAULT_SCORING_MODEL,
  normalizeScoringModel,
} from "./scoringModelCatalog";

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export type ScoringModelMigrationSummary = {
  scannedRecipes: number;
  normalizedAliases: number;
  requiresReview: number;
};

type ScoringModelMigrationClient = {
  playlistRecipe: {
    findMany: (args: Record<string, unknown>) => Promise<any[]>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
};

/**
 * Idempotent startup diagnostic for recipe JSON stored before the canonical
 * scoring-model schema. Documented aliases are normalized; unknown values are
 * preserved and the recipe is disabled/quarantined for explicit review.
 */
export async function diagnoseAndMigrateRecipeScoringModels(
  client: ScoringModelMigrationClient = prisma as unknown as ScoringModelMigrationClient,
): Promise<ScoringModelMigrationSummary> {
  const recipes = await client.playlistRecipe.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      scoringJson: true,
      normalizedPayloadJson: true,
      migrationHistoryJson: true,
      quarantineState: true,
      quarantineReason: true,
      enabled: true,
    },
  });
  const summary: ScoringModelMigrationSummary = {
    scannedRecipes: recipes.length,
    normalizedAliases: 0,
    requiresReview: 0,
  };

  for (const recipe of recipes) {
    const scoring = object(recipe.scoringJson);
    const received = scoring.scoringModel ?? DEFAULT_SCORING_MODEL;
    const resolution = normalizeScoringModel(received);
    if (resolution.status === "canonical") continue;
    if (resolution.status === "legacy_alias") {
      const normalizedPayload = object(recipe.normalizedPayloadJson);
      const normalizedScoring = object(normalizedPayload.scoring);
      const normalizedGeneration = object(normalizedPayload.generation);
      const history = Array.isArray(recipe.migrationHistoryJson) ? recipe.migrationHistoryJson : [];
      await client.playlistRecipe.update({
        where: { id: recipe.id },
        data: {
          scoringJson: { ...scoring, scoringModel: resolution.value } as Prisma.InputJsonValue,
          normalizedPayloadJson: {
            ...normalizedPayload,
            scoring: { ...normalizedScoring, scoringModel: resolution.value },
            generation: { ...normalizedGeneration, scoringModel: resolution.value },
          } as Prisma.InputJsonValue,
          migrationHistoryJson: [
            ...history,
            {
              code: "RECIPE_SCORING_MODEL_ALIAS_NORMALIZED",
              path: "scoring.scoringModel",
              from: resolution.receivedValue,
              to: resolution.value,
              version: "2.4.20",
            },
          ] as Prisma.InputJsonValue,
        },
      });
      summary.normalizedAliases += 1;
      console.info("[Recipe Copilot] Legacy scoring model normalized", {
        proposalId: null,
        path: "scoring.scoringModel",
        legacyValue: resolution.receivedValue,
        canonicalValue: resolution.value,
      });
      continue;
    }

    summary.requiresReview += 1;
    if (
      recipe.enabled
      || recipe.quarantineState !== "QUARANTINED"
      || recipe.quarantineReason !== "RECIPE_LEGACY_SCORING_MODEL_REVIEW_REQUIRED"
    ) {
      await client.playlistRecipe.update({
        where: { id: recipe.id },
        data: {
          enabled: false,
          quarantineState: "QUARANTINED",
          quarantineReason: "RECIPE_LEGACY_SCORING_MODEL_REVIEW_REQUIRED",
          compatibilityStatus: "REQUIRES_REVIEW",
        },
      });
    }
  }

  console.info("[Playlist Recipe] Scoring-model migration diagnostic", summary);
  return summary;
}
