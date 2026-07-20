# Mixarr v2.3.7 — Plex & Media Ecosystem Integrations

## Upgrade

1. Back up PostgreSQL.
2. Set a stable `MIXARR_SECRET_KEY`. Do not rotate it without re-entering saved integration secrets.
3. Deploy v2.3.7 and apply Prisma migration `20260720140000_media_ecosystem_integrations_v237` (`npx prisma migrate deploy` in non-container installs).
4. Open **Settings → Media Ecosystem Integrations** and run **Run safe tests**.
5. Create separate least-privilege tokens for Homepage, Home Assistant, Prometheus, and dashboards. Revoke legacy broad tokens after updating clients.

The migration is additive. Existing Plex servers and playlists remain enabled and managed. Automatic failover stays disabled, external integrations stay disabled, and all existing playlists receive `REQUIRE_MANUAL_REVIEW` reconciliation.

## Plex servers, users, ownership, and collections

The integration center displays Plex identity, priority, primary/secondary role, availability category, latency, failures, selected music libraries, scan state, and write-failover policy. The connection test reports reachability, authentication, server identity, configured music libraries, playlist reads, and collection reads separately.

Plex account discoveries are stored separately from administrator-confirmed Mixarr mappings. Username/email matches appear as suggestions; they are never silently committed. Mapping information is administrator-only.

Plex-backed generated playlists expose owner, modification permission, management/import state, synchronization time, and external-change state. Read-only ownership prevents restore actions. Mixarr snapshots ordered rating keys and supported metadata and classifies additions, removals, reorder, metadata, deletion, recreation, and owner changes. Existing playlists require manual review. Available decisions include keeping Plex, restoring Mixarr tracks, merging additions, accepting removals/order, ignoring, reviewing later, and detaching.

Collections are discovered from selected music libraries. `POST /api/integrations/plex/collections/import` converts collection rating keys into a fixed Mixarr result, recipe seed, inclusion filter, discovery pool, or automation source while reporting unmatched items. Export supports create-new, replace, merge intent, one-time output, and managed state. Replace is never chosen implicitly.

### Scan and mount safety

Immediately before missing-item reconciliation, Mixarr rechecks the Plex library and configured mounts. A scan, post-scan grace period, unavailable library, or mount failure creates a waiting job and skips the destructive phase. Read/upsert work can finish safely. Set `PLEX_SCAN_GRACE_MINUTES` to change the default 10-minute grace period.

Mount dependencies accept an expected directory, optional marker file such as `.mixarr-mount`, filesystem identity, and required consecutive recovery checks. An absent, unreadable, unexpectedly empty, changed, or unmarked path blocks destructive work.

## Tautulli, Discord, and Notifiarr

Tautulli uses its v2 history API. Mixarr retains only the track rating key, hashed listener identity, duration/completion, normalized behavior, count, timestamp, and a coarse privacy category. Records expire after the configured retention period. Existing recipes do not use these signals unless playback-aware scoring is enabled.

Discord recipe shares contain recipe metadata, Mixarr version, and either a token-free import link or portable base64url payload. Set `MIXARR_PUBLIC_URL` only when the address is reachable by recipients. Notifiarr and Discord use the centralized event envelope so business operations do not construct separate notification events.

## Events and signed webhooks

Every generic delivery uses a versioned envelope and these headers:

```text
X-Mixarr-Event
X-Mixarr-Delivery
X-Mixarr-Timestamp
X-Mixarr-Signature: sha256=<hex digest>
X-Mixarr-Version
```

The signed input is `<timestamp>.<raw request body>` and uses HMAC SHA-256. Reject stale timestamps in the receiver. Payload sanitization removes tokens, secrets, authorization, credentials, passwords, cookies, sessions, and filesystem paths. Private-network destinations are blocked unless `MIXARR_ALLOW_PRIVATE_WEBHOOKS=true`; credentials in URLs are always rejected.

Supported events:

```text
playlist.created playlist.updated playlist.health_changed
playlist.reconciliation_required playlist.reconciled playlist.sync_failed playlist.deleted
collection.created collection.updated collection.sync_failed
recipe.imported recipe.shared
smart_action.pending smart_action.completed smart_action.failed
experiment.completed automation.failed automation.recovered
plex.unavailable plex.recovered plex.failover_activated
mount.unavailable mount.recovered integration.failed integration.recovered
```

Retries use bounded exponential backoff and distinct `(deliveryId, attempt)` records. The integration center exposes sanitized response excerpts and retry history.

## Scoped API tokens

Raw tokens are displayed once and only a SHA-256 hash plus prefix is stored. Tokens can expire, be revoked, optionally restrict source IPs, and record use without logging the raw value.

```text
status.read health.read playlists.read collections.read automations.read
activity.read integrations.read widget.read home_assistant.read metrics.read
recipes.read webhooks.manage integrations.manage
```

`integrations.manage` satisfies integration scopes and should be reserved for trusted administrators. Ordinary dashboard tokens should receive only their endpoint-specific read scope.

## Monitoring endpoints

- `GET /health` and `GET /health/live`: public process liveness; optional dependency failures do not fail liveness.
- `GET /health/ready`: critical database/worker/environment readiness, with HTTP 503 when unsafe.
- `GET /health/details`: administrator session or `health.read`; sanitized dependency detail.
- `GET /api/homepage/widget`: `widget.read`, cached for 15 seconds.
- `GET /api/integrations/home-assistant/status`: `home_assistant.read`, flat values.
- `GET /metrics`: `metrics.read`, Prometheus text.
- `GET /api/public/v1/status|playlists|playlists/:id|collections|automations|activity|integrations|metrics-summary`: matching read scopes and sanitized schemas.

### Homepage

```yaml
widget:
  type: customapi
  url: http://mixarr:3000
  endpoint: api/homepage/widget
  headers:
    Authorization: Bearer mixarr_REPLACE_ONCE
```

### Home Assistant

```yaml
sensor:
  - platform: rest
    name: Mixarr
    resource: http://mixarr:3000/api/integrations/home-assistant/status
    headers:
      Authorization: Bearer mixarr_REPLACE_ONCE
    value_template: "{{ value_json.status }}"
    json_attributes: [plexAvailable, activePlexServer, mountsAvailable, healthyPlaylists, degradedPlaylists, pendingReconciliations, failedAutomations, lastSyncAt, version]
    scan_interval: 30
```

### Prometheus

```yaml
scrape_configs:
  - job_name: mixarr
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: mixarr_REPLACE_ONCE
    static_configs:
      - targets: [mixarr:3000]
```

Labels are deliberately low-cardinality. Playlist names, users, tracks, URLs, request IDs, and errors are never labels.

## Troubleshooting

- **401/403:** confirm the token is enabled, unexpired, and has the exact endpoint scope.
- **Plex authentication failed:** reauthenticate Plex; tokens are not shown in diagnostics.
- **Waiting for Plex scan:** wait for the scan and configured grace period; do not disable the gate to force deletions.
- **Waiting for mount:** verify the container volume, marker file, directory contents, and filesystem identity.
- **Webhook blocked:** use HTTPS, remove URL credentials, and do not target loopback/private hosts unless the explicit trusted-network option is appropriate.
- **No Discord import link:** configure a recipient-reachable `MIXARR_PUBLIC_URL`; portable payload sharing remains available.

Recent webhook deliveries, integration tests, playback signals, snapshots, health records, and events are removed by the retention job using the environment values documented in `.env.example`.
