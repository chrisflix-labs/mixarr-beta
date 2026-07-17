# Mixarr v2.1.7 — Playlist Relationships & Coordination

Playlist Coordination lets managed Smart Mix playlists share context without converging on the same tracks. Existing playlists are not related, regenerated, or written to Plex during upgrade. Coordination defaults to disabled until a user enables it or selects it in Smart Builder.

## Relationship and overlap model

Relationships are user-scoped and point to stable `GeneratedPlaylist` IDs. Sister, related, and distinct relationships use a normalized bidirectional pair so the inverse record is not duplicated. Parent/child and progression relationships retain direction. The service rejects self-links, duplicate links, inaccessible playlists, immediate circular parent/child links, and playlists on incompatible Plex servers.

Overlap counts only current managed membership whose library track is active, not deleted, and not missing. Physical duplicate rows first use `canonicalRecordingId`; normalized artist/title metadata is the fallback. This prevents remastered or deluxe copies in the same confirmed canonical group from inflating or bypassing overlap.

The enforced overlap percentage is:

`shared canonical tracks / smaller active playlist × 100`

Jaccard similarity is displayed separately as `shared / union × 100`. Artist and album percentages also use the smaller set as their denominator. Cached summaries are additive and can be safely rebuilt.

## Scoring and enforcement

Coordination is a distinct Smart Mix v2 layer. It does not replace base compatibility, tuning, identity, explicit feedback, adaptive personalization, playback awareness, or transition scoring. Its total influence is capped from 0–20 points, with 12 as the default maximum.

- **Warning only** explains projected reuse without applying the normal track-overlap penalty.
- **Soft target** penalizes reuse but allows a stronger compatible candidate to win.
- **Hard maximum** dynamically rejects a related candidate when the next selected track would exceed the configured percentage.
- **Shared core** bypasses only coordination overlap penalties. Never-recommend, blocked, missing, playlist rejection, and other hard rules remain authoritative.
- **Unused preference** gives a bounded bonus to tracks absent from active Smart Mix playlists. Historical-only usage receives weaker treatment.
- **Artist balancing** and keep-distinct album penalties use group aggregates. Locked source tracks are never removed by rebalance actions.

Historical membership evidence decays with a 90-day half-life: `weight = 0.5^(ageDays / 90)`. Only the most recent year is loaded for scoring, and current active use remains stronger than historical use.

## API routes

- `GET|POST /api/playlists/:id/relationships`
- `PATCH|DELETE /api/playlists/:id/relationships/:relationshipId`
- `GET|PATCH /api/playlists/:id/coordination`
- `GET /api/playlists/:id/overlap`
- `POST /api/playlists/:id/shared-core`
- `POST /api/playlists/:id/move-track/preview|apply`
- `GET /api/playlist-coordination/dashboard`
- `POST /api/playlist-coordination/compare`
- `GET|POST /api/playlist-coordination/progressions`
- `PATCH|DELETE /api/playlist-coordination/progressions/:chainId`
- `POST /api/playlist-coordination/rebalance/preview|apply`

All routes require the Mixarr session and re-check user ownership. Mutating Plex actions require an explicit preview and confirmation. Relationship/settings changes never write Plex.

## Upgrade notes

Apply migration `20260716050000_playlist_coordination`. It creates only new tables, indexes, foreign keys, and a self-relationship check; no existing playlist or track rows are rewritten. No environment variables were added. Docker's existing non-destructive Prisma preflight remains applicable.

## Performance and safety

Candidate IDs and track metadata are queried in chunks of 500. Related memberships are loaded once per generation context, active global usage is restricted to the candidate pool, and dashboard summaries may be persisted instead of recomputing every pair on page load. Confirmed move actions update Mixarr snapshots transactionally and synchronize Plex; on synchronization failure Mixarr restores the prior snapshots and attempts compensating Plex synchronization.

## Known limitations

- Featured-artist matching currently persists the selected mode, while scoring uses the primary normalized artist identity available in the synchronized library metadata.
- Rebalance apply accepts individually selected replacement changes from a preview client; automatic candidate proposal remains conservative when no compatible replacement is supplied.
- Progression members persist target mood, energy, BPM, duration, and handoff behavior. Current generation uses relationship coordination and transition scoring; full multi-playlist curve optimization is not performed as one combined queue.
