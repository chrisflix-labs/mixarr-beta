export type RoadmapStatus = "completed" | "current" | "upcoming";

export type RoadmapRelease = {
  version: string;
  title: string;
  cycle: string;
  status: RoadmapStatus;
  description: string;
  featureLabels: string[];
  releaseOrder: number;
  completionDate?: string;
  route?: string;
};

export type RoadmapCycle = {
  id: string;
  title: string;
  status: RoadmapStatus;
  description: string;
  releases: RoadmapRelease[];
  futureThemes?: string[];
};

const v20Titles = [
  ["2.0.0", "Smart Mix Engine v2 Foundation"],
  ["2.0.1", "Playlist Scoring"],
  ["2.0.2", "Recommendation Tuning"],
  ["2.0.3", "Mood Blending"],
  ["2.0.4", "BPM Ramp & Transition Tools"],
  ["2.0.5", "Deep Cut & Discovery Controls"],
  ["2.0.6", "Advanced Playlist Regeneration"],
  ["2.0.7", "Playlist Version History & Restore"],
  ["2.0.8", "Manual BPM & Metadata Corrections"],
  ["2.0.9", "Recently Added Automation"],
  ["2.0.10", "Beta Feature Polish & Advanced Flags"],
] as const;

export const roadmapReleases: RoadmapRelease[] = [
  ...v20Titles.map(([version, title], index) => ({
    version,
    title,
    cycle: "2.0.x",
    status: "completed" as const,
    description: "Delivered as part of the completed Smart Mix Engine v2 cycle.",
    featureLabels: [],
    releaseOrder: index,
    route: "/release-notes",
  })),
  {
    version: "2.1.0",
    title: "Personalization Foundation",
    cycle: "2.1.x",
    status: "completed",
    description: "Creates the data models and services required for adaptive recommendations while keeping initial scoring changes conservative and fully optional. Also fixes repeated missing-track restoration during Plex sync: restored availability now persists, post-commit totals are authoritative, and reconciliation verifies every restore.",
    featureLabels: ["User recommendation profiles", "Playlist preference profiles", "Interaction history", "Personal scoring adjustments", "Global and user scoring separation", "Privacy controls", "Reset personalization data", "Reliable Plex availability reconciliation"],
    releaseOrder: 100,
    route: "/release-notes",
  },
  {
    version: "2.1.1",
    title: "Duplicate Preservation & Plex Conflict Inspector",
    cycle: "2.1.x",
    status: "completed",
    description: "Preserves every Plex rating-key instance, groups confirmed duplicate recordings without merging physical rows, shares trusted enrichment with provenance, and turns Library Health counts into paginated diagnostic workflows with an idempotent repair preview.",
    featureLabels: ["Physical Plex instance identity", "Non-destructive duplicate groups", "Enrichment inheritance and provenance", "Plex Conflict Inspector", "Calculated repair preview", "Clickable Library Health diagnostics", "Duplicate-aware playlists", "Chunked large-library operations"],
    releaseOrder: 101,
    route: "/release-notes",
  },
  {
    version: "2.1.1-hotfix",
    title: "Nightly Audio Features & Logging Cleanup",
    cycle: "2.1.x",
    status: "completed",
    description: "Reliability hotfix that runs pending Audio Features as the final awaited nightly stage, unifies provider resolution with manual execution, preserves local Essentia fallback, and replaces repetitive production logs with useful summaries.",
    featureLabels: ["Nightly Audio Features reliability", "Shared provider resolution", "Local Essentia fallback", "Accurate zero-work states", "Stage summaries", "Logging cleanup"],
    releaseOrder: 102,
    route: "/release-notes",
  },
  {
    version: "2.1.2",
    title: "Likes, Dislikes & Track Feedback",
    cycle: "2.1.x",
    status: "completed",
    description: "Turns playlist editing into user-specific recommendation feedback through track and artist preferences, playlist-fit signals, transition reports, bulk tools, and explainable Smart Mix v2 adjustments.",
    featureLabels: ["Like and dislike tracks", "Never-recommend exclusions", "Artist preference controls", "Playlist-fit feedback", "Poor-transition reporting", "Preview feedback controls", "Bulk feedback tools", "Optional feedback reasons", "Feedback history and management", "User-specific scoring adjustments"],
    releaseOrder: 103,
    completionDate: "2026-07-15",
    route: "/release-notes",
  },
  {
    version: "2.1.3",
    title: "Playlist Identity & Memory",
    cycle: "2.1.x",
    status: "completed",
    description: "Gives every managed playlist a stable, explainable identity with learned mood, energy, BPM, artist, genre, discovery, importance, rejection, and historical membership memory that survives regeneration and Plex changes.",
    featureLabels: ["Stable playlist identity", "Learned and manual effective values", "Per-field locks", "Playlist rejection memory", "Important and anchor tracks", "Historical membership events", "Identity-aware regeneration", "Personality summaries", "Confidence explanations", "Clone, retrain, and reset workflows", "Identity snapshots", "Lazy legacy initialization"],
    releaseOrder: 104,
    route: "/release-notes",
  },
  {
    version: "2.1.4",
    title: "Adaptive Smart Mix Scoring",
    cycle: "2.1.x",
    status: "completed",
    description: "Builds on the v2.1.0 personalization profile, v2.1.2 feedback, and v2.1.3 playlist identity to adjust Smart Mix rankings through a separate, confidence-limited, reversible, explainable scoring layer.",
    featureLabels: ["Unchanged base Smart Mix score", "Personalized score comparison", "Eight adaptive scoring components", "Confidence multipliers", "Maximum influence slider", "Presets and advanced controls", "Playlist-specific overrides", "Source and scope labels", "Track-level explanations", "Aggregated history statistics", "Recalculation jobs", "Scoped reset and retraining", "Scoring version snapshots", "Large-library batching"],
    releaseOrder: 105,
    completionDate: "2026-07-16",
    route: "/personalization",
  },
  {
    version: "2.1.5",
    title: "Listening History & Playback Awareness",
    cycle: "2.1.x",
    status: "completed",
    description: "Uses per-user Plex listening history as a separate, confidence-weighted, capped Smart Mix layer for recent-play avoidance, completion and replay affinity, cautious skip signals, forgotten favorites, and playback-aware discovery.",
    featureLabels: ["Incremental Plex history sync", "Per-user Plex mapping", "Normalized playback events", "Aggregated track profiles", "Recently played controls", "Forgotten favorites", "Completion and replay affinity", "Confidence-limited skip signals", "Playback-aware discovery", "Visible score explanations", "Job History integration", "Local privacy controls", "Large-history batching"],
    releaseOrder: 106,
    completionDate: "2026-07-16",
    route: "/settings/personalization/playback",
  },
  {
    version: "2.1.6",
    title: "Contextual Mixes",
    cycle: "2.1.x",
    status: "completed",
    description: "Translates time, day, season, and activity contexts into visible, editable Smart Mix v2 settings with bounded contextual scoring, reusable custom profiles, manual overrides, and durable generation snapshots.",
    featureLabels: ["Context cards", "Seven built-in contexts", "Custom reusable contexts", "Time, day, season, and activity availability", "Energy and discovery targets", "Context influence cap", "Visible setting changes", "Manual overrides and restoration", "Context score explanations", "Playlist identity and personalization integration", "Context generation snapshots", "Local-time suggestions"],
    releaseOrder: 107,
    completionDate: "2026-07-16",
    route: "/builder",
  },
  {
    version: "2.1.7",
    title: "Playlist Relationships & Coordination",
    cycle: "2.1.x",
    status: "completed",
    description: "Coordinates related Smart Mix playlists through canonical overlap detection, configurable hard or soft limits, shared core tracks, artist balancing, unused-track preference, progression chains, previewed moves, and an explainable duplicate dashboard.",
    featureLabels: ["Playlist relationships", "Canonical overlap detection", "Hard and soft overlap limits", "Sister playlists", "Shared core tracks", "Progression chains", "Selected-playlist exclusions", "Unused-track preference", "Cross-playlist artist balancing", "Coordination dashboard", "Previewed track moves", "Rebalance previews", "Bounded explainable scoring", "Batched usage queries"],
    releaseOrder: 108,
    completionDate: "2026-07-16",
    route: "/playlist-coordination",
  },
  {
    version: "2.1.8",
    title: "Smart Mix Explanations & Insights",
    cycle: "2.1.x",
    status: "completed",
    description: "Captures immutable Smart Mix v2 decision traces so selected, rejected, replaced, and competing candidates can be understood through the exact scoring components, filters, fallbacks, metadata, personalization, identity, transitions, and confidence used at generation time.",
    featureLabels: ["Why selected and rejected", "Stable factor codes", "Hard and soft rejection stages", "Score and confidence separation", "Personalization caps", "Playlist identity influence", "Transition explanations", "Metadata and fallback disclosure", "Candidate comparison", "Generation insights", "Suggested fixes", "Historical snapshots", "Bounded trace retention", "Sanitized debug export", "Responsive accessible drawer"],
    releaseOrder: 109,
    completionDate: "2026-07-16",
    route: "/smart-builder",
  },
  {
    version: "2.1.9",
    title: "Adaptive Automation Policies",
    cycle: "2.1.x",
    status: "completed",
    description: "Makes playlist automation explicitly permissioned, bounded, protected, explainable, approval-aware, pausable, and reversible through one server-side policy evaluator.",
    featureLabels: ["Four automation permission levels", "Conservative, Balanced, and Aggressive presets", "Per-update, daily, and weekly limits", "Confidence thresholds", "Playlist and track protection", "Quiet hours and time zones", "Approval queue", "Automation activity", "Emergency pause", "Recoverable versions and rollback", "Safe legacy migration"],
    releaseOrder: 110,
    completionDate: "2026-07-16",
    route: "/automation",
  },
  {
    version: "2.1.10",
    title: "Personalization Dashboard & Release Polish",
    cycle: "2.1.x",
    status: "completed",
    description: "Brings adaptive recommendations, feedback, playlist identity, playback awareness, score influence, privacy controls, migration readiness, and data portability into one understandable user-controlled dashboard.",
    featureLabels: ["Personalization dashboard", "Real aggregate metrics", "Recently learned preferences", "Influential feedback", "Playlist identity browser", "Behavioral quality trends", "Score influence distribution", "Playback health", "JSON export and import", "Selective reset", "First-time onboarding", "Stable-readiness checks", "Cleanup previews", "Responsive accessible UI"],
    releaseOrder: 111,
    completionDate: "2026-07-17",
    route: "/personalization",
  },
];

