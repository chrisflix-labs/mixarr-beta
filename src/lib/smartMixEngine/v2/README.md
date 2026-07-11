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

## v2.0.4 BPM Ramp & Transitions

BPM flow is a playlist-ordering layer inside Smart Mix Engine v2. It does not replace eligibility, mood blending, recommendation tuning, artist variety, album variety, or the legacy v1 playlist builder.

Supported BPM flow modes are Ramp Up, Ramp Down, Keep Steady, Natural Flow, and No BPM Ordering. Ramp modes prefer directional movement, Steady minimizes drift, Natural Flow treats tempo as one compatibility factor, and Disabled preserves the normal Smart Mix order while still allowing transition analysis to be displayed.

The default BPM flow config is disabled for backward compatibility:

```text
mode: DISABLED
strength: 70
maxPreferredGap: 8 BPM
allowJumps: false
halfDoubleTimeMatching: true
startingBpmMode: AUTO
customStartingBpm: null
```

Transition scoring uses effective BPM gaps. When half-time/double-time matching is enabled, pairs such as `75 BPM -> 150 BPM` can be evaluated as a 0 BPM effective gap without mutating the stored BPM. Near matches such as `74 BPM -> 149 BPM` are tolerated; unrelated jumps such as `74 BPM -> 170 BPM` remain direct jumps.

The ordering algorithm is deterministic and greedy with a local swap optimization pass. It selects a starting track from the requested starting BPM strategy, scores each next candidate using BPM transition score plus existing mood, energy, recommendation, artist, and album variety signals, then swaps nearby tracks only when BPM flow improves without meaningfully damaging mood/energy flow.

Rule priority is:

1. Hard exclusions and eligibility rules
2. User-pinned tracks already supplied to v2
3. Strict mood requirements
4. Strict BPM gap penalties
5. Seed and starting-BPM preference
6. BPM flow and transition compatibility
7. Mood and energy progression
8. Recommendation weighting
9. Artist and album variety
10. Soft preferences and deterministic tie-breaking

Scoring terms are intentionally separate:

- BPM consistency is the older general tempo-smoothness score in playlist quality.
- BPM flow measures whether the final order follows the selected transition strategy.
- Individual transition difficulty labels adjacent pairs as Easy, Moderate, Difficult, Hard, or Unknown.

Example smooth ramp:

```text
92 BPM -> 95 BPM -> 98 BPM -> 102 BPM
```

Missing BPM never becomes `0 BPM`. Transitions with missing BPM are Unknown, generation continues using available mood, energy, popularity, and variety metadata, and playlist metadata records the missing/fallback counts.
