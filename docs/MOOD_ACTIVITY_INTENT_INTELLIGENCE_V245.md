# Mixarr v2.4.5 — Mood, Activity and Intent Intelligence

## Overview

Mixarr v2.4.5 adds a local-first intent interpretation layer in front of the existing playlist engine. It translates ordinary language into a versioned, editable, explainable document. Approval converts that document into canonical recipe filters, scoring signals, phase targets, and position-aware ordering targets.

The interpretation layer never selects tracks. Existing deterministic library scoping, hard filters, recipe safety, metadata compatibility, candidate scoring, duplicate handling, protected-track rules, variety rules, and Plex mutation controls remain authoritative.

## Supported intent

Canonical activity and context categories are Relaxing, Focus, Coding, Reading, Studying, Workout, Running, Driving, Party, Dinner, Sleep, Morning, Late night, and Background listening. Emotional and musical categories are Nostalgic, Romantic, Energetic, Melancholic, Aggressive, and Cinematic.

Built-in phrase profiles recognize single words and multi-word expressions such as `deep work`, `rainy night`, `date night`, `road trip`, `family-safe party`, and `after midnight`. Matching is case-insensitive, punctuation and whitespace are normalized, and longest phrases win. Activity defaults are soft preferences unless the request uses unambiguous requirement language.

## Local versus provider-assisted interpretation

The deterministic parser is enabled by default and supports categories, phrase normalization, negation, hard-versus-soft classification, activity profiles, time-of-day profiles, phases, energy curves, BPM expressions, preferences, conflicts, and confidence without any AI provider.

Provider enhancement is optional and disabled by default. When enabled it reuses Mixarr's existing provider configuration and obeys provider enablement, user policy, privacy mode, local-only mode, monetary and request-count budgets, provider-native context validation, timeouts, health, strict structured-output validation, cost tracking, and fallback behavior. Token estimates are informational. Invalid or unavailable provider output produces a non-blocking warning and falls back to local interpretation.

## Personal and household terminology privacy

Personal and household private phrases are resolved locally before any optional provider request. Their descriptions, definitions, aliases, household notes, and member names are never sent externally. When enhancement is permitted, Mixarr supplies only minimal generic structured context; it does not send the dictionary or custom definition.

For example, private phrases such as `Chrisflix chill` are resolved locally into generic categories and numeric targets. The UI displays a local-resolution privacy indicator and the audit records that a local dictionary matched. Cross-user access is enforced server-side. Household entries require active membership, and household management requires owner, household-admin, or Mixarr-admin authority.

## Structured intent schema

Schema version 1 stores source text according to retention policy, summary, weighted categories, 2–6 phases, positive and negative preferences, requirements, energy/BPM curves, conflicts, warnings, per-item confidence, overall confidence, phase-boundary confidence, review state, matched phrase provenance, and interpretation source.

Each preference records its normalized target, type, Required/Preferred/Neutral/Discouraged/Excluded strength, phrase, scope, confidence, classification confidence, deterministic mapping, and whether a user edited it. Unknown fields and out-of-range values are rejected.

## Hard and soft requirements

Words such as `must`, `only`, `never`, `no`, `exclude`, `nothing over`, `family-safe`, and `clean only` normally create hard filters or explicit exclusions. Words such as `prefer`, `favor`, `mostly`, `around`, `roughly`, and `not too` create bonuses or penalties.

Low-confidence inferred hard requirements require review. Negative preferences use explicit exclusion or penalty mappings, never inverted scoring. Approved hard requirements are never relaxed automatically.

## Phases and curves

Sequencing language such as `start with`, `then`, `become`, `build toward`, `finish with`, and `cool down` creates editable phases. Phase shares must total 100%; the review UI can rename, reorder, duplicate, add, remove, and resize them on desktop or mobile.

Energy supports Flat, Rising, Falling, Rise-and-fall, Fall-and-rise, Middle peak, Final peak, Stepped, Wave, and custom multi-phase shapes. BPM supports exact targets, ranges, approximate targets, rising/falling/flat/peak curves, and hard limits. Curves use normalized playlist positions from 0 to 1 and configurable tolerances.

The deterministic adapter maps:

- canonical mood categories to existing mood scoring signals;
- hard requirements and exclusions to canonical filters;
- soft preferences to bonuses and discouraged traits to penalties;
- phases to segment shares, mood sections, and position targets;
- energy/BPM curves to deterministic position-distance scoring;
- smooth-transition intent to adjacent energy/BPM jump penalties and existing variety safeguards.