export const roadmapCycles: RoadmapCycle[] = [
  {
    id: "2.0.x",
    title: "v2.0.x — Smart Mix Engine v2",
    status: "completed",
    description: "The v2.0.x cycle introduced Smart Mix Engine v2, visible playlist scoring, recommendation tuning, mood blending, BPM transition tools, discovery controls, advanced regeneration, playlist version history, metadata corrections, recently added automation, and expanded beta feature controls.",
    releases: roadmapReleases.filter((release) => release.cycle === "2.0.x"),
  },
  {
    id: "2.1.x",
    title: "v2.1.x — Adaptive Personalization",
    status: "completed",
    description: "Mixarr can now learn from direct feedback, playlist history, recommendation decisions, playlist identity, and playback behavior while keeping the resulting adjustments visible and under user control.",
    releases: roadmapReleases.filter((release) => release.cycle === "2.1.x"),
  },
  {
    id: "2.2.x",
    title: "v2.2.x — Automation & Playlist Lifecycle",
    status: "upcoming",
    description: "The proposed v2.2.x direction strengthens deterministic automation, playlist lifecycle management, operational resilience, and long-term recommendation quality without making generative AI a dependency.",
    releases: [],
    futureThemes: ["Lifecycle-aware playlist maintenance", "Safer scheduled regeneration", "Automation observability and recovery", "Long-term recommendation quality monitoring", "Cross-playlist capacity planning", "More playback-source adapters", "Reviewable maintenance proposals", "Storage and retention controls"],
  },
];

