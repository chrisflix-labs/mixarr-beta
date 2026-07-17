# Adaptive Smart Mix Scoring (v2.1.4)

> v2.1.8 integration: Smart Mix decision traces preserve the actual adaptive base score, capped adjustment, maximum influence, confidence limit, component reasons, and final personalized score at generation time. See [Smart Mix Explanations & Insights](SMART_MIX_EXPLANATIONS_V218.md).

Mixarr keeps the Smart Mix Engine v2 base score unchanged and applies personalization through a separate adaptive layer. Every scored candidate can expose the base score, personalized score, total adjustment, component adjustments, confidence, influence cap, source, scope, and adaptive model version.

The adaptive components are personal preference, playlist identity, historical acceptance, historical rejection, artist preference, mood preference, discovery tolerance, and repeat tolerance. Hard exclusions remain hard exclusions; adaptive scoring only ranks otherwise-valid candidates and cannot bypass playlist length, required/excluded tracks, artist or album limits, metadata rules, BPM/mood/energy rules, locks, corrections, permissions, or other generation safety constraints.

## Confidence and influence

Learned evidence uses five confidence bands:

- Very low: 0.10 multiplier
- Low: 0.30 multiplier
- Medium: 0.60 multiplier
- High: 0.85 multiplier
- Very high: 1.00 multiplier

Explicit feedback may use full confidence. One inferred interaction remains low confidence; repeated consistent evidence raises confidence while conflicting signals reduce it.

The maximum personalization influence setting ranges from 0–100%. It maps to an absolute adjustment ceiling of 0–20 Smart Mix points, while positive and negative advanced limits can be lower. Balanced is the recommended 50% default. Disabling adaptive scoring returns the base score without deleting feedback or learned statistics.

## Local data and recalculation

Adaptive scoring uses locally stored interactions, explicit feedback, playlist history, playlist identities, and metadata. It does not send behavioral data to external services.

Recalculation reads at most 20,000 recent interaction events, applies recency decay, creates global and playlist-specific aggregates, and writes statistics in batches of 500. Feedback marks the profile for recalculation rather than scanning the full library during every interaction. Manual recalculation and its counts appear in Job History.

## APIs

- `GET|PATCH /api/personalization/adaptive`
- `POST /api/personalization/adaptive/recalculate`
- `GET|POST /api/personalization/adaptive/reset`
- `GET /api/personalization/adaptive/statistics`
- `GET /api/personalization/adaptive/explanations/:trackId?playlistId=:playlistId`

All routes require the current Mixarr session and scope data to that user. Reset previews report what will be removed. Inferred-data reset preserves explicit feedback, playlist history, playlist identities, locks, and manual preferences.

## Persistence and versioning

Migration `20260716020000_adaptive_smart_mix_scoring` adds:

- `AdaptiveScoringProfile`
- `AdaptivePlaylistScoringSetting`
- `AdaptivePreferenceStatistic`
- adaptive scoring version/settings fields on managed playlists
- optional per-track adaptive explanation snapshots

Existing feedback, personalization profiles, playlist identities, playlist revisions, and generated playlists are not rewritten or deleted.
