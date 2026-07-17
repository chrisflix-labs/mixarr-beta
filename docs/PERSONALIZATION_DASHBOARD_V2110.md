# Mixarr v2.1.10 — Personalization Dashboard & Release Polish

## Overview

The `/personalization` dashboard explains what Mixarr has learned, where the evidence came from, how much it changes scores, whether playback data is healthy, and how to export, import, clean up, or remove that data. Values come from the signed-in user's stored records; the page does not invent sample metrics or expose another user's profile.

The dashboard uses one bounded summary service with a 30-second per-user/per-period cache. Large histories use aggregate counts, paginated drill-down, bounded score samples, batched export reads, and indexed filters. A forced refresh bypasses the cache. Destructive dashboard actions invalidate it.

## How Mixarr learns and confidence works

Mixarr can use direct track, artist, playlist-fit, and transition feedback; accepted or rejected preview changes; playlist history and identity; and enabled playback signals. Direct instructions such as `NEVER_RECOMMEND` remain visibly distinct from inferred preferences.

Confidence reflects supporting evidence and consistency. Labels are intentionally conservative:

- Low: less than 20% confidence
- Developing: 20% through 44%
- Medium: 45% through 74%
- High: 75% or greater

One or two isolated events must not become a strong claim. Score influence stays within configured adaptive and playback limits, while hard exclusions and never-recommend rules remain authoritative.

## Enabling, onboarding, and inspection

Open Personalization from the main navigation or Settings. First-time users see a skippable and resumable six-step wizard covering learning sources, privacy, influence, playback avoidance, and optional initial preferences. Advanced settings remain available under Settings and Playback Awareness.

Recently learned preferences show direction, confidence, source, supporting events, scope, and update time. Most influential feedback labels direct instructions separately. The playlist identity browser supports search, confidence and connection filters, sorting, grid/list layouts, retraining, learned-data reset, and JSON identity export.

## Recommendation and playback interpretation

“Suggestion acceptance rate” is accepted preview suggestions divided by accepted plus rejected preview suggestions. It is a behavioral indicator, not scientific accuracy. Empty periods render an explanation instead of a misleading zero chart.

The influence section compares base and personalized score layers from retained explanation traces. Large installations use a clearly labeled bounded sample; totals continue to use database aggregates.

Playback status distinguishes configuration, mapping/connection, data availability, freshness, and whether playback is currently influencing recommendations. Configure mappings, sync interval, retention, recent-play exclusion, skip learning, and repeat learning under `/settings/personalization/playback`.

## Export and import

Export first shows record counts, then downloads JSON using format `mixarr.personalization` and schema version `1`. It includes supported settings, feedback, learned preferences, identities, and decision history. It excludes Plex tokens, API keys, authentication sessions, password hashes, webhook secrets, and provider credentials.

Imports accept up to 25 MiB and follow validate → preview → mode selection → confirmation → transaction. Modes are merge, replace, identities only, preferences only, and feedback history only. The preview reports schema/version, conflicts, missing tracks, and missing playlists. Every record is applied only to the signed-in user and only when referenced local tracks, artists, and playlists are owned by that user. Replacement creates a 30-day backup inside the transaction before deleting personalization records. A failed transaction does not partially replace the profile.

## Reset and cleanup

Reset controls cover feedback, inferred preferences, playback-derived profiles, recommendation history, suggestion decisions, playlist identities, artist preferences, mood preferences, rejected-track history, settings, or all personalization. Every action has a preview. Complete reset requires typing `RESET PERSONALIZATION`.

Resets do not delete Plex library tracks, Plex playlists, metadata corrections, accounts, unrelated settings, or unrelated job history. Major actions create audit entries containing counts and scope, not deleted preference content.

Cleanup previews expired rejected-candidate traces, expired replacement backups, and old very-low-confidence inferred statistics without touching direct feedback, never-recommend rules, identity data, manual preferences, or required audit history.

## Stable-readiness and upgrade notes

The readiness panel checks migration availability, ownership/integrity assumptions, export/import schema, playback freshness, and observed influence bounds. Playback being disabled or unused is informational; stale enabled data is a warning rather than a full failure.

Migration `20260717010000_personalization_dashboard_v2110` is additive. It adds onboarding state, import backups, audit summaries, and decision-trace indexes. Existing enabled/disabled personalization state and learning data remain unchanged. Apply migrations using the normal Mixarr deployment flow; never force-reset an existing database.

## Troubleshooting

- Dashboard unavailable: apply Prisma migrations and verify database connectivity.
- No learned preferences: enable learning and provide more direct or preview feedback.
- No trends: accept or reject regeneration preview suggestions in the selected period.
- Playback configured but empty: verify the Plex user mapping, run history sync, and inspect the playback status page.
- Stale playback warning: check the last successful sync, permissions, scheduler/worker health, and Job History.
- Missing import tracks/playlists: sync the Plex library and recreate or reconnect playlists, then validate again.
- Import rejected: confirm JSON format/schema, supported version, and the 25 MiB limit.

## Roadmap

v2.1.x Adaptive Personalization is complete. The proposed v2.2.x direction strengthens automation, playlist lifecycle, recovery, observability, and long-term recommendation quality without requiring generative AI.

AI-assisted Mixarr is separate long-term exploration for later v2.x or the path toward v3.0. Possible providers include local Ollama or compatible self-hosted endpoints and explicitly configured OpenRouter, OpenAI, Anthropic, or compatible APIs. No provider is preferred or guaranteed. AI must remain optional; users must know what data would be sent; credentials, cost controls, consent, and failure isolation are required; and AI output must never silently override deterministic scoring.
