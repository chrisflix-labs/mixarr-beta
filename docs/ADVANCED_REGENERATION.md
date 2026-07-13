# Advanced Playlist Regeneration (v2.0.6 beta)

Advanced regeneration improves a saved Smart Mix Engine v2 playlist without rebuilding it. Open Generated Playlists, choose **Regenerate Playlist**, select an action, review preservation controls, and generate a preview. Nothing is written to Plex until **Apply Changes** is selected.

## Weak tracks and confidence

Weakness uses the existing playlist score plus previous/next transition quality, positional mood/BPM/energy fit, artist and album repetition, discovery mismatch, recent-use or skip signals when present, and metadata confidence. The ranges are Strong (0–24), Acceptable (25–44), Weak (45–64), Very weak (65–84), and Critical (85–100). Missing metadata is shown as a confidence warning and never makes a track weak by itself.

## Locks, sections, and curves

Locking fixes a track in its current position. **Lock selected**, **Lock liked**, and **Unlock all** are available, and liked tracks are preserved by default. If a fixed track prevents a clean boundary transition, the preview warns instead of moving or replacing it.

Intro is the first 10%, early is 10–30%, middle is 30–70%, late is 70–90%, and ending is the final 10%. Short playlists receive at least one track in every selected section where possible. A section replacement scores both the incoming and outgoing boundary.

Curve preservation treats the original value at each position as the target. Energy and discovery actions shift that target by the selected amount while retaining relative progression. BPM scoring supports the existing half-time/double-time transition rules.

## Preview, apply, and undo

Every preview stores its settings, proposed changes, playlist score, duration, and the playlist update timestamp. Individual positions may be accepted or rejected. Apply recalculates scores on the server and creates a complete playlist version; stale previews are rejected. The pre-change safety state remains available, and undo creates another version rather than deleting history. See [Playlist Version History](./PLAYLIST_VERSION_HISTORY.md).

## API

All endpoints require the normal `mixarr_session` cookie and verify playlist ownership. Client-provided scores are ignored.

- `POST /api/playlists/:playlistId/regeneration/analyze`
- `POST /api/playlists/:playlistId/regeneration/preview`
- `POST /api/playlists/:playlistId/regeneration/apply`
- `POST /api/playlists/:playlistId/regeneration/undo`
- `GET /api/playlists/:playlistId/regeneration/history`
- `PATCH /api/playlists/:playlistId/tracks/:trackId/lock`
- `POST /api/playlists/:playlistId/tracks/bulk-lock`

Preview accepts a regeneration mode plus preservation and threshold controls. Apply requires `previewId` and optionally `acceptedPositions` and `lockProposedPositions`. Omitting `acceptedPositions` accepts all persisted changes; an empty array rejects the preview without changing the playlist.

## Troubleshooting

- **No weak tracks found:** lower sensitivity only if you want a broader change.
- **No replacements available:** the original was kept because candidates broke a curve, restriction, duplicate rule, or improvement threshold.
- **All selected tracks are locked:** unlock at least one target or select a different section.
- **Playlist changed:** a lock, edit, or other regeneration made the preview stale; generate a new preview.
- **Not enough metadata:** enrichment confidence was reduced, but available metadata was still used.

Candidate pools are capped and loaded through the existing batched v2 query path. The browser receives only the playlist analysis, bounded preview candidates, and persisted changes—not the full Plex library.
