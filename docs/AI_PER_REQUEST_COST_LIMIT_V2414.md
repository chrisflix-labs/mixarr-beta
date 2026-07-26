# Per-Request AI Cost Limit Configuration (v2.4.14)

Fixes AI providers configured through the onboarding wizard rejecting every priced
external request with `AI_REQUEST_COST_LIMIT_EXCEEDED`, and separates a per-request
cost ceiling from the cumulative retry ceiling it had been conflated with.

## Three names, two controls, one column

The investigation confirmed the terms are **not** synonyms and were being mapped
between separate controls:

| Term | Where it lived | What it actually meant |
| --- | --- | --- |
| `maximumEstimatedRequestCost` | onboarding wizard config, labelled "Maximum request cost" | the estimated cost ceiling for **one request** |
| `maximumCumulativeRequestCost` | `AiGovernanceSetting` column, labelled "Maximum cumulative request cost" | the ceiling for the **first attempt plus every retry** |
| "per-request cost limit" | `previewAiRequest`, error text `AI_REQUEST_COST_LIMIT_EXCEEDED` | what admission enforced |

Only one column existed, so all three collapsed onto it:

```ts
// onboarding activation (src/ai/intelligence/service.ts)
maximumCumulativeRequestCost: configuration.mode === "LOCAL_ONLY" ? 0 : configuration.maximumEstimatedRequestCost,

// admission (src/ai/governance/service.ts)
evaluateCostLimit({ scope: "request", estimatedCost: cost.maximumEstimatedCost,
                    limit: governance.maximumCumulativeRequestCost?.toString(), ... })

// retry (src/ai/governance/service.ts)
evaluateRetryCost({ ..., cumulativeRequestLimit: governance.maximumCumulativeRequestCost?.toString() })
```

The wizard's per-request field was written into the cumulative column; admission
read that column as the per-request ceiling; the retry path read the same column as
the cumulative ceiling. A single value therefore governed two different decisions.

## Why it blocked everything

`configuration.maximumEstimatedRequestCost` defaulted to `0`, and the wizard input
coerced blanks back to it (`config.maximumEstimatedRequestCost ?? 0`). In
`evaluateCostLimit`, `currencyMicros()` returns null only for `null` and `""`, so a
stored `0` became a real ceiling of exactly $0.000000:

```ts
const allowed = limitMicros == null || usageMicros + estimatedMicros <= limitMicros;
```

Every external request with an estimated cost above zero was refused on admission,
before dispatch — so Recipe Copilot and every other feature reported
`AI_REQUEST_COST_LIMIT_EXCEEDED` and stayed unavailable. The same zero also became
the cumulative retry ceiling, so no retry of a priced request could ever proceed.

## How zero is interpreted across monetary limits

Every monetary limit funnels through `currencyMicros()`, where `null`/`""` mean
"no limit" and `0` means a real zero ceiling. The **callers**, however, are not
consistent, which is worth knowing when reading this area:

| Limit | Check | Meaning of a stored `0` |
| --- | --- | --- |
| per-request estimated cost | now mode-gated | Unlimited, or a deliberate zero under Limited |
| cumulative request cost | now mode-gated | Unlimited, or a deliberate zero under Limited |
| `maximumRetryCost` | `?.toString()` → `currencyMicros` | real zero ceiling; documented in the interface as "zero permits only zero-cost retries" |
| `AiProviderBudget.dailyLimit` | `providerBudget?.dailyLimit && …` (truthy) | treated as no limit |
| provider monthly limit | `providerMonthlyLimit != null && …` | real zero ceiling |
| `AiUserLimit.dailyCostLimit` / `monthlyCostLimit` | `!= null && …` | real zero ceiling (intentional: admits only free requests) |
| `AiGovernanceSetting.monthlyBudget` | `monthlyBudget && …` (truthy) | treated as no limit |
| `maximumBackgroundCostPerDay` | `governance.maximumBackgroundCostPerDay && …` (truthy) | treated as no limit |

This release changes only the first two rows. The truthy/null inconsistency in the
remaining budget checks is left as-is deliberately: those limits are reachable and
documented from the interface, and changing either direction would silently
strengthen or weaken a spending control that is not the reported defect.