export const aiExploration = {
  title: "Future Exploration — AI-Assisted Mixarr",
  timing: "Long-term exploration for later in v2.x or the path toward v3.0",
  description: "Mixarr may eventually support optional AI-assisted features through local providers such as Ollama or user-configured API providers such as OpenRouter, OpenAI, Anthropic, and compatible services. These are not part of the immediate v2.2.x roadmap, and no provider is preferred or guaranteed.",
  ideas: ["Natural-language playlist creation and refinement", "Playlist identity and scoring summaries", "Mood mapping and genre normalization", "Playlist naming and description suggestions", "Library exploration conversations", "Troubleshooting and comparison summaries", "Metadata cleanup suggestions", "Semantic playlist search", "Natural-language automation rules"],
  safeguards: ["AI remains optional", "Core generation and scoring work without AI", "Local models are supported where practical", "External providers require explicit configuration and consent", "Users see what data would be sent", "Credentials require secure storage", "Usage and cost controls are required", "Provider failures cannot break playlist generation", "AI cannot silently override deterministic scoring", "AI output remains reviewable and explainable"],
};

export function currentRoadmapRelease() {
  return roadmapReleases.find((release) => release.status === "current")
    || [...roadmapReleases].filter((release) => release.status === "completed").sort((left, right) => right.releaseOrder - left.releaseOrder)[0]
    || null;
}
