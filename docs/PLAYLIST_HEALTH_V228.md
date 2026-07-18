# Playlist Health Monitoring & Alerts (v2.2.8)

Playlist Health continuously evaluates generated playlists and presents one explainable 0–100 score. It is an observation and alerting system: analysis never edits a playlist or changes Plex media.

## Health checks

Each analysis checks Plex playlist linkage and stored track counts, unmatched tracks, unavailable library or local-file state, duplicate tracks, consecutive artist runs, artist and album concentration, learned BPM and energy identity, metadata-confidence decline, adjacent BPM jumps, adjacent mood conflicts, playlist age, and recent failed playlist automation.

Checks carry a configurable severity and a bounded penalty. Scores of 90–100 are Excellent, 75–89 are Good, 50–74 Need Attention, and lower scores are Critical. Missing metadata is not treated as proof that a mood or BPM transition is bad; only pairs with usable values are compared.

## Alert lifecycle

An active alert is unique per playlist and check type. Repeated detections update its evidence, severity, snapshot link, timestamp, and occurrence count. Users can acknowledge an alert without hiding the condition or resolve it with a note. If a later analysis no longer detects the condition, Mixarr resolves it automatically. A recurring condition reopens the same alert and records a lifecycle event.

Snapshots, acknowledgments, resolutions, reopenings, severity changes, delivery attempts, and timestamps remain available in the Playlist Health workspace. Analysis history is independent from playlist version history and does not create playlist revisions because no playlist mutation occurs.

## Notifications

In-app alerts are persisted by default. Discord and generic webhooks are opt-in and honor the configured minimum severity. Endpoints must use public HTTPS URLs; Discord endpoints must be Discord webhook URLs. Saved endpoints are encrypted with `MIXARR_SECRET_KEY`, never returned to the browser, and delivery logs store only channel, result, HTTP status, and a bounded error message.

Generic webhook deliveries contain an event name, alert identity/type/severity/message, playlist identity/name, and a relative Mixarr link. Discord deliveries use a compact message suitable for Discord webhook limits.

## Scheduling and APIs

Manual analysis is available from `/playlist-health`. Nightly analysis runs after playlist, metadata, Smart Refresh, and Smart Action work, so health reflects the final pipeline state. Per-user monitoring and nightly analysis can be disabled independently. `PLAYLIST_HEALTH_BATCH_SIZE` caps nightly playlist analysis per enabled user.

Authenticated APIs under `/api/playlist-health` provide the dashboard, playlist detail, analysis, alert listing, acknowledgment, and resolution. Settings are under `/api/settings/playlist-health`.

## Upgrade safety

Migration `20260718233000_playlist_health_v228` is additive. It creates Playlist Health settings, snapshots, alerts, lifecycle events, and notification-delivery tables with ownership and lookup indexes. It does not rewrite playlists, track rows, Plex mappings, metadata, automation policies, or playlist versions.
