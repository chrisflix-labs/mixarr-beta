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
    status: "current",
    description: "Uses per-user Plex listening history as a separate, confidence-weighted, capped Smart Mix layer for recent-play avoidance, completion and replay affinity, cautious skip signals, forgotten favorites, and playback-aware discovery.",
    featureLabels: ["Incremental Plex history sync", "Per-user Plex mapping", "Normalized playback events", "Aggregated track profiles", "Recently played controls", "Forgotten favorites", "Completion and replay affinity", "Confidence-limited skip signals", "Playback-aware discovery", "Visible score explanations", "Job History integration", "Local privacy controls", "Large-history batching"],
    releaseOrder: 106,
    completionDate: "2026-07-16",
    route: "/settings/personalization/playback",
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
    title: "v2.1.x — Personalization & Adaptive Recommendations",
    status: "current",
    description: "The v2.1.x cycle adds optional, locally stored personalization so Smart Mix can gradually adapt to each user's selections, rejections, playlist habits, and recommendation preferences.",
    releases: roadmapReleases.filter((release) => release.cycle === "2.1.x"),
    futureThemes: ["Cross-playlist preference insights", "More playback-source adapters", "Long-term recommendation health", "Additional user-controlled personalization safeguards"],
  },
];

export function currentRoadmapRelease() {
  return roadmapReleases.find((release) => release.status === "current")
    || [...roadmapReleases].filter((release) => release.status === "completed").sort((left, right) => right.releaseOrder - left.releaseOrder)[0]
    || null;
}
