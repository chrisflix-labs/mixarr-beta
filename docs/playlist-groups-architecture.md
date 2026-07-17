# Playlist Groups architecture (v2.2.1)

Playlist Groups are an additive organization and configuration layer over `GeneratedPlaylist`. Existing playlists are not migrated into groups, and their stored settings retain their current meaning.

## Assumptions and decisions

- `GeneratedPlaylist` is the canonical Mixarr playlist record. A many-to-many `PlaylistGroupMembership` joins playlists to user-owned groups.
- The membership stores group-local order and inheritance state. A partial database index plus service-layer transaction guarantees that a playlist has at most one primary settings group.
- Adding a playlist creates a non-inheriting membership. Existing playlist configuration therefore remains authoritative until the user explicitly enables inheritance.
- Group settings use a versioned JSON document so new Smart Mix controls can be added without destructive table backfills. The reusable resolver returns effective values, source metadata, conflicts, and warnings.
- Playlist values win over group values. Per-setting membership states are `inherit`, `override`, or `disabled`; unknown or unsupported settings are retained but never silently applied.
- Group exclusions are normalized records because they need independent enablement, explanations, ownership validation, and indexing.
- Group regeneration reuses Mixarr's existing playlist preview/regeneration services, version snapshot behavior, and `JobHistory`. One parent history job owns bounded child operations, allowing partial completion, cancellation between children, and isolated failures.
- Health uses stored playlist quality, metadata, automation, engine, and synchronization state. Every score returned by the service includes component scores and affected playlist identifiers.
- Artwork URLs are stored only after validation. Server-local absolute paths are never returned to clients. Uploaded artwork is outside the first migration and can be added through the existing media storage abstraction when that abstraction becomes available.
- Group schedules are versioned JSON and respect paused groups. The scheduler integration is deliberately conservative: no existing playlist schedule is altered, and duplicate playlist work is skipped by stable job keys.

## Backward compatibility

The migration only creates new tables and relations. It has no playlist backfill, changes no existing settings, schedules, identities, histories, or Plex identifiers, and deleting a group cascades only memberships, rules, and group activity.
