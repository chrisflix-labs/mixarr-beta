# Smart Action Center (v2.2.7)

Smart Actions give Mixarr one review queue for proactive playlist, library, and metadata recommendations. A recommendation is stored as a typed server-side payload with an explanation, confidence score, risk, preview, expected impact, source fingerprint, expiration, and stable deduplication key.

Nothing changes during generation, listing, detail viewing, or previewing. Users must explicitly approve an action before applying it now or scheduling it for a configured maintenance window. Optional automation policies are disabled by default, scoped to one known action type, and constrained by confidence, risk, and per-window limits. The global emergency disable is enabled by default.

## Upgrade

The `20260718220000_smart_actions_v227` migration is additive. It creates Smart Action, audit, settings, and policy tables and adds an optional Smart Action reference to playlist versions. It does not rewrite playlists, tracks, metadata corrections, settings, or existing versions.

## Safety model

- All API routes require the Plex-backed Mixarr session and enforce user ownership through playlist, library, and track relations.
- Browser payloads are never used to execute a recommendation. The stored payload is loaded and validated against its action-specific Zod schema.
- Actions are revalidated immediately before execution. Changed playlists, missing records, expired evidence, verified manual metadata, and protected removals stop execution without applying the proposal.
- Playlist changes create a restorable version first. Plex failures leave the local playlist unchanged; local transaction failures trigger a best-effort Plex compensation using the original track order.
- Bulk selection excludes low-confidence and high-risk recommendations by default. High-risk actions require individual review and conflicting actions cannot be approved, scheduled, or applied together.
- Snoozed actions are revalidated before returning to the queue. Obsolete actions expire instead.

## Background work

Nightly generation runs after audio-feature analysis has yielded scheduler capacity. Providers use bounded queries, and persistence caps the active queue. Maintenance revalidates each action, respects playback awareness and capability gates, limits actions and distinct playlists, and continues when one action fails.

## APIs

The authenticated API is rooted at `/api/smart-actions` and supports list/detail, generation, summary, history export, approval, rejection, snooze, scheduling, immediate application, cancelation, and bulk operations. Settings live at `/api/settings/smart-actions`.
