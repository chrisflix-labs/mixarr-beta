# Changelog

## v2.4.23 - Portable Recipe Share-Code Security Fix

- Fixed AI provider setup authorization so enabled, unapproved Ollama providers can verify connectivity, discover installed models, run health checks, and perform a selected-model inference test while production feature inference continues to require explicit provider/model/feature approval.
- Added real selected-model Ollama inference testing, native `/api/tags` validation, actionable connection/DNS/timeout/endpoint/no-model/model-missing diagnostics, visible production-approval status, and local zero-cost labeling.
- Fixed the false-positive share-code safeguard that scanned a source installation's `generation.libraryId` after reconstructing the complete internal recipe document.
- Routed Copy share code, Community JSON, and Community bundle through the shared explicit portable recipe allowlist before serialization; database, user, provider, library, playlist, browser, server, and installation identifiers remain excluded.
- Added redacted field-level export diagnostics with detector rule, category, and object path while never logging matched values, complete payloads, credentials, or share codes.
- Added Clipboard API fallback handling for non-secure LAN HTTP contexts and browsers with unavailable or denied clipboard access, with clipboard failures classified separately from security validation.
- Preserved MXR1/community-format-v1 import compatibility, deterministic share codes, and protections for credentials, private addresses, environment references, database URLs, local filesystem paths, and installation-specific data.
- See [Portable Recipe Sharing and Share-Code Security](docs/RECIPE_SHARING_V2423.md).

## v2.4.22 - Local AI Model Loading & Unlimited Timeout Support

- Added independently nullable connection, first-token, total-request, and streaming-idle timeouts; cancellation grace remains finite.
- Added provider-specific replacement policies, effective-policy previews, and Ollama slow-load/no-request-timeout presets.
- Separated transport connection, first content, streaming activity, total duration, and cancellation cleanup lifecycle timers.
- Removed hidden stream duration and idle environment caps from AI execution and added phase-specific error codes and audit snapshots.
- Kept unlimited requests cancellable and added periodic background-job lease heartbeats during long model loads.

## v2.4.21 - Lossless Library Intelligence Backup & Restore

- Fixed the exact 2,772-track round-trip loss: 1,529 shared-Plex-GUID records were silently de-duplicated during schema-v1 parsing and the 1,243 surviving group representatives were then rejected as ambiguous.
- Added schema-v2 artifacts with actual read/serialized/written counts, per-category states, safe source/library fingerprints, serialized-file checksums, explicit completeness, and versioned identity/path strategies.
- Added explicit v2.4.11-v2.4.20 migration adapters, including v2.4.15 fixtures, with legacy-derived expected counts and honest unavailable-field warnings.
- Added GUID-aware composite matching with scoped source/rating/media-part identities, multiple media parts, portable privacy-safe path hashes, metadata fingerprints, and explicit duplicate/ambiguity detection.
- Added persisted pre-write restore plans, explicit partial confirmation, deterministic atomic/resumable batches, idempotent applied state, and post-write aggregate reconciliation.
- Updated the backup/restore UI to separate current, selected, and written contents and to report matched, restored, current, unmatched, ambiguous, invalid, failed, rolled-back, checksum, schema, completeness, and reason diagnostics without raw paths.
- Added exact round-trip-format, 40,000-track, 999/1,000/1,001, 4,999/5,000/5,001, 34,039, 36,816, nullable-state, shared-GUID, multiple-part, path normalization, corrupt-archive, legacy, and idempotent parsing coverage.
- See [Lossless Library Intelligence Backup & Restore](docs/LIBRARY_INTELLIGENCE_BACKUP_V2421.md).

## v2.4.20 - Canonical Recipe Copilot Scoring Models

- Established `stable-v2` and `experimental-balanced` as the single engine-backed scoring-model enum shared by recipe drafts, Recipe Copilot structured output and prompts, Recipe Studio controls, API validation, persistence, import/export, and execution.
- Classified `popularity_heavy` as an AI-invented unsupported value: it has no engine implementation, legacy migration, product preset, or equivalent semantics, so it is rejected without fuzzy matching or silent replacement.
- Made proposal construction and Apply selected use the complete canonical draft plus save-semantic validator; failed candidates apply nothing, preserve selection and dirty state, and return the exact field, proposed value, and supported choices.
- Added field-specific `422` save errors with sanitized correlation IDs and the `RECIPE_SCORING_MODEL_UNSUPPORTED` code instead of exposing a generic error or stack trace.
- Added an idempotent startup diagnostic that normalizes only documented aliases, preserves unknown stored values, disables/quarantines affected recipes for review, and logs counts without recipe content.
- Generated Recipe Studio options and Copilot prompt descriptions from the canonical catalog, synchronized the derived execution copy before persistence, and added contract, apply-flow, API, migration, prompt, import, and execution coverage.

## v2.4.19 - Canonical Recipe Copilot Conflict Detection

- Fixed the false `name` conflict that blocked Recipe Copilot’s Apply selected workflow even when the active Recipe Studio name had not changed.
- Captured the authoritative initialized Recipe Studio draft immediately before generation, normalized and deep-cloned it as the proposal `baseDraft`, and derived a stable revision hash from canonical key ordering without volatile UI fields.
- Replaced raw serialized equality with path-aware three-way comparison: a conflict exists only when the current value differs from both the proposal base and proposed value.
- Added one-layer legacy JSON-string normalization for schema-defined string destinations, canonical schema defaults, ordered recipe arrays, unordered tag sets, stable object-key equality, and idempotent already-applied counts.
- Classified genuine conflicts as `AI_RECIPE_PROPOSAL_CONFLICT`, added explicit missing/invalid snapshot failures, and reserved `AI_RECIPE_PROPOSAL_APPLY_FAILED` for unexpected application errors.
- Added field-level conflict review with base, current, and proposed values; safe keep-current defaults; non-conflicting application; explicit Copilot override; and cancel-and-continue actions.
- Disabled generation until Recipe Studio initialization completes, marked proposals stale after a recipe-type change, preserved dirty state and validation, and kept Save/Create as the only persistence action.
- Added sanitized canonical hash/type/length diagnostics plus unit, component, integration, idempotency, protected-path, and browser regression coverage.

## v2.4.18 - Reliable Recipe Copilot Draft Application

- Fixed Recipe Copilot’s “Apply selected” action so reviewed scalar, nested-object, boolean, and array changes are atomically applied to the active Recipe Studio draft and immediately reflected in visible controls.
- Replaced path-label selection with stable proposal change IDs, added an allowlisted immutable patcher, rejected protected and prototype-pollution paths, and added field-level stale-proposal conflict detection.
- Applying now validates through the canonical Recipe Studio schema, marks the custom form draft dirty, refreshes live analysis, focuses and briefly highlights the first changed field, closes only after success, and reports the exact applied count.
- Apply failures keep the proposal and selection available, show a normalized local application error, and emit sanitized path-only diagnostics without classifying the failure as an AI provider error.
- Standardized Apply selected as a local draft operation for new and existing recipes. The normal Save/Create action remains responsible for persistence; applying never activates, executes, publishes, or generates a playlist.
- Added regression coverage for a boolean behavior flag, replacement of `filters.rules` with a popularity rule, the proposed recipe name, immutable atomic patching, protected paths, schema compatibility, conflict handling, button state, feedback, and no-persistence semantics.

## v2.4.17 - Token-Limit Removal and Reliable Recipe Copilot JSON

- Removed Mixarr-configured input, output, completion, prompt, reasoning, request, provider, feature, and user token caps from runtime governance, public APIs, onboarding, previews, provider tests, and settings. Deprecated database columns remain inert for a safe rollback window.
- Omitted `max_tokens`, `max_completion_tokens`, and `max_output_tokens` from normal requests and provider connectivity tests. Token estimates remain informational for cost previews; monetary and request-count budgets remain enforced.
- Retained provider/model native context-window safety under the explicit `AI_MODEL_CONTEXT_WINDOW_EXCEEDED` classification, separate from configurable governance limits.
- Added canonical Recipe Copilot JSON Schema generation, normalized `strict_json_schema`, `json_object`, and `prompt_only_json` provider capabilities, and DeepSeek V4 structured requests with thinking explicitly disabled and unsupported sampling parameters omitted.
- Added conservative fence/prose/string/wrapper normalization, path-specific sanitized schema diagnostics, and one privacy- and budget-governed provider repair attempt. Raw provider output and `reasoning_content` are never logged or exposed.
- Fixed the reported HTTP-200 schema mismatch: the provider used an unsupported rule operator, supplied a non-string rule value, and included unknown scoring properties. Normal completion is no longer mislabeled as truncation or token limiting.
- Added migration `20260726010000_remove_ai_token_limits_v2417`, migration notes, provider-payload tests, the 12KB regression fixture, and structured normalization/repair coverage.

## v2.4.16 - DeepSeek V4 Thinking and Truncated Response Fix

- Fixed DeepSeek V4 provider tests exhausting a tiny eight-token completion allowance in provider-default thinking mode before `message.content` was produced. The raw HTTP request succeeded, but `finish_reason: length` correctly means model completion failure rather than authentication or transport failure.
- Added a dedicated provider-test request profile: deterministic JSON-only system/user prompts, `response_format: {"type":"json_object"}` where supported, `stream: false`, no tools or sampling controls, and explicit `thinking: {"type":"disabled"}` for supported DeepSeek V4 models.
- Added one provider-test-only, governance- and budget-checked retry. Normal feature requests no longer retry or fall back automatically after truncation.
- Added explicit Off, On, and Provider default thinking modes for `deepseek-v4-pro` and `deepseek-v4-flash`. Structured requests default to Off; advisory free-form requests may honor the provider setting; enabled thinking omits unsupported sampling parameters.
- Separated final `message.content` from `reasoning_content`, removed reasoning from final-output extraction diagnostics, and added explicit provider truncation and invalid-structured-response classifications while retaining the old truncation parent category in sanitized details.
- Centralized provider-test request handling and excluded unrelated feature governance from connectivity tests.
- Added sanitized response logging/audit fields and an actionable failure panel. Mixarr records reasoning presence, provider-reported token counts, and character counts only; raw chain-of-thought is never returned, logged, audited, or displayed.
- Added migration `20260805010000_deepseek_v4_thinking_v2416`, mocked provider/regression coverage, and [DeepSeek V4 documentation](docs/DEEPSEEK_V4_THINKING_V2416.md).

## v2.4.15 - Storage Safety and Large-Library Scalability

- Fixed Recipe Copilot requests against slower DeepSeek/OpenAI-compatible models aborting at the legacy 30-second provider/global defaults. The coordinator is now the single total-request timer owner, defaults remote generation to 120 seconds, validates `AI_REQUEST_TIMEOUT_SECONDS` from 30 through 600 seconds, and retains stricter administrator provider/global/governance overrides.
- Replaced blind provider and browser JSON parsing with status-, Content-Type-, body-length-, empty-body-, SSE-, HTML-, error-object-, and response-shape-aware handling. OpenAI-compatible chat completions, Responses-style text, direct objects/JSON strings, fenced JSON, and one unambiguous JSON object are normalized through shared utilities.
- Added one bounded same-provider JSON repair attempt for malformed structured output, distinct timeout/HTTP/empty/invalid/schema error codes, a stable request ID across Recipe Copilot, provider diagnostics, API errors, and AI history, and safe UI fallback for non-JSON backend errors. Generated recipes remain unsaved, inactive, unapproved, and review-only.
- Corrected request accounting so timeouts record `TIMED_OUT`, invalid output records `INVALID_RESPONSE`, provider HTTP failures remain distinguishable, provider-reported usage/cost is retained when available, and unavailable usage after a timeout is not represented as proof that no provider work was billable.
- Added idempotent migration `20260803020000_recipe_copilot_reliability_v2415`, provider/parser/frontend/privacy/governance regression coverage, and [Recipe Copilot reliability documentation](docs/RECIPE_COPILOT_RELIABILITY_V2415.md).
- Confirmed and fixed a stock v2.4.14 Docker writable-layer defect: the startup command downloaded Prisma through `npx --yes` three times, leaving roughly 230 MiB under `/tmp/.npm` in every newly created app container.
- Replaced fragmented runtime paths with configurable `/config` and `/data` roots, moved temporary analysis and artwork out of `/app`, removed backup fallback into ephemeral paths, and added startup mount/permission/capacity validation.
- Streamed Plex track pages in bounded batches, replaced the O(n²) identity scan with a stable-key map, suppressed writes for unchanged artists/albums/tracks, and added an UNLOGGED per-scan identity staging table for missing-file reconciliation without rewriting 150,000 unchanged rows.
- Added bounded cache, temp, job, scan, and AI retention, safe startup/scheduled/manual cleanup, disk thresholds, Storage Diagnostics and cleanup APIs/UI, Docker log rotation, and a read-only application root.
- Added migration `20260803010000_storage_safety_v2415`, storage tests, and a synthetic real-production-path library benchmark.

## v2.4.14 - Per-Request AI Cost Limit Configuration

