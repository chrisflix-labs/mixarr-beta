# Mixarr v2.4.1 — AI Privacy, Cost and Context Controls

Mixarr v2.4.1 adds the administrative governance boundary required before any user-facing AI workflow. It does not add playlist generation, recommendations, discovery, tagging, conversation, autonomous agents, or AI-driven mutation. Existing deterministic Mixarr behavior remains authoritative and does not require AI.

## Upgrade and compatibility

Apply Prisma migration `20260721120000_ai_governance_v241` after the v2.4.0 provider-foundation migration. It is additive: existing provider UUIDs, encrypted credentials, model caches, health history, feature settings, and request audits remain valid and readable. Monetary governance uses `DECIMAL(18,6)` while the v2.4.0 provider budget column remains readable as a compatibility fallback.

After upgrade, AI and all future features retain their prior enablement. A new policy review notice appears. Until reviewed, the governance defaults are conservative:

- Privacy mode: Metadata Limited with a restrictive music-field allowlist.
- Paid-provider fallback: disabled.
- External background AI: disabled.
- Secure payload recording: disabled.
- Unknown metadata fields sent externally: blocked.
- Unpriced external models: blocked.
- Full Metadata: unavailable until the current warning version is accepted.
- Retry after possible provider billing: disabled.
- Hard budget shutdown: enabled when a monthly budget is configured.
- Budget reservations and field-name-only privacy audit reporting: enabled.

The migration does not create a provider, change a credential, contact a model endpoint, enable a future AI feature, or rewrite playlist/library data. Back up the database and `AI_CREDENTIAL_ENCRYPTION_KEY` or `MIXARR_SECRET_KEY` together.

## Central enforcement flow

Every normal completion and stream passes through `AiRequestCoordinator` and the same governance preview/reservation service:

1. Resolve global and feature enablement, the requested provider/model, and required capabilities.
2. Resolve the strictest global, feature, request, and user privacy policy.
3. Exclude an external provider in Local Only. A provider is local only when it is explicitly classified and administrator-confirmed; a private-looking hostname is insufficient.
4. Transform typed metadata through the allowlist/anonymization engine. Secret, credential, path, infrastructure, raw-file, and identity fields are always prohibited.
5. Validate prompt characters, UTF-8 bytes, message count, metadata-record count, response bytes, structured limits, and the selected model's native context window. Token estimates are informational.
6. Apply the configured visible context-trimming policy, preserving required system, safety, and structured-schema sections, then recalculate tokens and cost.
7. Find the effective model-pricing profile and calculate minimum, expected, and maximum estimated cost for the initial attempt only.
8. Check request counts plus provider, user, background, and global limits. Active reservations count as spent for admission control.
9. Create an expiring reservation in a serializable transaction before dispatch.
10. Execute and record each provider attempt separately. Before a retry or fallback, re-run policy and budget checks; possible-billing retries remain off by default.
11. Reconcile the reservation to provider-reported or calculated usage, or release it on failure, cancellation, timeout, and policy block.
12. Update sanitized usage/audit records and evaluate deduplicated alert thresholds.

Blocked requests receive a structured safe error and an audit row. Prompts, responses, raw provider bodies, credentials, authorization headers, tokens, private paths, and identifying metadata values are not stored by default.

## Privacy modes

### Local Only

Only explicitly local, administrator-confirmed endpoints are eligible. External execution, external fallback, automatic external discovery, and external background requests are prohibited. Local zero-cost requests may continue after a paid global limit unless another applicable limit blocks them.

### Metadata Limited

External providers receive only fields in the administrator allowlist. Unknown external fields are blocked. The privacy report records included, transformed, blocked, and unknown field names—not their sensitive values.

### Anonymous Metadata

Identifying music names are removed and numeric attributes can be converted into bands. Genre generalization, year ranges, BPM ranges, popularity ranges, and play-count ranges are deterministic for the same input. This is privacy minimization, not mathematical anonymity; attribute combinations may remain identifiable.

### Full Metadata

Full Metadata requires acceptance of the current versioned warning and can be revoked. “Full” means administrator-approved music metadata, never arbitrary database records. Secrets, credentials, raw files, file/network paths, authentication data, and infrastructure identifiers remain blocked.

## Pricing, budgets, and reservations

Pricing is stored per provider/model and effective date. Profiles support input, output, cached-input, reasoning-token, and fixed-request charges; currency; source; verification time; estimated/free/local/unpriced state; enablement; duplication; and history. Commercial prices are not hardcoded.

The cost estimator reports a minimum, expected, and maximum one-attempt estimate; confidence; price source and age; remaining user/provider/global budgets; and admission status. Estimates are never labeled as exact charges. Local providers default to zero monetary cost unless local cost counting and pricing are configured. Initial admission never adds the theoretical cost of all possible retries and never applies the retry-only cost limit.

Global, provider, and user budgets support daily/monthly cost and request limits. User limits also control provider/privacy/model eligibility, paid providers, and background use. Administrators are not exempt unless the explicit exemption setting is enabled.

