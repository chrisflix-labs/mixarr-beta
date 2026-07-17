# Mixarr v2.2.1 — Playlist Groups & Collections

Playlist Groups let a user organize any Mixarr-generated playlist into one or more collections. Open **Collections** from the main navigation to create, search, sort, filter, pause, clone, delete, and inspect groups.

## Membership and ordering

A playlist can belong to no groups, one group, or several groups. Adding or removing a membership never regenerates the playlist and does not copy settings. Each membership has an independent stable order, so moving a playlist in one collection has no effect elsewhere. Collection deletion removes memberships and group settings only; playlists, Plex content, identities, history, and versions remain.

## Primary settings group and inheritance

Multiple groups may organize a playlist, but only one membership can be its primary settings source. A database constraint and transaction enforce that rule. New memberships start with inheritance disabled, so existing settings remain local overrides.

The resolver applies this precedence:

1. System defaults
2. User defaults
3. Primary playlist-group defaults
4. Playlist-specific overrides
5. One-time generation overrides

Every resolved setting includes its value and source. Per-setting states are `inherit`, `override`, or `disabled`. If the primary group disappears, Mixarr keeps the playlist configuration intact and reports that another primary source should be selected; it never silently chooses a group by database order.

## Shared behavior

Versioned collection defaults cover discovery level, deep-cut target, artist and album limits, repeat tolerance, recently played and recently used exclusions, live-track handling, missing metadata, recommendation strength, personalization influence, and group-wide artist distribution. Supported inherited controls are merged into the real Smart Mix regeneration configuration before candidate selection. Existing hard exclusions, never-recommend feedback, locked tracks, metadata corrections, permissions, Plex scope, and version snapshots remain authoritative.

Shared exclusion records support track, artist, album, genre, mood, live, remix, instrumental, explicit, metadata-confidence, and library rules. They retain reason, source, enablement, and override policy for explanations and future export compatibility.

## Group regeneration

The group screen previews the selected playlists, preserved snapshot count, warnings, paused state, and version behavior. A confirmed operation creates one parent Job History record and bounded child jobs. Each child uses the existing regeneration preview and write service; failures are isolated, progress is aggregated, queued work can be cancelled, and normal playlist-version snapshots remain available for individual restore.

Manual regeneration of a paused group requires explicit confirmation. Pausing disables group-controlled schedules and automatic updates without changing standalone playlist automation.

## Health

The collection score is weighted and explainable, not synthetic. It combines playlist generation health (30%), metadata completeness (20%), automation health (15%), configuration consistency (20%), and Plex synchronization (15%). Each component lists affected playlist IDs and counts for healthy, warning, failed, paused, empty, and outdated-engine playlists.

## API

All routes require the `mixarr_session` user and validate ownership:

- `GET|POST /api/playlist-groups`
- `GET|PATCH|DELETE /api/playlist-groups/:id`
- `POST /api/playlist-groups/:id/playlists`
- `PATCH|DELETE /api/playlist-groups/:id/playlists/:playlistId`
- `PATCH /api/playlist-groups/:id/order`
- `POST /api/playlist-groups/:id/pause|resume|clone|regenerate`
- `GET /api/playlist-groups/:id/health`
- `GET|DELETE /api/playlist-groups/:id/jobs/:jobId`
- `GET|POST /api/playlists/:playlistId/groups`

Errors use `{ error: { code, message } }`. Batch membership is capped at 200 and ordering at 500 items.

## Upgrade and rollback

Migration `20260717180000_playlist_groups_v221` creates four additive tables, ownership and cascade foreign keys, ordering and lookup indexes, duplicate constraints, and a PostgreSQL partial unique index for the primary membership. It performs no playlist backfill.

Back up the database before upgrading. For a development database with no required collection data, rollback by stopping Mixarr, backing up the database, dropping `PlaylistGroupActivity`, `PlaylistGroupExclusionRule`, `PlaylistGroupMembership`, and `PlaylistGroup` in that order, then removing the migration record only after verification. Production rollback should restore a tested backup rather than force-resetting Prisma.
