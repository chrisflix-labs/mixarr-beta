# Mixarr v2.3.0 — Mix Recipe Foundation

A Mix Recipe is a reusable Smart Mix strategy. It contains targets, limits, scoring, flow, discovery, identity defaults, and optional refresh/automation policy. It does not contain playlist tracks, private feedback, playback events, credentials, or Plex tokens.

## Domain boundaries

- **Recipe:** reusable generation strategy and defaults.
- **Playlist:** concrete Plex-backed result with track membership and manual edits.
- **Playlist Identity:** an independent, playlist-specific profile initialized from recipe defaults and then learned from that playlist.
- **Generation Settings:** the resolved Smart Mix engine input for one run.
- **Generation Snapshot:** immutable recipe schema, recipe revision, and playlist-only overrides used for a run.
- **Playlist Version:** restorable track/settings state for one playlist.
- **Experiment:** a controlled comparison that preserves the source recipe reference and snapshot but never edits the recipe automatically.

## Portable schema

The canonical format is `mixarr-recipe`, currently `schemaVersion: 1`. Its top-level sections are `metadata`, `scoring`, `targets`, `bpmFlow`, `discovery`, `variety`, `playlistIdentity`, `refreshPolicy`, `automationPolicy`, and `generation`.

`schemaVersion` describes the technical document format. `recipeVersion` describes meaningful behavior revisions to one recipe. Metadata-only changes, last-used timestamps, and usage counts do not advance the recipe version.

Every create/update path normalizes and validates the schema on the server. Field errors cover invalid BPM/energy ranges, discovery limits, variety limits, strict mood requirements, scheduled intervals, automation library requirements, unknown scoring models, and future schema versions. Warnings cover optional descriptions/artwork and explicit automation confirmation.

Schema migrations are ordered, immutable, and idempotent. A legacy saved-filter recipe is treated as schema v0 and migrated into schema v1 defaults. Future schemas are rejected without changing stored input.

## Lifecycle and generation

Recipes can be created, edited, duplicated, renamed, disabled, validated, exported/imported, or soft-deleted in `/recipes`. A generated playlist can be converted into an independent recipe; track membership, feedback, playback statistics, experiment history, and Plex identifiers are excluded.

Generating from a recipe resolves permitted playlist-only overrides, creates the Plex playlist, stores the recipe ID/schema/revision and immutable resolved snapshot, initializes a separate playlist identity, and activates refresh/automation only after explicit confirmation. A failure compensates by removing a newly-created Plex playlist before local state is considered complete.

Deleting a recipe sets an archival tombstone and its generated playlists retain their snapshot and history through `ON DELETE SET NULL` relationships.

## Late Night Highway example

`Late Night Highway` is a Driving recipe for atmospheric, energetic, moody music from 95–122 BPM with a gradual rise, medium-high discovery, at most two tracks per artist, and weak-track replacement every 14 days. Automation remains disabled until the user confirms it while creating a playlist.

## API

- `GET|POST /api/playlist-recipes`
- `GET|PATCH|DELETE /api/playlist-recipes/:id`
- `POST /api/playlist-recipes/:id/duplicate`
- `POST /api/playlist-recipes/:id/rename`
- `POST /api/playlist-recipes/:id/validate`
- `POST /api/playlist-recipes/validate`
- `POST /api/playlist-recipes/from-playlist/:playlistId`
- `POST /api/playlist-recipes/:id/create-playlist`
- `GET /api/playlist-recipes/:id/playlists`
- `GET /api/playlist-recipes/:id/export`
- `GET /api/playlist-recipes/export`
- `POST /api/playlist-recipes/import/preview`
- `POST /api/playlist-recipes/import`

All routes require the normal Mixarr session and enforce owner scope. Collection reads are paginated and counts are aggregated without loading tracks.

## Backup, restore, and privacy

Back up the database before upgrading. The v2.3.0 migration is additive and backfills legacy recipes. Database restore preserves recipe revisions and playlist snapshots. Portable exports remove server IDs, library IDs, selected track IDs, source playlist IDs, personal interaction data, and credentials; imported automation is disabled and must be reconfigured locally.

Later v2.3.x releases may add templates, sharing, community catalogs, comparisons, history/rollback, inheritance, scheduling, recommendations, or optional AI-assisted creation. None of those are part of v2.3.0.

