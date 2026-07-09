# Smart Mix Engine v2 Foundation

Smart Mix Engine v2 is intentionally small in v2.0.0. The existing playlist builder remains the safe v1 path, while v2 provides a separate engine layer that can grow in later v2.x releases.

The v2 pipeline is ordered and explicit:

1. Source/library filtering
2. Required metadata checks
3. Hard filters
4. Soft scoring/preference rules
5. Fallback rules
6. Final sorting/selection
7. Playlist output formatting

Metadata fallbacks are centralized in `metadataFallbacks.ts`. Missing BPM, mood, energy, or popularity does not make a track invalid by itself. Missing metadata skips the matching bonus, applies a small confidence penalty, and records `metadataStatus` plus `fallbacksApplied` on v2 output tracks.

The initial scoring model is deliberately conservative:

- Start from a neutral base score.
- Add small bonuses for matching BPM, mood, energy, and popularity preferences.
- Use neutral popularity when popularity is missing.
- Apply small penalties for missing metadata.
- Keep the logic simple enough to tune in future v2.1.x, v2.2.x, and v2.3.x releases.