Note the contrast with request *counts* (v2.4.13): a zero request count is never
meaningful, so it is rejected on write. A zero **cost** ceiling is meaningful —
"admit only free or local-provider requests" — so it stays expressible, but only
under an explicit Limited mode where it cannot be confused with an unset field.

## Behavior after this release

`AiGovernanceSetting` now has three new fields:

- `perRequestCostLimitMode` — `UNLIMITED` (default) or `LIMITED`
- `maximumEstimatedRequestCost` — the per-request ceiling, its own column at last
- `cumulativeRequestCostLimitMode` — `UNLIMITED` (default) or `LIMITED`, governing
  the existing `maximumCumulativeRequestCost`

`src/ai/governance/costLimits.ts` is a pure module shared by admission, validation,
the settings API, the dashboard, and tests. It resolves **which** limit is active;
it does not do the arithmetic. `evaluateCostLimit` and `evaluateRetryCost` in
`./policy` remain the only cost comparators and are neither bypassed nor modified.

Resolution, per control:

- `UNLIMITED` → no ceiling, even if an amount is still stored.
- `LIMITED` with a valid amount (including `0`) → enforced.
- `LIMITED` with a missing or unparseable amount → **unlimited**, plus a reported
  configuration issue (`LIMITED_WITHOUT_LIMIT`, `INVALID_LIMIT`). A misconfiguration
  never blocks the feature.

Amounts are carried as exact decimal strings so micro-unit conversion is unchanged,
and `Unlimited` clears any stored amount so a later mode change cannot resurrect it.

Admission enforces the **per-request** ceiling only. The cumulative ceiling is
evaluated exclusively in `prepareAiRetry`, after a transient provider failure.

## Protections that are unchanged

Provider approval, per-feature approval, model approval and availability, the
monthly budget and hard shutdown, provider daily and monthly cost limits, user daily
and monthly cost limits, daily and monthly request-count limits, `maximumRetryCost`,
provider-native context and prompt-size limits, privacy modes and the metadata allowlist, unpriced-model
blocking, paid-provider permission, background-request policy, emergency shutdown,
and budget reservations are all evaluated separately and are untouched. The
estimated-cost calculation itself (`estimateRequestCost`) is unchanged.

## Interface

- **AI Governance → Budgets → AI cost limits** (`#ai-cost-limits`): the per-request
  mode selector and amount, an explanation of what is enforced, and a warning plus a
  confirmation prompt when a zero ceiling is chosen, since that blocks every priced
  external request.
- **Timeouts & Retries** now labels the cumulative ceiling accurately, gives it its
  own mode selector, and points to the separate per-request limit.
- The onboarding wizard asks for a per-request cost **mode** instead of defaulting an
  amount to zero. A local-only setup is still saved with an explicit `LIMITED` /
  `0.00` per-request policy, which is stated on the step.
- A blocked feature links to `/settings/ai?section=Budgets#ai-cost-limits`. Recipe
  Copilot labels the link "Open AI cost limits" and its message names the estimated
  cost, the ceiling, the control, and — when the ceiling is zero — what zero means.

## Upgrade

Apply migration `20260802010000_ai_per_request_cost_limit_v2414`. It is additive and
idempotent (`ADD COLUMN IF NOT EXISTS`) and it:

- adds the two mode columns and the dedicated `maximumEstimatedRequestCost` column;
- copies a **positive** `maximumCumulativeRequestCost` into the per-request column as
  an explicit `LIMITED` ceiling, preserving what admission was actually enforcing;
- releases a **zero** ceiling on installations that permit external providers — that
  value is the wizard default contradicting the administrator's own provider
  configuration, and is the reported defect;
- keeps a **zero** ceiling as an explicit `LIMITED` / `0.00` on local-only
  installations, where it is consistent with the privacy and provider policy already
  in force, so no deliberate control is removed;
- applies the same rule to the cumulative ceiling so a wizard-written zero can no
  longer block every retry.

No rows are deleted, no approval or permission is granted, AI and external providers
are not enabled, and no privacy, budget, token, or request-count setting is modified.
