# AI Governance, Security and Reliability — v2.4.9

Mixarr v2.4.9 makes every provider-bound AI operation pass through a common, deny-by-default governance boundary. AI remains advisory: deterministic validation and ordinary Mixarr authorization continue to decide what can be saved, approved, or executed.

> AI-generated output is treated as untrusted and must pass Mixarr's deterministic validation and governance controls before it can affect a playlist.

## Upgrade

1. Back up the PostgreSQL database.
2. Set `AI_CREDENTIAL_ENCRYPTION_KEY` to a long random secret. Set `MIXARR_AI_ENABLED=false` if AI must remain deployment-disabled during the upgrade.
3. Apply Prisma migration `20260727010000_ai_governance_security_reliability_v249` with the normal deployment migration command.
4. Deploy the v2.4.9 application and workers together.
5. In Settings → AI → Security & Queue, review the global policy. Existing providers and models are intentionally unapproved after migration.
6. Approve only the required provider, model, feature, privacy mode, model capabilities, external features, and external data categories.
7. Grant non-admin users only the permissions they require, then run a local provider test before enabling external access.

The migration is additive and preserves historical AI records. Rollback should restore the pre-upgrade database backup and v2.4.8 application image together; do not run an older image against the migrated schema.

Docker installations that use the bundled `prisma db push` startup path run `prisma/db-push-preflight.sql` first. The preflight verifies and creates the v2.4.9 audit idempotency index under its exact Prisma name, avoiding Prisma's generic unique-index warning without using `--accept-data-loss` or modifying existing audit values.

## Least-privilege permissions

Administrators retain complete AI administration. Other users are denied until an unexpired grant exists for the exact permission: `ai.use`, `ai.request.create`, `ai.recipe.create`, `ai.recipe.review`, `ai.metadata.review`, `ai.troubleshoot`, `ai.provider.view`, `ai.provider.manage`, `ai.cost.view`, `ai.cost.manage`, or `ai.audit.view`.

Feature checks are enforced in services and again at the centralized request coordinator. Permission grants and revocations are audited. Administrative provider operations also require an approved, enabled provider and are blocked during shutdown.

## Provider, model, and external-data policy

Provider configuration is not approval. A request is eligible only when the provider and selected model are enabled and approved, the feature and privacy mode are allowlisted, and required capabilities are declared by the model. Fallback candidates repeat the same policy checks; fallback cannot bypass approval, privacy, capability, pricing, budget, or external-data rules.

External providers are globally disabled by default. When enabled, the provider must allow external requests, the feature must be globally and provider-allowlisted, every data category must be globally and provider-allowlisted, and a per-request confirmation is required when configured. Request previews identify provider, model, locality, privacy mode, included categories, limits, and estimated cost without storing raw prompt content.

### Local-only guarantees and limits

`LOCAL_ONLY` guarantees that Mixarr rejects providers not explicitly classified as local/trusted and applies the same approval, feature, capability, redaction, and validation policy used for every request. It does not prove that the provider process, model, host, plugins, telemetry, logs, or network are isolated. Administrators remain responsible for securing the local provider and its storage/network boundary. Local prompts are not assumed to be secret-free, so centralized redaction still runs.

## Prompt and response security

The coordinator applies centralized email, path, host, IP, username, token, credential, and infrastructure redaction before provider dispatch. Versioned system/user prompt boundaries mark untrusted content as data. Local injection heuristics block or flag attempts to override instructions, expose secrets, invoke tools, or request unsafe actions. This is defense in depth, not a claim that prompt injection can be perfectly detected.

Structured features use strict Zod schemas with unknown fields rejected. Mixarr permits at most one deterministic local repair pass for a single fenced/object JSON response and trivial trailing commas; it never invents missing fields. Oversized, deeply nested, malformed, schema-invalid, suspicious, or unsafe responses are rejected and may be quarantined. Critical quarantine records are non-overridable and cannot become approved artifacts.

## Approval and provenance

AI artifacts store request, provider/model, prompt-template version, validation state, and safe provenance. Human decisions create a separate immutable approval event containing the reviewer, decision, canonical artifact hash, validation/safety state, and reviewed diff. AI output cannot approve itself. Recipe validation, review, approval, activation, and execution remain separate operations.

## Durable jobs and reliability

