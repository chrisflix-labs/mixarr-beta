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
    status: "current",
    description: "Preserves every Plex rating-key instance, groups confirmed duplicate recordings without merging physical rows, shares trusted enrichment with provenance, and turns Library Health counts into paginated diagnostic workflows with an idempotent repair preview.",
    featureLabels: ["Physical Plex instance identity", "Non-destructive duplicate groups", "Enrichment inheritance and provenance", "Plex Conflict Inspector", "Calculated repair preview", "Clickable Library Health diagnostics", "Duplicate-aware playlists", "Chunked large-library operations"],
    releaseOrder: 101,
    route: "/release-notes",
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
    futureThemes: ["Adaptive preference learning", "Personalized playlist explanations", "User feedback controls", "Playlist-specific learning", "Personal recommendation insights", "Personalization tuning and safeguards"],
  },
];

export function currentRoadmapRelease() {
  return roadmapReleases.find((release) => release.status === "current") || null;
}
