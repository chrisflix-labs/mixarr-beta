# Playlist Builder V2 generation safety

Playlist Builder V2 previews run as background jobs. The create request returns a Job History ID, progress is delivered with server-sent events, and the final Plex playlist is still created only after a non-empty preview has completed and the user confirms it.

The generation pipeline scores static candidate factors once, selects from a bounded look-ahead pool, keeps artist/album/discovery counters in lookup maps, yields to the Node.js event loop between chunks, and limits final BPM/mood ordering passes. Requests larger than the eligible pool complete with warnings instead of retrying indefinitely.

The supported environment variables and defaults are listed in `.env.example`. The most relevant controls are the 12-minute total deadline, 180-second per-stage deadline, 300 candidate attempts per playlist position, one optimization pass, 500-ID query batches, and one active generation job per process. Job History records the last stage, counts, memory snapshot, sanitized failure, cancellation, and effective limits. Worker startup recovery marks abandoned jobs interrupted/stale so they cannot block a later request.
