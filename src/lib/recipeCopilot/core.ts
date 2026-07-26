import { createHash } from "crypto";
import { BUILT_IN_RECIPES } from "../builtInRecipes/catalog";
import { compareRecipeDocuments, defaultRecipeStudioDraft } from "../recipeStudio";
import { playlistRecipeSchema } from "../playlistRecipes";
import type { AiRecipeStatus, RecipeCopilotPatch, RecipeCopilotResponse } from "./contracts";
import { isRecipeProposalPathAllowed } from "./proposalApply";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const secretKey = /(token|secret|credential|password|authorization|cookie|accessToken|apiKey|filesystem|filePath|path)/i;

export const AI_RECIPE_STATUS_TRANSITIONS: Record<AiRecipeStatus, readonly AiRecipeStatus[]> = {
  DRAFT: ["NEEDS_REVIEW", "VALIDATED", "QUARANTINED"],
  NEEDS_REVIEW: ["VALIDATED", "REJECTED", "QUARANTINED"],
  VALIDATED: ["APPROVED", "REJECTED", "SUPERSEDED", "QUARANTINED"],
  APPROVED: ["SUPERSEDED", "QUARANTINED"],
  REJECTED: [], SUPERSEDED: [], QUARANTINED: ["NEEDS_REVIEW", "VALIDATED"],
};

export function assertAiRecipeStatusTransition(from: AiRecipeStatus, to: AiRecipeStatus) {
  if (from === to) return;
  if (!AI_RECIPE_STATUS_TRANSITIONS[from].includes(to)) throw Object.assign(new Error(`AI recipe cannot move from ${from} to ${to}.`), { code: "INVALID_AI_RECIPE_STATUS_TRANSITION", status: 409 });
}

export function mergeRecipeCopilotPatch(source: Record<string, any> | undefined, patch: RecipeCopilotPatch) {
  const draft = clone(source || defaultRecipeStudioDraft());
  const merge = (section: string, value: Record<string, unknown>) => { draft[section] = { ...(draft[section] || {}), ...value }; };
  if (patch.metadata.name) draft.name = patch.metadata.name;
  if (patch.metadata.description !== undefined) draft.description = patch.metadata.description;
  if (patch.metadata.category) draft.category = patch.metadata.category;
  merge("filters", { ...patch.generation, ...(patch.generation.negativeFilters ? { negativeFilters: { ...(draft.filters?.negativeFilters || {}), ...patch.generation.negativeFilters } } : {}), ...(patch.generation.safetyRules ? { safetyRules: { ...(draft.filters?.safetyRules || {}), ...patch.generation.safetyRules } } : {}) });
  for (const section of ["scoring", "targets", "bpmFlow", "discovery", "variety", "playlistIdentity", "refreshPolicy", "automationPolicy"] as const) merge(section, patch[section] as Record<string, unknown>);
  // An AI proposal may recommend automation, but it can never enable or activate it.
  draft.enabled = false;
  draft.automationPolicy = { ...draft.automationPolicy, enabled: false, requireExplicitConfirmation: true };
  return playlistRecipeSchema.parse(draft);
}

export function recipeFingerprint(recipe: unknown) { return createHash("sha256").update(JSON.stringify(recipe)).digest("hex"); }

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !secretKey.test(key)).map(([key, item]) => [key, scrub(item)]));
}

export function buildPrivacyAwareRecipeContext(recipe: Record<string, any> | undefined, privacyMode: string) {
  if (!recipe) return { recipe: null, blockedFields: [] as string[] };
  const safe = scrub(clone(recipe)) as Record<string, any>;
  const blockedFields = ["credentials", "provider secrets", "track-level library data"];
  if (privacyMode === "FULL_METADATA" || privacyMode === "LOCAL_ONLY") return { recipe: safe, blockedFields };
  delete safe.name; delete safe.description; delete safe.artworkUrl; delete safe.sourcePlaylistId; delete safe.updatedAt;
  if (safe.filters) {
    delete safe.filters.serverId; delete safe.filters.libraryId; delete safe.filters.pinnedTrackIds; delete safe.filters.excludedTrackIds;
  }
  if (safe.automationPolicy) delete safe.automationPolicy.libraryId;
  blockedFields.push("recipe identity", "library and server identifiers", "selected track identifiers");
  return { recipe: safe, blockedFields };
}

export type IntentConflict = { code: string; description: string; resolution: string; resolved: boolean };
export function detectRecipeIntentConflicts(instruction: string, recipe: Record<string, any>, candidate?: Record<string, any>): IntentConflict[] {
  const text = instruction.toLowerCase(); const conflicts: IntentConflict[] = [];
  const add = (code: string, description: string, resolution: string) => conflicts.push({ code, description, resolution, resolved: false });
  if (/(only|just).*(favorite|familiar)/.test(text) && /(new artists|discovery|discover)/.test(text)) add("familiarity.discovery", "The request restricts results to familiar music while also asking for discovery.", "Choose a familiarity quota or allow unfamiliar artists.");
  if (/(never|no).*repeat.*artist/.test(text) && candidate && Number(recipe.filters?.limit || 0) > Number(candidate.uniqueArtists || 0)) add("artist_pool.size", "The requested playlist is larger than the estimated unique-artist pool.", "Reduce playlist size or permit limited artist repetition.");
  if (/(always fresh|constantly change)/.test(text) && /(stable|rarely change|mostly the same)/.test(text)) add("stability.freshness", "Always-fresh results conflict with playlist stability.", "Choose a maximum change percentage per refresh.");
  if (/(maximum|max) discovery/.test(text) && /(only|mostly) familiar/.test(text)) add("discovery.familiarity", "Maximum discovery conflicts with familiar-only selection.", "Set an explicit familiar/discovery balance.");
  if (/(daily|every day).*(full|replace|regenerat)/.test(text) && /(stable|rarely change)/.test(text)) add("automation.stability", "Daily full regeneration conflicts with stable-playlist expectations.", "Use incremental replacement with a preservation percentage.");
  if (candidate && Number(candidate.requestedPlaylistSize || 0) > Number(candidate.estimatedPlaylistCapacity ?? candidate.matchingCandidates ?? Infinity)) add("candidate.capacity", "The requested playlist size exceeds the locally estimated candidate capacity.", "Relax a restrictive rule or reduce the playlist size.");
  if (recipe.targets?.minimumEnergy != null && recipe.targets?.maximumEnergy != null && recipe.targets.minimumEnergy > recipe.targets.maximumEnergy) add("energy.range", "Minimum energy is higher than maximum energy.", "Correct the energy range.");
  if (recipe.bpmFlow?.minimumBpm != null && recipe.bpmFlow?.maximumBpm != null && recipe.bpmFlow.minimumBpm > recipe.bpmFlow.maximumBpm) add("bpm.range", "Minimum BPM is higher than maximum BPM.", "Correct the BPM range.");
  return conflicts;
}

