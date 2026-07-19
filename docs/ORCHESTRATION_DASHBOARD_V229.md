# Playlist Ecosystem & Orchestration Dashboard (v2.2.9)

Mixarr v2.2.9 completes the v2.2.x orchestration cycle with `/orchestration`, the **Playlist Ecosystem** operations console. It coordinates the existing managed-playlist queue, playlist groups, cross-playlist variety, coverage snapshots, Smart Actions, experiments, Playlist Health, and audit records. It does not create a parallel automation system and does not require an AI provider.

## Dashboard and data freshness

The overview shows managed, healthy, attention, paused, disabled, and eligible unmanaged playlist counts; cached library coverage and overlap; pending Smart Actions; active and recently completed experiments; upcoming and failed/stalled jobs; automation success; current warnings; recent changes; and ecosystem trends.

Summary panels load independently. Dashboard requests use bounded count/aggregate queries and the latest persisted domain snapshots. They never scan every library track. Coverage detail continues to use the v2.2.5 background calculation and segment snapshots. Relationship and heatmap endpoints cap render payloads, state when a result is limited, and support filters for narrowing the complete dataset. Audit, jobs, Smart Actions, and coverage details remain paginated.

The nightly scheduler captures an `OrchestrationTrendSnapshot` after Smart Actions and Playlist Health complete. A first dashboard visit may capture an initial snapshot; charts do not turn missing history into zero. Every chart has a table or textual alternative. The graph simplifies large result sets and has a relationship table; the heatmap becomes a scrollable table/list workflow at narrow widths.

## Health, groups, overlap, and coverage

Playlist health combines the latest Playlist Health snapshot with orchestration runtime state and Plex availability. A paused playlist is labeled Paused. Missing optional data produces Not enough data rather than an unhealthy label. Critical states include unavailable Plex playlists, orchestration errors, and critical health checks.

Group health aggregates member snapshots, overlap summaries, pending Smart Actions, active experiments, and job history. Overlap reuses `PlaylistOverlapSummary` and pair policy data. Not all overlap is treated as bad: cells show whether the pair remains within its configured policy and comparison links open the existing cross-playlist workspace.

Coverage uses eligible tracks after the configured exclusion policy as its denominator. The dashboard exposes that denominator and links to segment and track drill-downs for never-selected, neglected, recently added, and overused music.

## Automation, Smart Actions, experiments, and audit

Upcoming orchestration jobs include target, schedule, trigger, state, dry-run/approval context, last run, manual run, and safe occurrence cancellation. Administrator queue maintenance is preview-first and can clear retained completed/failed rows, retry bounded failed work, cancel queued work, remove stale rows, or recover interrupted jobs. Job deletion never deletes `PlaylistOrchestrationAuditEvent` rows; foreign-key behavior detaches the job reference while retaining the explanation. Normal retention remains controlled by the persisted orchestration settings, not a hard-coded cleanup period.

Smart Actions retain their existing approval state machine, risk gates, previews, conflict detection, per-action execution, version snapshots, and restore links. The dashboard exposes individual approval/rejection/apply actions and sends bulk management to the full Action Center. Experiments remain manual unless their separately configured automation policy permits otherwise; the dashboard never silently selects a winner.

Audit reads are cursor/page bounded and support date, event, playlist, group, job, actor, severity, outcome, operation, and readable-summary search fields. v2.2.9 audit records can directly identify configuration import, backup validation, queue maintenance, Smart Action, experiment, and group context.

## Onboarding and permissions

Onboarding is resumable and can be reopened as a configuration review. It records selected goals, requested automation level, maximum change scope, and review completion without changing the global runtime switch. Playlist enrollment remains explicit and automation remains disabled on new enrollment. Existing playlists are not enrolled by migration.

Mixarr's current authorization model provides authenticated ownership checks plus administrator status. User-owned reads and ordinary playlist actions verify the session owner. Configuration import, backup validation, migration checks, and broad queue cleanup require an administrator. The summary returns capability flags so unavailable controls are not rendered. Server-side checks remain authoritative.

## Export and import safety

