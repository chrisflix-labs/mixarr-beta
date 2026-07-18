# Mixarr v2.2.5 — Library Coverage & Rotation Intelligence

Mixarr v2.2.5 adds cached, explainable intelligence for how Smart Mix uses an eligible Plex music library. It reuses persistent playlist history, immutable Smart Mix decision traces, interaction feedback, current playlist membership, duplicate state, Recently Added state, personalization, and the existing Smart Mix v2 pipeline.

## Safety and compatibility

- The migration is additive and does not rewrite playlist history or personalization.
- No full-history backfill runs during application startup. The first calculation is user initiated and runs in bounded 400-track chunks.
- Coverage-aware Smart Mix scoring is disabled by default. Existing playlists and presets therefore retain their previous behavior after upgrade.
- When enabled, coverage influence is capped and applied only after eligibility, exclusions, analysis, confidence, base recommendation quality, playlist identity, personalization, playback, and coordination checks pass.
- Neglect cannot make an ineligible or low-confidence track pass a quality gate.
- Resetting calculated statistics deletes only coverage caches and snapshots. It preserves Plex data, playlists, playlist history, feedback, identities, and personalization.

## Calculation semantics

The primary coverage percentage is unique eligible analyzed tracks selected by Smart Mix divided by eligible analyzed tracks. Distinct Smart Mix generation IDs are the preferred selection event source, with v2 playlist-history snapshots used as a legacy fallback. Playlist versions alone do not create new usage.

Explicit exclusions, blocked and never-recommend tracks, unavailable Plex items, suppressed duplicate copies, configured live-track exclusions, and Recently Added do-not-suggest state are excluded from the denominator and reported separately. Retained history gaps are labeled partial.

## Background job stages

1. Determine eligible tracks.
2. Aggregate selection and consideration history.
3. Aggregate artist and album coverage.
4. Calculate genre and mood coverage.
5. Calculate decade coverage, including Unknown year.
6. Calculate Recently Added coverage.
7. Calculate overuse.
8. Calculate neglected opportunities.
9. Calculate rotation fairness.
10. Save a deduplicated snapshot.

Jobs expose progress, stage, processed and total track counts, cancellation, failure details, and Job History audit summaries. A user/library pair cannot run duplicate calculations concurrently.

## Operations

Apply `prisma/migrations/20260718150000_library_coverage_rotation_intelligence/migration.sql`, deploy the application, then open `/library-coverage` and select **Calculate library coverage**. The application remains usable during calculation. For a large first backfill, monitor the Library Coverage progress panel and Job History.

Snapshot retention defaults to 365 days. Identical summaries do not create duplicate snapshots. Library Coverage settings control history inclusion, confidence thresholds, opportunity and overuse thresholds, cooldown, recently-added window, and the optional maximum rotation influence.
