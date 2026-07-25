# Daily AI Request Limit Configuration (v2.4.13)

Fixes Recipe Copilot (and every other AI feature) being blocked by `AI_DAILY_LIMIT_EXCEEDED`
with no usable interface control to change or remove the limit, and adds an explicit
daily request-limit mode so "unlimited" is a first-class, selectable choice.

## Behavior before this release

Daily request counts were enforced in `remainingBudgets()` (`src/ai/governance/service.ts`)
as a single boolean chain:

```ts
if (providerBudget?.dailyRequestLimit != null && providerCountDay >= providerBudget.dailyRequestLimit
 || governance.dailyRequestLimit != null && globalCountDay >= governance.dailyRequestLimit
 || userLimit?.dailyRequestLimit != null && userCountDay >= userLimit.dailyRequestLimit)
  violations.push("DAILY_REQUEST_LIMIT_REACHED");
```

Precedence was therefore "any scope with a non-null number wins", evaluated
provider → global → user, with the first matching scope reported.

Four defects followed from that:

1. **Zero meant zero requests allowed.** `0 != null` is true and `count >= 0` is always
   true, so a stored zero blocked every AI request permanently. `AiUserLimit.dailyRequestLimit`
   accepted zero (`nonnegative()` in `src/ai/governance/userPolicy.ts`), and both the
   provider and user forms rendered `min="0"` inputs, so zero was reachable from the UI.
2. **No global control existed.** `AiGovernanceSetting.dailyRequestLimit` had no field in the
   AI Governance dashboard. The only writer was the onboarding wizard
   (`src/ai/intelligence/service.ts`), which defaulted to 50 requests per day and 1,000 per
   month. Once activated, an administrator could not raise, lower, or clear it.
3. **Unlimited was not expressible.** A blank field meant "no limit" only by absence, and the
   onboarding input coerced blanks back to its default (`config.dailyRequestLimit ?? 50`).
4. **The monthly request limit reported a daily error.** The monthly violation pushed
   `AI_DAILY_REQUEST_LIMIT_EXCEEDED`, and Recipe Copilot mapped both it and the daily
   *cost* limit onto `AI_DAILY_LIMIT_EXCEEDED`, so three different controls produced the same
   message and none of them named the responsible scope, usage, limit, or reset time.

With `available: false`, `recipeCopilotCanRequest()` keeps the Generate button disabled — the
button was a correct reflection of a wrong verdict.

## Behavior after this release

Request-count limits are **throttles, not spending controls**. A missing, blank, or
non-positive limit now means "no request-count limit at this scope", never "zero requests".

`src/ai/governance/requestLimits.ts` is a pure module shared by admission, validation, the
settings API, the dashboard, and the tests, so no layer can drift:

| Mode | Global scope | Provider / user scope | Effect |
| --- | --- | --- | --- |
| `UNLIMITED` | yes (default) | yes | No daily request cap; any stored number is cleared |
| `LIMITED` | yes | yes | Enforced; requires a whole number ≥ 1 |
| `INHERIT` | — | yes (default) | No opinion at this scope; the broader policy applies |

Resolution, per scope:

- `UNLIMITED` → unlimited, even if a number is still stored.
- `LIMITED` with a whole number ≥ 1 → blocked when `usage >= limit`.
- `LIMITED` with a missing, zero, negative, or fractional number → **unlimited**, plus a
  reported configuration issue (`LIMITED_WITHOUT_LIMIT`, `NON_POSITIVE_LIMIT`, `INVALID_LIMIT`).
  A misconfiguration never blocks the feature.
- `INHERIT` or absent (including legacy rows written before the mode existed) → enforces a
  stored positive number, otherwise unlimited. Upgrading neither drops an intentional limit
  nor invents one.
- No settings row for the scope at all → unlimited at that scope.

Precedence across scopes: every applicable scope is evaluated independently and the
**strictest wins** — a user-level `UNLIMITED` cannot weaken the global limit. Scopes resolve
in the deterministic order global → provider → user, and the first exhausted enforced scope
is the one reported. When nothing is exhausted, the scope with the fewest remaining requests
is reported so the interface shows the limit that will bind first.

Counting is unchanged: `AiRequestAudit` rows for the current UTC day with status `COMPLETED`,
`FAILED`, `TIMED_OUT`, or `CANCELLED`. Requests blocked by governance are not counted. The
daily window resets at the next UTC midnight; the monthly window resets on the configured
budget reset day.

Administrators exempted through `adminExemptionEnabled` are resolved as `UNLIMITED` at the
user scope rather than by nulling a number.

## Protections that are unchanged

This release only corrects and exposes daily request-count behavior. Provider approval,
per-feature approval, per-request cost limits (`maximumEstimatedRequestCost`, split out from
`maximumCumulativeRequestCost` in v2.4.14), provider and
global monthly budgets, daily and monthly *cost* limits, retry cost limits, token and prompt
limits, privacy modes and the metadata allowlist, paid-provider permission, background-request
policy, emergency shutdown, and provider/model availability checks are all evaluated
separately and are untouched.

## Interface

- **AI Governance → Budgets → AI request limits** (`#ai-request-limits`): global mode selector,
  maximum requests per day, monthly request limit, today's counted requests with remaining and
  reset time, and an explicit warning when the limit is currently reached.
- **Provider limits** and **User Limits** panels each gained an Inherit / Unlimited / Limited
  selector beside their maximum-requests-per-day field.
- A blocked AI feature links to `/settings/ai?section=Budgets#ai-request-limits`, which opens
  the Budgets section and scrolls to the control. Recipe Copilot's blocked panel labels the
  link "Open AI request limits" and its ready panel shows requests used and remaining.
- Zero is rejected at every write path with a specific message rather than stored, and
  choosing Limited without a number is refused before persistence.

## Errors

- `DAILY_REQUEST_LIMIT_REACHED` → Recipe Copilot `AI_DAILY_LIMIT_EXCEEDED`.
- `MONTHLY_REQUEST_LIMIT_REACHED` (new) → Recipe Copilot `AI_MONTHLY_REQUEST_LIMIT_EXCEEDED`,
  no longer mislabeled as a daily limit.
- Both carry sanitized details — `scope`, `limit`, `current_usage`, `remaining`, `reset_at`,
  and the evaluated scopes — which the feature turns into a sentence naming the scope, the
  limit, the usage, the reset time, and where to change it. Details contain configuration
  values only: no prompts, responses, credentials, or user metadata.

## Upgrade

Apply migration `20260801010000_ai_daily_request_limit_configuration_v2413`. It is additive and
idempotent (`ADD COLUMN IF NOT EXISTS`) and it:

- adds `dailyRequestLimitMode` to `AiGovernanceSetting` (default `UNLIMITED`),
  `AiProviderBudget`, and `AiUserLimit` (both default `INHERIT`);
- marks every existing positive daily limit as `LIMITED`, preserving it exactly;
- converts stored zero daily limits to `UNLIMITED` with a null number, which releases any
  installation that was blocking every AI request with no way to recover from the interface;
- clears zero monthly request limits, which had the same unrecoverable effect.

No rows are deleted, no approval or permission is granted, AI and external providers are not
enabled, and no cost, budget, token, or privacy setting is modified.
