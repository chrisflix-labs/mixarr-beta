# Mixarr v2.2.0 — Playlist Orchestration Foundation

Mixarr v2.2.0 adds an opt-in, database-backed coordination layer for managed Plex playlists. It does not automatically register existing playlists, enable automation, balance playlists, move tracks between playlists, or require AI.

## Safe upgrade defaults

- Global orchestration: disabled
- Existing playlists automatically registered: no
- Newly generated playlists automatically registered: no
- Automation automatically enabled after registration: no
- Scheduled orchestration: disabled
- Global concurrent playlist jobs: 1

Legacy generation, regeneration, Recently Added, Plex sync, identities, versions, feedback, and scheduled jobs continue to use their existing paths unless a playlist is explicitly registered and work is explicitly queued through orchestration.

## Architecture

The foundation consists of a persistent `ManagedPlaylist` registry, validated `ManagedPlaylistRelationship` graph, one `PlaylistOrchestrationJob` queue, leased `PlaylistOrchestrationLock` conflict/concurrency records, and an append-only `PlaylistOrchestrationAuditEvent` history. Service modules under `src/lib/orchestration` own state transitions, dependency resolution, queue creation and claiming, locks, recovery, execution, and settings. API routes and React components call these services rather than duplicating orchestration rules.

Dependencies use deterministic topological ordering. `DEPENDS_ON` and `RUNS_AFTER` participate in cycle detection; `RELATED` is stored for future behavior. A job stores its dependency snapshot so later relationship edits do not make historical decisions inexplicable.

Queue order is dependency eligibility, playlist priority, explicit job priority, schedule, then request time. A bounded aging bonus is added every six hours (up to 90 points), preventing permanent starvation while leaving dependency, lock, and concurrency checks authoritative.

## Dry runs

Dry-run jobs resolve dependencies, queue priority, conflict keys, and regeneration candidates. They store an expected add/remove/preserve summary with `plexModified: false`. They do not call Plex write functions, create playlist versions, update identity membership history, or record personalization interactions.

## Recovery and partial writes

Workers heartbeat jobs and locks and record operation phases. Startup recovery may requeue planning-only read/simulation work. Jobs that reached a Plex-write or database-commit phase become `STALE` with `MANUAL_REVIEW_REQUIRED`; Mixarr will not blindly replay them. Expired leases are removed and every recovery decision is audited.

## API

All endpoints require the existing `mixarr_session` authentication cookie and enforce user ownership. Global settings require administrator access.

- `GET /api/orchestration/status`
- `GET|POST /api/orchestration/playlists`
- `GET|PATCH|DELETE /api/orchestration/playlists/:id`
- `GET|POST /api/orchestration/relationships`
- `DELETE /api/orchestration/relationships/:id`
- `GET|POST /api/orchestration/jobs`
- `GET /api/orchestration/jobs/:id`
- `POST /api/orchestration/jobs/:id/cancel`
- `POST /api/orchestration/jobs/:id/retry`
- `POST /api/orchestration/dry-run`
- `GET /api/orchestration/audit`
- `GET|PATCH /api/settings/orchestration` (admin)

List endpoints accept `page` and `pageSize` (maximum 100). Job filters include status, trigger, priority, playlist, and date range. Audit filters include playlist, job, event type, severity, and date range. Mutation errors use `{ "error": { "code", "message", "details" } }`. Job creation accepts an `Idempotency-Key` header or body `idempotencyKey`.

## Deferred v2.2.x behavior

Playlist groups, cross-playlist duplicate control, shared pools, run windows, rotations, balancing, a visual planner, repair tooling, and optimization insights remain future work. v2.2.0 stores the relationships and operation metadata those releases can build upon.

## Migration, rollback, and failure safety

Apply `prisma/migrations/20260717020000_playlist_orchestration_foundation/migration.sql` with the normal deployment process. It only creates new enums/tables/indexes/foreign keys and inserts a disabled settings row. It does not scan, register, modify, or delete playlists.

For a development database with no orchestration data, rollback by first stopping all Mixarr processes, backing up the database, then dropping the five orchestration tables in dependency order and the seven v2.2.0 enum types. Remove only the `playlistOrchestrationSettings` `SystemState` row and the migration record after verifying the backup. Prisma Migrate does not provide a generally safe automatic production down migration.

For production rollback, keep the additive schema in place and deploy the previous application version. The added tables are backward-safe and ignored by v2.1.x. Do not drop tables if any orchestration history must be retained. A failed or incomplete migration is reported as an orchestration health warning; legacy services continue starting. Repair the migration from a backup or complete it with the supported Prisma deployment command rather than using `db push --force-reset`.

PostgreSQL is the database currently declared by this repository's Prisma datasource. No SQLite compatibility claim is made until the project officially adds and tests a SQLite datasource.
