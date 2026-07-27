# Local AI Model Loading & Unlimited Timeouts (v2.4.22)

Mixarr v2.4.22 replaces the former single “strictest timeout wins” behavior with
a persistent phase policy. Each request records the resolved policy used at
dispatch, so later settings changes do not alter its audit history.

## Timeout phases

| Phase | Starts | Ends | Unlimited behavior |
| --- | --- | --- | --- |
| Connection | Before opening the provider transport | When the HTTP/TLS connection is established | No Mixarr connection timer |
| First token | After connection establishment | First response data or meaningful streamed content | Model loading may take any duration |
| Total request | At dispatch | Request completion | No Mixarr total-request timer |
| Streaming idle | After first streamed content | Reset by each valid chunk, token, heartbeat, or provider event | No Mixarr stream-idle timer |
| Cancellation grace | After cancellation or timeout | Cooperative shutdown or forced cleanup | Always finite, 100–60,000 ms |

Finite values are positive whole milliseconds. `null` means Unlimited. Zero
and negative values are invalid. Mixarr accepts finite values through
2,147,483,647 ms and schedules against a deadline, so durations through at
least 24 hours are safe.

```json
{
  "connectionTimeoutMs": 30000,
  "firstTokenTimeoutMs": null,
  "totalRequestTimeoutMs": null,
  "streamingIdleTimeoutMs": 600000,
  "cancellationGraceMs": 5000
}
```

For PATCH requests, an omitted field is unchanged. An explicit `null` disables
that phase. Mixarr never uses zero as a synonym for Unlimited.

## Resolution precedence

Each phase resolves in this order:

1. Explicit internal request/job override
2. Enabled provider timeout override
3. Global AI timeout policy
4. Application defaults

An enabled provider policy replaces the global values; Mixarr does not take
the minimum. A local provider can therefore use a ten-minute first-token
timeout even when hosted providers use the global 30-second value.

Application defaults remain:

- Connection: 10,000 ms
- First token: 30,000 ms
- Total request: 120,000 ms
- Streaming idle: 30,000 ms
- Cancellation grace: 2,000 ms

Provider settings display the effective values and their source. The two
Ollama presets only populate the editor and require an explicit save:

- **Local model — slow initial load:** 30,000 / 600,000 / 1,800,000 / 600,000 / 5,000 ms
- **Local model — no request timeout:** 30,000 / Unlimited / Unlimited / Unlimited / 5,000 ms

Existing providers retain global inheritance after migration. Existing Ollama
providers receive a non-blocking preset recommendation and are not silently
changed.

## Cancellation, background work, and audit

Unlimited disables automatic application-level expiration only. Manual
cancellation, client disconnects, provider retirement, process shutdown,
queue cancellation, and worker shutdown still abort requests. Cancellation
grace starts only after cancellation begins and force-cleans the transport and
response stream if cooperative shutdown does not finish.

Background workers refresh their heartbeat and job lease while an AI handler
is running. Stale recovery is based on heartbeat/lease health, not request age,
so a healthy unlimited request remains visible and running.

Audit records retain the effective policy, per-phase source, provider, model,
streaming mode, elapsed time, whether content was produced, and cancellation
outcome. Timeout failures use:

- `AI_CONNECTION_TIMEOUT`
- `AI_FIRST_TOKEN_TIMEOUT`
- `AI_TOTAL_TIMEOUT`
- `AI_STREAM_IDLE_TIMEOUT`
- `AI_REQUEST_CANCELLED`

Retries still pass through retry-count and cost protections. Mixarr does not
start a duplicate retry after response output has begun.

## Ollama times out while loading a model

Connection timeout normally is not the relevant setting. It covers opening
the network connection, not loading weights into RAM or VRAM.

First-token timeout covers the period after connection establishment and
before generation begins, including model loading. Total timeout can still
terminate the complete request later. Edit the Ollama provider and apply
**Local model — slow initial load**, or set its first-token and/or total timeout
to **Unlimited**. Review the effective-policy preview, then save.

Unlimited requests remain manually cancellable. Reverse proxies, ingress
controllers, load balancers, container platforms, operating systems, and the
provider itself may impose separate limits that Mixarr cannot disable. Those
external limits are not represented as disabled by the Mixarr UI.

## Migration

The migration preserves positive global timeout values and adds provider
override columns with overrides disabled. No older Mixarr documentation
defined zero as Unlimited. If an ambiguous non-positive global value exists,
the migration emits a database warning and restores that phase’s prior
default. Nullable values round-trip through PostgreSQL, Prisma, and the API.

