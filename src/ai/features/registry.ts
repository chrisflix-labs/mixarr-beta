import type { AiCapability } from "../contracts";

export type AiFeatureDefinition = { key: string; name: string; description: string; implemented: boolean; requiredCapabilities: AiCapability[]; advisoryOnly: true };
// v2.4.0 deliberately exposes future features only as unavailable registry
// metadata. None are production actions or playlist mutation endpoints.
export const aiFeatureRegistry: readonly AiFeatureDefinition[] = [
  { key: "natural_language_playlist_requests", name: "Natural-language playlist requests", description: "Interprets a request into a reviewable canonical recipe draft. It cannot mutate Plex.", implemented: true, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "recipe_copilot", name: "Recipe Copilot", description: "Creates, explains, diagnoses, compares, and improves reviewable recipe drafts without approval or activation.", implemented: true, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "playlist_ai_summaries", name: "Playlist AI summaries", description: "Creates factual, reviewable playlist descriptions from privacy-scoped deterministic analysis. It cannot modify Plex.", implemented: true, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "metadata_suggestions", name: "Metadata suggestions", description: "Reviews deterministic metadata candidates and stores advisory cleanup suggestions. Approval never applies metadata.", implemented: true, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "library_analysis", name: "Library analysis", description: "Legacy registry alias; use Metadata suggestions for advisory library analysis.", implemented: false, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "recipe_suggestions", name: "Recipe suggestions", description: "Legacy registry alias; use Recipe Copilot for reviewable recipe improvements.", implemented: false, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "playlist_opportunities", name: "Playlist opportunities", description: "Future advisory playlist opportunity analysis.", implemented: false, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "mix_design_assistant", name: "Mix design assistant", description: "Future reviewed mix-design guidance.", implemented: false, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
] as const;
export const aiFeatureByKey = new Map(aiFeatureRegistry.map((feature) => [feature.key, feature]));