export function deriveRecipePurpose(recipe: Record<string, any>) {
  const familiar = Number(recipe.discovery?.familiarityBalance ?? 50);
  const category = String(recipe.category || "custom").toLowerCase();
  const energy = recipe.targets?.energyProgression && recipe.targets.energyProgression !== "mixed" ? ` with ${recipe.targets.energyProgression} energy` : "";
  const discovery = familiar >= 65 ? "mostly familiar" : familiar <= 35 ? "discovery-forward" : "balanced familiar and discovery";
  return `This recipe appears intended to create a ${discovery} ${category} playlist${energy}, limited to ${recipe.variety?.maximumTracksPerArtist || 3} tracks per artist.`;
}

export function logicalRecipeChanges(before: Record<string, any>, after: Record<string, any>, output: RecipeCopilotResponse) {
  const rationale = new Map(output.changeRationales.map((item) => [item.path, item]));
  return compareRecipeDocuments(before, after).filter((difference) => isRecipeProposalPathAllowed(difference.path)).map((difference) => {
    const reason = rationale.get(difference.path);
    return { ...difference, reason: reason?.reason || "Aligns this setting with the stated intent.", expectedBehaviorChange: reason?.expectedBehaviorChange || "The generated playlist behavior will reflect the proposed value.", potentialSideEffects: reason?.potentialSideEffects || [], confidence: reason?.confidence ?? output.analysis.confidence };
  });
}

export function localSafetyRecommendations(recipe: Record<string, any>) {
  const recommendations: Array<{ path: string; reason: string; suggestedValue: unknown }> = [];
  if (recipe.refreshPolicy?.strategy === "full_regeneration") recommendations.push({ path: "refreshPolicy.strategy", reason: "Incremental updates reduce disruptive full replacements.", suggestedValue: "replace_weak" });
  if (!recipe.refreshPolicy?.preserveLockedTracks) recommendations.push({ path: "refreshPolicy.preserveLockedTracks", reason: "Protect manually locked tracks during refresh.", suggestedValue: true });
  if (!recipe.refreshPolicy?.preserveLikedTracks) recommendations.push({ path: "refreshPolicy.preserveLikedTracks", reason: "Protect liked tracks during refresh.", suggestedValue: true });
  if (Number(recipe.refreshPolicy?.maximumReplacements || 0) > 20) recommendations.push({ path: "refreshPolicy.maximumReplacements", reason: "Bound destructive churn per run.", suggestedValue: 20 });
  if (recipe.automationPolicy?.enabled) recommendations.push({ path: "automationPolicy.enabled", reason: "Keep automation off until review, validation, approval, and a separate activation action.", suggestedValue: false });
  return recommendations;
}

export function recommendBuiltInParents(recipe: Record<string, any>, intent: string) {
  const terms = `${intent} ${recipe.category || ""} ${recipe.description || ""}`.toLowerCase();
  return BUILT_IN_RECIPES.map((parent) => {
    const haystack = `${parent.name} ${parent.category} ${parent.tags.join(" ")} ${parent.shortDescription}`.toLowerCase();
    const score = terms.split(/\W+/).filter((term) => term.length > 3 && haystack.includes(term)).length;
    return { parent, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(({ parent }) => ({ id: parent.id, name: parent.name, reason: `This built-in recipe already provides ${parent.behaviorSummary.slice(0, 2).join(" and ").toLowerCase()}.`, inheritedRules: parent.behaviorSummary, childRules: ["User-specific source, size, and intent overrides"], conflicts: [], compatibilityRequirements: parent.metadataRequirements.filter((item) => item.importance === "required").map((item) => item.id), maintenanceBenefit: "Inheriting shared defaults reduces duplicated rules and receives compatible built-in improvements." }));
}

export function statusForProposal(input: { errors: number; warnings: number; conflicts: number; assumptions: number; unsupported: number; confidence: number; unsafe: boolean }): AiRecipeStatus {
  if (input.unsafe || input.errors > 0) return "QUARANTINED";
  if (input.warnings || input.conflicts || input.assumptions || input.unsupported || input.confidence < 0.7) return "NEEDS_REVIEW";
  return "VALIDATED";
}

export function isStaleRecipeResult(sourceUpdatedAt: Date | string | null | undefined, currentUpdatedAt: Date | string | null | undefined) {
  if (!sourceUpdatedAt || !currentUpdatedAt) return false;
  return new Date(sourceUpdatedAt).getTime() !== new Date(currentUpdatedAt).getTime();
}
