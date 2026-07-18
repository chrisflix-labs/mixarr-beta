# Mixarr v2.2.4 — Smart Refresh Scheduling

Smart Refresh decides whether a tracked Smart Mix v2 playlist can be meaningfully improved before Mixarr changes Plex. It extends the existing scoring, identity, personalization, playback, Recently Added, advanced regeneration, version-history, scheduler, and Job History services. It does not introduce another playlist-generation engine or an unmanaged timer.

## Safe defaults and upgrade

Migration `20260718030000_smart_refresh_scheduling` is additive. Existing playlists receive no settings row until first viewed or configured, and the row default is `MANUAL_ONLY`. No existing fixed schedule is removed, no automatic playlist change is enabled, and the migration never calls Plex. Automatic full regeneration defaults off. The application can be rolled back while leaving these additive tables in place; keep them if evaluation audit history matters.

Default behavior is Balanced sensitivity, +5 minimum estimated improvement, five compatible tracks, a seven-day successful-refresh cooldown, one successful changing refresh per rolling seven days, inherited quiet hours, and automatic weak-track refresh only after the user enables a Smart mode. Failed, cancelled, rejected, and no-change runs do not consume the weekly limit.

## Evaluation pipeline

The evaluator separates decision-making from execution:

1. Load the tracked playlist and bounded current-track references.
2. Reuse Smart Mix v2 weakness and quality scoring.
3. Count high-confidence Recently Added matches already associated with this playlist.
4. Normalize recent playback concentration and skips; fewer than ten observations cannot trigger an aggressive repetition decision.
5. Compare current BPM, energy, and preferred-artist character with the saved playlist identity.
6. Count metadata corrections and audio/BPM analysis updates only for current playlist tracks.
7. Check unavailable tracks, locks, cooldown, weekly limit, quiet hours, active work, analysis availability, and fallback age.
8. When a useful signal exists, run the existing bounded advanced-regeneration candidate preview (maximum candidate pool remains capped by that engine).
9. Reject proposals below the configured improvement threshold or with disproportionate identity damage.
10. Persist the complete explanation, blockers, thresholds, timestamps, playlist/settings versions, preview reference, duration, and trigger source.

Recommendations are `NO_ACTION`, `REFRESH_WEAK_TRACKS`, `ADD_COMPATIBLE_TRACKS`, `REBALANCE_PLAYLIST`, `REFRESH_METADATA_AFFECTED_TRACKS`, and `FULL_REGENERATION`. Advanced regeneration maps these to its existing weak-track, discovery, BPM-flow, and low-score actions. Full regeneration remains approval-gated by default.

## Scheduling and concurrency

The existing background scheduler runs Smart Refresh after sync, playback, enrichment, fixed playlist refresh, and audio analysis. `SMART_REFRESH_EVALUATION_BATCH_SIZE` defaults to 20 and is clamped to 1–100. Per-playlist evaluation intervals are enforced after selection. Recent evaluations are deduplicated, track-ID queries are chunked, compatible matches are capped, preview candidate pools are bounded, and work is processed sequentially inside the scheduler's existing global lock.

A library sync is considered major when at least 50 tracks changed or changed tracks represent at least 5% of scanned tracks. Only enabled Smart Refresh playlists on the affected Plex server are invalidated and made eligible; playlists are evaluated later in the bounded scheduler stage after analysis. The evaluator still decides whether any change is useful.

Quiet hours support named IANA time zones and windows crossing midnight. Evaluations and writes have separate permissions. A recommended automatic action is deferred with an eligibility time when generation is disallowed. Cooldowns use the last successful playlist-changing refresh. Weekly limits count only `EXECUTED` evaluations.

## Preview, execution, and recovery

`Check for improvements` is always read-only. Its bounded preview records exact proposed replacements but does not write Plex or create a current playlist version. Apply revalidates playlist `updatedAt`, settings `updatedAt`, and the invalidation version, then delegates to `applyAdvancedPlaylistRegeneration`. That service rechecks the stored preview, locks, likes, excluded tracks, Plex availability, and write claim; saves the pre-change revision; updates Plex; stores the changed snapshot and final score; and keeps the previous version restorable.

Container restarts retain settings, deferred times, evaluation history, and preview records. Stale evaluations are rejected instead of overwriting newer playlist or settings changes. Existing active regeneration and orchestration jobs block Smart Refresh execution.

## API

All routes require the normal `mixarr_session` cookie and scope every query to the signed-in user.

| Method | Route | Behavior |
| --- | --- | --- |
| GET/PATCH | `/api/playlists/:playlistId/smart-refresh` | Read/update playlist settings and latest evaluation |
| POST | `/api/playlists/:playlistId/smart-refresh/evaluate` | Run a manual read-only evaluation |
| GET | `/api/playlists/:playlistId/smart-refresh/preview?evaluationId=…` | Read the exact bounded proposal |
| POST | `/api/playlists/:playlistId/smart-refresh/execute` | Revalidate and apply an evaluation preview |
| POST | `/api/playlists/:playlistId/smart-refresh/dismiss` | Dismiss while retaining audit history |
| GET/PATCH | `/api/settings/smart-refresh` | Read/update global quiet-hour defaults |
| GET | `/api/smart-refresh/dashboard` | Return bounded user summary and top recommendations |

Long-running evaluate and execute routes declare a 120-second route budget. Full generation is not held open through these routes. Errors are structured as `{ error: string }`; stale and conflicting operations use conflict responses.

## Persistence

- `SmartRefreshGlobalSetting` stores per-user quiet-hour defaults.
- `SmartRefreshSettings` stores bounded per-playlist configuration, eligibility timestamps, invalidation markers, and compact latest status.
- `SmartRefreshEvaluation` stores summaries and identifiers needed for audit and preview. It does not store full candidate pools.

Indexes cover mode/evaluation eligibility, deferred work, last successful refresh, pending recommendation, playlist history, user/status history, and preview lookup.

## Known boundaries

- Smart Refresh is available for tracked Smart Mix Engine v2 playlists because targeted advanced regeneration and its stale-safe preview contract are v2 features.
- Compatible-track recommendations use existing Recently Added playlist matches. With preserve-length enabled they rotate compatible tracks into the playlist; actual playlist growth depends on the underlying regeneration/automation capability.
- Identity drift currently uses saved BPM, energy, and preferred-artist character plus the existing candidate identity-impact result. Future versions can add richer mood-distribution drift without changing the evaluation contract.
- Global notification providers are not currently exposed by Mixarr as a generic event bus; evaluation and execution remain visible in the playlist UI, dashboard, Job History, and version history.