`GET /api/orchestration/configuration/export` returns readable `mixarr-orchestration` JSON schema version 1. Export is allowlisted and recursively excludes credentials, tokens, API keys, cookies, sessions, authorization data, encrypted notification endpoints, and encryption material. Metadata lists included sections and excluded secret categories.

Import accepts at most the application's normal request limit and follows parse → schema validation → version detection → preview → conflict/missing-reference report → confirmation → transaction → audit. Modes are:

- **Merge**: create or update orchestration-owned sections while leaving unrelated configuration intact.
- **Replace orchestration settings**: disable absent orchestration enrollments and pause absent groups; it never replaces unrelated application settings.
- **Preview only**: validate and report without writes.

Unknown schema versions, invalid priorities/modes, unsafe bounds, duplicate references, invalid schedules, and missing playlists are rejected or reported. Missing playlist references are skipped explicitly. Secrets are removed before validation and are never imported.

## Backup validation

Backup validation checks a JSON backup manifest for playlist groups, relationships, automation configuration, Smart Actions, experiments, health history, audit logs, playlist versions, and orchestration preferences. It reports missing/corrupt sections, schema version, estimated scope, warnings/errors, and restore compatibility. Validation stores only section-level evidence and never stores the uploaded payload or changes the active database. A valid file is more than an existing file: required sections and schema metadata must be readable.

## Upgrade and migration

Migration `20260719010000_orchestration_dashboard_v229` is additive. It creates:

- `OrchestrationPreference`
- `OrchestrationTrendSnapshot`
- `OrchestrationBackupValidation`
- optional orchestration audit linkage/outcome columns
- targeted scheduled-job, Smart Action priority, experiment completion, audit filter, trend, and validation indexes

It does not rewrite or enable managed playlists, schedules, Smart Actions, experiments, group membership, coverage snapshots, health history, or playlist versions. Migration readiness checks verify tables, indexes, ownership links, duplicate active jobs, experiment references, readable histories, and Smart Action statuses. Warnings are non-blocking; missing required tables are critical and should be repaired before enabling orchestration.

After upgrading:

1. Apply the normal Prisma migration/deployment flow; never force-reset an existing database.
2. Open **Playlist Ecosystem → Setup & Safety** and run migration checks.
3. Confirm managed enrollment and automation states were preserved.
4. Review upcoming jobs, open health warnings, pending Smart Actions, and active experiments.
5. Export the configuration and validate a current backup manifest.
6. Let at least two nightly snapshots accumulate before interpreting trend direction.

Production rollback should deploy the previous application while leaving the additive tables intact. Dropping v2.2.9 tables or columns should be attempted only during a tested database restore.

## API reference

All routes require the Mixarr session cookie and scope reads and writes to the authenticated owner. Administrator-only routes return `403 ADMIN_REQUIRED` when unavailable.

- `GET /api/orchestration/summary?range=7d|30d|90d|all`
- `GET /api/orchestration/groups`
- `GET /api/orchestration/relationships?view=graph`
- `GET /api/orchestration/overlap`
- `GET /api/orchestration/coverage`
- `GET /api/orchestration/health-trends?range=...`
- `GET|PATCH /api/orchestration/preferences`
- `GET /api/orchestration/jobs/upcoming`
- `GET|POST /api/orchestration/jobs/maintenance` (administrator)
- `GET /api/orchestration/activity` and `GET /api/orchestration/audit` with bounded pagination and filters
- `GET /api/orchestration/audit/:id` for an owned event and its linked job, playlist, group, Smart Action, or experiment
- `GET /api/orchestration/configuration/export`
- `POST /api/orchestration/configuration/import/preview` (administrator)
- `POST /api/orchestration/configuration/import` (administrator and explicit confirmation)
- `POST /api/orchestration/backup/validate` (administrator)
- `GET /api/orchestration/migration-checks` (administrator)

Relationship and overlap endpoints accept bounded search/group/health/minimum-strength filters. Collection endpoints clamp page size or response limits server-side; the dashboard never requests unbounded job, action, experiment, audit, graph, or overlap data.
