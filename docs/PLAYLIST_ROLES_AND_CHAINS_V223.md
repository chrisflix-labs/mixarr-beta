# Mixarr v2.2.3 — Playlist Roles & Progression Chains

Mixarr v2.2.3 adds an optional journey layer above existing generated playlists. A playlist remains independently usable and keeps its own filters, identity, feedback, personalization, locks, history, and Plex playlist. A progression chain stores only the ordering and chain-specific guidance needed to coordinate it with neighboring playlists.

## Safety and compatibility

- Existing playlists receive no role during migration.
- Existing `PlaylistProgressionChain` and `PlaylistProgressionMember` rows are extended in place.
- The default role behavior is `SUGGEST`; role guidance does not change generation unless the user explicitly selects `APPLY`.
- Automatic repair and Plex master synchronization are disabled by default.
- Chain optimization creates a preview and a chain version before changing any boundary order or adding a shared bridge.
- Locked and automation-protected boundary tracks are excluded from reorder suggestions. Liked tracks are retained.
- A generated master journey is a separate `GeneratedPlaylist` with `sourceType=chain_master`; it never replaces a source playlist.
- Mixarr does not claim that a Plex client will automatically open the next playlist. Users can open the next playlist from Mixarr or explicitly create a combined Plex playlist.

## Role behavior

Built-in roles are Intro, Warm-up, Main, Peak Energy, Recovery, Cooldown, Discovery, Intermission, After-Hours, Archive, and Custom. Built-ins are seeded idempotently by both the migration and the role service.

Each role stores energy, BPM, discovery, transition, mood-direction, ending, variety, and repeat recommendations in a future-extensible definition. Playlist assignments store a behavior mode and JSON overrides:

- `LABEL_ONLY`: display the role without recommendations affecting generation.
- `SUGGEST`: show recommended values and differences; generation remains unchanged.
- `APPLY`: apply compatible guidance only where an explicit playlist setting is not already active. Explicit playlist settings remain authoritative.

Custom definitions are user-owned. The built-in Custom role also accepts a per-playlist display name.

## Chain analysis

Analysis loads only the playlists and track IDs in the chain. Track metadata is queried in bounded batches. It does not load the complete library.

For each playlist, Mixarr samples up to five tracks from the opening and ending sections (20 percent for short playlists). It calculates:

- starting and ending energy;
- starting and ending BPM and ranges;
- opening, ending, and primary mood tags;
- mood intensity;
- duration, familiarity, and discovery distribution;
- missing BPM, energy, mood, and availability counts;
- per-track energy, BPM, and mood curves.

For each adjacent membership pair, Mixarr evaluates energy, BPM, and mood. BPM uses the existing Smart Mix v2 half-time/double-time analyzer. Mood uses the existing normalized multi-mood track tags and effective mood metadata. The stored handoff reports the component scores, raw values, intended mode, confidence, warnings, and explanations.

Overall scores are the inspectable aggregation of role progression, energy continuity, BPM continuity, mood progression, boundary transitions, discovery balance, playlist identity, and metadata confidence. Missing component metadata yields an unavailable component rather than an invented score.

## Optimization and shared bridges

`POST /api/playlist-chains/:id/optimize` only creates a one-hour preview. It considers the final five and opening five available, unlocked tracks and proposes a boundary reorder only when the projected handoff improves by at least five points. Shared bridges are offered separately and are not selected by default.

`POST /api/playlist-chains/:id/apply-optimization` requires the preview ID and selected suggestion IDs. It rejects an expired preview or a chain whose version counter changed. Apply creates a restore point, changes only the selected boundaries, persists selected bridge explanations, marks analysis stale, and incrementally re-analyzes the chain.

When a bridge is selected, the track remains at the end of the previous playlist and is added to the opening of the next Mixarr playlist. It is never duplicated inside the same playlist. Plex is not changed by this operation; Plex changes require an explicit playlist sync/master action.

## Background analysis and maintenance

Analysis uses the existing Job History table and an in-process cancellable queue, consistent with Playlist Builder jobs in the custom Mixarr server. Progress stages are persisted and visible to the UI:

1. Preparing chain
2. Analyzing playlist roles
3. Calculating playlist summaries
4. Evaluating energy handoffs
5. Evaluating BPM handoffs
6. Evaluating mood handoffs
7. Finding transition candidates
8. Building optimization preview
9. Finalizing chain score

