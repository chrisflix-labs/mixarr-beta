import type { AiCapability } from "../contracts";

export type AiFeatureDefinition = { key: string; name: string; description: string; implemented: boolean; requiredCapabilities: AiCapability[]; advisoryOnly: true };
// v2.4.0 deliberately exposes future features only as unavailable registry
// metadata. None are production actions or playlist mutation endpoints.
export const aiFeatureRegistry: readonly AiFeatureDefinition[] = [
  { key: "natural_language_playlist_requests", name: "Natural-language playlist requests", description: "Interprets a request into a reviewable canonical recipe draft. It cannot mutate Plex.", implemented: true, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "recipe_copilot", name: "Recipe Copilot", description: "Creates, explains, diagnoses, compares, and improves reviewable recipe drafts without approval or activation.", implemented: true, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "playlist_ai_summaries", name: "Playlist AI summaries", description: "Creates factual, reviewable playlist descriptions from privacy-scoped deterministic analysis. It cannot modify Plex.", implemented: true, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "metadata_suggestions", name: "Metadata suggestions", description: "Reviews deterministic metadata candidates and stores advisory cleanup suggestions. Approval never applies metadata.", implemented: true, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "troubleshooting_explanations", name: "Troubleshooting explanations", description: "Explains sanitized deterministic diagnostics and proposes reviewable allowlisted actions. It cannot change settings without explicit approval.", implemented: true, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "library_analysis", name: "Library analysis", description: "Legacy registry alias; use Metadata suggestions for advisory library analysis.", implemented: false, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "recipe_suggestions", name: "Recipe suggestions", description: "Legacy registry alias; use Recipe Copilot for reviewable recipe improvements.", implemented: false, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "playlist_opportunities", name: "Playlist opportunities", description: "Future advisory playlist opportunity analysis.", implemented: false, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "mix_design_assistant", name: "Mix design assistant", description: "Future reviewed mix-design guidance.", implemented: false, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
] as const;
export const aiFeatureByKey = new Map(aiFeatureRegistry.map((feature) => [feature.key, feature]));

// v2.4.12 canonical AI feature registry. Every layer (UI, API, database, queue,
// worker, provider adapter) must authorize against these exact canonical feature
// IDs. Do not introduce parallel string literals; import from here instead.
export const AI_FEATURES = {
  RECIPE_COPILOT: "recipe_copilot",
  NATURAL_LANGUAGE_PLAYLIST_REQUESTS: "natural_language_playlist_requests",
  PLAYLIST_AI_SUMMARIES: "playlist_ai_summaries",
  METADATA_SUGGESTIONS: "metadata_suggestions",
  TROUBLESHOOTING_EXPLANATIONS: "troubleshooting_explanations",
} as const;
export type CanonicalAiFeatureId = (typeof AI_FEATURES)[keyof typeof AI_FEATURES];

// Known non-canonical spellings observed in older installations, onboarding
// payloads, and hand-written configuration. These map to the ONE canonical ID.
// Deliberately, natural_language_playlist_requests is NEVER an alias of
// recipe_copilot: they are distinct governance features and must stay separate.
export const LEGACY_FEATURE_ALIASES: Readonly<Record<string, string>> = {
  "recipe-copilot": AI_FEATURES.RECIPE_COPILOT,
  recipecopilot: AI_FEATURES.RECIPE_COPILOT,
  recipe_generation: AI_FEATURES.RECIPE_COPILOT,
  recipe_suggestions: AI_FEATURES.RECIPE_COPILOT,
  natural_language_playlist_request: AI_FEATURES.NATURAL_LANGUAGE_PLAYLIST_REQUESTS,
  library_analysis: AI_FEATURES.METADATA_SUGGESTIONS,
};

// Normalize any feature reference to its canonical ID. Case, surrounding
// whitespace, and hyphen/space separators never affect authorization. Unknown
// values are returned normalized (lower_snake) rather than silently remapped, so
// they still fail closed against the per-provider allowlist.
export function canonicalFeatureId(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (aiFeatureByKey.has(normalized)) return normalized;
  return LEGACY_FEATURE_ALIASES[normalized] || normalized;
}

export function isKnownFeatureId(value: unknown): boolean {
  return aiFeatureByKey.has(canonicalFeatureId(value));
}

// Startup validation: warn (never crash) when a feature ID stored in settings is
// neither canonical nor a known legacy alias, so administrators can reconcile it.
export function reportUnknownFeatureIds(featureIds: Iterable<string>, context: string): string[] {
  const unknown = Array.from(new Set(Array.from(featureIds).filter((id) => !isKnownFeatureId(id))));
  if (unknown.length) console.warn("[AI] Unknown AI feature identifiers ignored during authorization", { context, unknownFeatureIds: unknown });
  return unknown;
}
