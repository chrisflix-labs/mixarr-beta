# Mixarr v2.2.9 Orchestration Dashboard implementation plan

## Repository inventory

The v2.2.x releases already provide the domain records that v2.2.9 must coordinate:

- `ManagedPlaylist`, `ManagedPlaylistRelationship`, `PlaylistOrchestrationJob`, locks, audit events, worker recovery, job deduplication, and queue retention from v2.2.0.
- Playlist groups, memberships, inherited settings, schedules, activities, and group health from v2.2.1.
- Pair policies, overlap summaries/snapshots, repair previews, and cross-playlist variety settings from v2.2.2.
- Playlist roles and progression chains from v2.2.3.
- Smart Refresh settings/evaluations and scheduled processing from v2.2.4.
- Cached library coverage snapshots, segment snapshots, rotation statistics, and background calculation jobs from v2.2.5.
- Smart Experiment variants, metrics, events, decisions, protected playlist revisions, and scheduler from v2.2.6.
- Smart Actions, explicit approval transitions, preview payloads, audit events, automation policies, and rollback-linked revisions from v2.2.7.
- Playlist health snapshots, alerts, notification delivery, settings, and batch analysis from v2.2.8.

The current `/orchestration` page predates those integrations. It exposes managed-playlist registration, dependencies, the queue, and a basic audit list, but it does not aggregate health, groups, overlap, coverage, Smart Actions, experiments, trends, migration readiness, or configuration safety. Several separate pages already render those domains, so v2.2.9 will link to and reuse them instead of duplicating their management flows.

## Architecture

The v2.2.9 service boundary will live under `src/lib/orchestration/` and expose focused modules for dashboard aggregation, health/groups, relationships/overlap, trends, configuration transfer, backup validation, migration checks, and job maintenance. Route handlers will validate inputs and delegate to these modules. Full-library calculations will not run during dashboard requests.

Dashboard reads will use:

- bounded aggregate/count queries for current status;
- the latest `PlaylistHealthSnapshot`, `LibraryCoverageSnapshot`, and `PlaylistOverlapSummary` records;
- paginated jobs, activity, Smart Actions, experiments, and relationship rows;
- historical `OrchestrationTrendSnapshot` records for charts and accessible tables;
- independently loaded endpoints so slow detail panels cannot block the summary.

## Durable additions

- Per-user orchestration preferences and resumable onboarding configuration.
- Cached orchestration trend snapshots suitable for scheduled/incremental collection.
- Backup-validation history that records section-level validation without changing the active database.
- Optional audit linkage fields for playlist groups, Smart Actions, experiments, operation category, and outcome.
- Query indexes for scheduled jobs, priority Smart Actions, experiment status/time, audit filters, and trend history.

## Safety and compatibility

- Existing playlists are never enrolled or enabled during migration.
- Existing schedules, statuses, experiment variants, playlist versions, and Smart Actions remain untouched.
- Export uses a versioned readable JSON envelope and an allowlist; credentials, tokens, encrypted endpoints, and session data are excluded by construction.
- Import is preview-first, supports merge/replace-orchestration modes, validates references and limits, and applies only orchestration-owned settings in a transaction.
- Backup validation reads an uploaded JSON manifest and verifies schema/required sections without restoring it.
- Administrative queue cleanup preserves audit rows and uses configured retention.
- Visualizations always have table/list alternatives and detailed data stays paginated.

## Known repository constraints

Mixarr currently authenticates a single Plex-backed session and distinguishes administrators with `isUserAdmin`; it does not yet have a granular role/permission table. v2.2.9 will enforce ownership for reads and ordinary actions, require administrator status for configuration import, backup validation, migration checks, and broad queue cleanup, and expose capability flags so read-only controls can be hidden when the authorization model is expanded later.
