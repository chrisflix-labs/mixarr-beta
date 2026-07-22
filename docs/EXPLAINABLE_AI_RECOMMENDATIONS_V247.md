# Mixarr v2.4.7 — Explainable AI Recommendations

Mixarr now preserves a versioned explanation from the user’s original request through AI interpretation, generated recipe configuration, deterministic candidate evaluation, and final track outcome. The explanation is reviewable in Recipe Copilot and on generated Smart Mix v2 playlists.

The responsibility boundary is deliberate:

- AI interprets natural-language intent and proposes structured configuration.
- Mixarr validates that configuration and its safety, compatibility, and governance constraints.
- Smart Mix v2 discovers candidates, applies hard filters, scores and deduplicates tracks, enforces artist/album variety and repeat rules, checks metadata and availability, orders the playlist, and selects the final tracks.
- Explanation prose for engine decisions is rendered locally from stable reason codes and captured values. It does not make another AI request.

Mixarr never labels a deterministic track decision as an AI selection.

## Five explanation layers

1. **User intent** retains the original, unchanged request, submission time, source, owner, recipe, and generation link.
2. **AI interpretation** stores structured goals and field interpretations, numeric/category confidence, conflicts, warnings, assumptions, and alternatives.
3. **Generated configuration** records each semantic field change, previous/proposed value, source interpretation, confidence, explicit/inferred state, user-modification state, and deterministic validation result.
4. **Engine evaluation** links the existing immutable Smart Mix v2 decision trace to normalized hard-filter, soft-preference, score-modifier, metadata, and positioning events.
5. **Final outcome** uses the same retained events to explain selection, exclusion, rank, score changes, metadata fallbacks, and positioning.

The panel’s Overview, User Intent, AI Interpretation, Generated Rules, Engine Evaluation, Track Results, Assumptions, Alternatives, Reproducibility, and Export tabs use progressive disclosure. Track events are loaded separately with server-side pagination.

## Data, migration, and retention

Apply additive migration `20260725010000_explainable_ai_recommendations_v247`. It creates `RecommendationExplanation`, `ExplanationAssumption`, `ExplanationAlternative`, `RecommendationRuleTrace`, `RecommendationTrackEvaluation`, `ExplanationApprovalNote`, and `RecommendationExplanationAudit`.

The migration does not delete or rewrite existing recipes, playlists, Smart Mix decision traces, or AI request history. Existing Smart Mix v2 rejected-candidate retention settings still bound detailed candidate storage. Selected track explanations remain attached to playlist snapshots; expired historical candidate data is reported as unavailable and is never fabricated.

Legacy recipes and generations display the deterministic trace that actually exists. If no structured AI interpretation was retained, the panel states that it is unavailable.

## Permissions and household review

The service defines these capabilities for Mixarr’s role framework:

- `recommendations.explanation.view`
- `recommendations.explanation.export`
- `recommendations.explanation.modify_assumptions`
- `recommendations.explanation.apply_alternative`
- `recommendations.explanation.regenerate`
- `recommendations.explanation.view_raw`
- `recommendations.explanation.approve`
- `recommendations.explanation.add_notes`

Owners and administrators can review and modify their explanation artifacts. Active household members can view explanations for household playlists; owner/admin access is required for raw data and modifications. Household notes retain the approver, timestamp, decision, note, related field/rule, recipe version, explanation version, generation run, and optional requested change. They appear in exports and explanation history.

## API

All routes require the normal `mixarr_session`, enforce resource ownership or authorized household access, and return structured errors.

```text
GET    /api/recommendations/{id}/explanation
GET    /api/recommendations/{id}/explanation/intent
GET    /api/recommendations/{id}/explanation/rules
GET    /api/recommendations/{id}/explanation/tracks
GET    /api/recommendations/{id}/explanation/tracks/{trackId}
GET    /api/recommendations/{id}/explanation/assumptions
GET    /api/recommendations/{id}/explanation/alternatives
GET    /api/recommendations/{id}/explanation/diff
GET    /api/recommendations/{id}/explanation/reproducibility
POST   /api/recommendations/{id}/explanation/assumptions/{assumptionId}/accept
POST   /api/recommendations/{id}/explanation/assumptions/{assumptionId}/reject
PATCH  /api/recommendations/{id}/explanation/assumptions/{assumptionId}
POST   /api/recommendations/{id}/explanation/alternatives/{alternativeId}/apply
POST   /api/recommendations/{id}/explanation/regenerate
POST   /api/recommendations/{id}/explanation/approval-notes
GET    /api/recommendations/{id}/explanation/export?format=json|markdown|html|print
```

