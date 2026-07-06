export const MIXARR_BETA_DISCORD_URL = "https://discord.com/invite/B7xMvAhaF";

export type ReleaseNoteBadge =
  | "Audio Features"
  | "Automation"
  | "Beta"
  | "Bug Fix"
  | "BPM"
  | "Dashboard"
  | "Debugging"
  | "Jobs"
  | "Library"
  | "Library Health"
  | "Local Analysis"
  | "Mood"
  | "Playlists"
  | "Plex"
  | "Preview"
  | "Recipes"
  | "Release Notes"
  | "Retry"
  | "Roadmap"
  | "Safety Rules"
  | "Scheduler"
  | "Settings"
  | "Smart Builder"
  | "UI";

export type ReleaseNote = {
  version: string;
  title: string;
  releaseDate?: string;
  badges: ReleaseNoteBadge[];
  changes: string[];
};

export const releaseNotes: ReleaseNote[] = [
  {
    version: "1.2.1",
    title: "Mood Presets",
    badges: ["Smart Builder", "Playlists", "Mood", "Recipes", "Preview"],
    changes: [
      "Added Mood Presets for quickly applying mood, energy, and BPM ranges.",
      "Added presets such as Happy, Chill, Hype, Dark, Emotional, Sad / Mellow, Relaxed, Focus, Upbeat, and Balanced.",
      "Moved Mood Presets into the Smart Builder flow where guided playlist features belong.",
      "Playlist Preview now shows the selected mood preset and related warnings.",
      "Saved recipes now preserve mood preset metadata while keeping filter values as the source of truth.",
    ],
  },
  {
    version: "1.2.0",
    title: "Smart Playlist Builder v1",
    badges: ["Smart Builder", "Playlists", "Recipes", "Preview", "Safety Rules"],
    changes: [
      "Added Smart Playlist Builder v1 with guided playlist presets.",
      "Added presets for Workout, Chill, Party, Focus, Driving, Discovery, Deep Cuts, Popular Favorites, and Balanced Mix.",
      "Smart Builder now suggests filters, BPM ranges, energy/mood ranges, popularity preferences, and safety rules.",
      "Smart Builder uses the existing playlist preview flow before creating playlists.",
      "Smart Builder setups can be saved as reusable playlist recipes.",
      "Playlist creation history now records the Smart Builder preset used.",
    ],
  },
  {
    version: "1.1.10",
    title: "Playlist Safety Rules",
    badges: ["Playlists", "Recipes", "Preview", "Safety Rules"],
    changes: [
      "Added optional playlist safety rules to reduce repetitive results.",
      "Added artist spacing to avoid same-artist back-to-back tracks.",
      "Added max tracks per artist and max tracks per album controls.",
      "Added low-track-count warnings in playlist preview.",
      "Saved safety rule settings with playlist recipes.",
      "Added safety rule summaries and warnings to playlist preview and Job History.",
    ],
  },
  {
    version: "1.1.9.1",
    title: "Manual Track Exclusion",
    badges: ["Playlists", "Recipes", "Preview", "Library"],
    changes: [
      "Added manual track exclusions for Mixarr-generated playlists.",
      "Added exclude actions from playlist previews.",
      "Added excluded track management with remove-exclusion support.",
      "Applied manual exclusions to playlist previews, recipe previews, and playlist creation.",
      "Added exclusion counts to playlist preview stats where applicable.",
    ],
  },
  {
    version: "1.1.9",
    title: "Edit and Duplicate Playlist Recipes",
    badges: ["Playlists", "Recipes", "UI", "Preview"],
    changes: [
      "Added editing for saved playlist recipes.",
      "Added recipe duplication for quickly creating variations.",
      "Added update-existing-recipe support from the playlist builder.",
      "Added improved recipe actions and updated recipe metadata.",
      "Kept recipe previews connected to the playlist preview flow.",
    ],
  },
  {
    version: "1.1.8",
    title: "Save Playlist Recipes",
    badges: ["Playlists", "Recipes", "Preview", "UI"],
    changes: [
      "Added saved playlist recipes for reusable playlist filter setups.",
      "Added Save Recipe action to the playlist builder.",
      "Added a Saved Recipes page with recipe summaries and usage actions.",
      "Added recipe preview support using the playlist preview flow.",
      "Added dashboard visibility for saved playlist recipes.",
    ],
  },
  {
    version: "1.1.7",
    title: "Playlist Preview Before Create",
    badges: ["Playlists", "Preview", "UI", "Plex"],
    changes: [
      "Added a playlist preview step before creating playlists.",
      "Added track previews, filter summaries, and playlist stats before writing to Plex.",
      "Added warnings for low-match and zero-match playlist filters.",
      "Added create-from-preview flow so users can review playlists first.",
      "Improved playlist creation confidence and reduced accidental bad playlists.",
    ],
  },
  {
    version: "1.1.6-hotfix",
    title: "Homepage Library Health Performance Hotfix",
    badges: ["Bug Fix", "Dashboard", "Library Health"],
    changes: [
      "Fixed large-library homepage performance issue where Library Health counts could block SSR for several minutes.",
      "Reduced expensive repeated health-count queries.",
      "Homepage now renders without waiting for a full Library Health recalculation.",
    ],
  },
  {
    version: "1.1.6",
    title: "Library Health Details",
    badges: ["Library Health", "Debugging", "BPM", "Audio Features", "Jobs"],
    changes: [
      "Added a dedicated Library Health Details page.",
      "Added clickable health categories for missing BPM, API-only BPM, partial audio features, failed analysis, and missing local files.",
      "Added track-level explanations for why items appear in each health category.",
      "Added filtered track views with sorting and basic actions.",
      "Connected Library Health retry actions with Job History and retry explanations.",
    ],
  },
  {
    version: "1.1.5",
    title: "Background Scheduler Settings",
    badges: ["Settings", "Scheduler", "Automation", "Jobs"],
    changes: [
      "Added web UI controls for the Background Scheduler.",
      "Added daily, weekly, interval, and custom cron schedule options.",
      "Kept 3:00 AM daily as the default schedule.",
      "Added validation for custom cron expressions.",
      "Added scheduler status visibility and better scheduled-job history labeling.",
      "Kept SYNC_CRON_SCHEDULE as a fallback/default environment variable.",
    ],
  },
  {
    version: "1.1.4",
    title: "Retry Explanation Improvements",
    badges: ["Library Health", "Retry", "Debugging", "Jobs"],
    changes: [
      "Improved retry result messages when no tracks are queued.",
      "Added clearer explanations for zero-result BPM and audio-feature retry actions.",
      "Added retry filter, matched, queued, skipped, and reason details where available.",
      "Improved Job History summaries for retry and zero-attempt jobs.",
      "Reduced confusion around local-only retry and force reprocess actions.",
    ],
  },
  {
    version: "1.1.3",
    title: "Better Job History",
    badges: ["Jobs", "Dashboard", "Debugging", "Library Health"],
    changes: [
      "Added Job History page for recent background jobs.",
      "Added status, timing, duration, and summary details for sync and retry jobs.",
      "Added dashboard visibility for recent job activity.",
      "Added basic filters for job status and job type.",
      "Improved debugging visibility for failed or zero-result jobs.",
    ],
  },
  {
    version: "1.1.2",
    title: "Version & Update Visibility",
    badges: ["UI", "Settings", "Release Notes", "Roadmap"],
    changes: [
      "Added clearer current-version visibility across Mixarr.",
      "Added an About / Updates area for release notes, roadmap access, and update guidance.",
      "Added dashboard version visibility.",
      "Centralized app version display to reduce stale version mismatches.",
    ],
  },
  {
    version: "1.1.1",
    title: "Roadmap & Coming Soon",
    badges: ["Beta", "Dashboard", "Roadmap", "UI"],
    changes: [
      "Added a Roadmap / Coming Soon page for Mixarr's path toward v2.0.0.",
      "Added a dashboard card linking to the v2.0.0 roadmap.",
      "Added roadmap sections for current release, upcoming features, v2.0.0 ideas, and beta community access.",
      "Updated app version display to v1.1.1.",
    ],
  },
  {
    version: "1.1.0",
    title: "Dashboard Cleanup & v2.0.0 Preview",
    badges: ["Beta", "Dashboard", "Roadmap", "UI"],
    changes: [
      "Cleaned up dashboard enrichment card layouts.",
      "Fixed Track Genres card text overflow.",
      "Removed redundant Data Enrichment dashboard section.",
      "Added v2.0.0 Coming Soon preview section.",
      "Added guidance that enrichment tools are available from each dashboard card.",
      "Improved dashboard polish and mobile layout.",
    ],
  },
  {
    version: "1.0.5",
    title: "Metadata Reliability & Library Health Polish",
    badges: ["Beta", "Bug Fix", "Dashboard", "Library Health", "Local Analysis"],
    changes: [
      "Fixed partial audio feature retry not clearing after successful local Essentia analysis.",
      "Fixed retry queues replaying already-completed tracks.",
      "Improved BPM and audio feature candidate selection consistency.",
      "Added post-save verification logging for local metadata analysis.",
      "Improved Library Health count/filter accuracy.",
      "Improved whole-track Essentia temp cleanup and worker safety.",
      "Added separate too-short status handling.",
      "Added GitHub repository link.",
      "Improved provider/status breakdowns in Dashboard and Library Health.",
    ],
  },
  {
    version: "1.0.4",
    title: "Local/API Metadata Controls",
    badges: ["Beta", "Local Analysis", "Settings"],
    changes: [
      "Added settings to enable or disable API BPM lookup.",
      "Added settings to enable or disable API Audio Feature lookup.",
      "Added local Essentia-only mode for BPM.",
      "Added local Essentia-only mode for Audio Features.",
      "Added API-preferred vs local-preferred effective value logic.",
      "Added provider breakdowns to Dashboard and Library Health.",
      "Added retry behavior that respects configured providers.",
    ],
  },
  {
    version: "1.0.3",
    title: "Library Health, Cleanup & Pool Stability",
    badges: ["Beta", "Bug Fix", "Dashboard", "Library Health", "Plex"],
    changes: [
      "Added Library Health page.",
      "Added Plex/Mixarr sync integrity stats.",
      "Added missing track viewer.",
      "Added safe cleanup tools for stale Plex records.",
      "Added missing track export.",
      "Added BPM health summary.",
      "Added validated atomic BPM samples, ffmpeg seek fallback, and separate extraction/analyzer failure reporting.",
      "Improved dashboard counts to use active tracks only.",
      "Fixed Prisma connection pool exhaustion during long-running sync/status polling.",
      "Improved Sync Center status polling with slower idle polling, active polling hints, and pool-busy backoff.",
      "Added shared job overlap protection for manual syncs, enrichment jobs, and nightly scheduler runs.",
      "Improved Prisma P2024 logging with concise pool-timeout diagnostics instead of repeated status stack traces.",
    ],
  },
];

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "");
}

function prereleaseRank(value?: string) {
  if (!value) return 0;
  if (value.startsWith("hotfix")) return 1;
  return -1;
}

export function compareSemanticVersions(left: string, right: string) {
  const [leftMain, leftPrerelease] = normalizeVersion(left).split("-", 2);
  const [rightMain, rightPrerelease] = normalizeVersion(right).split("-", 2);
  const leftParts = leftMain.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = rightMain.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }

  const rankDifference = prereleaseRank(leftPrerelease) - prereleaseRank(rightPrerelease);
  if (rankDifference !== 0) return rankDifference;
  return (leftPrerelease || "").localeCompare(rightPrerelease || "");
}

export function getReleaseNotesOldestFirst(notes: ReleaseNote[] = releaseNotes) {
  return [...notes].sort((left, right) => compareSemanticVersions(left.version, right.version));
}

export function getReleaseNotesNewestFirst(notes: ReleaseNote[] = releaseNotes) {
  return [...notes].sort((left, right) => compareSemanticVersions(right.version, left.version));
}
