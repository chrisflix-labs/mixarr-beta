export const MIXARR_BETA_DISCORD_URL = "https://discord.com/invite/B7xMvAhaF";

export type ReleaseNoteBadge =
  | "Audio Features"
  | "Automation"
  | "Backup"
  | "Beta"
  | "Bug Fix"
  | "BPM"
  | "Accuracy"
  | "Cache"
  | "Dashboard"
  | "Data Enrichment"
  | "Debugging"
  | "Diagnostics"
  | "Energy"
  | "Essentia"
  | "Hotfix"
  | "History"
  | "Import"
  | "Export"
  | "Genres"
  | "Job History"
  | "Jobs"
  | "Library"
  | "Library Health"
  | "Local Analysis"
  | "Matching Rules"
  | "Mood"
  | "Mobile"
  | "Navigation"
  | "Playlists"
  | "Popularity"
  | "Plex"
  | "Preview"
  | "Recipes"
  | "Regeneration"
  | "Release Notes"
  | "Retry"
  | "Roadmap"
  | "Safety Rules"
  | "Scheduler"
  | "Settings"
  | "Sharing"
  | "Smart Builder"
  | "UI"
  | "Reliability"
  | "Worker";

export type ReleaseNote = {
  version: string;
  title: string;
  releaseDate?: string;
  badges: ReleaseNoteBadge[];
  changes: string[];
};

