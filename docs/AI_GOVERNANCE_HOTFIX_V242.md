# Mixarr v2.4.2 — Ollama Requests & User Policy Hotfix

This backward-compatible hotfix corrects Ollama admission, user-specific policy persistence, provider-test diagnostics, and safe audit classification. It does not bypass global AI enablement, feature permissions, privacy transformation, token/prompt/response limits, request and cost budgets, background controls, timeouts, retries, or fallback safety.

## Provider and model classification

Every governed request resolves one classification before privacy, pricing, and paid-provider checks:

| Classification | Meaning | Missing pricing | Paid permission |
| --- | --- | --- | --- |
| `LOCAL_FREE` | A trusted/self-hosted local endpoint and model | Allowed; shown as “Local / no estimated provider cost” | Not required |
| `EXTERNAL_FREE_OR_UNPRICED` | A remote model that is explicitly free or has no active pricing | Controlled by “Allow unpriced external models” | Not required unless explicitly reclassified as paid |
| `EXTERNAL_PAID` | An external model/provider explicitly configured as billed | Pricing and budgets apply | Required |
| `UNKNOWN` | Mixarr cannot safely determine locality or billing | Fails closed | Request is denied with `PROVIDER_CLASSIFICATION_UNKNOWN` |

Explicit provider/model configuration wins. A model pricing profile marked externally billed also wins over protocol or hostname assumptions. A standard Ollama URL using loopback, RFC1918/private, link-local, Docker host/service, IPv6 local, or an administrator-configured internal hostname is local unless the provider is explicitly remote. The Ollama protocol alone does not make a public endpoint local.

Optional `customConfiguration` classification keys are `providerClassification`, `providerModelClassification`, `modelClassifications`, and `internalHostnames`. Valid classifications are the four values above.

## Deterministic policy precedence

Mixarr resolves admission in this order:

1. Global AI enabled state.
2. Feature permission and implementation state.
3. User-specific restrictions and overrides.
4. Provider restrictions and enabled state.
5. Model restrictions and availability.
6. Privacy compatibility.
7. Request and cost budgets plus pricing eligibility.
8. Background-request permission.
9. Timeout and retry controls.

Paid-provider permission is tri-state at user level:

- `true` permits a paid provider only when global user overrides are allowed.
- `false` always denies paid providers for that user.
- blank/unset inherits the global paid-provider policy.
- an enabled administrator exemption remains an explicit, audited source.

Local models do not enter the paid-provider check. Existing explicit `true` and `false` values are preserved by the migration; nullable values represent inheritance.

## User Limits

Use **Settings → AI Governance → Budgets → User Limits**. Select a user by username/email and shortened UUID, or paste the full application user UUID. The API continues to accept `userId` and the backward-compatible `user_uuid` input.

Blank daily/monthly cost and request limits mean “inherit/no user-specific limit”; blank is never converted to zero. An explicitly entered zero is stored as zero. Costs accept up to six decimal places, request limits require whole numbers, and negative values are rejected. A policy can contain only permission overrides.

To locate a UUID, open the searchable user selector. The selected option shows the username, email when available, and shortened UUID; the full UUID remains visible in the UUID input.

Validation responses use:

```json
{
  "code": "AI_POLICY_VALIDATION_FAILED",
  "message": "One or more AI governance settings are invalid.",
  "field_errors": {
    "user_uuid": "No Mixarr user exists with this UUID."
  }
}
```

The dashboard activates Budgets, scrolls/focuses the first invalid field, preserves unsaved values, and prevents duplicate submissions.

## Administrative connection tests

An explicit test uses the authenticated administrator UUID and that user’s saved policy. With a configured Ollama model, the action sends one minimal `Reply only with OK.` chat request and never persists the raw prompt or provider response. Results distinguish:

- `stage: governance` for policy denials such as `PAID_PROVIDER_NOT_PERMITTED`.
- `stage: provider` for reachability, authentication, TLS, or timeout failures.
- success with provider, model, classification, latency, effective policy, and correlation ID.

The UI disables repeat clicks while the test is in progress.

## Auditing and troubleshooting

Audit rows include feature, user, provider, model, classification, status, denial/error code, latency, token counts, estimated cost, retry/fallback state, and correlation ID. Governance denials are `BLOCKED`; they are not provider failures or successful usage. Local unpriced rows use the local/no-cost label, while external unpriced rows say pricing is not configured.

Unexpected failures alone use `INTERNAL_AI_ERROR`. Server logs include correlation ID, safe request context, decision stage, exception class, a sanitized message, and a server-only sanitized stack. Logs and audits exclude credentials, headers, Plex tokens, cookies, prompts, raw responses, and secrets. Use the correlation ID shown in the UI to find the corresponding server log and audit row.

PostgreSQL advisory budget admission remains transaction-scoped. The lock function's `void` result is explicitly cast to text before Prisma deserializes it; an `INTERNAL_AI_ERROR` mentioning `Failed to deserialize column of type 'void'` indicates an older build that predates this hotfix revision.

## Migration and rollback

Apply `20260721210000_ai_governance_ollama_user_policy_hotfix` after the v2.4.1 governance migration. It preserves providers, credentials, global settings, user settings, reservations, and audit history. It makes the two user permission columns nullable, adds global paid-provider/override policy fields with a fail-closed paid-provider default, and adds an indexed audit classification field.

For downgrade, retain the additive columns. Before running older code that requires non-null user permission fields, replace nulls with the older conservative defaults (`false`) after a verified backup. Dropping the added audit/global columns is optional and loses hotfix metadata.

## Manual acceptance workflow

1. Sign in as an administrator and open **Settings → AI Governance**.
2. Configure local Ollama, select `llama3:latest`, and run a connection test.
3. Confirm `LOCAL_FREE`, one successful audit row, and success without paid-provider permission.
4. Open **Budgets → User Limits**, select the administrator, leave numeric limits blank, choose **Permit** for paid providers, and save.
5. Refresh and confirm the permission remains enabled; retest local Ollama.
6. Configure/test an explicitly `EXTERNAL_PAID` model. Confirm it is allowed when global user overrides are enabled.
7. Change the user permission to **Deny** and confirm the paid model returns `PAID_PROVIDER_NOT_PERMITTED`.
8. Confirm local Ollama still succeeds and every audit row shows the correct classification, outcome, cost label, and correlation ID.
