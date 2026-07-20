import { defaultMixRecipeDocument, mixRecipeDocumentSchema, type MixRecipeDocument } from "../mixRecipes/schema";
import { playlistConfigSchema } from "../playlistService";
import type { NaturalLanguageInterpretation } from "./contracts";

function safeObject(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }

export function mergeRecipePatch(base: MixRecipeDocument, patch: NaturalLanguageInterpretation["recipePatch"]): MixRecipeDocument {
  const generationPatch = safeObject(patch.generation);
  const generation = playlistConfigSchema.parse({ ...base.generation, ...generationPatch, negativeFilters: { ...base.generation.negativeFilters, ...safeObject(generationPatch.negativeFilters) }, pinnedTrackIds: [], excludedTrackIds: [], engineVersion: "v2" });
  return mixRecipeDocumentSchema.parse({ ...base, metadata: { ...base.metadata, ...patch.metadata }, generation, targets: { ...base.targets, ...patch.targets }, bpmFlow: { ...base.bpmFlow, ...patch.bpmFlow }, discovery: { ...base.discovery, ...patch.discovery }, variety: { ...base.variety, ...patch.variety }, refreshPolicy: { ...base.refreshPolicy, ...patch.refreshPolicy }, automationPolicy: { ...base.automationPolicy, enabled: false, requireExplicitConfirmation: true }, permissions: [], signature: null });
}

export function interpretationRequiresClarification(interpretation: NaturalLanguageInterpretation) {
  return interpretation.ambiguities.some((item) => item.requiresConfirmation && !item.resolution)
    || interpretation.assumptions.some((item) => item.blocking && !item.accepted)
    || interpretation.unresolvedEntities.length > 0
    || interpretation.unsupportedRequests.length > 0;
}

export function defaultNaturalLanguageRecipe(name: string, summary: string) {
  return defaultMixRecipeDocument({ name, description: summary, category: "Custom" }, { engineVersion: "v2", limit: 100, rules: [] });
}