export const releaseNotes: ReleaseNote[] = [
  {
    version: "1.3.6",
    title: "Background Worker Reliability",
    badges: ["Worker", "Scheduler", "Job History", "Reliability", "Diagnostics"],
    changes: [
      "Added clearer background worker health, heartbeat, and queue visibility.",
      "Added stale worker and stale job detection.",
      "Improved recovery for interrupted enrichment and analysis jobs after restart.",
      "Added duplicate job protection for long-running sync and enrichment actions.",
      "Improved Job History status, progress, and result summaries.",
      "Improved scheduled job reliability and skip reporting when another job is already running.",
      "Added worker and scheduler diagnostics for troubleshooting.",
    ],
  },
  {
    version: "1.3.5",
    title: "Mood & Energy Sync Improvements",
    badges: ["Mood", "Energy", "Audio Features", "Library Health", "Data Enrichment", "Smart Builder"],
    changes: [
      "Added clearer mood and energy health classification in Library Health.",
      "Added mood/energy source and confidence display where available.",
      "Added missing mood, missing energy, and partial mood/energy visibility.",
      "Improved retry/reprocess targeting for tracks missing mood or energy values.",
      "Improved Data Enrichment summaries for mood and energy completeness.",
      "Improved Smart Builder and Playlist Preview messaging when mood/energy data is incomplete.",
    ],
  },
  {
    version: "1.3.4",
    title: "BPM Confidence & Source Improvements",
    badges: ["BPM", "Library Health", "Data Enrichment", "Diagnostics", "Playlists"],
    changes: [
      "Added clearer BPM source labels for local, API, imported, estimated, and manual values.",
      "Added BPM confidence levels to make tempo data easier to trust.",
      "Added BPM source conflict detection for significantly different provider values.",
      "Improved Library Health BPM detail views with source, confidence, and reason information.",
      "Added BPM source/confidence filters and source breakdowns where available.",
      "Improved Dashboard and Data Enrichment BPM summaries.",
    ],
  },
  {
    version: "1.3.3",
    title: "Data Enrichment Cleanup",
    badges: ["Data Enrichment", "Library Health", "BPM", "Audio Features", "Genres", "Popularity", "Job History"],
    changes: [
      "Cleaned up Data Enrichment into clearer BPM, Audio Features, Genres, Popularity, and Local Audio Analysis sections.",
      "Added clearer provider/mode visibility for enrichment actions.",
      "Added preflight summaries before enrichment jobs run.",
      "Improved no-op handling so enrichment actions explain when no tracks are eligible.",
      "Connected enrichment actions to Library Health detail filters.",
      "Improved Job History summaries for enrichment jobs.",
      "Improved dashboard and Library Health refresh after enrichment jobs complete.",
    ],
  },
  {
    version: "1.3.2",
    title: "Local Audio Analysis Polish",
    badges: ["Audio Features", "Local Analysis", "Essentia", "Library Health", "Job History"],
    changes: [
      "Added clearer Local Audio Analysis status and provider-mode visibility.",
      "Added local analysis preflight summaries with matched, eligible, skipped, and skip-reason counts.",
      "Improved Local Essentia progress and completion summaries.",
      "Improved skip reason reporting for local audio analysis and force reprocess actions.",
      "Added local analysis diagnostics to Library Health.",
      "Improved Library Health and dashboard refresh after local analysis jobs complete.",
    ],
  },
  {
    version: "1.3.1",
    title: "Audio Feature Retry Improvements",
    badges: ["Library Health", "Audio Features", "Retry", "Local Analysis", "Job History"],
    changes: [
      "Improved audio-feature retry actions to use the same resolved track sets as Library Health cards and detail views.",
      "Added retry preflight checks with matched, eligible, queued, skipped, and skip-reason counts.",
      "Improved local Essentia retry handling for partial and pending audio-feature tracks.",
      "Added clearer disabled states for API-only and local-only retry modes.",
      "Improved Job History summaries for audio-feature retry and reprocess jobs.",
      "Library Health and dashboard counts now refresh after audio-feature retry jobs complete.",
    ],
  },
  {
    version: "1.3.0.1",
    title: "Audio Features Health Card Sync Fix",
    badges: ["Hotfix", "Dashboard", "Library Health", "Audio Features", "Cache"],
    changes: [
      "Fixed Audio Features health cards showing stale incomplete counts after audio feature data was saved.",
      "Improved Library Health cache invalidation after audio feature sync, retry, and local Essentia reprocess jobs.",
      "Aligned Dashboard and Library Health audio feature counts around the same source-of-truth resolver.",
      "Added stale summary diagnostics for audio feature health counts.",
      "Preserved v1.3.0 Library Health Accuracy count/detail/retry consistency rules.",
    ],
  },
  {
    version: "1.3.0",
    title: "Library Health Accuracy",
    badges: ["Library Health", "Accuracy", "Diagnostics", "Audio Features", "BPM", "Genres", "Popularity", "Retry"],
    changes: [
      "Rebuilt Library Health around shared category resolvers so card counts, detail rows, and retry actions use the same track sets.",
      "Added health accuracy invariants for audio features, BPM, genres, popularity, and local file status.",
      "Added Health Accuracy Diagnostics to detect count/detail mismatches.",
      "Improved provider-mode-aware classification for BPM and audio feature health.",
      "Preserved the v1.2.8 fix for BPM-present tracks being classified as partial audio features.",
      "Improved retry targeting and skip explanations for Library Health categories.",
      "Added health diagnostics export for easier bug reports.",
    ],
  },
  {
    version: "1.2.9.1",
    title: "Matching Rules Layout Fix",
    badges: ["Hotfix", "UI", "Playlists", "Matching Rules"],
    changes: [
      "Fixed Matching Rules row overflow on the Playlist Builder page.",
      "Improved responsive layout for rule fields, operators, values, and delete actions.",
      "Prevented Matching Rules controls from overlapping the preview panel.",
      "Improved narrow-width and mobile behavior for the Matching Rules card.",
    ],
  },
  {
    version: "1.2.9",
    title: "Playlist Builder UI Fix",
    badges: ["UI", "Playlists", "Preview", "Safety Rules", "Bug Fix"],
    changes: [
      "Fixed Playlist Builder layout overlap after generating a playlist preview.",
      "Improved Previewed Tracks table sizing and overflow behavior.",
      "Improved responsive layout for builder and preview panels.",
      "Tuned repeated-artist warnings so allowed repeats do not show as warnings when max tracks per artist is enabled.",
      "Added clearer safety-rule messaging for successful variety rules versus actual problems.",
      "Prepared the UI for the upcoming v1.3.0 feature branch.",
    ],
  },
  {
    version: "1.2.8-hotfix.7",
    title: "Audio Feature Incomplete Count Classification Fix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Retry", "Dashboard"],
    changes: [
      "Fixed Audio Feature Health showing zero incomplete categories while the dashboard reported incomplete tracks.",
      "Tracks with BPM data but missing full audio feature fields now count as Partial Audio Features.",
      "Partial and Pending Audio Feature detail views now use the same incomplete track set as the dashboard.",
      "Improved local Essentia retry targeting for partial audio-feature tracks.",
      "Removed misleading missing-audio-feature gap wording when tracks are actually partial.",
    ],
  },
  {
    version: "1.2.8-hotfix.6",
    title: "BPM Partial Audio Feature Classification Fix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Retry", "Local Analysis"],
    changes: [
      "Fixed tracks with BPM data being incorrectly classified as missing audio features.",
      "Tracks with BPM but missing energy, mood, danceability, or local Essentia values now count as partial audio features.",
      "Partial Audio Features and Pending Audio Features now load the correct track sets.",
      "Improved retry and local Essentia candidate selection for partial audio-feature tracks.",
      "Aligned /settings/library-health and /library-health around the same classification rules.",
    ],
  },
  {
    version: "1.2.8-hotfix.5",
    title: "Partial Audio Feature Classification Fix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Retry", "Local Analysis"],
    changes: [
      "Fixed tracks with BPM data but missing audio feature fields being classified as missing instead of partial.",
      "Partial Audio Features now correctly shows tracks with incomplete energy, mood, danceability, or local Essentia fields.",
      "Pending Audio Features now loads the same retry-eligible track set shown in the summary.",
      "Improved local Essentia retry candidate selection for partial audio-feature tracks.",
      "Aligned /settings/library-health and /library-health classification behavior.",
    ],
  },
  {
    version: "1.2.8-hotfix.4",
    title: "Library Health Card Detail Match Fix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Retry"],
    changes: [
      "Fixed Missing Audio Features cards showing 70 while the detail view returned 0 tracks.",
      "Fixed Pending Audio Features cards showing 70 while the detail view returned 0 tracks.",
      "Unified Library Health card counts and detail rows around shared track ID resolution.",
      "Included audio feature gap tracks in detail views and retry candidate selection.",
      "Added mismatch detection so health cards cannot silently disagree with detail tables.",
    ],
  },
  {
    version: "1.2.8-hotfix.3",
    title: "Audio Gap Detail Query Fix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Retry"],
    changes: [
      "Fixed Missing Audio Features detail view returning zero rows when summary showed gap-classified tracks.",
      "Fixed Pending Audio Features detail view to include gap-classified tracks.",
      "Added shared audio feature gap track ID logic for summary, details, and retry actions.",
      "Improved retry candidate selection for active tracks without audio feature records.",
      "Improved debug logging for audio feature summary/detail count matching.",
    ],
  },
  {
    version: "1.2.8-hotfix.2",
    title: "Audio Gap Summary Merge Fix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Dashboard", "Retry"],
    changes: [
      "Fixed audio feature gap detection not being merged into Library Health summary counts.",
      "Missing audio feature cards now include active tracks without audio feature records.",
      "Fixed detail filters so gap tracks appear when clicking View tracks.",
      "Improved audio feature retry targeting for gap-classified tracks.",
      "Aligned audio feature provider mode logging with actual settings.",
    ],
  },
  {
    version: "1.2.8-hotfix",
    title: "Audio Feature Gap Hotfix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Dashboard", "Retry"],
    changes: [
      "Fixed active tracks with no audio feature records being excluded from Library Health detail filters.",
      "Added audio feature gap detection between dashboard complete counts and Library Health categories.",
      "Classified unaccounted incomplete tracks as missing audio features instead of hiding them.",
      "Improved dashboard wording to show exact incomplete audio feature counts.",
      "Improved retry targeting for missing audio feature tracks.",
    ],
  },
  {
    version: "1.2.8",
    title: "Audio Feature Health Consistency Fix",
    badges: ["Library Health", "Audio Features", "Bug Fix", "Retry", "Dashboard"],
    changes: [
      "Fixed mismatch where audio feature health summaries showed incomplete tracks but detail views returned none.",
      "Aligned missing, partial, and pending audio feature filters with summary counts.",
      "Improved audio feature completeness checks for current provider settings.",
      "Added clearer incomplete-track reasons in Library Health details.",
      "Improved retry targeting so audio feature retries use the same filters shown in the UI.",
      "Improved dashboard wording when rounded percentages hide incomplete tracks.",
    ],
  },
  {
    version: "1.2.7",
    title: "Navigation Cleanup",
    badges: ["UI", "Mobile", "Navigation", "Dashboard"],
    changes: [
      "Cleaned up desktop sidebar navigation with grouped sections.",
      "Grouped playlist tools, library tools, and activity pages.",
      "Reduced mobile bottom navigation to the most-used items.",
      "Added a mobile More menu for secondary pages.",
      "Improved mobile spacing so navigation labels no longer overlap.",
      "Moved mobile version/GitHub/Beta controls out of the crowded bottom area.",
    ],
  },
  {
    version: "1.2.6",
    title: "Export/Import Mixarr Recipes",
    badges: ["Recipes", "Import", "Export", "Backup", "Sharing"],
    changes: [
      "Added recipe export for individual recipes and all saved recipes.",
      "Added recipe import with validation and preview before saving.",
      "Added duplicate-name handling with automatic rename or skip options.",
      "Preserved recipe filters, Smart presets, Mood presets, BPM presets, and safety rules during export/import.",
      "Added a stable Mixarr recipe JSON format for backups and sharing.",
    ],
  },
  {
    version: "1.2.5",
    title: "Playlist History",
    badges: ["Playlists", "History", "Regeneration", "Preview", "Job History"],
    changes: [
      "Added Playlist History for created and regenerated Mixarr playlists.",
      "Added historical track snapshots showing the exact order written to Plex.",
      "Added playlist creation and regeneration summaries with filters, recipes, presets, exclusions, and safety rules.",
      "Added history details views with track lists and regeneration comparison stats.",
      "Added links from Generated Playlists to related playlist history.",
    ],
  },
  {
    version: "1.2.4",
    title: "Advanced Playlist Regeneration",
    badges: ["Playlists", "Regeneration", "Plex", "Preview", "Job History"],
    changes: [
      "Enabled Keep Some Existing Tracks regeneration mode.",
      "Added 25% and 50% keep options for playlist regeneration.",
      "Enabled Prefer Different Tracks Than Last Time using generated playlist snapshots.",
      "Added regeneration comparison stats for kept, replaced, reused, and new tracks.",
      "Added Remove from Generated Playlists action without deleting Plex playlists.",
      "Improved regeneration preview safety before replacing Plex playlist contents.",
    ],
  },
  {
    version: "1.2.3",
    title: "Playlist Regeneration",
    badges: ["Playlists", "Regeneration", "Smart Builder", "Recipes", "Preview", "Plex"],
    changes: [
      "Added playlist regeneration for Mixarr-created playlists.",
      "Added saved generation metadata for playlists created from the builder, Smart Builder, and recipes.",
      "Added regeneration preview before replacing tracks in Plex.",
      "Added support for regenerating playlists using saved filters, presets, manual exclusions, and safety rules.",
      "Added Generated Playlists visibility and Job History entries for regeneration runs.",
    ],
  },
  {
    version: "1.2.2-hotfix",
    title: "Smart Builder Preset Hotfix",
    badges: ["Hotfix", "Smart Builder", "Mood", "BPM", "Beta"],
    changes: [
      "Fixed Smart Builder so Mood Presets can be selected without first choosing a Smart Preset.",
      "Fixed Smart Builder so BPM Presets can be selected without first choosing a Smart Preset.",
      "Allowed Smart, Mood, and BPM presets to be combined independently.",
      "Improved Smart Builder preview metadata for partial preset selections.",
      "Changed the app status badge from Official to Beta.",
    ],
  },
  {
    version: "1.2.2",
    title: "BPM Range Presets",
    badges: ["Smart Builder", "Playlists", "BPM", "Recipes", "Preview"],
    changes: [
      "Added BPM Range Presets to Smart Builder.",
      "Added Slow, Medium, Upbeat, Dance, High Energy, and Wide Open tempo presets.",
      "BPM Presets now tune playlist tempo without manually entering ranges.",
      "Playlist Preview now shows selected BPM preset metadata and helpful low-match warnings.",
      "Saved recipes now preserve BPM preset metadata while keeping filter values as the source of truth.",
    ],
  },
  {
    version: "1.2.1",
    title: "Mood Presets",
    badges: ["Smart Builder", "Playlists", "Mood", "Recipes", "Preview"],
    changes: [
      "Added Mood Presets for quickly applying mood, energy, and BPM ranges.",
      "Added presets such as Happy, Chill, Hype, Dark, Emotional, Sad / Mellow, Relaxed, Focus, Upbeat, and Balanced.",
      "Moved Mood Presets into the Smart Builder flow where guided playlist features belong.",
      "Fixed Mood Presets placement so they now appear directly in the Smart Builder flow.",
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
  if (!value) return 3;
  if (value.startsWith("hotfix")) return 4;
  if (value.startsWith("rc")) return 2;
  if (value.startsWith("beta")) return 1;
  return 0;
}

function comparePrereleaseIdentifiers(left: string, right: string) {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) {
      const difference = leftNumber - rightNumber;
      if (difference !== 0) return difference;
      continue;
    }

    const difference = leftPart.localeCompare(rightPart);
    if (difference !== 0) return difference;
  }

  return 0;
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
  return comparePrereleaseIdentifiers(leftPrerelease || "", rightPrerelease || "");
}

export function getReleaseNotesOldestFirst(notes: ReleaseNote[] = releaseNotes) {
  return [...notes].sort((left, right) => compareSemanticVersions(left.version, right.version));
}

export function getReleaseNotesNewestFirst(notes: ReleaseNote[] = releaseNotes) {
  return [...notes].sort((left, right) => compareSemanticVersions(right.version, left.version));
}