- Fixed AI providers configured through the onboarding wizard rejecting every priced external request with `AI_REQUEST_COST_LIMIT_EXCEEDED`. The wizard's "maximum request cost" defaulted to `0` and was written into `maximumCumulativeRequestCost`, which admission read as the per-request ceiling; `evaluateCostLimit` treats a stored `0` as a real ceiling of exactly $0.000000, so any request estimated above zero was refused before dispatch.
- Separated three things that had collapsed onto one column: the **per-request estimated cost limit** (checked once, on admission), the **cumulative request cost limit** (first attempt plus retries, checked only after a transient failure), and the wizard field that was feeding the wrong one. The per-request ceiling now has its own `maximumEstimatedRequestCost` column, and each ceiling has its own explicit mode.
- Added `perRequestCostLimitMode` and `cumulativeRequestCostLimitMode` (`UNLIMITED` by default, or `LIMITED`). Unlike a request count, a zero-dollar ceiling stays expressible because it is a real policy — "admit only free or local-provider requests" — but only under an explicit Limited mode, where it can no longer be confused with an unset field. Choosing Limited without an amount resolves to unlimited and is reported as a configuration problem instead of blocking every request.
- Centralized the resolution in one pure module (`src/ai/governance/costLimits.ts`) shared by admission, validation, the settings API, and the dashboard. It resolves which limit applies; `evaluateCostLimit` and `evaluateRetryCost` remain the only cost comparators and are neither bypassed nor reimplemented, and amounts are carried as exact decimal strings so micro-unit conversion is unchanged.
- Corrected the onboarding wizard so it asks for a per-request cost mode rather than defaulting an amount to zero, and no longer writes a per-request value into the cumulative retry ceiling. A local-only setup is still saved with an explicit Limited $0.00 per-request policy, now stated on the step.
- Added administrator visibility and a direct route to the control: an "AI cost limits" panel under Budgets with the mode, the amount, what is enforced, and a confirmation prompt before saving a zero ceiling; an accurate label and its own mode for the cumulative ceiling under Timeouts & Retries; and a blocked-feature link to `/settings/ai?section=Budgets#ai-cost-limits`. Recipe Copilot's message now names the estimated cost, the ceiling, the control, and what a zero ceiling means.
- Provider approval, feature approval, model availability, monthly budgets and hard shutdown, provider and user daily/monthly cost limits, daily and monthly request-count limits, the retry cost limit, token and prompt limits, privacy modes, unpriced-model blocking, paid-provider permission, background policy, emergency shutdown, and budget reservations are unchanged and still enforced independently. The estimated-cost calculation itself is unchanged.
- Added idempotent migration `20260802010000_ai_per_request_cost_limit_v2414`. It moves a positive cumulative amount into the per-request column as an explicit Limited ceiling, releases a zero ceiling on installations that permit external providers (the wizard default that contradicts the administrator's own provider configuration), and keeps a zero ceiling as an explicit Limited $0.00 on local-only installations so no deliberate control is removed. It deletes no rows, grants no permission, and does not enable AI or external providers.

## v2.4.13 - Daily AI Request Limit Configuration

- Fixed Recipe Copilot (and every other AI feature) being blocked by `AI_DAILY_LIMIT_EXCEEDED` with no usable setting to change the limit. Root cause: daily request counts were enforced as `limit != null && count >= limit`, so a missing, blank, or zero limit was interpreted as "zero requests allowed" and blocked every request permanently. A zero was reachable through the provider and user forms (`min="0"`) and through `AiUserLimit`, which accepted zero as a valid limit.
- Added an explicit daily request-limit mode so unlimited usage is selectable rather than implied by a blank field: `UNLIMITED` and `LIMITED` at the global scope, plus `INHERIT` at the provider and user scopes. Zero is no longer an ambiguous limit; it is rejected at every write path with a specific message instead of being stored.
- Added the missing global control. `AiGovernanceSetting.dailyRequestLimit` previously had no field in the AI Governance dashboard and could only be written by the onboarding wizard, which defaulted to 50 requests per day with no way to raise or clear it afterwards. Onboarding now defaults to Unlimited and never persists a number the settings page cannot change.
- Centralized precedence in one pure module (`src/ai/governance/requestLimits.ts`) shared by admission, validation, the settings API, and the dashboard. Every scope is evaluated independently and the strictest wins, so a user-level Unlimited cannot weaken the global limit; a `LIMITED` scope with no usable number resolves to unlimited and is reported as a configuration problem rather than blocking the feature; and legacy rows written before the mode existed keep enforcing their stored positive limit.
- Corrected error reporting: the monthly request limit returned the daily error code, and the daily message named neither the responsible scope nor the numbers. Added `MONTHLY_REQUEST_LIMIT_REACHED` (surfaced as `AI_MONTHLY_REQUEST_LIMIT_EXCEEDED`), and both codes now carry sanitized scope, limit, usage, remaining, and reset-time details that features render as a sentence pointing at the exact control. No prompts, responses, credentials, or user metadata are included.
- Added administrator visibility and a direct route to the control: an "AI request limits" panel showing today's counted requests, remaining, and reset time; Inherit/Unlimited/Limited selectors on the provider and user limit panels; a blocked-feature link to `/settings/ai?section=Budgets#ai-request-limits` that opens and scrolls to the setting; and requests used and remaining in the Recipe Copilot readiness panel.
- Provider approval, feature approval, per-request cost limits, monthly budgets, daily and monthly cost limits, retry cost limits, token and prompt limits, privacy modes, paid-provider permission, background-request policy, emergency shutdown, and provider availability checks are unchanged and continue to be enforced independently.
- Added idempotent migration `20260801010000_ai_daily_request_limit_configuration_v2413`. It adds the mode columns, marks existing positive limits as Limited so they are preserved exactly, and converts stored zero daily and monthly request limits to unlimited, which releases any installation that was blocking every AI request. It deletes no rows, grants no permission or approval, and does not enable AI or external providers.

## v2.4.12 - AI Provider Feature Authorization Fix

- Fixed Recipe Copilot (and any provider-feature request) being incorrectly rejected with `AI_PROVIDER_FEATURE_BLOCKED` when the provider was genuinely approved for the feature. Root cause: a duplicate global "allowed external features" list (`AiGovernanceSetting.allowedExternalFeaturesJson`) shadowed the authoritative per-provider feature allowlist (`AiProviderConfig.allowedFeaturesJson`) and additionally returned the wrong error code. The per-provider allowlist is now the single authoritative provider-feature approval control; the legacy global list is retained for backward data compatibility but is no longer an independent authorization gate.
- Added a single canonical AI feature registry (`AI_FEATURES`, `canonicalFeatureId`, legacy alias map) and a pure, centralized authorization evaluator (`evaluateProviderFeatureAuthorization`) that evaluates checks in a deterministic order and returns a structured decision (`allowed`, `code`, `failedCheck`, `requestedFeature`, `providerId`, `providerSlug`). The API route, durable queue, and execution worker all authorize through this one evaluator so they cannot drift.
- Normalized feature and provider identifiers before authorization: case, hyphen/space separators, and known legacy aliases no longer affect the decision. Provider approval and per-feature approval remain separate governance controls, and no provider (including DeepSeek) is special-cased.
- Corrected error selection so `AI_PROVIDER_FEATURE_BLOCKED` is returned only for an actual provider-feature approval failure. Global external access, feature-disabled, privacy-mode, data-category, capability, model, and confirmation failures each return their specific existing error codes.
- Added an administrator-safe Effective Authorization diagnostic: `GET /api/ai/effective-policy?providerId=...&feature=recipe_copilot` and an expandable section in the AI Security dashboard that show the exact ordered checks and the blocking reason, plus a sanitized server-side decision log keyed by request ID. No credentials, headers, prompts, or responses are exposed.
- Recipe Copilot continues to operate on unsaved recipes, permission changes take effect immediately without restarting Mixarr, and the "Operation unavailable" status is replaced with accurate Ready/Blocked-by-policy states. Added a startup validation warning for unknown feature identifiers that never crashes the application.
- Added idempotent migration `20260731010000_ai_provider_feature_authorization_v2412` that canonicalizes existing feature allowlists, preserves every explicit approval, de-duplicates entries, grants no new permissions, and does not enable AI or external providers. Added a v2.4.12 authorization matrix test suite.

## v2.4.11 - Library Intelligence Backup & Restore

- Added a scoped "Library Intelligence Backup" that preserves only calculated audio features, BPM/tempo, popularity scores, track genres, their processing and known no-data states, and the minimum Plex track identity (GUID, rating key, source id, title, artist, album, disc/track number, duration, year, file size, normalized path hash, and metadata fingerprint) needed to re-match tracks after the database is recreated.
- Backups deliberately exclude AI configuration/requests/prompts/responses/history, API keys, Plex tokens, passwords, authentication and session secrets, environment variables, application and audit logs, user accounts and passwords, notification/webhook/provider credentials, recipes, playlists, saved natural-language requests, household controls, unrelated settings, raw audio, and full database dumps. An explicit field allowlist enforces this and raw absolute media paths are replaced by a SHA-256 hash of the normalized path.
- Added a portable versioned `.mixarr-library-backup` archive (`manifest.json`, `tracks.ndjson`, `checksums.json`) written and read as background jobs with streaming batched track export, per-entry CRC and archive checksums, browser download, and a configurable server backup directory (`MIXARR_BACKUP_DIR`, default `/app/backups`).
- Added a guided restore that validates untrusted archives before any write (path traversal, symlinks, absolute paths, zip bombs/oversize, unexpected entries, duplicate entries, bad/missing checksums, unsupported schema versions, malformed JSON, oversized records, hostile secret-named fields, and NaN/Infinity/negative/out-of-range values), previews matches and per-category changes without writing, and applies with Fill Missing Only (default), Prefer Backup, or Keep Current policies (global or per category).
- Restore uses conservative deterministic matching (exact GUID, source id, rating key, then normalized path hash, then strict metadata fingerprint, then a strict-duration high-confidence fallback) so restored features, BPM, popularity, and genres are marked complete without rerunning local Essentia analysis or repeating external popularity/genre lookups. Ambiguous matches are never applied automatically, known no-data states are preserved so lookups are not immediately repeated, and each match is persisted for inspection.
- Restore is idempotent, batched, and resumable after interruption; a backup uploaded before a Plex library sync is validated and staged, then applied after tracks appear. Restored records keep their original source and analysis timestamp plus explicit restored-from-backup provenance, and dashboard/coverage counts reflect restored data without double counting.
- Added admin-only APIs and a `/settings/system/library-backup` page, plus additive migration `20260729010000_library_intelligence_backup_v2411` that adds only job-state, staging, match, and provenance columns and does not enable AI, queue analysis, or modify existing intelligence data. Keep a downloaded copy or store backups on a volume separate from the Mixarr database.

## v2.4.10 - AI-Assisted Mix Intelligence Polish

- Added the primary `/ai` intelligence center with real provider, model, privacy, request, token, cost, budget, queue, approval, warning, feature, success, and failure state.
- Added resumable ten-step administrator onboarding with separate activation, local-only completion, provider/model health validation, privacy payload previews, backend cost limits, optional features, a safe provider test gate, generated-recipe review, and final approval summary.
- Added permission-scoped natural-language request history, reusable validated request templates, household-aware sharing, variable previews, and private thumbs feedback that is never forwarded to providers.
- Added provider comparison and guidance links, clearer Ollama Docker networking defaults, mobile AI navigation, responsive cards, keyboard focus states, semantic status announcements, and screen-reader labels.
- Reused v2.4.x governance, provider registry, request coordinator, queue, audit, recipe revision, metadata review, explanations, troubleshooting, authorization, sanitization, cost reservation, and validation systems rather than introducing parallel AI infrastructure.
- Added additive migration `20260728010000_ai_intelligence_polish_v2410`, release documentation, roadmap and release-note updates, and v2.4.10 integration tests. AI, external providers, paid fallback, metadata writes, and features remain disabled until explicitly reviewed and activated.

## v2.4.9 - AI Governance, Security and Reliability

- Added deny-by-default granular AI permissions, explicit provider/model approvals, per-feature and per-privacy-mode allowlists, model capability declarations, and external-provider/data-category controls.
- Added centralized outbound redaction, prompt-template boundaries, prompt-injection detection, strict structured-response validation, bounded local JSON repair, malicious-response inspection, immutable security events, and non-overridable quarantine for critical findings.
- Added durable idempotent AI jobs with leases, heartbeats, cancellation, stale-job recovery, database-coordinated concurrency limits, queue visibility, and retry-safe request fingerprints.
- Added versioned prompt provenance, approval records with artifact hashes and diffs, configurable request/response/audit/quarantine retention, and a safe retention purge service.
- Added database and `MIXARR_AI_ENABLED` emergency shutdown controls that block provider requests, retries, discovery, health checks, and queued execution, while preserving deterministic non-AI functionality.
- Added the Security & Queue administration UI, governance/capabilities/permissions/jobs/quarantine/retention APIs, migration `20260727010000_ai_governance_security_reliability_v249`, documentation, and local-only security regression tests.

## v2.4.8 - AI-Assisted Troubleshooting

- Added a persistent Troubleshooting Center with guided problem selection, explicit diagnostic privacy controls, sanitized previews, progress, history, exports, and deletion.
- Added centralized recursive credential redaction and per-session stable pseudonyms for emails, paths, hosts, and IP addresses before preview, storage, export, audit context, or AI submission.
- Added deterministic checks for candidate exhaustion, provider and Plex health, metadata gaps, and recent job failures, including ordered candidate funnels and the 11-of-50 acceptance fixture.
- Added governed, structured AI explanations that can reference only deterministic finding IDs and allowlisted suggestion types; deterministic results survive AI failures and limits.
- Added separately persisted suggestions, review decisions, stale-target checks, non-persistent recipe simulations through the existing playlist preview engine, exact-diff confirmation, validated recipe revisions, and audit history.
- External AI troubleshooting, log sharing, and track-level metadata sharing remain disabled by default. No settings are changed automatically.

## v2.4.7 - Explainable AI Recommendations

- Added a versioned five-layer explanation model spanning immutable user requests, structured AI interpretation, generated configuration, deterministic engine evaluation, and final track outcomes.
- Added request-to-rule and rule-to-track traces, stable reason codes, responsibility labels, field-level AI confidence, deterministic validation, assumption review, alternative previews, and semantic recipe diffs.
- Added authenticated explanation APIs, paginated track evaluation filters, household approval notes, JSON/Markdown/HTML/print exports, privacy redaction, canonical hashes, reproducibility statuses, and no-AI deterministic regeneration.
- Integrated a keyboard-accessible responsive ten-tab explanation panel with Recipe Copilot and Smart Mix v2 generated playlists.
- Added additive migration `20260725010000_explainable_ai_recommendations_v247`, tests, API/permission/privacy/reproducibility documentation, and a complete rainy-night worked example.
- AI continues to interpret and propose structured settings only. Mixarr's deterministic engine remains responsible for filtering, scoring, deduplication, spacing, repeat prevention, availability, ordering, and final selection.

## v2.4.6 - AI Playlist Summaries and Metadata Suggestions

- Added deterministic, privacy-scoped playlist analysis and 14 individually selectable factual summary formats, including refresh comparisons, Plex-friendly plain text, and household descriptions.
- Added governed request previews, strict structured output, unsupported-claim rejection, summary history, original-text preservation, preferred summaries, comparison, archive, export, copy, and local playlist notes.
- Added opt-in deterministic and AI-assisted metadata scans with bounded batching, cancellation, partial-result retention, stable fingerprints, deduplication, source evidence, conflicts, and unavailable-source labels.
- Added responsive metadata review with complete filtering/sorting, paginated detail, confirmation-bound single and bulk decisions, ignore rules, CSV/JSON exports, progress, audits, and permission-scoped APIs.
- Added additive migration `20260724010000_ai_playlist_summaries_metadata_suggestions_v246`, dashboard/navigation integration, configuration examples, documentation, and safety-focused tests.
- Metadata suggestions are advisory only. Approval records agreement but never modifies Plex, source-library metadata, embedded tags, filenames, or folders. `AI_METADATA_WRITES_ENABLED` remains hard-coded false.

## v2.4.5 - Mood, Activity and Intent Intelligence

- Added a local-first, versioned structured intent layer for canonical moods, activities, time-of-day contexts, positive and negative preferences, hard requirements, confidence, warnings, and conflicts.
- Added editable 2–6 phase playlist progressions with normalized shares plus energy, valence, vocal, tempo, and transition targets.
- Added deterministic energy/BPM curve sampling and curve-aware ordering without changing the authoritative candidate filtering, scoring, safety, duplicate, and compatibility systems.
- Added personal and household interpretation dictionaries, saved intent presets, strict owner/household authorization, local custom-term resolution, and provider-safe generic context redaction.
- Added intent validation, coverage estimation, persistence, audit events, settings, CRUD APIs, responsive review UI, documentation, and additive database migration `20260723010000_mood_activity_intent_intelligence_v245`.
- Provider assistance remains optional and governed by the existing provider configuration, privacy, permissions, budgets, limits, timeouts, structured validation, and fallback controls. Final track selection remains deterministic.

## v2.4.4 - AI-Assisted Recipe Creation

Added:

- Recipe Copilot in Recipe Studio for structured Create, Refine, Explain, Diagnose, Optimize, intent comparison, naming, descriptions, onboarding, and playlist-example conversion.
- Strict versioned provider output, actual-schema normalization, local conflict detection, candidate estimation, compatibility and safety validation, built-in parent and inheritance recommendations, and safer automation guidance.
- Reviewable logical diffs with per-change accept, reject, editing, side effects, confidence, and one-click pre-AI restoration.
- Durable AI request/proposal provenance with Draft, Needs Review, Validated, Approved, Rejected, Superseded, and Quarantined workflows enforced by the backend.
- Owner/admin permission checks, audit history, prompt-injection delimiters, privacy-aware context filtering, stale-result detection, and governed provider/token/cost/budget preflight.
- Additive migration `20260722120000_ai_recipe_copilot_v244`, responsive accessible drawer, documentation, and automated backend/UI/security contracts.

Safety boundary:

- AI proposals are inactive review artifacts. They cannot approve or activate themselves, attach a parent automatically, execute arbitrary content, bypass recipe validation, or send track-level library data unnecessarily.
- Applying a proposal creates a normal restorable revision and clears approval. Validation, approval, and activation remain separate explicit actions.

## v2.4.3 - OpenAI Test Requests & Model Compatibility Hotfix

Fixed:

- Native OpenAI model discovery succeeding while inference tests failed through the generic Chat Completions adapter.
- Native OpenAI tests using the wrong endpoint and response parser; tests now send one minimal `POST /v1/responses` request.
- Embedding, moderation, image, audio, transcription, realtime, and other specialized models being offered as standard text-test models.
- Model, authorization, permission, quota, rate-limit, invalid-request, endpoint, service, timeout, and connectivity failures being collapsed into `PROVIDER_CONNECTION_FAILED`.
- Discovery alone marking a provider fully healthy, failed requests displaying a confirmed `$0.00`, and saved-secret failures appearing as network failures.

Improved:

- Added a dedicated native OpenAI adapter with canonical API-root handling, Responses output/usage parsing, OpenAI error parsing, request IDs, and sanitized diagnostics.
- Added deterministic compatible test-model selection without changing the saved default model during a test.
- Added separate credential verification, model discovery, and inference testing actions plus authentication, discovery, and inference health dimensions.
- Added explicit audit stages, provider/model results, endpoint mode, HTTP status, safe provider error codes, provider request IDs, and cost states.
- Native OpenAI is classified as externally paid independently from whether Mixarr has a pricing profile; paid-provider, privacy, budget, and permission governance remain enforced.
- Added additive migration `20260722010000_openai_provider_hotfix_v243` and focused backend/frontend regression coverage.

## v2.4.2 - Ollama Requests & User Policy Hotfix

Fixed:

- Ollama requests being incorrectly blocked or reported as `INTERNAL_AI_ERROR`.
- PostgreSQL advisory budget locks returning `void` and failing Prisma deserialization before provider dispatch.
- Local Ollama models being affected by paid-provider and missing-pricing checks.
- User-specific AI policies failing when optional numeric limits were blank.
- UUID validation, user existence checks, and duplicate-safe user-policy persistence.
- Generic AI Governance validation messages and incorrect-field navigation.
- Administrative provider tests resolving incomplete user context or issuing more than one configured Ollama test request.
- Audit entries incorrectly categorizing governance denials as internal/provider errors.

Improved:

- Central provider/model classification (`LOCAL_FREE`, `EXTERNAL_FREE_OR_UNPRICED`, `EXTERNAL_PAID`, `UNKNOWN`).
- Field-level validation, searchable user selection, tri-state permission inheritance, and exact save feedback.
- Sanitized unexpected-error logging and UI diagnostics with correlation IDs.
- Server-only stack sanitization now retains call frames without repeating raw multiline exception text.
- Paid-provider policy precedence, local no-cost labels, and connection-test governance/provider stages.

The existing Ask Mixarr v2.4.2 workflow remains available:

- Added `/ask-mixarr` with provider privacy/cost preflight, structured interpretation review, explicit versus inferred constraints, assumptions, ambiguity resolution, conversational revisions, revision diffs, Recipe Studio editing, candidate/compatibility analysis, and deterministic track previews.
- Added strict Zod provider output contracts and canonical recipe normalization. Provider output cannot supply track IDs, enable automation, request recipe permissions, or reach a Plex mutation path.
- Added revision-bound approval, server-validated status transitions, automatic approval invalidation after edits, stale analysis/preview checks, idempotent execution, and separate save-recipe versus create-playlist operations.
- Added locally scoped entity resolution for libraries, recipes, artists, albums, genres, and accessible playlists. Similar-playlist drafts remove selected track IDs and enforce a deterministic overlap limit instead of copying the source.
- Added additive migration `20260721180000_natural_language_playlist_requests`, request/revision/audit persistence, owner/admin permission enforcement, AI governance integration, responsive accessible UI, tests, API documentation, and upgrade notes.
- Safety boundary: AI interprets intent. The existing deterministic engine selects and orders tracks, and no Plex mutation occurs before explicit approval and a separate create action.

## v2.4.1 - AI Privacy, Cost and Context Controls

- Added one backend AI governance preflight for global/feature/user privacy, metadata transformation, prompt/token/response limits, configured model pricing, request limits, provider/user/global budgets, background policy, fallback eligibility, retry cost, and context trimming before provider dispatch.
- Added Local Only, Metadata Limited, Anonymous Metadata, and version-acknowledged Full Metadata modes with an allowlist engine, deterministic abstractions, unknown-field blocking, field-name-only privacy reports, and outgoing payload preview.
- Added decimal-safe model pricing history, real-time minimum/expected/maximum cost estimates, provider comparison, and serializable expiring budget reservations reconciled or released on every terminal request state.
- Added provider and user budgets, request-count limits, context safety, background controls, conservative paid fallback and retry defaults, provider-attempt records, alert deduplication/cooldowns, governance-change auditing, filtered usage analytics, sanitized detail, and CSV/JSON exports.
- Added an accessible responsive `/settings/ai` governance dashboard with setup review, privacy and cost previews, pricing, budgets, request-count controls, context safety, background, timeouts/retries, alerts, usage charts, audit table, loading/empty/error states, and provider local-endpoint confirmation.
- Added additive migration `20260721120000_ai_governance_v241`, policy/unit coverage, API enforcement markers, governance documentation, upgrade notes, roadmap/version updates, and no paid-provider calls in tests.
- Compatibility: existing v2.4.0 provider rows and encrypted credentials remain valid. Upgrade defaults are Metadata Limited with a restrictive allowlist, paid fallback off, external background AI off, prompt recording off, unknown external fields and unpriced external models blocked, and hard shutdown on when a budget exists.
- Scope boundary: v2.4.1 adds no user-facing playlist generation, recommendation, discovery, tagging, or conversational AI feature.

## v2.4.0 - AI Provider Foundation

- Added a provider-neutral AI contract, adapter registry, capability model, request coordinator, normalized errors, retries with jitter, timeouts, cancellation, response byte limits, normalized streams, and Zod-backed structured-response validation.
- Added native Ollama and Anthropic adapters plus shared OpenAI-compatible support for OpenAI, LiteLLM, LM Studio, DeepSeek, OpenRouter, and configurable compatible APIs. ChatGPT Subscription is registered as unavailable; Mixarr never uses browser cookies, profiles, session tokens, or web automation.
- Added additive provider, discovered-model, health, feature-setting, global-setting, and safe request-audit tables in migration `20260721050000_ai_provider_foundation_v240`. Global AI and every feature default to disabled; no provider is created and no external request runs during upgrade.
- Added administrator APIs and a responsive `/settings/ai` dashboard for provider CRUD, explicit secret replacement/removal, connection testing, model discovery, health, capabilities, budget/usage metadata, privacy classification, future-feature availability, and sanitized audits.
- AI credentials and secret headers use application-level AES-256-GCM authenticated encryption. Full prompts, full responses, raw provider errors, API keys, authorization headers, Plex tokens, and private library records are not persisted in AI audits.
- v2.4.0 adds foundation only: there is no AI playlist creation, regeneration, recipe execution, track add/remove/unlock, automation, web browsing, filesystem, shell, or tool-execution endpoint.

## v2.3.9 - Recipe Studio & Release Polish

- Added `/recipes/new` and `/recipes/:id/edit` as one responsive Recipe Studio with Guided, Beginner, and Advanced modes over the existing recipe schema.
- Added debounced and cancellable live candidate estimates, actionable compatibility analysis, scoring impact, discovery/variety previews, cached aggregate library profiles, and explicit estimate/stale/error states.
- Added accessible energy curve presets and control-point tables, expanded BPM flow controls, keyboard-native inputs, reduced-motion behavior, mobile collapse, and sticky mobile Validate/Save actions.
- Added unsaved-change detection, save progress, structured validation messaging, optimistic `expectedUpdatedAt` conflicts, recipe create/edit/archive audit events, and confirmed section copying from side-by-side comparison.
- Added recipe usage analytics, first-time onboarding, dedicated import routing, Recipe Library Studio links, and documentation covering safety, troubleshooting, migration, backup, keyboard, and mobile behavior.
- Added additive indexes for installed recipe lists, recipe playlist usage, and operational job aggregation in migration `20260721010000_recipe_studio_v239`.
- Reorganized Roadmap into Current, Next, Future, and collapsed Completed views while preserving historical data; added **Mixarr v2.4.x — AI-Assisted Mix Intelligence** as a roadmap-only next release line.
- Existing v2.3.x recipe documents, playlist associations, trust state, signatures, audit history, inheritance, snapshots, imports, and backups remain backward compatible and are not silently rewritten.

## v2.3.8 - Recipe Safety, Compatibility & Governance

- Added recipe schema v3 with explicit permission reasons, dependencies and safe fallbacks, semantic Mixarr-version compatibility, deprecation-aware migration output, deterministic canonical signing payloads, and Ed25519 public-key verification.
- Added server-derived local/trusted/official/untrusted/quarantined/signature-invalid/unknown/revoked trust, pending/approved/restricted/rejected/revoked approval, and signature result state persisted independently of enabled state.
- Added conservative configurable safety limits with absolute caps, explainable combined-risk analysis, impossible-candidate checks, forbidden delete/recreate and protected-target detection, and Suggest-Only defaults for external recipes.
- Extended staged import with a shared server-side governance plan, explicit high-risk consequences, stale-plan revalidation, transactional persistence, pre-import snapshots, immutable correlated audit events, and conflict-aware atomic restore.
- Added scoped governance, quarantine, signing-key, migration, audit, validation, approval, rejection, revalidation, safety-policy, snapshot-preview, and restore APIs plus recipe-list badges, visible import warnings, recipe governance details, and a quarantine workflow.
- Added execution-time approval, quarantine, permission, deletion, and protected-playlist enforcement; private signing keys and client-provided official/trust state are never accepted.
- Added additive migration `20260720180000_recipe_governance_v238`, governance/security tests, release documentation, and recipe-author guidance.

## v2.3.7 - Plex & Media Ecosystem Integrations

- Added prioritized multi-server Plex status, detailed authentication/identity/library/playlist/collection tests, user mapping, playlist ownership and permissions, collection import/export, external fingerprints, change classification, and manual reconciliation actions.
- Added scan-aware and mount-aware destructive synchronization gates, post-scan grace periods, recovery hysteresis, actionable Plex availability categories, and failover policy state with safe read-only defaults.
- Added privacy-minimized Tautulli playback signal ingestion, portable Discord recipe sharing, Notifiarr notifications, centralized versioned integration events, HMAC SHA-256 webhooks, retry tracking, delivery history, and retention cleanup.
- Added a fast expanded Homepage widget, flat Home Assistant status, authenticated low-cardinality Prometheus metrics, liveness/readiness/protected-details health endpoints, and a sanitized `/api/public/v1` dashboard API.
- Added hashed scoped API tokens shown once, expiry/revocation/use audit data, an administrator integration center, safe integration tests, ownership/reconciliation controls, responsive layouts, and an additive migration.
- Upgrade defaults are conservative: existing servers stay enabled; reconciliation requires manual review; failover and every new external integration remain disabled; webhook destinations and all new secrets require encryption and validation.

## v2.3.6 - Household Collaboration & Shared Playlists

- Added named, archivable households with stable Mixarr-user memberships, owner/member/child roles, reusable or expiring guests, configurable influence, eligibility, family restrictions, and temporary exclusions that retain preference history.
- Added opt-in household mode to Smart Builder with participant selection, six deterministic balance modes, configured-versus-effective influence preview, shared-favorite weighting, caps, anti-domination safeguards, party mode, family rules, voting, approval thresholds, and fairness controls.
- Extended Smart Mix generation with batched individual/shared preference loading, household compatibility scoring, consensus boosts, hard household dislikes, strict child content rules, conflict detection/resolution, artist/genre/member representation, contribution snapshots, and explanations.
- Added versioned playlist and track voting, approval-gated drafts that do not sync to Plex, administrator publication after approval, contribution breakdowns, preference conflicts, and a filterable privacy-safe activity log.
- Added household management and generated-playlist collaboration UI, authenticated APIs, an additive indexed migration, deterministic algorithm tests, and release documentation.
- Compatibility: all existing playlists remain Individual; no playlist, recipe, feedback, history, or Plex workflow is converted automatically.

## v2.3.5 - Community Recipe Sharing

- Added portable community recipe JSON, `.mixarr-recipe.zip` bundles, and checksum-protected `MXR1:` share codes.
- Added secure HTTPS URL, copy-and-paste, share-code, and upload import through one staged validation and approval pipeline.
- Added author, license, compatibility, changelog, tags, artwork, screenshots, source attribution, trust warnings, update conflicts, and local-modification detection.
- Added strict SSRF, redirect, archive, image, executable-content, credential, environment-variable, size, and path-traversal protections.
- Added decentralized sanitized reporting and optional read-only official GitHub repository browsing.
- Community recipes are data-only: Mixarr never executes recipe scripts, commands, plugins, hooks, or imported secrets.

## v2.3.4 - Curated Recipe Library

### Added

- A bundled, offline catalog of 28 versioned starter recipes covering Workout, Driving, Focus, Party, Relaxation, Sleep, Discovery, Deep Cuts, Recently Added, Forgotten Favorites, Decade Mixes, Seasonal Mixes, Genre Journeys, Artist Radio, Album Exploration, and Mood Progressions.
- A responsive `/recipes/library` browser with search, multi-category chips, difficulty, metadata, compatibility, favorites, hidden-recipe management, sorting, recently used recipes, loading and empty states, behavior previews, exact on-demand candidate counts, and accessible mobile details.
- One-click installation into the existing Mix Recipe model, safe duplicate prevention, source recipe/version tracking, customize-before-create handoff to the established editor, update status, explicit restore-original controls, and recipe-level version history.
- Deterministic compatibility estimates based on aggregate coverage of playback history, ratings, BPM, mood, energy, genres, artist/album metadata, date added, release year, popularity, and local analysis, with required/recommended distinctions and plain-language reasons.
- Normalized per-user favorite, hidden, last-used, source-version, and use-count persistence through the additive `20260720040000_curated_recipe_library_v234` migration.

### Compatibility, privacy, and performance

- Existing recipes, playlists, automation, inheritance, imports, and settings remain unchanged; built-in definitions are version-controlled application data and never overwrite an installed customization automatically.
- Card compatibility uses cached aggregate/count queries and never loads full track records. Exact primary-filter counts are lazy-loaded only for the opened recipe details view and reuse the current Smart Mix query builder.
- The complete catalog works without internet access, GitHub, external metadata requests, a marketplace, or a remote recipe service. Compatibility is an estimate, not a playlist guarantee.

## v2.3.3 - Preset Inheritance & Overrides

### Added

- Deterministic centralized recipe resolution across built-in/global defaults, categories, multi-level base recipes, transition/discovery/variety/automation presets, recipe/group/playlist/user overrides, and authoritative locks.
- Per-field provenance, suppressed-value and conflict explanations, stable fingerprints, cycle/depth protection, field and section resets, dependency/impact previews, versioned presets, and four inheritance-aware clone modes.
- Additive normalized persistence for presets, categories, overrides, group policies, user preferences, locks, effective snapshots, conflicts, and audit events; generated playlists now capture exact resolver snapshots for reproducible retries.
- Responsive Presets & Inheritance management and recipe-editor foundation/effective-configuration views with accessible state labels, mobile inheritance chains, lock details, conflict guidance, and reset controls.

### Compatibility and safety

- Existing recipes remain legacy-explicit after the non-destructive migration and retain equivalent generation behavior. Inheritance is opt-in, false/zero/empty values remain explicit, and preset changes never trigger automatic regeneration.
- Server-side resolution and validation remain authoritative. Base/preset deletion is dependency-checked, group precedence is explicit, and administrator/user permissions reuse Mixarr authentication.

## v2.3.2 - Adaptive Recipe Mapping

### Added

- Receiving-library analysis for staged recipe imports, including genres, moods, artists, BPM, energy, popularity, audio-feature coverage, sync state, total tracks, and reusable saved mappings.
- Exact, normalized, saved, conservative alias/related, one-to-many, relaxed, unavailable, unsupported, and no-mapping-required decisions with confidence, reasons, local counts, candidate impact, and manual review.
- Deterministic weighted compatibility scoring and breakdowns, original/adapted count-only candidate estimates through the existing Smart Mix query builder, library coverage, candidate-pool health, warnings, and relaxation recommendations.
- Responsive Recipe Compatibility & Mapping UI with original/adapted comparison, searchable local vocabulary controls, debounced/cancellable recalculation, accept/reset actions, import-original choice, and explicit high-impact confirmation.
- Owner- and library-scoped analysis, mapping-decision, and saved-rule persistence; a mapping management page; later review from recipe details; and additive indexed migration `20260719230000_adaptive_recipe_mapping_v232`.

### Compatibility and safety

- The original imported recipe is preserved beside the adapted local definition. Existing v2.3.0/v2.3.1 recipes remain supported, imported automation remains disabled, and import never creates or modifies a Plex playlist.
- Candidate estimates use the same rule-to-Prisma query builder as playlist generation, grouped one-to-many OR rules remain grouped, manual/effective BPM sources retain existing precedence, and count queries do not load full track records.
- Major recipe-identity changes and low-compatibility original imports require explicit confirmation. Missing energy, BPM, or mood values are never fabricated.

## v2.3.1 - Recipe Import & Export

### Added

- Versioned `mixarr-recipe` and `mixarr-recipe-bundle` envelopes with explicit portable-field allowlists, deterministic canonical JSON, per-recipe SHA-256 checksums, and bundle-level integrity validation.
- Expiring, owner-scoped staged imports with checksum validation, sensitive-data scanning, schema migration, compatibility/adaptation analysis, duplicate-content and naming conflict detection, and server-side revalidation at confirmation.
- Rename, replace, skip, and use-existing conflict actions; administrator-only replacement; atomic and independent bundle transactions; recipe revision preservation; and no automatic playlist or automation creation.
- Optional `.mixarr-recipe.zip` and `.mixarr-bundle.zip` archives with controlled artwork files, path/symlink/executable/nested-archive defenses, compressed/expanded/file-count limits, content-based PNG/JPEG/WebP validation, and dimension/size limits.
- Persistent import/export audit history, sanitized support diagnostics, clear-history authorization, structured privacy-safe logs, and short-lived upload disposal.
- Responsive Recipe Library selection and bulk export, drag-and-drop six-step import wizard, human-readable recipe summaries, compatibility/security badges, per-recipe resolutions, progress/results state, and transfer history.
- Additive `20260719190000_recipe_import_export_v231` migration, security/unit/regression coverage, transfer format documentation, release notes, and Roadmap updates.

### Security and compatibility

- Valid exports cannot contain credentials, Plex server/library/media identifiers, database or installation IDs, local paths, hostnames, listening/playback history, learned preferences, likes/dislikes/rejections, generated playlist membership, or notification destinations.
- Existing v2.3.0 recipes remain valid. Older checksum-less canonical files use an explicit warning path; unsupported or corrupted integrity data is blocked.
- Exporting never changes recipe configuration. Importing never creates a generated playlist and never activates imported automation.

## v2.3.0 - Mix Recipe Foundation

### Added

- First-class Smart Mix recipes with metadata, artwork, independent ownership, enabled state, source traceability, and indexed generated-playlist relationships.
- Canonical `mixarr-recipe` schema v1 covering scoring, mood and energy, BPM flow, discovery, variety, playlist identity defaults, refresh, automation, and generation settings.
- Recipe revision tracking, centralized validation, schema migration infrastructure, create-from-playlist conversion, create-playlist-from-recipe generation, duplication, rename, soft deletion, and canonical export/import.
- Immutable resolved recipe snapshots and playlist-only override snapshots on generated playlists and regeneration records.
- Responsive Recipe Library, sectioned editor, validation UI, generated-playlist listing, and explicit automation confirmation.

### Compatibility

- Existing playlists and Smart Mix workflows do not require recipes.
- Recipes never contain track membership or personal feedback/history.
- Deleting a recipe retains every generated playlist and its historical snapshot.

## v2.2.9 - Orchestration Dashboard & Release Polish

- Added the unified Playlist Ecosystem dashboard with real health, group, overlap, coverage, Smart Action, experiment, job, activity, trend, and warning data.
- Added a bounded relationship graph, accessible relationship table, configurable overlap heatmap, group health overview, coverage segment drill-down, and mobile alternatives.
- Added independently loaded orchestration summary APIs, cached nightly ecosystem snapshots, persisted dashboard ranges, and bounded/paginated detailed payloads for large libraries.
- Added upcoming-job actions, retention-aware administrator queue cleanup, stale-job recovery, and audit filtering while preserving explanatory audit records.
- Added resumable onboarding/configuration review and explicit playlist enrollment that keeps automation disabled until separately enabled.
- Added versioned allowlisted JSON export, validated conflict preview, confirmed merge/replace import, missing-reference handling, transactions, and import auditing without importing secrets.
- Added backup-manifest validation, restore-readiness evidence, v2.2.x migration/index/link checks, and actionable non-blocking warnings.
- Added the additive `20260719010000_orchestration_dashboard_v229` migration, query indexes, tests, documentation, release notes, and final v2.2.x Roadmap updates.

## v2.2.8 - Playlist Health Monitoring & Alerts

- Added continuous playlist health scores across Plex linkage, missing and unavailable tracks, identity, repetition, artist and album variety, metadata confidence, BPM and mood transitions, staleness, and automation failures.
- Added severity-aware persistent alerts with acknowledgment, resolution, automatic recovery, reopening, occurrence counts, and audit history.
- Added in-app alerts plus encrypted Discord and generic webhook delivery with minimum-severity controls and delivery history.
- Added the Playlist Health workspace, dashboard health card, settings, navigation, nightly monitoring, authenticated APIs, additive persistence, tests, documentation, and v2.2.8 metadata.

## v2.2.7 - Smart Action Center

- Added a persistent, typed Smart Action framework and centralized review queue for playlist, library, and metadata recommendations.
- Added confidence, risk, explanations, previews, expected impact, approval, rejection, snooze, bulk safeguards, conflict detection, immediate execution, and maintenance scheduling.
- Added server-side revalidation, protected-track enforcement, playlist-version snapshots, restore links, audit history, structured failures, ownership checks, and automation policies disabled by default.
- Added Recently Added, metadata-conflict, and Smart Refresh providers with deduplication, superseding, expiry, progress-aware Job History, dashboard, navigation, settings, responsive UI, APIs, additive migration, and tests.

## v2.2.6 - Smart Experiments & Playlist A/B Testing

- Added protected Smart Mix v2 experiment drafts with pinned original playlist-version snapshots, controlled Version A and B settings, stable configuration history, and no Plex mutation during setup or generation.
- Added discovery, personalized-versus-base, scoring, BPM flow, mood blend, artist variety, and custom comparisons with controlled-variable validation, visible differences, constant settings, shared candidate/library/metadata references, random seeds, fallbacks, missing metadata, personalization influence, and overlap.
- Added optional separate Plex playlists and explicitly experimental alternating-active publication with independent stored Plex identifiers and idempotent retry behavior; the original is never replaced by publishing variants.
- Added independent variant feedback, acceptance/rejection metrics that exclude passive inactivity, bounded playback aggregation for unique tracks, generation-quality scores, metric definitions, and explainable confidence-limited suggested winners.
- Added explicit Version A or B application, continue/no-winner/inconclusive outcomes, merged-configuration generation previews and application, and snapshot-based original restoration with retained experiment history.
- Added the responsive `/experiments` dashboard, protected setup wizard, detail page, track comparison and feedback, timeline, decision controls, Smart Experiment settings, navigation, and Generated Playlists entry points.
- Added the additive `20260718190000_smart_experiments_v226` migration, ownership-checked APIs, Job History integration, bounded writes and playback reads, unit tests, documentation, roadmap completion, and v2.2.6 metadata.

## v2.2.5 - Library Coverage & Rotation Intelligence

- Added a responsive Library Coverage dashboard with all-time, active, 30-day, 90-day, and 12-month coverage; quality-weighted rotation fairness; used-versus-unused, trend, genre, mood, decade, and recently-added views.
- Added paginated intelligence for never-selected and overused tracks, high-confidence neglected opportunities, unused and partially used artists and albums, and nested library segments with filter-preserving drill-down and CSV/JSON export.
- Added explainable opportunity and overuse scoring that respects analysis, confidence, feedback, missing Plex items, duplicate suppression, live-track rules, playlist compatibility, recent rejection history, likes, locks, and intentionally preferred tracks.
- Added resumable, cancellable, duplicate-protected background calculation jobs with 400-track batches, progress stages, persistent cached track statistics, deduplicated snapshots, retention cleanup, structured summary logging, and no startup backfill.
- Added a guided neglected-mix workflow with conservative Safe Discovery, Balanced, Deep Library, Recently Added, and Underused High Quality presets; every draft remains preview-only until handed to Smart Builder.
- Added conservative Library Coverage settings, reset-calculated-statistics support that preserves playlist history and personalization, and optional quality-gated coverage-aware Smart Mix scoring that is disabled for existing installations.
- Extended Smart Mix explanations with bounded neglect bonuses and overuse penalties while preserving eligibility, feedback, identity, personalization, BPM/mood flow, transition, diversity, and existing repeat controls.
- Added authenticated summary, tracks, artists, albums, segments, genres, moods, decades, recently-added, overuse, opportunities, history, jobs, settings, export, recalculation, cancellation, and build-mix APIs.
- Added the additive `20260718150000_library_coverage_rotation_intelligence` migration, scoring and fairness tests, release metadata, roadmap updates, upgrade notes, and operator documentation.

## v2.2.4 - Smart Refresh Scheduling

- Added per-playlist Manual Only, Fixed Schedule, Smart Refresh, Smart Refresh with Fallback, and Disabled modes with conservative migration defaults.
- Added explainable evaluation of existing Smart Mix quality, weak tracks, compatible new tracks, playback repetition, identity drift, relevant metadata improvements, unavailable tracks, and major library changes.
- Added bounded candidate previews, predicted score improvement, confidence, identity-damage rejection, minimum-improvement gating, and least-disruptive action selection.
- Added Low, Balanced, High, and bounded Custom sensitivity; cooldowns; successful-refresh weekly limits; evaluation frequency; fallback age; and global/per-playlist time-zone quiet hours.
- Added manual Check for improvements, exact preview, explicit apply/dismiss, responsive settings, dashboard summaries, Job History audit, stale-safe execution, and automatic restorable version snapshots.
- Integrated bounded Smart Refresh evaluation as the final background pipeline stage after audio analysis, with major-sync targeting, batching, duplicate suppression, active-job safeguards, and no parallel generation engine.
- Added the additive `20260718030000_smart_refresh_scheduling` migration, authenticated APIs, documentation, and deterministic evaluation/scheduling tests.

## v2.2.3 - Playlist Roles & Progression Chains

- Added optional built-in and custom playlist roles with label-only, suggest, and apply-guidance behavior. Existing playlists receive no automatic role.
- Expanded existing progression chains in place with descriptions, lifecycle status, explicit member roles, handoff records, shared transitions, settings, analysis snapshots, master playlist links, and restoreable versions.
- Added real opening/ending boundary analysis for energy, BPM, half/double-time compatibility, mood tags and intensity, metadata confidence, warnings, and explainable category/overall scores.
- Added a responsive Playlist Chains workspace with drag, keyboard/touch ordering, charts, track previews, configurable handoffs, background analysis progress, optimization review, history, onboarding, and destructive confirmations.
- Added selected boundary optimization and shared bridge application with locked-track protection, stale-preview validation, pre-change snapshots, and incremental re-analysis.
- Added Mixarr-private and Plex-synced master journey playlists without replacing or modifying source playlists.
- Added authenticated, ownership-checked role, chain, member, handoff, analysis, optimization, master, settings, and version APIs with structured errors and paginated lists.
- Added an additive migration with idempotent role seeding, batched metadata reads, indexes, cancellable Job History integration, tests, API/migration documentation, and release metadata.
- Safety defaults: role behavior is Suggest, automatic repair and automatic Plex synchronization remain disabled, and ordinary playlist generation changes only when Apply role guidance is selected explicitly.

## v2.2.2 - Cross-Playlist Deduplication & Variety

- Added canonical track overlap, both-playlist percentages, smaller-playlist enforcement, Jaccard similarity, unique-track targets, artist concentration, album concentration, compilation handling, actionable severity warnings, and retained overlap trends.
- Added user defaults, per-playlist overrides, canonical pair policies, track/count allowances, allowed artists and albums, report-only playlists, core tracks, sharing designations, playlist/group/time-limited exclusivity, and clear inheritance labels.
- Integrated bounded current-use, recent-use, unused-track, artist, album, core, allowance, and exclusivity signals into Smart Mix v2 without bypassing identity, feedback, metadata, mood, energy, BPM, transition, or score-quality rules.
- Added an accessible paginated heatmap, mobile ranked comparisons, detailed shared/unique track views, policy details, stale-analysis indicators, background progress, cancellation, retry, and actionable repair entry points.
- Added deterministic selectable repair previews, protected-track priorities, explicit reasons and impacts, graceful insufficient-pool behavior, revision/content-hash stale checks, transactional apply, Plex rollback, repair history, and restorable pre-repair versions.
- Added bounded background pair processing, checkpoints, changed-result snapshots with retention, cached page reads, additive indexed data models, authenticated APIs, export/reset support, documentation, tests, and release metadata.
- Automatic repair remains disabled and preview remains enabled by default. Migration and startup do not analyze or rewrite Plex playlists.

## v2.2.1 - Playlist Groups & Collections

- Added user-owned collections with artwork, descriptions, multiple playlist memberships, group-local ordering, pause/resume, cloning, and safe deletion that never deletes playlists.
- Added versioned group defaults, explicit inheritance, playlist override precedence, a single primary settings group, source metadata, and conflict warnings while preserving every existing playlist setting.
- Integrated group discovery, deep-cut, artist and album limits, recency, live-track, recommendation, personalization, and exclusion controls into regeneration previews.
- Added bounded parent/child group regeneration jobs with progress, cancellation, failure isolation, existing playlist version snapshots, and activity history.
- Added explainable group health, responsive browser/detail management, search, filters, sorting, accessible ordering controls, navigation, per-playlist collection access, and a concise dashboard summary.
- Added authenticated user-isolated APIs, indexed additive schema, safe migration, tests, documentation, release metadata, and backwards-compatible empty defaults.

## v2.2.0 - Playlist Orchestration Foundation

- Added an opt-in managed playlist registry that distinguishes existing Plex playlists, generated playlists, managed playlists, automation configuration, runtime state, availability, and historical unregister state.
- Added validated `DEPENDS_ON`, `RUNS_AFTER`, and `RELATED` relationships with ownership/library checks, duplicate prevention, deterministic dependency ordering, full cycle reporting, and immutable job dependency snapshots.
- Added a shared persistent orchestration queue with strongly typed jobs, triggers, statuses, priority aging, scheduled eligibility, idempotency keys, duplicate audit decisions, cancellation, safe retry, and paginated history.
- Added database-backed playlist, Plex playlist, identity, library-write, global, user, and library locks with owners, heartbeats, leases, expiry, idempotent release, multi-process conflict handling, and conservative concurrency defaults.
- Added startup stale-job recovery that only requeues planning-only read/simulation work and sends possibly partial playlist writes to manual review.
- Added global and per-playlist automation controls, explicit state transitions and reasons, dry-run safeguards, structured audit events, startup schema health warnings, and a dedicated orchestration worker integrated with existing startup reliability.
- Added authenticated, user-isolated orchestration APIs, admin-only global settings, a responsive `/orchestration` workspace, dependency list, queue and audit controls, navigation, one compact dashboard card, and settings UI.
- Added the additive `20260717020000_playlist_orchestration_foundation` migration. Global orchestration, automatic registration, automatic automation enablement, and scheduled orchestration default to off; existing playlists are not silently registered.
- Added orchestration unit and safety coverage, v2.2.0 release/upgrade/rollback/API documentation, roadmap updates, and version metadata.

## v2.1.11 - Dashboard UI Cleanup

- Reorganized the dashboard around Library Readiness, Quick Actions, Activity & Automation, Playlist Management, Product & Preview, and Plex Servers.
- Removed the duplicate Recently Added Discovery registration and its duplicate summary request by using one canonical, stable widget definition.
- Combined Plex sync and enrichment coverage into one compact readiness panel with explicit states, progress indicators, preserved diagnostics, and on-demand detailed controls.
- Consolidated recent jobs and automation status, prioritized active work, and reduced repeated playlist-launch actions while retaining every existing destination.
- Moved version, roadmap, release, support, experimental, and preview information into one collapsed low-priority panel; the full Roadmap remains available on its dedicated page.
- Added resilient per-widget empty and error states, compact Plex server summaries, responsive single/two/four-column layouts, accessibility improvements, registry validation, and dashboard regression tests.

## v2.1.10 - Personalization Dashboard & Release Polish

- Added the dedicated `/personalization` control center with real user-scoped aggregates, learned-preference evidence, influential feedback, paginated suggestion decisions, playlist identities, behavioral trends, playback status, score influence, readiness checks, and accessible responsive states.
- Added a bounded dashboard service and authenticated APIs for summary, suggestions, identity browsing, health, cleanup, onboarding, versioned JSON export, validation, transactional import, and selective reset.
- Added merge, replace, identities-only, preferences-only, and feedback-only imports. Replace imports create a 30-day backup before changing data; missing tracks and playlists are reported without crossing user boundaries.
- Added reset previews, typed confirmation for full deletion, non-content audit entries, and low-value cleanup previews that preserve direct feedback, never-recommend rules, identities, manual preferences, Plex content, and unrelated settings.
- Added first-use onboarding, clear configured-environment privacy language, export secret exclusions, playback freshness checks, aggregate cache controls, database indexes, tests, documentation, and the additive `20260717010000_personalization_dashboard_v2110` migration.
- Marked v2.1.x Adaptive Personalization complete, introduced the proposed non-AI-dependent v2.2.x automation and playlist lifecycle direction, and documented later optional AI exploration with explicit consent and failure-isolation safeguards.

## v2.1.9 - Adaptive Automation Policies

- Added centralized, fail-safe policy evaluation for all Recently Added and scheduled-regeneration Plex writes.
- Added Disabled, Suggest Only, Require Approval, and Fully Automatic modes with Conservative, Balanced, Aggressive, and Custom presets.
- Added addition/removal limits, confidence thresholds, daily and weekly usage boundaries, timezone-aware quiet hours, playlist/track protection, and an emergency pause.
- Added stale-safe approvals, durable activity explanations, recoverable pre-write versions, and idempotent rollback through Playlist Version History.
- Added a responsive policy workspace, dashboard health summary, playlist protection tools, approval queue, and activity/rollback views.
- Added the additive `20260716130000_adaptive_automation_policies` migration with conservative legacy mapping and automatic removals disabled.

## v2.1.8 - Smart Mix Explanations & Insights

- Added immutable Smart Mix v2 decision traces sourced from actual scoring, filtering, fallback, transition, personalization, identity, and selection-margin values.
- Added selected and rejected explanations, deterministic recommendation confidence, score-layer separation, stable factor/reason codes, suggested fixes, and candidate comparisons.
- Added responsive explanation drawers, generation insights and filters, historical version explanations, detail preferences, privacy controls, and safe JSON debug export.
- Added authenticated paginated APIs, selected-track permanence, configurable rejected-trace caps and expiry, aggregate retention, indexed storage, cleanup controls, and trace-time instrumentation.
- Added the non-destructive `20260716120000_smart_mix_explanations` migration, tests, documentation, release notes, and completed Roadmap entry.

## v2.1.7 - Playlist Relationships & Coordination

- Added persisted playlist relationships, coordination settings, shared-core tracks, progression chains, and cached overlap summaries.
- Added canonical duplicate-aware track, artist, album, Jaccard, and enforced smaller-playlist overlap calculations.
- Added separate capped coordination scoring with hard/soft/warning modes, unused-track preference, selected-playlist exclusions, and group artist balancing.
- Added the Playlist Coordination dashboard, Smart Builder coordination controls, authenticated APIs, previewed track moves, and rebalance previews.
- Existing playlists remain unchanged and coordination-disabled until explicitly enabled.

## v2.1.6 - Contextual Mixes

- Added seven built-in contexts for focus, energy, driving, discovery, acoustic listening, summer parties, and winter relaxation.
- Added persistent user-isolated custom contexts with clone, edit, enable/disable, duplicate, and delete workflows.
- Added visible context application summaries, apply-only-unset behavior, manual override markers, individual restoration, and reset-to-context-default actions.
- Integrated a confidence-aware, capped contextual adjustment into Smart Mix Engine v2 while preserving identity, personalization, feedback, exclusions, and protected tracks.
- Added context-aware playlist previews and real per-track explanations with missing-metadata confidence.
- Stored versioned context snapshots, influence, overrides, and resolved settings in generated playlists and history.
- Added optional local-time/day suggestions without location tracking or inferred activities.
- Added the additive `20260716040000_contextual_mixes` PostgreSQL migration, APIs, responsive UI, tests, documentation, release notes, and Roadmap update.

## v2.1.5 - Listening History & Playback Awareness

- Added incremental, paginated Plex playback-history import with idempotent events, safe retry state, bounded matching, retention, and dedicated Job History records.
- Added explicit per-server Plex user mapping and user-isolated playback profiles.
- Added conservative completion, replay, recent-play, skip, forgotten-favorite, discovery, and confidence calculations.
- Integrated playback as a separately capped and explained layer after existing Smart Mix and adaptive scoring.
- Added soft and strict recent-play controls with locked, important, and selected-track protection.
- Added the responsive playback settings/dashboard, sync and rebuild actions, privacy controls, paginated profile categories, and unmatched-event administration.
- Added the non-destructive `20260716030000_playback_awareness` PostgreSQL migration, tests, upgrade documentation, and Roadmap update.

## v2.1.4 - Adaptive Smart Mix Scoring

- Added a dedicated adaptive scoring service layered on top of the unchanged Smart Mix Engine v2 base score.
- Added separate personal preference, playlist identity, historical acceptance, historical rejection, artist, mood, discovery, and repeat components with plain-language reasons and source/scope labels.
- Added evidence-based confidence bands and multipliers so one inferred interaction remains low influence while repeated consistent or explicit feedback receives greater trust.
- Added Off, Light, Balanced, Strong, and Maximum presets plus a 0–100% maximum-influence control, per-playlist override storage, component toggles, confidence thresholds, and directional limits.
- Added visible base-versus-personalized score comparisons and expandable scoring explanations in playlist previews and regeneration previews.
- Added aggregated user/playlist preference statistics, bounded 20,000-event recalculation, 500-row database batches, dirty-state tracking, Job History summaries, reset previews, and scoped reset APIs.
- Added adaptive scoring version and settings snapshots on managed playlists plus optional per-track explanation snapshots.
- Added authenticated settings, statistics, explanation, recalculation, and reset APIs with user isolation.
- Added the additive `20260716020000_adaptive_smart_mix_scoring` migration without changing existing personalization, feedback, playlist identity, history, or version records.

## v2.1.3 - Playlist Identity & Memory

- Added stable playlist identities independent of playlist names, with durable Mixarr and Plex linkage.
- Added normalized learned/manual/effective attributes, field locks, playlist track memory, idempotent membership history, artist and genre weights, training runs, and snapshots.
- Learned mood, energy, BPM, discovery, metadata coverage, artist, genre, and historical character from current and versioned playlist membership without requiring complete metadata.
- Added playlist-specific rejection strength, permanent never-use memory, important/anchor/locked tracks, and explicit feedback integration.
- Integrated playlist identity as a separate Smart Mix v2 scoring component and added identity reasons and impact summaries to advanced regeneration previews.
- Added the responsive Playlist Identity panel and editor with retrain, reset, clone, confidence, visual distributions, selectable moods, effective-value previews, and track-memory controls.
- Added lazy legacy initialization, batched historical processing, safe fallbacks, local privacy documentation, Job History summaries, and the additive `20260716010000_playlist_identity_memory` migration.

## v2.1.2 - Likes, Dislikes & Track Feedback

- Added user-specific liked, disliked, and never-recommend track states plus preferred and recommend-less artist states.
- Added playlist/profile-scoped fit feedback and pairwise poor-transition reports with optional stable reason enums and contextual metadata.
- Added append-only feedback events, indexed effective-state tables, authenticated mutation/read/bulk APIs, chunked large selections, and partial-failure reporting.
- Integrated explicit feedback as explainable Smart Mix v2 scoring components while preserving global scoring, hard rules, variety limits, and the personalization toggle.
- Applied never-recommend as a hard exclusion in generation, regeneration, and Recently Added recommendation paths without modifying existing playlists.
- Added compact feedback menus to playlist previews, regeneration previews, and the library, plus optional removal reasons, undo, bulk actions, and feedback management.
- Expanded user-specific reset and privacy controls to cover all explicit feedback data.
- Added the non-destructive `20260715090000_track_feedback_v212` PostgreSQL migration with indexed user/track, user/artist, playlist/profile, pairwise transition, and event-history lookups.

## v2.1.1-hotfix - Nightly Audio Features & Logging Cleanup

- Fixed newly discovered tracks not receiving Audio Features during the same nightly synchronization run.
- Moved Audio Features and BPM processing to the final nightly stage and kept the parent job active until analysis finishes.
- Unified manual, recovered, and scheduled Audio Features execution around fresh settings and shared provider resolution.
- Added local Essentia fallback when a preferred API is unavailable, without treating API preference as disabling local analysis.
- Distinguished disabled, no-eligible-track, provider-misconfiguration, processing-failure, and successful processing outcomes.
- Added guarded batch draining, stage-level Job History metadata, and concise progress reporting for long local analysis runs.
- Reduced repetitive sanitizer, Plex duplicate/conflict, popularity, track-tag, Library Health, and routine worker-lock logging while retaining per-item debug diagnostics.

## v2.1.1 - Duplicate Preservation & Plex Conflict Inspector

- Made Plex server, library, and rating key the authoritative physical track-instance identity; Plex GUIDs, file paths, and metadata now provide duplicate evidence without claiming or suppressing another item.
- Preserved every valid Plex item as a separate active `Track` row and replaced conflict skip paths with separate-instance creation, confidence grouping, or durable review state.
- Added canonical recording groups, match evidence, preferred enrichment sources, split/merge controls, review status, and indexed non-destructive membership.
- Added BPM, mood, and energy inheritance with manual correction, verified local, high-confidence API, inherited, and fallback precedence plus source-track/provider/confidence provenance.
- Added the default-enabled “Automatically share enrichment across confirmed duplicates” setting while retaining track-level overrides and instance-specific Plex, file, play, playlist, and interaction fields.
- Added a calculated, idempotent Repair Unresolved Plex Tracks preview and repair action that uses the existing per-library sync lock and persists missing rating-key instances without resetting or deleting data.
- Added a searchable, filterable, paginated Plex Conflict Inspector with candidate records, evidence, status, row actions, and bounded bulk actions.
- Made non-zero Library Health values interactive and added missing album, artist, track, duplicate-group, and track-copy detail views.
- Updated playlist duplicate handling to avoid canonical recording repeats by default, allow alternates, prefer quality, or prefer an existing playlist copy without hiding tracks from the library.
- Replaced ambiguous conflict/skip summaries with active-instance, new-instance, grouped-duplicate, inherited-data, needs-review, and persistence-failure counts and credential-safe structured logs.
- Added safe v2.1.1 migrations and high-confidence backfill while preserving all existing IDs, corrections, analysis, history, personalization, and playlists.

## v2.1.0 - Personalization Foundation

- Added opt-in user recommendation profiles, optional playlist profiles, append-oriented interaction history, compact derived adjustments, and safe user-owned reset behavior.
- Added a dedicated personalization scoring layer with structured explanations, confidence gating, playlist/user de-duplication, and a conservative eight-point maximum adjustment.
- Added independent personalization and learning toggles, profile summaries, preference/avoidance cards, recent signals, playlist profiles, privacy copy, and mobile-safe controls.
- Connected reliable lock, accepted regeneration replacement, and playlist restore actions to non-blocking local event collection.
- Added user-scoped profile, history, rebuild, reset, and playlist-preference APIs with typed validation and pagination.
- Marked v2.0.x complete and v2.1.x current in a typed, centralized product roadmap source.
- Personalization data remains local; no external behavioral analytics or profile synchronization was added.
- Fixed repeated missing-track restoration during Plex sync with conditional persisted-state transitions, post-commit active totals, verified cache invalidation, and non-destructive conflict handling.

## v2.0.10 - Beta Feature Polish & Advanced Flags

- Replaced scattered beta checks with a shared feature registry and authoritative server resolver covering server ceilings, access tiers, administrator restrictions, user opt-in, per-feature preferences, runtime overrides, and emergency kill switches.
- Added Stable, Public Beta, Private Beta, and Developer access levels with persistent administrator-managed grants, expiration support, preserved configuration after revocation, and first-user admin bootstrapping for existing self-hosted installations.
- Added Stable v2 and a real Experimental Balanced scoring model, safe model resolution/fallback, comparison previews that never auto-save, and scoring/beta metadata in generated playlists and version history.
- Added beta administration, consistent risk labels and warnings, acknowledgement-based opt-in, stable reset controls, configurable Sponsors messaging, safe feedback/Discord links, sanitized feedback reports, and local beta usage summaries.
- Protected experimental Recently Added auto-add and scheduled regeneration at execution time, storing required flags/access/model with runs and skipping permanently unavailable work before playlist mutation.
- Added database models for feature overrides, per-user preferences/access, usage, and feedback reports while preserving the v1.5.x `betaFeatureSettings` JSON and disabled-by-default behavior.

## v2.0.9 - Recently Added Automation

- Added disabled-by-default Recently Added Automation with independent, persistent feature toggles and preview-first automatic changes.
- Added idempotent Plex new-track detection, first-seen and batch state, explainable New Music Scores, confidence bands, quarantine rules, manual override, ignore controls, and chunked processing.
- Added Smart Mix v2 playlist compatibility matching with reasons, suggested sections, expected score impact, global thresholds, and playlist-level Off, Suggestions Only, and Automatic Strong Matches overrides.
- Added pending change sets, manual approval, conservative per-playlist/run limits, duplicate and variety protection, and mandatory restorable playlist versions around automatic additions.
- Added optional recently added mixes, per-user schedules, deduplicated in-app notifications, structured automation history, progress phases, and overlapping-run locks.
- Added a responsive dashboard discovery card and full review/configuration workspace while keeping every manual tool available when automation is disabled.

## v2.0.8 - Manual BPM & Metadata Corrections

- Added durable, separately stored BPM, mood, and energy corrections with optional reasons, verified state, actor attribution, and append-only history.
- Added one centralized, query-free effective metadata resolver with manual, verified source, provider/local, embedded/imported, fallback, and missing precedence.
- Added field-specific verification and source ignore/restore controls without deleting raw enrichment or local-analysis data.
- Integrated effective metadata into Smart Mix v2 scoring, BPM transitions, mood blending, energy curves, regeneration, explanations, and immutable playlist-version snapshots.
- Added library metadata badges and server-side filters plus transactional bulk correction previews with shared batch IDs.
- Added responsive track correction controls, source comparisons, BPM half/double-time suggestions, correction removal, and history browsing.

## v2.0.7 - Playlist Version History & Restore

- Added complete, schema-versioned playlist state snapshots with ordered tracks, track state, display metadata, generation settings, engine/app versions, scores, duration, and secret redaction.
- Added a playlist version timeline, detailed historical track view, pinning, labels, named manual restore points, lightweight pagination, storage estimates, and protected retention cleanup.
- Added deterministic comparison between current or arbitrary versions, including added, removed, moved, state-changed, and possible replacement tracks plus settings and score changes.
- Added preview-first restoration with ownership checks, stale-preview protection, unavailable-track warnings, automatic safety versions, current score recalculation, new restore revisions, and Plex synchronization status.
- Integrated initial generation, full regeneration, advanced regeneration, and undo with the existing `PlaylistRevision` model while preserving and migrating v2.0.6 revisions in memory.
- Added conservative user settings. History defaults on, the retention target is 25, manual and score snapshots default on, and destructive automatic cleanup defaults off.

## v2.0.6 - Advanced Playlist Regeneration

- Added targeted replacement for weak, low-scoring, selected, intro, middle, ending, and custom-range tracks.
- Added per-track locks, bulk lock actions, liked-track preservation, and lock-aware warnings.
- Added position-aware candidate scoring against both neighbors while preserving saved mood, BPM, energy, discovery, duration, order, and variety intent.
- Added a required preview with individual accept/reject controls, before/after scoring details, and meaningful-improvement thresholds.
- Added transactional regeneration records, playlist revisions, stale-preview protection, detailed history, and server-side undo.
- Added responsive and keyboard-accessible advanced regeneration controls for Smart Mix Engine v2 beta playlists.
- Kept the original track when no candidate is a meaningful improvement and limited candidate pools for large Plex libraries.

## v2.0.5 - Deep Cut & Discovery Controls

- Added Mostly Familiar, Balanced Discovery, and Deep Discovery profiles plus editable advanced controls.
- Added soft deep-cut targets, relative overplay penalties, hidden-gem boosts, popular-track limits, and underplayed Plex track weighting.
- Added efficient Mixarr playlist-history lookbacks and recent-use penalties without large database `IN` queries.
- Added discovery previews, result labels, track-level reasons, target-match scoring, warnings, and generation diagnostics.
- Added backward-compatible migration from Familiar vs Discovery and persisted effective configuration/results on generated playlists.
- Preserved hard rules, missing-metadata fallbacks, and Smart Mix v1 behavior.

## v2.0.3 - Mood Blending

- Added Smart Mix v2 mood blend modes for Smooth Transition, Strict Matching, and Mixed Mood playlists.
- Added mood path and allowed-mood controls in Builder and Smart Builder.
- Improved mood-aware ordering so smooth paths can move through zones like Happy -> Energetic -> Party.
- Added scoring support for multi-mood bridge tracks, compatible mixed moods, conflicting mood penalties, and missing mood-tag fallbacks.
- Added mood warnings and mood curve preview data to playlist previews and regeneration previews.
- Extended Smart Mix v2 diagnostics with mood blend mode, selected mood path, allowed moods, coverage, fallback counts, conflict counts, bridge tracks, and missing mood counts.

## v2.0.2 - Recommendation Tuning

- Added Smart Mix v2 recommendation tuning with built-in Balanced, More Familiar, More Discovery, High-Energy, Chill, DJ-Friendly, and Deep Cuts presets.
- Added user-facing tuning controls for recommendation strength, familiar/discovery balance, popularity, mood, energy, BPM, artist variety, album variety, and recently used tracks.
- Added saved custom tuning presets with basic create, select, and delete support.
- Applied tuning to v2 candidate scoring, transition ordering, artist/album variety, recent-use fallback, and preview warnings.
- Stored the tuning preset and config snapshot used for generated playlists.
- Added generated playlist display for the tuning preset and key tuning values.

## v2.0.1 - Playlist Scoring

- Added playlist quality scoring for Smart Mix v2 generated playlists.
- Added BPM flow, energy curve, mood consistency, discovery balance, and weak-spot scoring.
- Added quality score storage and display for generated playlists and regeneration previews.
- Added warnings for missing metadata and transition weak spots.

## v2.0.0 - Smart Mix Engine v2 Foundation

- Added a separate Smart Mix Engine v2 foundation with an ordered generation pipeline.
- Added v1/v2 engine version tracking for generated playlists and playlist history.
- Added v2 metadata fallback handling for missing BPM, mood, energy, and popularity.
- Added internal v2 score and score breakdown fields for generated preview tracks.
- Added Smart Mix Engine v1 Legacy and v2 Foundation labels in preview, generated playlists, and history UI.
- Preserved the existing v1 playlist builder path as the standard legacy generation behavior.

## v1.5.1 - Job History Cleanup

- Added a Clear History action to the Job History page.
- Added confirmation before clearing old job records.
- Finished jobs can now be removed from history.
- Active, running, queued, or pending jobs are preserved.
- Added backend support for safely clearing terminal job records.
- Added success and error feedback for cleanup actions.

## v1.5.0 - Beta Feature Flags & Experimental Access

- Added new Beta & Experimental Features settings section.
- Added master experimental feature toggle.
- Added groundwork for individual beta feature flags.
- Added clear beta, preview, and unstable UI labels.
- Added private beta warning text.
- Added GitHub Sponsors beta access messaging.
- Added optional beta-only preview cards for future v2.0.0 features.
- Added safe defaults so experimental features are disabled by default.
- Added backend support for reading and saving beta feature settings.
- Added guardrails so stable users are not affected by beta features.

## v1.3.9.2 - External API Settings UI

- Rebuilt the External APIs settings section into configurable provider cards.
- Added web UI configuration for API provider toggles and supported enrichment types.
- Added encrypted storage for API keys and secrets saved through the UI.
- Kept .env fallback support while allowing UI-saved credentials to take effect without container restarts.
- Added safer provider testing, masked credentials, and support diagnostics redaction.
- Improved local-first behavior when API providers are disabled.

## v1.3.9.1 - App Readiness Database Check Fix

- Fixed a false App Readiness database error on the Settings page.
- Improved database readiness checks so optional or stale table checks do not show as critical errors.
- Added clearer database readiness statuses for OK, warning, and error states.
- Improved readiness diagnostics without exposing database credentials or secrets.

## v1.3.9 - v2.0.0 Readiness & Beta Hardening

- Added app readiness checks for database, Plex, worker, scheduler, support links, and local analysis status.
- Added readiness information to support/settings diagnostics.
- Cleaned up release notes and roadmap for the end of the v1.3.x cycle.
- Added a v2.0.0 roadmap preview focused on Smart Mix Engine v2 and smarter playlist generation.
- Improved configuration validation and safer empty/error states.
- Improved support diagnostics consistency while preserving secret redaction.
- Hardened beta defaults before the v2.0.0 feature cycle.

## v1.3.8 - Beta Feedback & Discord Support Polish

- Added a Beta Support page with Discord, GitHub, feedback, and diagnostics actions.
- Added copyable bug report and feedback templates.
- Added safe support diagnostics export with secret redaction.
- Added support actions for failed jobs and Library Health diagnostics.
- Added configurable Discord support URL handling.
- Improved beta version/about details and links to release notes and roadmap.

## v1.3.7.2 - Dashboard Card Refresh Fix

- Fixed the Dashboard Library Health card staying stuck in a Refreshing state after health data was available.
- Fixed Dashboard Data Enrichment showing zero counts when enrichment data existed.
- Aligned Dashboard Library Health and Data Enrichment cards with their shared summary sources.
- Improved dashboard loading, error, and stale refresh states.
- Improved dashboard refresh behavior after sync, enrichment, and worker jobs complete.

## v1.3.7.1 - Remove Healthy Tracks Card

- Removed the expensive Healthy Tracks card from the Library Health summary page.
- Improved Library Health page load performance by avoiding unnecessary healthy-track calculations.
- Kept issue-focused Library Health cards for missing, partial, failed, and pending metadata categories.

## v1.3.7 - Plex Matching & Track Sync Polish

- Improved Plex track matching using stable identifiers before metadata fallbacks.
- Improved handling for moved files, renamed tracks, restored tracks, and missing-from-Plex records.
- Added clearer Plex sync summaries with scanned, matched, added, updated, moved, missing, duplicate, and conflict counts.
- Added Plex Sync diagnostics and Library Health visibility for sync-related issues.
- Improved duplicate candidate and match conflict handling without unsafe automatic merging.
- Preserved enrichment metadata more reliably during track sync updates.

## v1.3.6 - Background Worker Reliability

- Added clearer background worker health, heartbeat, and queue visibility.
- Added stale worker and stale job detection.
- Improved recovery for interrupted enrichment and analysis jobs after restart.
- Added duplicate job protection for long-running sync and enrichment actions.
- Improved Job History status, progress, and result summaries.
- Improved scheduled job reliability and skip reporting when another job is already running.
- Added worker and scheduler diagnostics for troubleshooting.

## v1.3.5 - Mood & Energy Sync Improvements

- Added clearer mood and energy health classification in Library Health.
- Added mood/energy source and confidence display where available.
- Added missing mood, missing energy, and partial mood/energy visibility.
- Improved retry/reprocess targeting for tracks missing mood or energy values.
- Improved Data Enrichment summaries for mood and energy completeness.
- Improved Smart Builder and Playlist Preview messaging when mood/energy data is incomplete.

## v1.3.4 - BPM Confidence & Source Improvements

- Added clearer BPM source labels for local, API, imported, estimated, and manual values.
- Added BPM confidence levels to make tempo data easier to trust.
- Added BPM source conflict detection for significantly different provider values, including possible half-time/double-time matches.
- Improved Library Health BPM detail views with source, confidence, source values, and reason information.
- Added BPM source/confidence filters and source breakdowns where available.
- Improved Dashboard, Data Enrichment, diagnostics, Job History, and playlist preview BPM summaries.

## v1.3.3 - Data Enrichment Cleanup

- Cleaned up Data Enrichment into clearer BPM, Audio Features, Genres, Popularity, and Local Audio Analysis sections.
- Added clearer provider/mode visibility for enrichment actions.
- Added preflight summaries before enrichment jobs run.
- Improved no-op handling so enrichment actions explain when no tracks are eligible.
- Connected enrichment actions to Library Health detail filters.
- Improved Job History summaries for enrichment jobs.
- Improved dashboard and Library Health refresh after enrichment jobs complete.

## v1.3.2 - Local Audio Analysis Polish

- Added clearer Local Audio Analysis status and provider-mode visibility.
- Added local analysis preflight summaries with matched, eligible, skipped, and skip-reason counts.
- Improved Local Essentia progress and completion summaries.
- Improved skip reason reporting for local audio analysis and force reprocess actions.
- Added local analysis diagnostics to Library Health.
- Improved Library Health and dashboard refresh after local analysis jobs complete.

## v1.3.1 - Audio Feature Retry Improvements

- Improved audio-feature retry actions to use the same resolved track sets as Library Health cards and detail views.
- Added retry preflight checks with matched, eligible, queued, skipped, and skip-reason counts.
- Improved local Essentia retry handling for partial and pending audio-feature tracks.
- Added clearer disabled states for API-only and local-only retry modes.
- Improved Job History summaries for audio-feature retry and reprocess jobs.
- Library Health and dashboard counts now refresh after audio-feature retry jobs complete.

## v1.3.0.1 - Audio Features Health Card Sync Fix

- Fixed Audio Features health cards showing stale incomplete counts after audio feature data was saved.
- Improved Library Health cache invalidation after audio feature sync, retry, and local Essentia reprocess jobs.
- Aligned Dashboard and Library Health audio feature counts around the same source-of-truth resolver.
- Added stale summary diagnostics for audio feature health counts.
- Preserved v1.3.0 Library Health Accuracy count/detail/retry consistency rules.

## v1.3.0 - Library Health Accuracy

- Rebuilt Library Health around shared category resolvers so card counts, detail rows, and retry actions use the same track sets.
- Added health accuracy invariants for audio features, BPM, genres, popularity, and local file status.
- Added Health Accuracy Diagnostics to detect count/detail mismatches.
- Improved provider-mode-aware classification for BPM and audio feature health.
- Preserved the v1.2.8 fix for BPM-present tracks being classified as partial audio features.
- Improved retry targeting and skip explanations for Library Health categories.
- Added health diagnostics export for easier bug reports.

## v1.2.9.1 - Matching Rules Layout Fix

- Fixed Matching Rules row overflow on the Playlist Builder page.
- Improved responsive layout for rule fields, operators, values, and delete actions.
- Prevented Matching Rules controls from overlapping the preview panel.
- Improved narrow-width and mobile behavior for the Matching Rules card.

## v1.2.9 - Playlist Builder UI Fix

- Fixed Playlist Builder layout overlap after generating a playlist preview.
- Improved Previewed Tracks table sizing and overflow behavior.
- Improved responsive layout for builder and preview panels.
- Tuned repeated-artist warnings so allowed repeats do not show as warnings when max tracks per artist is enabled.
- Added clearer safety-rule messaging for successful variety rules versus actual problems.
- Prepared the UI for the upcoming v1.3.0 feature branch.

## v1.2.8-hotfix.7 - Audio Feature Incomplete Count Classification Fix

- Fixed Audio Feature Health showing zero incomplete categories while the dashboard reported incomplete tracks.
- Tracks with BPM data but missing full audio feature fields now count as Partial Audio Features.
- Partial and Pending Audio Feature detail views now use the same incomplete track set as the dashboard.
- Improved local Essentia retry targeting for partial audio-feature tracks.
- Removed misleading missing-audio-feature gap wording when tracks are actually partial.

## v1.2.8-hotfix.6 - BPM Partial Audio Feature Classification Fix

- Fixed tracks with BPM data being incorrectly classified as missing audio features.
- Tracks with BPM but missing energy, mood, danceability, or local Essentia values now count as partial audio features.
- Partial Audio Features and Pending Audio Features now load the correct track sets.
- Improved retry and local Essentia candidate selection for partial audio-feature tracks.
- Aligned /settings/library-health and /library-health around the same classification rules.

## v1.2.8-hotfix.5 - Partial Audio Feature Classification Fix

- Fixed tracks with BPM data but missing audio feature fields being classified as missing instead of partial.
- Partial Audio Features now correctly shows tracks with incomplete energy, mood, danceability, or local Essentia fields.
- Pending Audio Features now loads the same retry-eligible track set shown in the summary.
- Improved local Essentia retry candidate selection for partial audio-feature tracks.
- Aligned /settings/library-health and /library-health classification behavior.

## v1.2.8-hotfix.4 - Library Health Card Detail Match Fix

- Fixed Missing Audio Features cards showing 70 while the detail view returned 0 tracks.
- Fixed Pending Audio Features cards showing 70 while the detail view returned 0 tracks.
- Unified Library Health card counts and detail rows around shared track ID resolution.
- Included audio feature gap tracks in detail views and retry candidate selection.
- Added mismatch detection so health cards cannot silently disagree with detail tables.

## v1.2.8-hotfix.3 - Audio Gap Detail Query Fix

- Fixed Missing Audio Features detail view returning zero rows when summary showed gap-classified tracks.
- Fixed Pending Audio Features detail view to include gap-classified tracks.
- Added shared audio feature gap track ID logic for summary, details, and retry actions.
- Improved retry candidate selection for active tracks without audio feature records.
- Improved debug logging for audio feature summary/detail count matching.

## v1.2.8-hotfix.2 - Audio Gap Summary Merge Fix

- Fixed audio feature gap detection not being merged into Library Health summary counts.
- Missing audio feature cards now include active tracks without audio feature records.
- Fixed detail filters so gap tracks appear when clicking View tracks.
- Improved audio feature retry targeting for gap-classified tracks.
- Aligned audio feature provider mode logging with actual settings.

## v1.2.8-hotfix - Audio Feature Gap Hotfix

- Fixed active tracks with no audio feature records being excluded from Library Health detail filters.
- Added audio feature gap detection between dashboard complete counts and Library Health categories.
- Classified unaccounted incomplete tracks as missing audio features instead of hiding them.
- Improved dashboard wording to show exact incomplete audio feature counts.
- Improved retry targeting for missing audio feature tracks.

## v1.2.8 - Audio Feature Health Consistency Fix

- Fixed mismatch where audio feature health summaries showed incomplete tracks but detail views returned none.
- Aligned missing, partial, and pending audio feature filters with summary counts.
- Improved audio feature completeness checks for current provider settings.
- Added clearer incomplete-track reasons in Library Health details.
- Improved retry targeting so audio feature retries use the same filters shown in the UI.
- Improved dashboard wording when rounded percentages hide incomplete tracks.

## v1.2.7 - Navigation Cleanup

- Cleaned up desktop sidebar navigation with grouped sections.
- Grouped playlist tools, library tools, and activity pages.
- Reduced mobile bottom navigation to the most-used items.
- Added a mobile More menu for secondary pages.
- Improved mobile spacing so navigation labels no longer overlap.
- Moved mobile version/GitHub/Beta controls out of the crowded bottom area.

## v1.2.6 - Export/Import Mixarr Recipes

- Added recipe export for individual recipes and all saved recipes.
- Added recipe import with validation and preview before saving.
- Added duplicate-name handling with automatic rename or skip options.
- Preserved recipe filters, Smart presets, Mood presets, BPM presets, and safety rules during export/import.
- Added a stable Mixarr recipe JSON format for backups and sharing.

## v1.2.5 - Playlist History

- Added Playlist History for created and regenerated Mixarr playlists.
- Added historical track snapshots showing the exact order written to Plex.
- Added playlist creation and regeneration summaries with filters, recipes, presets, exclusions, and safety rules.
- Added history details views with track lists and regeneration comparison stats.
- Added links from Generated Playlists to related playlist history.

## v1.2.4 - Advanced Playlist Regeneration

- Enabled Keep Some Existing Tracks regeneration mode.
- Added 25% and 50% keep options for playlist regeneration.
- Enabled Prefer Different Tracks Than Last Time using generated playlist snapshots.
- Added regeneration comparison stats for kept, replaced, reused, and new tracks.
- Added Remove from Generated Playlists action without deleting Plex playlists.
- Improved regeneration preview safety before replacing Plex playlist contents.

## v1.2.3 - Playlist Regeneration

- Added playlist regeneration for Mixarr-created playlists.
- Added saved generation metadata for playlists created from the builder, Smart Builder, and recipes.
- Added regeneration preview before replacing tracks in Plex.
- Added support for regenerating playlists using saved filters, presets, manual exclusions, and safety rules.
- Added Generated Playlists visibility and Job History entries for regeneration runs.

## v1.2.2-hotfix - Smart Builder Preset Hotfix

- Fixed Smart Builder so Mood Presets can be selected without first choosing a Smart Preset.
- Fixed Smart Builder so BPM Presets can be selected without first choosing a Smart Preset.
- Allowed Smart, Mood, and BPM presets to be combined independently.
- Improved Smart Builder preview metadata for partial preset selections.
- Changed the app status badge from Official to Beta.

## v1.2.2 - BPM Range Presets

- Added BPM Range Presets to Smart Builder.
- Added Slow, Medium, Upbeat, Dance, High Energy, and Wide Open tempo presets.
- BPM Presets now tune playlist tempo without manually entering ranges.
- Playlist Preview now shows selected BPM preset metadata and helpful low-match warnings.
- Saved recipes now preserve BPM preset metadata while keeping filter values as the source of truth.

## v1.2.1 - Mood Presets

- Added Mood Presets for quickly applying mood, energy, and BPM ranges.
- Added presets such as Happy, Chill, Hype, Dark, Emotional, Sad / Mellow, Relaxed, Focus, Upbeat, and Balanced.
- Moved Mood Presets into the Smart Builder flow where guided playlist features belong.
- Fixed Mood Presets placement so they now appear directly in the Smart Builder flow.
- Playlist Preview now shows the selected mood preset and related warnings.
- Saved recipes now preserve mood preset metadata while keeping filter values as the source of truth.

## v1.2.0 - Smart Playlist Builder v1

- Added Smart Playlist Builder v1 with guided playlist presets.
- Added presets for Workout, Chill, Party, Focus, Driving, Discovery, Deep Cuts, Popular Favorites, and Balanced Mix.
- Smart Builder now suggests filters, BPM ranges, energy/mood ranges, popularity preferences, and safety rules.
- Smart Builder uses the existing playlist preview flow before creating playlists.
- Smart Builder setups can be saved as reusable playlist recipes.
- Playlist creation history now records the Smart Builder preset used.

## v1.1.10 - Playlist Safety Rules

- Added optional playlist safety rules to reduce repetitive results.
- Added artist spacing to avoid same-artist back-to-back tracks.
- Added max tracks per artist and max tracks per album controls.
- Added low-track-count warnings in playlist preview.
- Saved safety rule settings with playlist recipes.
- Added safety rule summaries and warnings to playlist preview and Job History.

## v1.1.9.1 - Manual Track Exclusion

- Added manual track exclusions for Mixarr-generated playlists.
- Added exclude actions from playlist previews.
- Added excluded track management with remove-exclusion support.
- Applied manual exclusions to playlist previews, recipe previews, and playlist creation.
- Added exclusion counts to playlist preview stats where applicable.

## v1.1.9 - Edit and Duplicate Playlist Recipes

- Added editing for saved playlist recipes.
- Added recipe duplication for quickly creating variations.
- Added update-existing-recipe support from the playlist builder.
- Added improved recipe actions and updated recipe metadata.
- Kept recipe previews connected to the playlist preview flow.

## v1.1.8 - Save Playlist Recipes

- Added saved playlist recipes for reusable playlist filter setups.
- Added Save Recipe action to the playlist builder.
- Added a Saved Recipes page with recipe summaries and usage actions.
- Added recipe preview support using the playlist preview flow.
- Added dashboard visibility for saved playlist recipes.

## v1.1.7 - Playlist Preview Before Create

- Added a playlist preview step before creating playlists.
- Added track previews, filter summaries, and playlist stats before writing to Plex.
- Added warnings for low-match and zero-match playlist filters.
- Added create-from-preview flow so users can review playlists first.
- Improved playlist creation confidence and reduced accidental bad playlists.

## v1.1.6-hotfix - Homepage Library Health Performance Hotfix

- Fixed large-library homepage performance issue where Library Health counts could block SSR for several minutes.
- Reduced expensive repeated health-count queries.
- Homepage now renders without waiting for a full Library Health recalculation.

## v1.1.6 - Library Health Details

- Added a dedicated Library Health Details page.
- Added clickable health categories for missing BPM, API-only BPM, partial audio features, failed analysis, and missing local files.
- Added track-level explanations for why items appear in each health category.
- Added filtered track views with sorting and basic actions.
- Connected Library Health retry actions with Job History and retry explanations.

## v1.1.5 - Background Scheduler Settings

- Added web UI controls for the Background Scheduler.
- Added daily, weekly, interval, and custom cron schedule options.
- Kept 3:00 AM daily as the default schedule.
- Added validation for custom cron expressions.
- Added scheduler status visibility and better scheduled-job history labeling.
- Kept SYNC_CRON_SCHEDULE as a fallback/default environment variable.

## v1.1.4 - Retry Explanation Improvements

- Improved retry result messages when no tracks are queued.
- Added clearer explanations for zero-result BPM and audio-feature retry actions.
- Added retry filter, matched, queued, skipped, and reason details where available.
- Improved Job History summaries for retry and zero-attempt jobs.
- Reduced confusion around local-only retry and force reprocess actions.

## v1.1.3 - Better Job History

- Added Job History page for recent background jobs.
- Added status, timing, duration, and summary details for sync and retry jobs.
- Added dashboard visibility for recent job activity.
- Added basic filters for job status and job type.
- Improved debugging visibility for failed or zero-result jobs.

## v1.1.2 - Version & Update Visibility

- Added clearer current-version visibility across Mixarr.
- Added an About / Updates area for release notes, roadmap access, and update guidance.
- Added dashboard version visibility.
- Centralized app version display to reduce stale version mismatches.

## v1.1.1 - Roadmap & Coming Soon

- Added a Roadmap / Coming Soon page for Mixarr's path toward v2.0.0.
- Added a dashboard card linking to the v2.0.0 roadmap.
- Added roadmap sections for current release, upcoming features, v2.0.0 ideas, Discord beta feedback, and GitHub supporter beta access.
- Updated app version display to v1.1.1.

## v1.1.0 - Dashboard Cleanup & v2.0.0 Preview

- Cleaned up dashboard enrichment card layouts.
- Fixed Track Genres card text overflow.
- Removed redundant Data Enrichment dashboard section.
- Added v2.0.0 Coming Soon preview section.
- Added guidance that enrichment tools are available from each dashboard card.
- Improved dashboard polish and mobile layout.

## v1.0.5 - Metadata Reliability & Library Health Polish

- Fixed partial audio feature retry not clearing after successful local Essentia analysis.
- Fixed retry queues replaying already-completed tracks.
- Improved BPM and audio feature candidate selection consistency.
- Added post-save verification logging for local metadata analysis.
- Improved Library Health count/filter accuracy.
- Improved whole-track Essentia temp cleanup and worker safety.
- Added separate too-short status handling.
- Added GitHub repository link.
- Improved provider/status breakdowns in Dashboard and Library Health.

## v1.0.4 - Local/API Metadata Controls

- Added settings to enable or disable API BPM lookup.
- Added settings to enable or disable API Audio Feature lookup.
- Added local Essentia-only mode for BPM.
- Added local Essentia-only mode for Audio Features.
- Added API-preferred vs local-preferred effective value logic.
- Added provider breakdowns to Dashboard and Library Health.
- Added retry behavior that respects configured providers.


## v1.0.3 - Library Health, Cleanup & Pool Stability

- Added Library Health page.
- Added Plex/Mixarr sync integrity stats.
- Added missing track viewer.
- Added safe cleanup tools for stale Plex records.
- Added missing track export.
- Added BPM health summary.
- Added validated atomic BPM samples, ffmpeg seek fallback, and separate extraction/analyzer failure reporting.
- Improved dashboard counts to use active tracks only.
- Fixed Prisma connection pool exhaustion during long-running sync/status polling.
- Improved Sync Center status polling with slower idle polling, active polling hints, and pool-busy backoff.
- Added shared job overlap protection for manual syncs, enrichment jobs, and nightly scheduler runs.
- Improved Prisma P2024 logging with concise pool-timeout diagnostics instead of repeated status stack traces.
