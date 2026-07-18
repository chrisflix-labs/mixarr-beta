# Smart Experiments & Playlist A/B Testing (v2.2.6)

Smart Experiments compare two controlled Smart Mix v2 configurations without changing the source playlist during setup or generation. Mixarr creates a pinned playlist-version snapshot first, stores stable A and B configuration snapshots, generates both variants against the same recorded library/metadata reference, and keeps all experiment data local.

## Safety model

- Creating a draft captures the original tracks, settings, identity, locks, metadata, and Plex mapping through the existing playlist-version system.
- Preview-only is the default publication mode. Variant generation writes only experiment records and Job History.
- Separate Plex publication creates independently identified A and B playlists. It never edits the original.
- Alternating Active is explicitly experimental, publishes A initially, and rotates the independent active experiment playlist on the user-selected interval. It is never the default and never rotates the original playlist.
- Applying A, B, or a merged configuration requires explicit confirmation and creates another pinned pre-decision version.
- A Plex synchronization failure restores the pre-decision snapshot locally and reports the failure; it never silently treats the other variant as a winner.
- Restoring the original uses the stored playlist-version snapshot and retains all experiment records, metrics, feedback, decisions, and timeline events.
- No experiment or playback data is sent to an external AI service.

## Controlled variables

The setup service rejects experiments with no meaningful difference. Playlist identity inputs—library, filters, target length, pins, exclusions, presets, engine version, and scoring model—cannot drift silently. Type-specific comparisons reject unrelated differences. Custom experiments support multiple changes, with a warning above three changed settings.

Supported comparisons include scoring weights, personalized versus base scoring, discovery/deep-cut targets, BPM flow, mood blending, artist variety, and custom multi-variable tests. Historical pages render stored versioned configuration JSON rather than current settings.

## Metrics and recommendations

Acceptance is the number of evaluated experimental tracks kept or positively rated divided by evaluated tracks. Rejection includes removal, dislike, never-recommend, and repeated early skips when playback integration is available. Passive inactivity never counts as rejection.

Playback attribution is intentionally conservative: Mixarr aggregates events in bounded track batches and attributes only tracks unique to one variant. Shared-track playback is excluded because it cannot identify which version caused the signal. Playback is labeled inferred, generation scores are labeled generation scores, and feedback is labeled explicit.

Suggested winners combine acceptance, rejection, optional completion/skip evidence, playlist score, and discovery signals. User-configurable minimum sessions, interactions, elapsed duration, and result difference are enforced before suggesting A or B. Confidence labels are Very Low, Low, Moderate, and High; no result is described as statistically proven.

## API

Authenticated, user-owned routes:

- `GET|POST /api/experiments`
- `GET|PATCH|DELETE /api/experiments/[id]`
- `POST /api/experiments/[id]/generate`
- `POST /api/experiments/[id]/publish`
- `POST /api/experiments/[id]/rotate`
- `POST /api/experiments/[id]/start|pause|resume|complete|cancel|archive`
- `GET /api/experiments/[id]/comparison|timeline`
- `GET|POST /api/experiments/[id]/metrics`
- `GET|POST /api/experiments/[id]/tracks`
- `POST /api/experiments/[id]/select-winner`
- `POST /api/experiments/[id]/merge-settings`
- `POST /api/experiments/[id]/restore-original`
- `GET|PATCH /api/settings/smart-experiments`

Expensive generation, publishing, recalculation, merge preview/application, and restore operations write progress and outcomes to Job History. Publication is idempotent per stored variant Plex identifier, creation supports an idempotency key, and successful partial generation remains available for retry.

## Persistence and performance

Migration: `20260718190000_smart_experiments_v226`.

The migration adds `SmartExperiment`, `SmartExperimentVariant`, `SmartExperimentMetric`, `SmartExperimentTrack`, `SmartExperimentEvent`, `SmartExperimentDecision`, and `SmartExperimentSetting`. Foreign keys preserve original/source records where destructive deletion would invalidate restoration; variant children cascade with explicitly deleted experiment history.

Important indexes cover user/status, playlist/history, completion, experiment/variant, metric types, experiment/track, variant positions, Plex identifiers, and settings ownership. Metric rows are upserted by `(variant, metric type, source)`. Track writes use 500-row chunks, playback reads use 400-track chunks, track comparisons are cursor-paginated, list pages are bounded, and completed metrics are cached in indexed rows.

## Upgrade and rollback

1. Back up PostgreSQL before any upgrade.
2. Deploy v2.2.6 and allow Prisma migration/db-push reconciliation to add the new tables.
3. Verify `/experiments`, `/api/settings/smart-experiments`, and Job History.
4. Existing playlists and all pre-v2.2.6 data remain unchanged; no experiment is created automatically.

Application rollback is safe while the additive tables remain in the database: older builds ignore them. A database schema rollback should only be attempted after exporting or intentionally deleting experiment history. Drop the seven experiment tables in reverse dependency order and remove their migration record only during a planned database restore. Never use `prisma db push --force-reset`.

## Current limitations

- Plex history does not expose a reliable playlist-session identifier in the existing integration. Session counts are conservative approximations, and shared-track playback is not assigned to A or B.
- Alternating Active timing uses a bounded five-minute scheduler scan, so rotation can occur up to five minutes after the configured due time. Failed or missing Plex targets are reported and can automatically pause the experiment.
- Deleting generated Plex experiment playlists is intentionally not automatic in the v2.2.6 UI. Mixarr retains their identifiers and reports missing/renamed playlists gracefully; users can remove Plex playlists explicitly in Plex.
- Retention cleanup is opt-in, scans bounded 25-row pages per configured user, removes only terminal experiment history older than the selected duration, and never deletes Plex playlists automatically.