The `AiJob` queue provides idempotency keys and content fingerprints, PostgreSQL advisory-lock claiming, leases and heartbeats, cancellation requests, bounded attempts, stale-lease recovery, progress, and terminal result/error metadata. Concurrency is enforced across global, provider, model, user, feature, diagnostic, and health-check scopes. Queue status and cancellation are available from the Security & Queue UI and `/api/ai/jobs` endpoints.

Provider calls retain the existing bounded timeout, cancellation, retry, budget reservation, rate-limit, context trimming, and fallback controls. Retry policy distinguishes safe pre-dispatch failures from ambiguous potentially billed attempts. Response validation and quarantine are applied after fallback exactly as on the primary provider.

## Retention and redaction

Request/response bodies default to no retention. Metadata, audits, errors, usage summaries, approvals, costs, diagnostics, and quarantine records have independent retention periods. The retention service first nulls expired payloads, then deletes eligible metadata records without weakening immutable approval/security records still inside policy. Queue it manually with `POST /api/ai/retention/run` or from a trusted scheduler. The endpoint returns an `AiJob`; status and cancellation use the normal job endpoints.

Audit and quarantine previews are centrally redacted. Secrets and credentials are never intentionally persisted. Administrators should still treat diagnostics as sensitive and keep database access restricted.

## Emergency shutdown

The database shutdown control requires administrator confirmation and a reason, audits the change, requests cancellation for active AI jobs, and blocks provider requests, retries, discovery, health checks, and queue claims. `MIXARR_AI_ENABLED=false` is a higher-priority environment override and cannot be reversed in the UI. Deterministic playlist generation, diagnostics, and other non-AI functions remain available.

## API surface

- `GET /api/ai/capabilities` — current user permissions and effective deployment state.
- `GET|PUT /api/ai/permissions` — permission grants (administrator only).
- `GET|PUT /api/ai/emergency-shutdown` — inspect or change shutdown state.
- `GET /api/ai/jobs`, `GET /api/ai/jobs/:id`, `POST /api/ai/jobs/:id/cancel` — queue visibility and cancellation.
- `GET /api/ai/quarantine`, `GET /api/ai/quarantine/:id`, `POST /api/ai/quarantine/:id/action` — redacted quarantine review.
- `POST /api/ai/retention/run` — enqueue configured retention cleanup.

All endpoints use the normal authenticated session and granular AI permissions. Quarantine and audit responses expose redacted previews, not raw provider payloads.

## Verification

The v2.4.9 tests use local fixtures and mocked adapters only. They cover redaction, injection detection, prompt boundaries, malicious response classification, strict schemas, bounded JSON repair, fingerprints, permissions, quarantine behavior, queue primitives, shutdown policy, and regression behavior. CI does not require live provider credentials or billable network requests.

### Manual verification

1. Start with `MIXARR_AI_ENABLED=false`; confirm deterministic playlist features work while provider tests, discovery, jobs, and AI requests are blocked.
2. Enable AI, approve one local provider/model with only the needed feature and capability, grant a non-admin user one matching permission, and verify an unrelated feature remains denied.
3. Configure an external provider without feature/data allowlists and verify denial. Then allow only the exact feature and categories, require confirmation, inspect the preview, and confirm one request.
4. Use a mocked adapter to return prompt-injection text, suspicious HTML/tool instructions, malformed JSON, and an oversized response; verify rejection, redacted audit data, and quarantine where applicable.
5. Submit the same metadata scan idempotency key twice, verify one durable job, request cancellation, and restart a worker to exercise lease recovery.
6. Activate database emergency shutdown while a job is queued/running; verify new claims stop, cancellation is requested, and the administrative event is audited.
7. Set short test retention periods, enqueue cleanup, and verify payloads are purged before eligible metadata rows while approvals/security events remain governed by their own retention.

### Security assumptions and known limits

Prompt-injection and malicious-output detection are conservative heuristics and cannot identify every adversarial response. Interactive recipe, summary, and troubleshooting calls remain foreground requests protected by bounded timeouts, cancellation, concurrency, audit, and fallback controls; long-running metadata scans and retention cleanup use the durable queue. Streamed text is rendered as inert text and inspected before persistence or approval, but a user may see safe-rendered chunks before final post-stream classification. Mixarr cannot secure a provider host, plugin, telemetry system, proxy, or database deployment that is outside its process boundary.
