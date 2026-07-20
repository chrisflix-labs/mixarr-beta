import type { AiCapability } from "../contracts";

export type AiFeatureDefinition = { key: string; name: string; description: string; implemented: boolean; requiredCapabilities: AiCapability[]; advisoryOnly: true };
// v2.4.0 deliberately exposes future features only as unavailable registry
// metadata. None are production actions or playlist mutation endpoints.
export const aiFeatureRegistry: readonly AiFeatureDefinition[] = [
  { key: "natural_language_playlist_requests", name: "Natural-language playlist requests", description: "Interprets a request into a reviewable canonical recipe draft. It cannot mutate Plex.", implemented: true, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "library_analysis", name: "Library analysis", description: "Future privacy-scoped library observations.", implemented: false, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "recipe_suggestions", name: "Recipe suggestions", description: "Future reviewable recipe improvement suggestions.", implemented: false, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "playlist_opportunities", name: "Playlist opportunities", description: "Future advisory playlist opportunity analysis.", implemented: false, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
  { key: "mix_design_assistant", name: "Mix design assistant", description: "Future reviewed mix-design guidance.", implemented: false, requiredCapabilities: ["chat_messages", "structured_json"], advisoryOnly: true },
] as const;
export const aiFeatureByKey = new Map(aiFeatureRegistry.map((feature) => [feature.key, feature]));
