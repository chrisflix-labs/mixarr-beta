import type { SmartMixEngineV2Stage } from "./types";

export const SMART_MIX_ENGINE_V2_PIPELINE: SmartMixEngineV2Stage[] = [
  {
    key: "sourceFiltering",
    order: 1,
    label: "Source/library filtering",
    description: "Limit candidate tracks to the selected user, server, library, active sync state, blocked tracks, and manual exclusions.",
  },
  {
    key: "metadataChecks",
    order: 2,
    label: "Required metadata checks",
    description: "Inspect BPM, mood, energy, and popularity without failing tracks that are missing enrichment data.",
  },
  {
    key: "hardFilters",
    order: 3,
    label: "Hard filters",
    description: "Apply non-negotiable library, genre, text, rating, duration, and negative-filter constraints before scoring.",
  },
  {
    key: "softScoring",
    order: 4,
    label: "Soft scoring/preference rules",
    description: "Score tracks with small bonuses for matching metadata preferences while keeping the formula easy to tune.",
  },
  {
    key: "fallbacks",
    order: 5,
    label: "Fallback rules",
    description: "Use neutral or skipped scoring behavior for missing metadata and record which fallbacks were applied.",
  },
  {
    key: "finalSelection",
    order: 6,
    label: "Final sorting/selection",
    description: "Order candidates by v2 score, apply duplicate controls, merge pinned tracks, and enforce playlist safety rules.",
  },
  {
    key: "outputFormatting",
    order: 7,
    label: "Playlist output formatting",
    description: "Return tracks annotated with engine version, internal score, score breakdown, and metadata fallback status.",
  },
];

export function describeSmartMixEngineV2Pipeline() {
  return SMART_MIX_ENGINE_V2_PIPELINE.map((stage) => `${stage.order}. ${stage.label}`).join(" -> ");
}