Missing metadata is distinguished from a failed match. Unsupported dimensions produce warnings and degrade to the nearest supported characteristics without inventing metadata.

## Conflicts and confidence

Mixarr reports hard conflicts, soft tensions, insufficient-library conflicts, and unavailable-metadata conflicts without discarding either side. Each report explains the problem, suggests a resolution, and remains reviewable. Unresolved mutually exclusive hard requirements block approval/generation; soft tensions do not.

Numeric confidence remains internal while the UI presents High, Medium, or Low. Defaults are configurable under Settings → Intelligence → Intent Interpretation.

## Library coverage

`POST /api/intents/estimate` reports approximate hard-filter matches, BPM and energy metadata coverage, phase coverage, adjustment suggestions, and Strong/Good/Limited/Insufficient/Unknown states. Estimates are advisory and never promise playlist quality.

## API

Authenticated endpoints are:

```text
POST   /api/intents/interpret
POST   /api/intents/validate
POST   /api/intents/estimate
POST   /api/intents/apply
GET    /api/intents/{id}
PUT    /api/intents/{id}
DELETE /api/intents/{id}

GET    /api/intent-dictionary
POST   /api/intent-dictionary
PUT    /api/intent-dictionary/{id}
DELETE /api/intent-dictionary/{id}

GET    /api/intent-presets
POST   /api/intent-presets
PUT    /api/intent-presets/{id}
DELETE /api/intent-presets/{id}
POST   /api/intent-presets/{id}/apply

GET    /api/intent-settings
PUT    /api/intent-settings
```

Example local request:

```json
{
  "text": "Start calm, build toward 130 BPM, and finish uplifting.",
  "privacyMode": "LOCAL_ONLY",
  "providerAssistance": false,
  "retainSourceText": true
}
```

The apply response contains a canonical recipe patch and ordering context, not selected track IDs.

## Permissions and settings

Intent permission identifiers are `intent.interpret`, `intent.generate`, `intent.edit`, `intent.view_explanation`, dictionary view/create/edit-own/delete-own/manage-household, preset view/create/edit-own/delete-own/share, and `intent_ai.use`. Existing owner/admin and active household membership checks enforce them server-side.

Settings cover feature/local/provider enablement, default provider reference, confidence thresholds, maximum phases, energy/BPM tolerances, coverage estimation, required review, personal/household dictionaries, presets, privacy defaults, source retention, retention period, and audit detail. API keys remain in the existing AI provider store.

## Database migration

Apply `20260723010000_mood_activity_intent_intelligence_v245`. It adds `IntentInterpretation`, `IntentDictionaryEntry`, `IntentPreset`, `IntentInterpretationSetting`, and `IntentAuditEvent` plus owner, household, state, phrase, visibility, and update indexes. The migration is additive: it drops no tables or columns and preserves all existing requests, recipes, providers, playlists, and user data.

## Troubleshooting

- **Provider disabled, timed out, over budget, or invalid:** local interpretation continues and shows a fallback warning.
- **Insufficient phase coverage:** widen BPM/energy tolerance, shorten or remove a phase, soften a preference, or run audio feature analysis.
- **Contradictory requirements:** resolve the hard conflict in review before approval.
- **Unknown due to metadata:** run BPM/audio analysis or allow tracks with missing metadata.
- **Dictionary phrase conflict:** edit the existing personal phrase; normalized phrases are unique per owner.
- **Stale edit:** reload before retrying; mutable records use updated-at concurrency checks.

## Manual verification

1. Apply the migration and restart Mixarr.
2. Open Ask Mixarr with Local Only selected.
3. Interpret each example in the automated fixture suite and inspect categories, phases, curves, preferences, confidence, warnings, and conflicts.
4. Rename, reorder, duplicate, resize, and save phases; verify the new revision invalidates prior approval.
5. Add a personal phrase in Settings, interpret it, and verify the local privacy indicator.
6. Estimate library coverage, approve the current revision, preview, save the recipe, and create the playlist.
7. Confirm the explanation records requested/achieved curves and missing metadata while track selection remains in Smart Mix Engine v2.
8. Optionally enable governed provider enhancement, force a timeout/invalid response, and verify local fallback.

Final version: `v2.4.5`.