`{id}` may be an explanation, AI proposal/request, recipe, generated playlist, or generation ID. Track filters include `selected`, `excluded`, `ruleId`, `result`, `reasonCode`, `responsibility`, `artist`, `album`, `minScore`, `maxScore`, and `missingMetadata`; `page` and `pageSize` are bounded server-side.

Applying a stored alternative updates the structured explanation preview without calling AI and without overwriting the recipe. Deterministic regeneration defaults to preview. Applying a preview requires explicit `apply: true` plus returned track IDs; reinterpretation remains a separate explicit Recipe Copilot action.

## Diff and recipe approval

Recipe changes use semantic field paths, not serialized-text comparison. Each field records its before/after value, rationale, expected behavior, confidence, validation, responsibility, and inference state. Recipe Copilot continues to support selecting individual changes, rejecting all by selecting none, editing proposed values, restoring the pre-AI recipe, saving a new draft, and applying to an existing recipe as a new disabled revision. Existing recipes are never silently overwritten or activated.

## Privacy and cost controls

The feature reuses v2.4.1 privacy, provider, token, budget, and audit controls.

- Deterministic explanations and exports make no AI request and show zero additional interpretation/rendering cost.
- Track evaluation histories are not returned to an AI provider.
- Exports recursively remove credentials, API keys, authentication headers, cookies, private prompts, and provider secrets.
- Provider/model identifiers follow the active privacy mode.
- Original AI request cost is retained when available.
- Full raw data is owner/admin restricted.

JSON, Markdown, HTML, and printable HTML exports include the request, interpretation, confidence, assumptions, alternatives, generated configuration, validation, hashes, engine/recipe versions, rule-to-track events, selected/excluded outcomes, approval notes, and reproducibility state.

## Reproducibility

Every record stores canonical SHA-256 hashes of the structured interpretation and generated configuration plus schema/engine versions, metadata policy, provider context, random seed, assumptions, alternatives, and validation results.

Possible states are Fully reproducible, Reproducible with current metadata, Reproducible with stored snapshot, Partially reproducible, Not reproducible, and Reinterpretation required. Engine-version or provider-metadata changes produce explicit reasons. Stored configuration can be previewed or rerun without AI. AI is invoked only when the user separately requests reinterpretation.

## Worked example

Request:

> Create a rainy-night playlist for reading. Keep it reflective and calm, include some discoveries, avoid explicit tracks, and do not repeat artists too closely.

AI interpretation (illustrative stored structure):

```json
{
  "moods": ["reflective"],
  "energy": { "opening": "low", "middle": "medium-low", "closing": "low" },
  "discovery": { "requested": true },
  "explicitContent": "exclude",
  "artistVariety": "high"
}
```

Generated rules might set a reflective mood preference, low energy targets, a bounded discovery balance, `negativeFilters.excludeExplicit = true`, and tighter artist limits. Each field is marked explicit or inferred and validated separately from AI confidence.

For a selected 82 BPM track, retained deterministic events can show:

- `EXPLICIT_CONTENT_ALLOWED`: passed as a hard filter.
- `MOOD_MATCH`: positive score contribution using stored mood metadata.
- `BPM_MATCH`: target match using the evaluated BPM value.
- `DISCOVERY_FIT`: positive score delta for a discovery candidate.
- `ARTIST_ALBUM_REPETITION`: no penalty at the evaluated position.
- `POSITION_ASSIGNED`: selected at position 1 using the sequencing result.

The panel labels the rainy-night interpretation as AI work and every filter, score, selection, and position as deterministic Mixarr work.

## Troubleshooting

- **No AI interpretation:** the recipe/run predates v2.4.7 or was created deterministically. Future Smart Mix v2 runs still expose engine events.
- **No rejected tracks:** rejected trace retention may be disabled, capped, or expired. Mixarr does not reconstruct missing history.
- **Partially reproducible:** review the displayed engine-version or metadata-change reason before rerunning.
- **Insufficient metadata:** use the linked Library Health/audio-analysis workflow; the event shows the fallback used.
- **Export denied:** confirm ownership, household access, and raw/export permission scope.
- **Regeneration differs:** compare the original/current engine versions, configuration hash, metadata policy, and provider metadata changes shown in the reproducibility tab.
