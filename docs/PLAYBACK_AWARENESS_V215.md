# Mixarr v2.1.5 — Listening History & Playback Awareness

Playback awareness is an optional, local, per-user scoring layer for Smart Mix Engine v2. It does not replace the base Smart Mix, playlist identity, feedback, or adaptive scoring layers.

## Setup

1. Connect and synchronize a Plex music server.
2. Open **Settings → Personalization → Playback Awareness**.
3. Run **Sync now** once to discover Plex users and import available history.
4. Map the current Mixarr user to the correct Plex account or managed user.
5. Enable playback recommendations and choose the desired influence and windows.

The feature stays inactive if no Plex user is mapped. Mixarr never falls back to merging every Plex user's history.

## Plex data and limitations

Mixarr reads the Plex Media Server history collection in bounded pages and requests track records for each discovered account. Plex server versions and clients do not always expose the same fields. Rating key, library section, playback time, duration, offset, account identifier, and explicit completion or skip fields are therefore nullable.

A play is completed when Plex explicitly reports completion or its usable offset reaches the configured threshold (90% by default). A skip is inferred only when an ended historical record has known duration and offset, exceeds the minimum meaningful duration, and stops below the skip threshold. Very short starts, active sessions, missing fields, and ambiguous partial records do not create an inferred skip. Some Plex histories only contain records after Plex's own play threshold; on those servers, skip detection will be limited or unavailable.

## Synchronization

- History uses `X-Plex-Container-Start` and `X-Plex-Container-Size` pagination with pages of 250.
- Incremental runs use the last imported timestamp with a five-minute overlap. A SHA-256 import key and database uniqueness constraint make the overlap idempotent.
- Track matching uses server, library section, and Plex rating key. Rating-key lookups are chunked to 500.
- Unmatched tracks, unconfigured libraries, and missing rating keys are stored with a review reason and do not fail the run.
- A failed run updates error state but does not delete valid existing events or profiles.
- The standard scheduler invokes playback synchronization as a dedicated job after Plex library sync. It remains separately visible as **Playback History** in Job History.
- Raw history retention defaults to 730 days and is configurable from 30 to 3,650 days.

## Profiles and confidence

Derived profiles store total plays, completions, cautious skips, replays, recent 7/14/30/90-day counts, first and last playback, rates, affinity, forgotten-favorite strength, and confidence. Rebuilds stream events in bounded 2,000-row pages and write profiles in 500-row batches.

Confidence combines evidence volume and consistency. Low-confidence records stay close to the base score. A single old play cannot become a forgotten favorite; the track needs at least the configured minimum observations, good completion history, repeated listening, and enough time since the last play.

## Scoring order

1. Base Smart Mix score.
2. Playlist identity and explicit/user personalization.
3. Adaptive scoring, within its configured maximum influence.
4. Playback-history scoring, within both the playback cap and the existing maximum personalization influence.
5. Hard exclusions, required-track protection, variety, flow, and playlist safety.

Playback components are visible in preview explanations:

- Recently played penalty or explicit strict exclusion.
- Frequent completion bonus with diminishing returns.
- Replay affinity bonus with diminishing returns.
- Confidence-weighted repeated-skip penalty.
- Forgotten-favorite bonus.
- Small deeper-cut discovery bonus where playback evidence supports it.

Explicit never-recommend feedback and playlist permanent rejections remain hard exclusions. Playback affinity cannot reverse them. Strict recently played avoidance does not remove pinned, locked, anchor, or important tracks; the explanation states why the track remained.

## Privacy and permissions

Playback behavior is stored in the local Mixarr PostgreSQL database. No cloud recommendation service is required. Non-admin users can read and reset only their own derived profile, configure mappings for their own Plex servers, and start synchronization for servers they own. Administrators can review unmatched history and manage cross-user mappings or global rebuilds. Plex tokens are never returned by playback APIs.

Disabling the feature stops playback influence but preserves raw history and profiles. **Reset derived profile** removes only aggregate profiles; raw history remains available for a rebuild.

## API

Authenticated routes:

- `GET/PATCH /api/playback/settings`
- `GET/PATCH /api/playback/users`
- `GET /api/playback/status`
- `POST /api/playback/sync`
- `POST /api/playback/rebuild`
- `GET /api/playback/summary`
- `GET /api/playback/tracks`
- `GET /api/playback/tracks/{trackId}`
- `POST /api/playback/reset`
- `GET /api/playback/unmatched` (administrator only)

List endpoints are paginated. Settings and action payloads are validated with Zod.

## Upgrade and troubleshooting

The `20260716030000_playback_awareness` migration is additive and disabled by default. Existing playlists and earlier scoring snapshots remain readable.

If the UI shows **Playback awareness unavailable**, verify that the Plex server token can read server history, run Sync now, review the discovered user mapping, and inspect the Playback History entry in Job History. A server may provide usable completed-play history without enough offset detail for skip inference; standard Smart Mix scoring continues normally in that case.
