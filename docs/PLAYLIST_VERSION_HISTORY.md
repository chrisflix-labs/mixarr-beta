# Playlist Version History & Restore (v2.0.7)

Mixarr saves complete, ordered states for generated playlists so regeneration and editing experiments can be compared and reversed. Open **Generated Playlists**, then **History & Restore**.

## What creates a version

Initial generation, full regeneration, accepted advanced regeneration, undo, restore, and manual save points create versions after the internal playlist mutation succeeds. Lock-only changes and canceled or failed previews do not. Related manual edits are intended to be recorded at their save boundary rather than once per drag operation.

Each snapshot contains restore-critical track IDs and order; locked, liked, and regeneration-excluded state; stable Plex identifiers; title, artist, album, duration, BPM, mood, and energy display metadata where available; playlist metadata; structured generation settings; historical score summaries; engine and Mixarr versions; reason, description, and timestamp. Recursive redaction removes token, password, credential, authorization, cookie, session, and API-key fields. Full analysis payloads and audio data are not copied.

Snapshots use an explicit schema version. The reader migrates v2.0.6 bare track arrays in memory without rewriting the original row. Invalid snapshots remain visible but cannot be restored.

## Compare

Select a version and use **Compare with Current**, or select any second version. Track IDs distinguish additions and removals from movement. A remove/add pair at the same position is labeled **Possible replacement** because it is an inference. Settings are flattened into General, Mood, BPM, Energy, Discovery, Variety, Regeneration, and Fallback groups; normal users are not shown raw JSON. Historical scores are immutable.

## Restore and undo

Restore is always preview-first. The preview lists track, order, settings, duration, and missing-track changes and captures the playlist update timestamp. Apply fails if the playlist changed after preview. The server verifies ownership and never trusts snapshot data supplied by the browser.

Applying a restore runs one internal transaction that saves the current state as a safety version, restores available ordered tracks and track state, optionally restores generation settings, recalculates the current score, and creates a new restore revision linked to its source. Later versions are never removed. Restoring the safety version provides durable undo and creates another timeline event.

Unavailable tracks are listed with stored title and artist. Mixarr will not omit them silently: the user must cancel or explicitly choose **Restore available tracks only**. Automatic replacement is not enabled in v2.0.7, because low-confidence historical matching is less safe than a clear omission decision.

The internal restore commits before Plex synchronization. The new revision records `pending`, `synced`, or `failed`; a Plex failure is surfaced while the Mixarr state and safety version remain intact.

## Retention and storage

History is enabled by default. The configured retention target defaults to 25 versions, manual edit snapshots and score snapshots default on, and automatic cleanup defaults off. Cleanup never removes the current version, pinned versions, initial generation, restore sources, or required recent versions. Revision numbers come from an atomic per-playlist counter and are never reused or renumbered after deletion.

Disabling history keeps all existing rows. Mandatory safety history for destructive advanced regeneration, undo, and restore, plus explicitly requested manual restore points, remains available. Summary columns keep history lists lightweight; full JSON is loaded only for details and comparisons. Snapshot byte estimates support storage reporting.

## API

All endpoints require `mixarr_session`, validate input, and enforce generated-playlist ownership.

- `GET|POST /api/playlists/:playlistId/versions`
- `GET|PATCH|DELETE /api/playlists/:playlistId/versions/:versionId`
- `GET /api/playlists/:playlistId/versions/:versionId/diff?to=:versionId`
- `POST /api/playlists/:playlistId/versions/compare`
- `POST /api/playlists/:playlistId/versions/:versionId/restore`
- `POST /api/playlists/:playlistId/versions/cleanup`
- `GET /api/playlists/:playlistId/versions/storage`
- `GET|PUT /api/settings/playlist-versions`

## Backup and troubleshooting

Database backups include all version JSON and metadata. A playlist deletion cascades its versions; deleting one non-current version never changes playlist tracks.

- **Playlist changed:** create a fresh restore preview.
- **Version could not be loaded:** its snapshot is incomplete or uses an unsupported schema.
- **Some tracks are unavailable:** cancel or explicitly restore available tracks only.
- **Plex synchronization failed:** Mixarr restored successfully; retry synchronization after restoring Plex connectivity.
