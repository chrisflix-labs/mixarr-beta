# Recently Added Automation (v2.0.9)

Recently Added Automation watches stable Plex synchronization results for genuinely new tracks, scores whether their metadata is ready for safe automation, and compares eligible tracks with Mixarr-managed Smart Mix v2 playlists. It is **disabled by default**.

Open **Recently Added** from the Playlists navigation. Manual scanning, analysis, matching, mix creation, review, and selected application work even while the master switch is disabled.

## Safety model

- The master switch does not enable playlist creation, automatic additions, scheduling, publishing, or notifications.
- Suggestions default on, quarantine defaults on, preview defaults on, and playlist-level behavior defaults to **Suggestions Only**.
- Automatic additions require the master switch, the global automatic-add toggle, an **Automatic Strong Matches** playlist override, completed quarantine, metadata confidence and compatibility thresholds, per-run limits, no duplicate, and saved artist/album/length rules.
- Mixarr saves an automatic pre-change backup and a new current playlist version for every changed playlist. Plex synchronization failures are recorded without deleting version history.
- One Recently Added run can execute at a time. Track, match, change, and notification uniqueness constraints make retries idempotent.

## New Music Score

The 0–100 score combines metadata completeness, BPM confidence, mood confidence, energy confidence, and best playlist compatibility. It describes automation readiness and compatibility; it is not a prediction that the listener will like a track. Active, verified manual metadata from v2.0.8 overrides provider/local observations and receives verified confidence.

Bands are Excellent (90–100), Strong (75–89), Usable (60–74), Low confidence (40–59), and Not ready (0–39).

## API

- `GET /api/recently-added/summary`
- `GET /api/recently-added/tracks`
- `GET /api/recently-added/matches`
- `POST /api/recently-added/scan`
- `POST /api/recently-added/analyze`
- `POST /api/recently-added/match`
- `POST /api/recently-added/run`
- `POST /api/recently-added/apply`
- `POST /api/recently-added/create-mix`
- `POST /api/recently-added/ignore`
- `GET` / `DELETE /api/recently-added/history`
- `GET` / `PUT /api/recently-added/settings`
- `GET` / `PUT /api/recently-added/playlists/:id/settings`

All routes follow the existing Plex-session ownership checks. List and bulk operations are paginated or bounded and database writes use small chunks.

## Scheduling and notifications

Schedules can be manual, hourly, daily, weekly, or a validated custom cron expression. Daily and weekly tasks use `TZ` when configured and otherwise use the host timezone. Changing settings reschedules that user's task immediately.

Notifications are stored in-app and deduplicated by user, batch, and trigger. Each trigger is independently configurable. Disabling the master switch prevents Recently Added notifications.

## Migration

Migration `20260713040000_recently_added_automation` adds track discovery fields and the settings, batch, state, match, run, change, notification, and playlist override tables. Existing playlist, analysis, correction, settings, history, and version rows are preserved. Apply with the normal deployment migration command:

```bash
npx prisma migrate deploy
```

