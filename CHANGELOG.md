# Changelog

## v1.2.0 - Smart Playlist Builder v1

- Added Smart Playlist Builder v1 with guided playlist presets.
- Added presets for Workout, Chill, Party, Focus, Driving, Discovery, Deep Cuts, Popular Favorites, and Balanced Mix.
- Smart Builder now suggests filters, BPM ranges, energy/mood ranges, popularity preferences, and safety rules.
- Smart Builder uses the existing playlist preview flow before creating playlists.
- Smart Builder setups can be saved as reusable playlist recipes.
- Playlist creation history now records the Smart Builder preset used.

## v1.1.10 - Playlist Safety Rules

- Added optional playlist safety rules to reduce repetitive results.
- Added artist spacing to avoid same-artist back-to-back tracks.
- Added max tracks per artist and max tracks per album controls.
- Added low-track-count warnings in playlist preview.
- Saved safety rule settings with playlist recipes.
- Added safety rule summaries and warnings to playlist preview and Job History.

## v1.1.9.1 - Manual Track Exclusion

- Added manual track exclusions for Mixarr-generated playlists.
- Added exclude actions from playlist previews.
- Added excluded track management with remove-exclusion support.
- Applied manual exclusions to playlist previews, recipe previews, and playlist creation.
- Added exclusion counts to playlist preview stats where applicable.

## v1.1.9 - Edit and Duplicate Playlist Recipes

- Added editing for saved playlist recipes.
- Added recipe duplication for quickly creating variations.
- Added update-existing-recipe support from the playlist builder.
- Added improved recipe actions and updated recipe metadata.
- Kept recipe previews connected to the playlist preview flow.

## v1.1.8 - Save Playlist Recipes

- Added saved playlist recipes for reusable playlist filter setups.
- Added Save Recipe action to the playlist builder.
- Added a Saved Recipes page with recipe summaries and usage actions.
- Added recipe preview support using the playlist preview flow.
- Added dashboard visibility for saved playlist recipes.

## v1.1.7 - Playlist Preview Before Create

- Added a playlist preview step before creating playlists.
- Added track previews, filter summaries, and playlist stats before writing to Plex.
- Added warnings for low-match and zero-match playlist filters.
- Added create-from-preview flow so users can review playlists first.
- Improved playlist creation confidence and reduced accidental bad playlists.

## v1.1.6-hotfix - Homepage Library Health Performance Hotfix

- Fixed large-library homepage performance issue where Library Health counts could block SSR for several minutes.
- Reduced expensive repeated health-count queries.
- Homepage now renders without waiting for a full Library Health recalculation.

## v1.1.6 - Library Health Details

- Added a dedicated Library Health Details page.
- Added clickable health categories for missing BPM, API-only BPM, partial audio features, failed analysis, and missing local files.
- Added track-level explanations for why items appear in each health category.
- Added filtered track views with sorting and basic actions.
- Connected Library Health retry actions with Job History and retry explanations.

## v1.1.5 - Background Scheduler Settings

- Added web UI controls for the Background Scheduler.
- Added daily, weekly, interval, and custom cron schedule options.
- Kept 3:00 AM daily as the default schedule.
- Added validation for custom cron expressions.
- Added scheduler status visibility and better scheduled-job history labeling.
- Kept SYNC_CRON_SCHEDULE as a fallback/default environment variable.

## v1.1.4 - Retry Explanation Improvements

- Improved retry result messages when no tracks are queued.
- Added clearer explanations for zero-result BPM and audio-feature retry actions.
- Added retry filter, matched, queued, skipped, and reason details where available.
- Improved Job History summaries for retry and zero-attempt jobs.
- Reduced confusion around local-only retry and force reprocess actions.

## v1.1.3 - Better Job History

- Added Job History page for recent background jobs.
- Added status, timing, duration, and summary details for sync and retry jobs.
- Added dashboard visibility for recent job activity.
- Added basic filters for job status and job type.
- Improved debugging visibility for failed or zero-result jobs.

## v1.1.2 - Version & Update Visibility

- Added clearer current-version visibility across Mixarr.
- Added an About / Updates area for release notes, roadmap access, and update guidance.
- Added dashboard version visibility.
- Centralized app version display to reduce stale version mismatches.

## v1.1.1 - Roadmap & Coming Soon

- Added a Roadmap / Coming Soon page for Mixarr's path toward v2.0.0.
- Added a dashboard card linking to the v2.0.0 roadmap.
- Added roadmap sections for current release, upcoming features, v2.0.0 ideas, Discord beta feedback, and GitHub supporter beta access.
- Updated app version display to v1.1.1.

## v1.1.0 - Dashboard Cleanup & v2.0.0 Preview

- Cleaned up dashboard enrichment card layouts.
- Fixed Track Genres card text overflow.
- Removed redundant Data Enrichment dashboard section.
- Added v2.0.0 Coming Soon preview section.
- Added guidance that enrichment tools are available from each dashboard card.
- Improved dashboard polish and mobile layout.

## v1.0.5 - Metadata Reliability & Library Health Polish

- Fixed partial audio feature retry not clearing after successful local Essentia analysis.
- Fixed retry queues replaying already-completed tracks.
- Improved BPM and audio feature candidate selection consistency.
- Added post-save verification logging for local metadata analysis.
- Improved Library Health count/filter accuracy.
- Improved whole-track Essentia temp cleanup and worker safety.
- Added separate too-short status handling.
- Added GitHub repository link.
- Improved provider/status breakdowns in Dashboard and Library Health.

## v1.0.4 - Local/API Metadata Controls

- Added settings to enable or disable API BPM lookup.
- Added settings to enable or disable API Audio Feature lookup.
- Added local Essentia-only mode for BPM.
- Added local Essentia-only mode for Audio Features.
- Added API-preferred vs local-preferred effective value logic.
- Added provider breakdowns to Dashboard and Library Health.
- Added retry behavior that respects configured providers.


## v1.0.3 - Library Health, Cleanup & Pool Stability

- Added Library Health page.
- Added Plex/Mixarr sync integrity stats.
- Added missing track viewer.
- Added safe cleanup tools for stale Plex records.
- Added missing track export.
- Added BPM health summary.
- Added validated atomic BPM samples, ffmpeg seek fallback, and separate extraction/analyzer failure reporting.
- Improved dashboard counts to use active tracks only.
- Fixed Prisma connection pool exhaustion during long-running sync/status polling.
- Improved Sync Center status polling with slower idle polling, active polling hints, and pool-busy backoff.
- Added shared job overlap protection for manual syncs, enrichment jobs, and nightly scheduler runs.
- Improved Prisma P2024 logging with concise pool-timeout diagnostics instead of repeated status stack traces.
