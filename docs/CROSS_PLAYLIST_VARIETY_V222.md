# Mixarr v2.2.2 — Cross-Playlist Deduplication & Variety

Mixarr v2.2.2 reduces unhealthy reuse across generated Smart Mix playlists without trying to make every playlist completely exclusive. Strong tracks can remain shared, users can designate intentional exceptions, and playlist fit remains more important than novelty alone.

## How overlap is calculated

Track overlap uses normalized canonical recording identity where available. If no canonical recording exists, Mixarr falls back to normalized artist and track title, then the local track or Plex rating key. Deleted, unavailable, missing-file, and unresolved memberships are excluded, and duplicate physical copies of the same canonical recording count once.

The enforcement percentage is:

```text
shared canonical tracks / canonical track count of the smaller playlist
```

Mixarr also reports shared/source, shared/target, and Jaccard (shared/union) percentages. The smaller-playlist denominator prevents a short playlist that is mostly contained in a large playlist from appearing healthy.

Artist overlap reports shared credited artists when normalized credits are available and shared primary artists separately. Current Plex library data exposes a normalized primary artist for every track; additional credited artists are included when a provider supplies them. Concentration is weighted by repeated track appearances, so one shared appearance has less effect than an artist occupying several positions.

Album overlap ignores empty and generic unknown-album values. Compilation albums are keyed with the primary track artist, preventing an entire various-artists compilation from becoming one misleading album concentration.

Recommended defaults are 20% maximum track overlap, 35% artist overlap, 25% album overlap, and 70% minimum unique tracks.

## Policy inheritance and intentional sharing

Policies resolve in this order: playlist-pair override, playlist override, user preference, then the built-in global default. The UI labels the effective source. Policies can set percentage and count limits, preferred or strict uniqueness, comparison scope, recent-use lookback and penalty, repair safeguards, and exclusivity behavior.

Intentional exceptions include:

- Core tracks, which are recurring playlist members and are protected during repair.
- Allowed shared tracks, artists, and albums.
- Shared-count allowances.
- Ignored playlist pairs, which remain in reports but are not enforced.
- Report-only playlists, which remain visible without affecting generation or repair.
- Prefer-exclusive or strict-exclusive track rules, optionally limited to selected playlists, a playlist group, or an expiry time.

Locked remains an operation-level protection, Important remains a playlist-identity signal, and Core means an expected permanent or recurring member.

## Generation-time scoring

Smart Mix v2 loads cross-playlist usage in bounded batches. Its separate, capped variety adjustment can explain current playlist use, recent generated-playlist history, repeated artists and albums, allowed/core status, exclusivity, and unused-track boosts. It does not bypass Never Recommend, manual exclusions, metadata eligibility, playlist identity, mood or energy targets, BPM transitions, feedback, or existing artist/album limits. A poor match is not selected merely because it is unused.

Strict policies reject candidates when a valid pool can satisfy them. If protected tracks or the eligible pool make a target impossible, generation returns the best valid playlist it can and reports the achieved result; settings are never silently changed.

## Background analysis and performance

Analysis never runs during migration or startup. The variety workspace starts a user-scoped background job that:

- Processes one source playlist against bounded target batches.
- Uses configurable batch sizes capped at 50.
- Checks cancellation between batches.
- Persists progress and checkpoints in Job History.
- Supports retry after failure.
- Uses bounded track-ID queries and transactions.
- Updates cached pair summaries and retains changed-result snapshots for 180 days.
- Releases target-batch facts before loading the next batch.

Pages read cached summaries rather than starting all-to-all calculations. A playlist change marks involving summaries stale; unrelated pairs remain cached. The UI displays analysis timestamps and stale state.

## Heatmap and comparison

The heatmap supports track, artist, and album modes, exact values, screen-reader labels, sorting by highest overlap, exclusion filtering, and a bounded playlist page. Mobile uses a ranked comparison list instead of shrinking the matrix. Selecting a cell opens shared and unique tracks, repeated artists and albums, policy sources, warnings, history, designations, and repair controls.

## Repair previews and safety

Repair preview does not modify Mixarr or Plex. Suggestions are deterministic where inputs are equal and prioritize overlapping low-scoring tracks while protecting locked, core, manually added, liked, and automation-protected tracks. Replacement candidates must pass the saved Smart Mix filters and improve cross-playlist use without silently relaxing quality constraints.

Every proposal explains removal and replacement reasons plus score, mood, BPM-flow, energy-flow, artist-variety, and album-variety effects. Users can accept selected proposals, choose from bounded alternate candidates, reject all, mark a track core, allow track/artist/album sharing, ignore a pair, or recalculate.

Preview records expire after one hour and bind to both the playlist revision and a content hash. Apply fails with a conflict if the playlist changed. Apply is transactional, creates a restorable pre-repair Playlist Version, records a repair history entry, synchronizes Plex, and restores the previous local membership if Plex synchronization fails.

Automatic repair is disabled by default. Preview is required by default, and the current API always applies a persisted preview.

## Export, reset, and privacy

Personalization export includes user variety defaults, playlist overrides, pair rules, core/shared designations, and exclusivity data. Calculated heatmap caches are excluded. Reset operations separately cover calculated data, policies, pair exceptions, core designations, and exclusivity rules and require confirmation.

Mixarr evaluates locally stored playlist membership, track metadata, history, and policies. This feature does not send listening or playlist data to an external service.

## API surface

Authenticated routes are available under `/api/cross-playlist-variety` for settings, pair policies, analysis start/status/cancel, summaries, bounded heatmap data, pair comparison, repair preview/apply, and scoped reset. Playlist track designations are available under `/api/playlists/[playlistId]/variety-designations`. All routes enforce the current user session and playlist ownership.

## Migration and troubleshooting

The `20260717193000_cross_playlist_variety_v222` migration is additive. It preserves playlists, versions, feedback, personalization, identities, groups, locked and important tracks, and does not call Plex. After upgrade, open Cross-Playlist Variety and run analysis. An “Analysis required” or stale state does not block existing generation.

If analysis appears stuck, inspect Job History, cancel the current job, and retry. Completed batch results remain cached. If a repair preview is stale, recalculate it; Mixarr will not apply it or alter policy settings automatically.
