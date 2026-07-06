# Changelog

## v1.2.8 - Audio Feature Health Consistency Fix

- Fixed mismatch where audio feature health summaries showed incomplete tracks but detail views returned none.
- Aligned missing, partial, and pending audio feature filters with summary counts.
- Improved audio feature completeness checks for current provider settings.
- Added clearer incomplete-track reasons in Library Health details.
- Improved retry targeting so audio feature retries use the same filters shown in the UI.
- Improved dashboard wording when rounded percentages hide incomplete tracks.

## v1.2.7 - Navigation Cleanup

- Cleaned up desktop sidebar navigation with grouped sections.
- Grouped playlist tools, library tools, and activity pages.
- Reduced mobile bottom navigation to the most-used items.
- Added a mobile More menu for secondary pages.
- Improved mobile spacing so navigation labels no longer overlap.
- Moved mobile version/GitHub/Beta controls out of the crowded bottom area.

## v1.2.6 - Export/Import Mixarr Recipes

- Added recipe export for individual recipes and all saved recipes.
- Added recipe import with validation and preview before saving.
- Added duplicate-name handling with automatic rename or skip options.
- Preserved recipe filters, Smart presets, Mood presets, BPM presets, and safety rules during export/import.
- Added a stable Mixarr recipe JSON format for backups and sharing.

## v1.2.5 - Playlist History

- Added Playlist History for created and regenerated Mixarr playlists.
- Added historical track snapshots showing the exact order written to Plex.
- Added playlist creation and regeneration summaries with filters, recipes, presets, exclusions, and safety rules.
- Added history details views with track lists and regeneration comparison stats.
- Added links from Generated Playlists to related playlist history.

## v1.2.4 - Advanced Playlist Regeneration

- Enabled Keep Some Existing Tracks regeneration mode.
- Added 25% and 50% keep options for playlist regeneration.
- Enabled Prefer Different Tracks Than Last Time using generated playlist snapshots.
- Added regeneration comparison stats for kept, replaced, reused, and new tracks.
- Added Remove from Generated Playlists action without deleting Plex playlists.
- Improved regeneration preview safety before replacing Plex playlist contents.

## v1.2.3 - Playlist Regeneration

- Added playlist regeneration for Mixarr-created playlists.
- Added saved generation metadata for playlists created from the builder, Smart Builder, and recipes.
- Added regeneration preview before replacing tracks in Plex.
- Added support for regenerating playlists using saved filters, presets, manual exclusions, and safety rules.
- Added Generated Playlists visibility and Job History entries for regeneration runs.

## v1.2.2-hotfix - Smart Builder Preset Hotfix

- Fixed Smart Builder so Mood Presets can be selected without first choosing a Smart Preset.
- Fixed Smart Builder so BPM Presets can be selected without first choosing a Smart Preset.
- Allowed Smart, Mood, and BPM presets to be combined independently.
- Improved Smart Builder preview metadata for partial preset selections.
- Changed the app status badge from Official to Beta.

## v1.2.2 - BPM Range Presets

- Added BPM Range Presets to Smart Builder.
- Added Slow, Medium, Upbeat, Dance, High Energy, and Wide Open tempo presets.
- BPM Presets now tune playlist tempo without manually entering ranges.
- Playlist Preview now shows selected BPM preset metadata and helpful low-match warnings.
- Saved recipes now preserve BPM preset metadata while keeping filter values as the source of truth.

## v1.2.1 - Mood Presets

- Added Mood Presets for quickly applying mood, energy, and BPM ranges.
- Added presets such as Happy, Chill, Hype, Dark, Emotional, Sad / Mellow, Relaxed, Focus, Upbeat, and Balanced.
- Moved Mood Presets into the Smart Builder flow where guided playlist features belong.
- Fixed Mood Presets placement so they now appear directly in the Smart Builder flow.
- Playlist Preview now shows the selected mood preset and related warnings.
- Saved recipes now preserve mood preset metadata while keeping filter values as the source of truth.

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