When “Automatically analyze updated chains” is enabled, successful full or advanced playlist regeneration queues analysis for affected active chains. Automatic repair additionally requires both the user setting and per-chain maintenance setting. It respects the configured improvement and replacement limits; automatic shared bridges additionally require the chain’s `AUTOMATIC` shared-transition mode.

## Database migration

Migration: `prisma/migrations/20260718010000_playlist_roles_progression_chains/migration.sql`

The migration:

- adds backward-compatible defaults to existing progression tables;
- removes only the old `(chainId, playlistId)` uniqueness constraint so one playlist may appear at separate chain positions;
- preserves the `(chainId, sequencePosition)` ordering constraint;
- creates role definition/assignment, handoff, transition-track, version, optimization-preview, and user-settings tables;
- adds chain ownership, status, membership, handoff, version, and archive indexes;
- seeds built-in roles with `ON CONFLICT (key) DO UPDATE`;
- performs no playlist, Plex, analysis, or track-order writes.

For a rollback, application code can be returned to v2.2.2 while leaving the additive tables/columns in place. Before physically dropping v2.2.3 tables, export any chain versions and remove v2.2.3 foreign keys/columns in reverse dependency order. Recreating the old membership uniqueness index will fail if the same playlist is intentionally used more than once in a chain, so resolve those memberships first.

No new environment variables are required.

## API

All endpoints require the `mixarr_session` cookie and validate user ownership.

### Roles

| Method | Route | Purpose |
| --- | --- | --- |
| GET/POST | `/api/playlist-roles` | List accessible roles or create a custom definition |
| PATCH/DELETE | `/api/playlist-roles/:id` | Edit or remove a user-owned custom definition |
| GET/PUT/POST/DELETE | `/api/playlist-roles/assignments/:playlistId` | Read, assign, copy/restore, or remove a playlist assignment |

### Chains and memberships

| Method | Route | Purpose |
| --- | --- | --- |
| GET/POST | `/api/playlist-chains` | Paginated list or create |
| GET/PATCH/DELETE | `/api/playlist-chains/:id` | Detail, edit/archive, or explicitly delete |
| POST | `/api/playlist-chains/:id/duplicate` | Duplicate configuration without a master playlist |
| POST | `/api/playlist-chains/:id/members` | Add an existing playlist |
| PATCH/DELETE | `/api/playlist-chains/:id/members/:memberId` | Edit or remove one explicit membership |
| POST | `/api/playlist-chains/:id/reorder` | Replace the complete ordered member-ID sequence |
| PATCH | `/api/playlist-chains/:id/handoffs/:handoffId` | Configure energy, BPM, mood, sharing, and lock state |

### Analysis, optimization, master, and versions

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/playlist-chains/:id/analyze` | Queue analysis and return HTTP 202/job ID |
| GET/DELETE | `/api/playlist-chains/analysis-jobs/:jobId` | Poll or cancel an owned job |
| POST | `/api/playlist-chains/:id/preview` | Synchronous complete preview for API clients |
| POST | `/api/playlist-chains/:id/optimize` | Create a read-only optimization preview |
| POST | `/api/playlist-chains/:id/apply-optimization` | Apply selected suggestions after version validation |
| POST | `/api/playlist-chains/:id/generate-master` | Generate or refresh the separate master journey |
| POST | `/api/playlist-chains/:id/sync-master` | Explicitly sync an existing master journey to Plex |
| GET | `/api/playlist-chains/:id/versions` | Paginated chain history |
| POST | `/api/playlist-chains/:id/restore/:versionId` | Save current state and restore an available snapshot |
| GET/PUT | `/api/settings/playlist-chains` | Read or replace conservative user defaults |

Errors use `{ error: { code, message, details? } }` and appropriate 400, 401, 404, or 409 statuses. List and version endpoints are bounded and paginated.

## Known platform behavior

- Plex support is limited to normal playlist creation/update. Cross-playlist automatic playback depends on the Plex client and is not presented as a Mixarr guarantee.
- Boundary charts render missing values as visible gaps.
- Restoring a chain skips deleted playlist references only when at least two playlists remain; otherwise restore is rejected without mutating the chain.
- A failure in one analysis job is recorded in Job History and does not modify source playlists or corrupt stored versions.