Reservations expire after ten minutes if a worker disappears. Active and expired reservations are visible through administrator diagnostics. A completed request reconciles its reservation; failure, cancellation, timeout, or fallback releases it before another provider is reserved.

## Background work, timeouts, retry, and fallback

Background AI is globally off by default. Independent controls cover external background use, daily request/cost limits, concurrency, allowed UTC hours, per-feature disablement, user eligibility, and manual approval. Policy is resolved immediately before queued execution, so a queued item cannot retain an older privacy or budget decision.

Timeouts now resolve by explicit request override, enabled provider policy, global policy, then application defaults. An enabled provider policy replaces—not tightens—the global policy. Connection, first-token, total-request, and streaming-idle phases accept a positive millisecond value or `null` for Unlimited; cancellation grace stays finite. See [v2.4.22 local model timeouts](AI_LOCAL_MODEL_TIMEOUTS_V2422.md).

Retries are bounded by provider and governance attempt counts, retry cost, cumulative request cost, privacy, and remaining budgets. Retry limits are evaluated only after a recognized transient provider failure and immediately before each real retry. A missing retry-cost limit (`null`) means no separate monetary retry ceiling; zero means only zero-cost retries are allowed. A retry count of zero disables retries. Missing retry settings on installations upgraded from an older release retain these schema defaults and never become an accidental zero-dollar allowance. When provider acknowledgement is possible, automatic retry is disabled unless explicitly enabled.

Unknown pricing for an external model is allowed only when the existing `allowUnpricedExternalModels` policy is enabled. Otherwise the request returns a model-pricing error; it is never translated into a retry-cost failure.

Paid fallback is off by default. A compatible cheaper-model selector must retain required capabilities, context, streaming, structured output, tools, reasoning, and cancellation. Local Only never crosses to external, and local/free requests never cross to paid while paid fallback is disabled. Audit data records the original and selected target, reason, estimated savings, and boundary crossings.

## Administrator APIs

All routes follow the existing authenticated administrator convention and structured error format.

- `GET/PATCH/POST /api/ai/governance` — summary/settings and Full Metadata acceptance/revocation.
- `GET/POST /api/ai/pricing` and `PATCH/POST /api/ai/pricing/:pricingId` — pricing history, create/update, and duplicate.
- `GET/PUT /api/ai/budgets` — provider and user limits.
- `POST /api/ai/preview` — sanitized metadata, context, token, cost, and budget preview without execution.
- `GET /api/ai/compare` — model/provider cost, capability, health, privacy, and budget comparison.
- `GET /api/ai/reservations` — active reservations.
- `GET/PUT /api/ai/alerts` — alert thresholds and events.
- `GET /api/ai/usage` — filtered summaries, time series, breakdowns, token analytics, and sanitized records.
- `GET /api/ai/usage/export?format=csv|json` — safe administrator exports.
- `GET /api/ai/audit` and `GET /api/ai/audit/:requestId` — searchable audit and sanitized linked attempts/reservations.

Representative errors include `AI_EXTERNAL_PROVIDER_BLOCKED`, `AI_GLOBAL_BUDGET_EXCEEDED`, `AI_PROVIDER_BUDGET_EXCEEDED`, `AI_USER_BUDGET_EXCEEDED`, `AI_DAILY_REQUEST_LIMIT_EXCEEDED`, `AI_MODEL_CONTEXT_WINDOW_EXCEEDED`, `AI_PROMPT_TOO_LARGE`, `AI_MODEL_PRICING_MISSING`, `AI_BACKGROUND_REQUEST_BLOCKED`, `AI_RETRY_COST_LIMIT_EXCEEDED`, and `AI_NO_ELIGIBLE_PROVIDER`. Mixarr-configured token caps were retired in v2.4.17; token estimates remain informational while model-native context validation remains active.

## Permissions and auditing

Named checks cover viewing usage/audits, exports, budget/pricing/privacy/token/user/background/retry management, sanitized detail, secure debugging, Full Metadata acceptance, and hard-shutdown override. In v2.4.1 they map to Mixarr's administrator role, keeping future role delegation additive. Every governance-setting, pricing, budget, user-limit, local-endpoint confirmation, and acknowledgment change records actor, timestamp, previous/new safe values, and optional reason.

## Verification

The standard suite uses deterministic policy tests and provider mocks; it never calls a live paid provider. Coverage includes fixed-point pricing, privacy allowlisting/anonymization, unknown-field blocking, strict limit resolution, budget periods, reservation/reconciliation markers, retry/fallback guards, context preservation, alert deduplication, additive migration safety, API redaction, responsive states, and the no-user-feature boundary.

## Rollback

Rolling application code back while leaving the additive tables in place preserves history and provider compatibility. Dropping the v2.4.1 tables/columns destroys pricing, budgets, reservations, alerts, privacy acknowledgments, and governance audit history, so do that only after a verified backup. No provider credential needs to be re-entered for a normal upgrade or rollback.
