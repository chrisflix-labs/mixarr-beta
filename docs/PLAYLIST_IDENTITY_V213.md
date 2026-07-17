# Playlist Identity & Memory (v2.1.3)

> v2.1.8 integration: track explanations retain the identity adjustment, match/conflict reasons, confidence, and sanitized generation-time identity profile snapshot. Historical explanations do not change after retraining. See [Smart Mix Explanations & Insights](SMART_MIX_EXPLANATIONS_V218.md).

Mixarr gives each managed playlist a stable internal identity based on `GeneratedPlaylist.id`. The display name and Plex playlist rating key may change without changing that identity. Legacy playlists are initialized lazily when their identity panel is opened or when they are regenerated; startup never performs an expensive full-history rebuild.

## Stored locally

Playlist identity data is stored in the same local PostgreSQL database as the rest of Mixarr:

- learned, user-defined, locked, inherited, and effective identity attributes;
- playlist-specific track acceptance, rejection, importance, anchor, and lock memory;
- idempotent membership events and lightweight historical snapshots;
- artist and genre preference scores;
- training runs, confidence reasons, and compact identity snapshots.

This information is not sent to Plex or to an external recommendation service. Disabling identity keeps the data but removes its scoring effect. Scoped resets do not delete playlist tracks.

## Scoring order

Identity is a separate explainable Smart Mix v2 layer. The effective precedence is:

1. availability and safety constraints;
2. manual metadata corrections;
3. locked and mandatory tracks;
4. explicit playlist rejection rules;
5. playlist generation rules;
6. user personalization and explicit feedback;
7. playlist identity;
8. recommendation tuning;
9. BPM and transition optimization;
10. artist and album diversity;
11. discovery balancing and final placement.

Explicit user actions override inferred identity. Flexible, Balanced, Strong, and Strict modes adjust the influence of identity without replacing existing BPM, transition, discovery, feedback, or diversity systems. Balanced is the default.

## Training and confidence

Training combines current tracks, playlist versions, locks, likes, and playlist-fit feedback with conservative historical weighting. Missing BPM, mood, energy, popularity, genre, or duration metadata lowers field confidence but does not prevent training. Large track ID lookups use bounded batches to avoid PostgreSQL/Prisma bind-variable limits.

Training writes summarized Job History records and keeps normal playlist playback, viewing, synchronization, and editing available if identity training fails.
