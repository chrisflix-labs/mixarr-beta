# Mixarr v2.1.8 — Smart Mix Explanations & Insights

Smart Mix explanations show what the v2 engine actually used to select, reject, rank, or replace a candidate. The explanation collector consumes the score breakdown, adaptive and playback outputs, playlist identity result, coordination result, fallback list, final-selection adjustments, runner-up margin, and BPM-flow analysis emitted during the generation. It does not run a parallel scoring model.

## Score versus confidence

The final score describes candidate fit under the generation's settings. Recommendation confidence describes how certain Mixarr is that the decision is well-supported. A high-scoring track can have low confidence when metadata is incomplete, fallbacks were needed, identity or personalization history is sparse, signals conflict, or the runner-up was nearly tied.

Confidence is deterministic. It starts at 100 and applies bounded deductions:

- 10 points per missing core metadata field, capped at 40.
- 5 points per fallback, capped at 20.
- 10 points when the retained runner-up margin is under 2 points.
- 5 points for meaningful positive and negative signal conflict.
- 8 points each for limited playlist-identity or personalization evidence when that layer was applied.

Labels are Very High (90–100), High (75–89), Medium (55–74), Low (35–54), and Very Low (0–34). Score changes do not directly change confidence.

## Hard and soft rejection

A hard rejection means an authoritative eligibility rule removed the candidate, such as strict recent-play avoidance, a coordination hard maximum, Never recommend feedback, or another retained exclusion code. Its trace records the rejection stage and stable code.

A soft rejection means the candidate remained eligible but finished below the selected set. When available, Mixarr stores the winning candidate, score margin, and factors that favored the winner. Counts for exclusions that occur before candidate hydration, such as manual exclusions, remain in generation aggregates even when a per-track trace is not stored.

## Personalization and playlist identity

The score view distinguishes the base engine score, adaptive/personalization adjustment, playlist identity adjustment, transition adjustment, other penalties, and final selection score. It displays the configured maximum influence, confidence limit, and whether adaptive scoring capped the adjustment. When disabled or under-trained, the saved status explains that the layer had no or minimal influence.

Playlist identity reasons come from the identity score result and generation-time identity snapshot. Influence is labeled strongly supportive, moderately supportive, neutral, moderately conflicting, or strongly conflicting from the actual bounded adjustment. The snapshot contains relevant identity traits, not credentials or tokens.

## Transitions, metadata, and fallbacks

Transition explanations preserve raw and effective BPM gaps, direct/half-time/double-time relationship, direction, difficulty, transition score, runner-up margin, transition feedback, discovery slot adjustment, and repetition penalty when available. A first-position track or expired candidate may have no transition context.

Missing BPM, mood, energy, and popularity fields create structured metadata entries with confidence impact and relevant repair links. Every engine fallback receives a stable code, trigger, used behavior, confidence effect, relaxation flag, and action flag. Relaxed constraints are never hidden.

## Retention and privacy

- Selected track explanations: retained with the generated playlist and every playlist-version snapshot.
- Rejected candidate details: top 100 per generation by default, configurable from 0–500.
- Full rejected trace history: 30 days by default, configurable from 1–365 days.
- Aggregate insights and grouped rejection counts: retained with the generation record.
- Expired trace cleanup: available in Settings and through the authenticated cleanup API.

Explanation rows are user-scoped and indexed by generation, track, playlist, decision, rejection code, and expiry. Factors stay in JSON on one decision row instead of creating one row per factor. Candidate APIs are paginated and never load the whole retained generation by default.

Explanations can reveal listening behavior, artist preferences, and rejected tracks. They remain in the local Mixarr database. JSON debug reports remove secret-like keys including tokens, passwords, cookies, sessions, credentials, and API keys, but the remaining preference data is still private and should be reviewed before sharing.

Existing personalization reset behavior removes or neutralizes the live profile used by later generations. Historical explanations intentionally remain immutable records of what influenced an earlier playlist; delete the related playlist/history if local privacy policy requires deleting those records too.

## Explanation API

All endpoints require the `mixarr_session` cookie and scope every query to the current user.

- `GET /api/smart-mix-explanations/tracks/:trackId?generationId=...&playlistId=...`
- `GET /api/smart-mix-explanations/generations/:generationId/insights`
- `GET /api/smart-mix-explanations/generations/:generationId/candidates?decision=rejected&page=1&pageSize=25`
- `POST /api/smart-mix-explanations/compare` with `generationId` and exactly two `trackIds`
- `GET /api/smart-mix-explanations/generations/:generationId/export`
- `POST /api/smart-mix-explanations/cleanup`
- `GET` or `PATCH /api/settings/smart-mix-explanations`

Developer detail is restricted to administrators. Debug export returns JSON with a privacy warning and private/no-store response headers.

## Migration and upgrade

Apply `prisma/migrations/20260716120000_smart_mix_explanations/migration.sql` through the normal deployment process. The migration is additive: it adds `explanationJson` to generated playlist tracks plus explanation preference, generation, and decision-trace tables and their indexes. It does not modify or delete existing playlist, scoring, identity, feedback, playback, or coordination data.

Historical Smart Mix v1 and pre-v2.1.8 playlists show an explicit unavailable state because they do not have an authoritative trace. Mixarr does not fabricate a retrospective explanation.

## Logging and performance

Normal operation emits one structured `[SmartMixInsights]` summary per traced generation, including evaluated, eligible, selected, hard-rejected, fallback, low-confidence, and trace-duration values. Set `SMART_MIX_EXPLANATION_DEBUG=true` only for bounded diagnostic work; it logs retained trace summaries, never credentials or full profiles. Generation timing is recorded on the explanation generation row so tracing overhead can be compared across workloads.
