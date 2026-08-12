# Full bug audit — Mixarr v2.4.23

- **Repository version:** 2.4.23 (`package.json`)
- **Audited commit:** `b5c3b1b57282fad5f60d2ff4e051a01ad7453a5a` ("Fix portable recipe share-code security and clipboard handling")
- **Branch:** `main`
- **Audit date:** 2026-07-31
- **Scope:** web application, API routes, background workers, database/migrations, Docker deployment, supported integrations. The paused native iPhone application was **not** built, modified, or inspected beyond shared API contracts.

---

## Executive summary

Mixarr is in unusually good health for its size (≈69k lines under `src/lib`, ≈5.6k under `src/ai`, 609 API route files, 256 Prisma models, 126 test files). The whole-repository sweep for the classic decay markers came back **empty**: no `TODO`, `FIXME`, `HACK`, or `XXX`; no `@ts-ignore` or `@ts-expect-error`; exactly one intentional empty `catch` (a stream-reader cancel). Type checking is clean under `strict`, and the only ESLint output is three pre-existing warnings. The AI governance subsystem in particular is defensively written and unusually well commented — the zero-value semantics that the brief flags as a common failure mode are already handled correctly and deliberately in `requestLimits.ts` and `costLimits.ts`.

The defects that remain are therefore not decay; they are **gaps at the seams** — places where a correct core is reached through an incorrect edge:

1. **Configuration seam.** Three different boolean environment parsers coexisted, and the weakest one (`!== "false"`) guarded fail-open AI and network-egress switches. `.env.example` documents *both* a numeric and a textual convention in the same file, so following it could silently fail to disable a feature.
2. **Browser seam.** v2.4.23 introduced a correct, fallback-capable clipboard helper but wired it into exactly one of six copy controls. On the plain-HTTP LAN address where Mixarr is normally reached, `navigator.clipboard` is undefined, so the other five threw synchronously inside their click handlers and did nothing at all. One of them reveals a scoped API token exactly once.
3. **Upgrade seam.** Container installations upgrade with `prisma db push`, which reconciles schema shape but never executes migration SQL. A migration that *also* backfilled data was therefore only half-applied, and an administrator's global daily AI request limit silently stopped being enforced.
4. **UI/server contract seam.** The AI governance panel offers retry-attempt values the server rejects with a 400.

The most serious risk areas are, in order: the `db push` upgrade path (silent, persistent, affects cost controls), unrecoverable credential loss through the clipboard, and boolean configuration that fails open.

Five defects were confirmed and reproduced; all five are fixed with automated coverage. Four further items are recorded as suspected risks with the evidence and the next verification step, deliberately kept separate from the reproduced findings.

---

## Verification baseline

Established **before** any code change, on commit `b5c3b1b`.

| Command | Result (baseline) | Result (after fixes) |
| --- | --- | --- |
| `npm install` (lockfile present, `postinstall` runs `prisma generate`) | Pass | Pass |
| `npm test` (`tsc -p tsconfig.tests.json` + `node --test`) | **Pass** — 1294 tests, 1293 pass, 0 fail, 1 skipped | **Pass** — 1322 tests, 1321 pass, 0 fail, 1 skipped |
| `npx tsc --noEmit -p tsconfig.json` (strict) | **Pass** — 0 errors | **Pass** — 0 errors |
| `npx next lint` | **Pass** — 0 errors, 3 warnings | **Pass** — 0 errors, 3 warnings (identical) |
| `npm run build` (production) | **Pass** | **Pass** |
| `docker compose config` | **Pass** | **Pass** |
| `docker build .` | **Pass** | **Pass** |
| Live Postgres 16 upgrade rehearsal (throwaway container) | n/a | **Pass** — used to reproduce and verify BUG-005 |

Notes on the baseline:

- **There is no CI.** No `.github/` directory exists; every check above is run manually. This is itself the largest process risk in the repository (see *Deferred work*).
- **Formatting:** the repository has no formatter (no Prettier config, no `format` script). Style is enforced by convention only.
- **Migration validation:** there is no `prisma migrate` validation step. Containers run `prisma db push`, so `prisma/migrations` is effectively documentation rather than the executed upgrade path. This is the root of BUG-005.
- **End-to-end tests:** none exist. All 126 test files are Node `node:test` unit/contract tests over `src/lib/*.test.ts`. UI behaviour is covered by source-contract assertions (`readFileSync` + regex), an established convention in this repository (`appShellLayout.test.ts`, `plexUserMappingUi.test.ts`).

### Skipped / quarantined tests

Exactly one test skips, and it is legitimate and environment-conditional:

- `src/lib/storageSafety.test.ts:81` — `context.skip("Windows developer mode may deny symlink creation")`. It guards a symlink-creation assertion on Windows hosts. Not a quarantined failure; it would run on the Linux container.

No commented-out, `.only`, `.todo`, or permanently disabled tests were found.

### Warning-sign sweep

| Marker | Occurrences in `src` (excluding tests) |
| --- | --- |
| `TODO` / `FIXME` / `HACK` / `XXX` | **0** |
| `@ts-ignore` / `@ts-expect-error` | **0** |
| Empty `catch` blocks | **1** (`src/ai/providers/http.ts:199`, `try { await reader.cancel(); } catch {}` — correct) |
| `eslint-disable` | 20, all `react-hooks/exhaustive-deps` on load-on-mount effects or `no-img-element`; consistent with repository convention |
| Debug routes / development bypasses | 2, both correctly gated (`NODE_ENV === "development"` for a dashboard preview; `DASHBOARD_DEBUG`/`SMART_MIX_EXPLANATION_DEBUG` log switches) |

---

## Confirmed bugs

### BUG-001 — Boolean environment flags silently ignore the `0`/`no`/`off` convention the same file documents

- **Severity:** High · **Confidence:** High (reproduced) · **Blocks release:** No (fixed)
- **Component:** Configuration (`src/lib/aiAdvisory/core.ts`, `communityRecipes/service.ts`, `integrations/scheduler.ts`, `integrations/service.ts`, `metrics.ts`, `api/integrations/tautulli/import/route.ts`, `api/integrations/webhooks/route.ts`)

**User-visible impact.** An administrator who disables an AI feature by setting `AI_PLAYLIST_SUMMARIES_ENABLED=0` finds it still enabled. Mixarr keeps constructing prompts, sending playlist metadata to the configured provider, and incurring cost for a feature the operator believes is switched off. The same failure applies to `AI_METADATA_SUGGESTIONS_ENABLED`, `COMMUNITY_RECIPES_ENABLED`, `INTEGRATION_SCHEDULER_ENABLED`, and — with a security dimension — `MIXARR_ALLOW_PRIVATE_INTEGRATIONS`, where `=0` fails to re-enable private-network egress blocking.

**Technical root cause.** Three parsers coexisted:

| Parser | Location | Accepts as true | Accepts as false |
| --- | --- | --- | --- |
| `value !== "false"` / `value === "false"` | 7 call sites | everything else | `"false"` only |
| `["1","true","yes","on"]` | `externalApiSettings.ts:38` | those four | everything else |
| `["1","true","yes","on","enabled"]` | `featureFlagService.ts:59` | those five | everything else |

Meanwhile `.env.example` uses **both** conventions: `DEEZER_TAGS_ENABLED=1` and `DISCOGS_TAGS_ENABLED=0` alongside `COMMUNITY_RECIPES_ENABLED=true` and `AI_PLAYLIST_SUMMARIES_ENABLED=true`. Ten flags use numeric values and 25 use textual ones, in one file, with no stated rule. The `!== "false"` group fails **open**; `"enabled"` also failed to enable anything parsed by `externalApiSettings`.

**Reproduction.**
1. Set `AI_PLAYLIST_SUMMARIES_ENABLED=0` (or `no`, or `off`) in `.env`.
2. Start Mixarr.
3. Open a playlist → AI summaries. The feature is available and will issue provider requests.

Direct evaluation of the pre-fix predicates:

```
AI_PLAYLIST_SUMMARIES_ENABLED (!== 'false'): "0"=>true "no"=>true "off"=>true "false"=>false
externalApiSettings envEnabled:              "enabled"=>false
```

**Expected:** `0`, `no`, `off`, and `false` all disable the flag; `1`, `yes`, `on`, `true`, `enabled` all enable it.
**Actual (pre-fix):** only the exact string `"false"` disabled the fail-open group.

**Fix applied.** New single-authority module `src/lib/envBoolean.ts` (`envBoolean`, `envFlag`, `describeEnvBooleanIssue`). It accepts `1/true/yes/y/on/enabled/enable` and `0/false/no/n/off/disabled/disable`, case-insensitively and whitespace-tolerantly, **in both directions**. Every call site now passes its documented default explicitly, so an unset, blank, or unrecognized value keeps the documented behaviour rather than guessing. `externalApiSettings.envEnabled` and `featureFlagService.envBoolean` were reduced to thin delegations, preserving their signatures. `.env.example` now states the accepted spellings at the top.

`describeEnvBooleanIssue` reports an unrecognized value **without echoing it** — an environment value may be a pasted secret.

**Regression tests.** `src/lib/envBoolean.test.ts` — 7 tests covering every accepted spelling in both directions, default preservation for unset/blank/unrecognized input, non-echoing diagnostics, plus source-contract assertions that no call site regresses to a bare string comparison and that each flag's default is preserved (fail-open flags default `true`; `MIXARR_ALLOW_PRIVATE_WEBHOOKS` and `METRICS_ALLOW_UNAUTHENTICATED` stay opt-in `false`).

**Compatibility risk.** Low, but real and intentional: an installation that currently sets one of these flags to `0`/`no`/`off` will now see the feature **disabled**, which is what the value always meant. No persisted database configuration is touched. This is a behaviour change and belongs in the release notes.

**Complexity:** Small.

---

### BUG-002 — AI governance offers up to 10 retry attempts; the server rejects anything above 1

- **Severity:** Medium · **Confidence:** High (confirmed by code inspection across all three layers) · **Blocks release:** No (fixed)
- **Component:** AI governance (`src/components/AiGovernanceDashboard.tsx`, `src/ai/governance/service.ts`)

**User-visible impact.** An administrator opens **AI Governance → Timeouts & Retries**, sets *Maximum retry attempts* to `2` (the control's `max` is `10`), presses **Save retry policy**, and receives a 400 error: "AI requests permit at most one transient retry." The control advertises a range the product does not support, and there is no way to discover the real limit from the interface.

**Technical root cause.** Three layers disagree:

| Layer | Permitted range |
| --- | --- |
| UI input (`AiGovernanceDashboard.tsx`) | `min="0" max="10"` |
| Zod schema (`governanceSchema`) | `.int().min(0).max(10)` |
| Server check (`updateAiGovernanceSettings:53`) | rejects `> 1` with 400 |
| Runtime (`request-coordinator/index.ts:206`) | `Math.min(1, config.retryCount, maximumRetryAttempts)` |

The one-retry ceiling is a deliberate cost-protection decision (a retry may be billed twice; see the `retryAfterPossibleBilling` control beside it). The interface simply never reflected it.

**Reproduction.** AI Governance → Timeouts & Retries → set *Maximum retry attempts* to `2` → Save retry policy → 400.

**Expected:** the control offers only values the server accepts, and the help text states the ceiling.
**Actual:** the control offers 0–10; anything above 1 always fails.

**Fix applied.** The server remains the authority — deliberately **not** loosened. The control is now `min="0" max="1" step="1"` with a `data-field` hook, and the panel help text reads "Mixarr permits at most one transient retry, so this field accepts only 0 or 1; zero disables retries entirely."

**Regression tests.** `src/lib/uiFailureReporting.test.ts` — asserts the control's bounds and help text, and asserts the server check and the coordinator's `Math.min(1, …)` cap remain in place, so the two sides cannot drift apart again.

**Compatibility risk.** None. No stored value changes; only the offered range narrows to the enforced one.

**Complexity:** Trivial.

---

### BUG-003 — Five of six clipboard controls fail silently outside a secure context; a one-time API token is lost unrecoverably

- **Severity:** High · **Confidence:** High (reproduced against the helper's fallback path) · **Blocks release:** No (fixed)
- **Component:** Frontend (`IntegrationCenter.tsx`, `PlaylistAiSummaries.tsx`, `BetaFeatureSettingsForm.tsx`, `BetaAdministration.tsx`, `app/recipes/[id]/page.tsx`)

**User-visible impact.** Mixarr is a self-hosted application normally reached at a plain-HTTP LAN address such as `http://192.168.1.20:3000`. That is **not** a secure context, so `navigator.clipboard` is `undefined`. Every control that called `navigator.clipboard.writeText(...)` directly therefore threw a `TypeError` synchronously inside its click handler: the button did nothing, no message appeared, and nothing indicated failure.

The worst case is **Integrations → Scoped API tokens**. The panel reveals a newly created token under the label "Copy now — shown once", and the token is stored only as a hash. Pressing **Copy** appeared to work, copied nothing, and reported nothing; navigating away destroyed the credential permanently, forcing the administrator to revoke and recreate it.

**Technical root cause.** v2.4.23 added `src/lib/clipboard.ts` — a correct helper that tries the async Clipboard API, falls back to a temporary `<textarea>` + `execCommand("copy")` (which *does* work in non-secure contexts under a user gesture), and otherwise throws a typed `ClipboardCopyError`. It was wired into exactly one call site (the recipe share code). Five call sites were left calling the raw API, three of them as `void navigator.clipboard.writeText(...)` — which does not even produce a rejected promise when `navigator.clipboard` is undefined, but a synchronous throw.

A sixth issue sits in the same area: the community-report handler wrapped **both** the report request and the clipboard write in one `try`, so a clipboard denial surfaced as **"The report could not be created."** — untrue; the report existed.

**Reproduction.**
1. Browse to Mixarr over `http://<lan-ip>:3000` (not `localhost`, not HTTPS).
2. Settings → Integrations → create a scoped API token.
3. Press **Copy** on the revealed token.
4. Nothing is copied and nothing is reported. The browser console shows `TypeError: Cannot read properties of undefined (reading 'writeText')`.

**Expected:** the copy succeeds via the `execCommand` fallback; if it genuinely cannot, the interface says so and tells the user the token is still on screen and must be copied manually before leaving.
**Actual (pre-fix):** silent no-op; the credential is lost on navigation.

**Fix applied.** All five sites now route through `copyTextToClipboard`, giving them the `execCommand` fallback and a typed failure. Each reports its own outcome truthfully:

- `IntegrationCenter` gained `copyToken()`: success sets a confirmation, failure sets an error naming the consequence — *"Select the token above and copy it manually before leaving this page."*
- `PlaylistAiSummaries` gained `copySummary()` and points at the existing Export button as an alternative.
- `BetaFeatureSettingsForm` points at Download Report.
- `BetaAdministration` reports through its new error channel (see BUG-004).
- The community report now separates the two stages: a clipboard denial reads *"The report was created, but the browser denied clipboard access."*

`ClipboardCopyError`'s message was generalized from "The share code was created, but the browser denied clipboard access." to "The browser denied clipboard access.", so each caller states what actually succeeded. The recipe page still names the share code specifically.

**Regression tests.** `src/lib/uiFailureReporting.test.ts` — 9 tests: every call site is asserted to be free of direct `navigator.clipboard.writeText` and to use the helper; the token site is asserted to keep its recoverable-failure wording; the helper's fallback ordering is exercised functionally (API → append → `execCommand` → cleanup) and asserted to throw `ClipboardCopyError` when `execCommand` returns false; the report/copy stage separation is asserted.

**Compatibility risk.** None.

**Complexity:** Small.

---

### BUG-004 — Beta administration has no error handling: failed saves disable their controls permanently and a failed load spins forever

- **Severity:** Medium · **Confidence:** High (confirmed by inspection; the component is the only one in the repository with zero `try`/`finally`) · **Blocks release:** No (fixed)
- **Component:** Frontend (`src/components/BetaAdministration.tsx`)

**User-visible impact.** Three distinct failures in one admin panel:

1. **Infinite spinner.** `load()` had no `try`/`catch` and was invoked as `void load()`. If `/api/admin/beta/features` returned 403 (non-administrator) or any error, `payload` stayed `null` and the panel showed "Loading beta administration..." forever, with the rejection swallowed.
2. **Permanently disabled controls.** `updateFeature` and `updateAccess` set `working` before the request and cleared it only on the success path. A rejected save left the checkbox `disabled`, the row stuck reading **SAVING**, and no error anywhere — the administrator believes the toggle is saving when it has already failed.
3. **Invisible failures.** The only status line renders `message` beside a `CheckCircle2` success icon, so there was no channel capable of expressing failure at all.

A fourth, smaller issue: the sponsors-card toggle performed a bare `await axios.put(...)` inside its `onChange`, so its failure was an unhandled rejection.

**Reproduction.** Sign in as a non-administrator and open the beta administration panel: the loading spinner never resolves. Or, as an administrator, stop the database and toggle any beta flag: the row reads SAVING indefinitely and no error is shown.

**Expected:** a failed load shows a retryable error; a failed save clears the busy state, restores the displayed value, and states that the previous setting is unchanged.
**Actual (pre-fix):** infinite spinner / permanent SAVING / silence.

**Fix applied.** `load()` now catches and sets `loadError`, and the panel renders a retryable error instead of the spinner when it has no payload. `updateFeature`, `updateAccess`, and the extracted `toggleSponsorsCard` each clear `working` in `finally` and set a new `actionError`, whose messages state the consequence — *"…could not be updated. The previous setting is unchanged."* Errors render with `role="alert"` and a `ShieldAlert` icon, deliberately **not** through the `CheckCircle2` success line. `updateFeature` also re-runs `load()` after a failure so the displayed checkbox returns to the server's actual value rather than the optimistic one.

**Regression tests.** `src/lib/uiFailureReporting.test.ts` — 4 tests asserting `finally { setWorking(""); }` on every mutation, the retryable load error, that failures use `role="alert"` and never the success indicator, and the "previous setting is unchanged" wording.

**Compatibility risk.** None.

**Complexity:** Small.

---

### BUG-005 — Container upgrades silently drop the global daily AI request limit

- **Severity:** High · **Confidence:** High (**reproduced end-to-end against Postgres 16**) · **Blocks release:** No (fixed)
- **Component:** Database upgrade path (`Dockerfile`, `prisma/migrations/20260801010000_ai_daily_request_limit_configuration_v2413`)

**User-visible impact.** An administrator who configured a global daily AI request cap (for example 500 requests/day) before v2.4.13 finds, after upgrading a Docker installation, that the cap is no longer enforced. The AI Governance page still displays the stored number, so nothing looks wrong, but every request is admitted. This is a cost control that fails **open** and stays failed. It affects any container installation that set the limit before v2.4.13 — including installations already running v2.4.13 through v2.4.23, which never received the backfill either.

**Technical root cause.** Containers upgrade with `prisma db push`, which reconciles schema *shape* only and never executes the SQL under `prisma/migrations`. The Dockerfile CMD compensates by executing three specific SQL files by hand. The v2.4.13 migration both **added columns and backfilled data**, and it was not among them.

`db push` therefore added `"dailyRequestLimitMode" TEXT NOT NULL DEFAULT 'UNLIMITED'` to `AiGovernanceSetting`, which sets **every existing row** to `'UNLIMITED'`. The migration's compensating statement — promoting rows with a positive stored limit to `'LIMITED'` — never ran. `resolveRequestLimitScope` then computes `enforced = requestedMode !== "UNLIMITED" && limit != null`, which is `false`, so the stored 500 is ignored.

`AiProviderBudget` and `AiUserLimit` default to `'INHERIT'`, which `resolveRequestLimitScope` *does* enforce (documented there as "INHERIT (including legacy rows written before the mode existed) enforces a stored positive limit"). Only the global scope regressed — the module was written to survive a missing backfill, but the one column whose default is `'UNLIMITED'` defeats that defence.

**Reproduction (performed against a throwaway `postgres:16-alpine` container).**

1. Create the pre-v2.4.13 shape and a configured limit:
   ```sql
   CREATE TABLE "AiGovernanceSetting" ("id" TEXT PRIMARY KEY, "dailyRequestLimit" INT, "monthlyRequestLimit" INT);
   INSERT INTO "AiGovernanceSetting" VALUES ('global', 500, NULL);
   ```
2. Apply what `prisma db push` does:
   ```sql
   ALTER TABLE "AiGovernanceSetting" ADD COLUMN IF NOT EXISTS "dailyRequestLimitMode" TEXT NOT NULL DEFAULT 'UNLIMITED';
   ```
3. Observe: `global | 500 | UNLIMITED`.
4. Evaluate the real governance module with that row:
   ```
   mode=UNLIMITED, limit=500, usage=99999  ->  unlimited: true,  allowed: true    <-- throttle gone
   mode=LIMITED,   limit=500, usage=99999  ->  unlimited: false, allowed: false   <-- correct
   ```

**Expected:** the configured 500/day limit continues to be enforced after upgrading.
**Actual (pre-fix):** the limit is stored, displayed, and ignored.

**Fix applied.** New idempotent companion `prisma/db-push-v2.4.13-request-limit-backfill.sql`, wired into the Dockerfile CMD after `db push`, following the existing `db-push-v2.1.1-backfill.sql` precedent. It promotes rows to `'LIMITED'` only where a **positive** limit is stored, and clears the ambiguous zero-limit rows.

The promotion cannot override a deliberate choice: `validateRequestLimitConfiguration` returns `limit: mode === "UNLIMITED" ? null : limit` ("Unlimited clears any stored number so a later mode change cannot resurrect it"), so a row holding *both* `'UNLIMITED'` and a positive number can only be one that missed the backfill.

**Verification of the fix (same live database):**
- After the backfill: `global | 500 | LIMITED` — enforced again.
- The legacy zero row became `NULL | UNLIMITED` — the unrecoverable-zero state cleared.
- A deliberate `('deliberate-unlimited', NULL, 'UNLIMITED')` row was **untouched**.
- Running the file three times produced identical output — idempotent.

**Regression tests.** `src/lib/dbPushUpgradeBackfill.test.ts` — 6 tests: the Dockerfile executes the backfill *after* `db push`; every promotion statement is guarded by both `> 0` and the current mode (so it stays idempotent and never invents a limit); the file contains no `DELETE`/`DROP`/`TRUNCATE`; the three request-limit semantics the backfill restores are asserted against the real `evaluateRequestLimit`. A fourth test enumerates **all** migrations that backfill data without a `db push` companion and pins the count at its audited value of 13, so the class cannot silently grow.

**Compatibility risk.** Medium and deliberate: on first start after this change, a container installation whose global daily request limit was silently disabled will have it **enforced again**. That is the restoration of the administrator's original intent, but it is a live behaviour change and must appear in the release notes. Installations that never set a limit are unaffected (the statements match no rows).

**Complexity:** Small (SQL + one CMD entry), but the reasoning required to establish safety was the largest part of this audit.

---

## Suspected risks (not reproduced — evidence and next step recorded)

These are **not** claimed as bugs. Each is a real observation whose user impact I could not establish within this audit.

### RISK-001 — 13 further migrations backfill data that container upgrades never receive

- **Evidence.** The same mechanism as BUG-005. 20 of 84 migrations contain `UPDATE`/`INSERT` statements; one is executed directly by the Dockerfile, six are covered by existing companion files, and **13 are not**:
  `beta_feature_settings`, `playlist_version_history`, `beta_feature_polish`, `adaptive_automation_policies`, `playlist_orchestration_foundation`, `playlist_roles_progression_chains`, `mix_recipe_foundation_v230`, `ai_recipe_copilot_v244`, `plex_user_mapping_reliability`, `ai_playlist_summaries_metadata_suggestions_v246`, `ai_assisted_troubleshooting_v248`, `ai_provider_feature_authorization_v2412`, `recipe_copilot_reliability_v2415` (11 statements — the largest).
- **Why not confirmed.** Many of these statements plausibly only restate a column `DEFAULT` that `db push` already applies, in which case they are harmless. Establishing impact requires reading each one against its schema change and its consuming code, as was done for v2.4.13.
- **Next verification step.** For each, determine whether the backfilled column's `db push` default differs from the value the migration writes, and whether any read path treats the default as a distinct state. `recipe_copilot_reliability_v2415` and `ai_provider_feature_authorization_v2412` should be examined first — both touch AI authorization or reliability behaviour.
- **Guard in place.** The count is pinned by `dbPushUpgradeBackfill.test.ts`; it can shrink but not grow.

### RISK-002 — Plex requests built with `new URL()` discard a configured base path

- **Evidence.** `src/lib/integrations/service.ts:48` builds Plex requests as `new URL(pathname, server.uri…)` with root-anchored paths such as `/library/sections`. A leading `/` discards the base path, so a server configured at `http://host/plex` would be queried at `http://host/library/sections`. The repository is inconsistent here: `src/lib/plex.ts` uses string concatenation (`${conn.uri}/identity`, preserves the base path) and `src/lib/mobile/directPlay.ts` uses a *relative* specifier (`library/metadata/…`, also preserves it).
- **Why not confirmed.** `server.uri` is normally populated from Plex's own connection discovery, which returns root-level URIs, so a base path may be unreachable in practice. I did not establish whether a user-entered sub-path URI is possible.
- **Next verification step.** Determine whether `server.uri` can be set manually to a sub-path (check the server-add UI and any manual-URI route); if so, add a Plex fixture served under `/plex` and assert connection-test and account-discovery paths.

### RISK-003 — Community bundle ZIP inspection trusts central-directory sizes and scans bytewise

- **Evidence.** `inspectZipCentralDirectory` (`src/lib/communityRecipes/core.ts`) enforces the file-count and extracted-size limits using `originalSize` read from the ZIP central directory — a value the uploader controls — before handing the archive to `unzipSync`, which decompresses the actual data. A crafted bundle could understate its expansion. Separately, the scan walks every byte looking for the `0x02014b50` signature, so that byte sequence occurring inside compressed data would be parsed as a spurious entry and could reject a valid bundle.
- **Why not confirmed.** Exploiting the first requires crafting a ZIP with inconsistent central-directory and local-header sizes and confirming `fflate`'s behaviour; the second requires constructing compressed data containing the signature. Neither was attempted. Both require an authenticated user to upload a bundle to a self-hosted instance.
- **Next verification step.** Craft the two archives as fixtures and assert that (a) a size-lying bundle is rejected before memory grows, and (b) a bundle whose compressed data contains the signature still imports.

### RISK-004 — `recipeIdentityDefaults.transitionPreference` is accepted and stored but never consumed

- **Evidence.** `transitionPreference: z.enum(["smooth", "balanced", "adventurous"])` is validated, persisted, exposed to the Recipe Copilot's editable-field list, and defaulted in Recipe Studio — but the value `"adventurous"` appears nowhere else in the repository, and no generation or scoring code reads the field.
- **Why not confirmed.** This is a dead-setting/maintainability concern rather than a demonstrated malfunction; a setting that does nothing is not the same as one that does the wrong thing. I did not exhaustively trace every scoring path.
- **Next verification step.** Trace `playlistIdentity` consumption in `smartMixEngine/v2` scoring. If genuinely unused, either wire it in or mark it clearly in the schema so authors are not misled.

---

## Prioritized repair sequence

Ordered as the brief specifies. Items marked ✅ were completed in this audit.

**1. Critical data-loss, security, or privacy problems**
- ✅ BUG-003 — unrecoverable API-token loss through a silent clipboard failure.
- ✅ BUG-001 — fail-open configuration, including `MIXARR_ALLOW_PRIVATE_INTEGRATIONS` (network egress).

**2. Startup, migration, and deployment failures**
- ✅ BUG-005 — `db push` upgrade drops the global AI request limit.
- ⬜ RISK-001 — audit the 13 remaining un-companioned data backfills.

**3. Broken primary workflows**
- ✅ BUG-004 — beta administration panel unusable on any error.

**4. AI-provider reliability and cost-control failures**
- ✅ BUG-002 — retry-attempt control offers unsupported values.
- ✅ BUG-005 also belongs here (it is a cost control).

**5. Concurrency and background-job issues**
- None found. `jobLock.ts`, `concurrency.ts`, and `workerHealth.ts` were reviewed and are sound: lock keys are deduplicated, leases carry expiry and heartbeats, release is identity-checked (`activeByKey[key]?.id === job.id`), and `mapWithConcurrency` bounds its worker pool correctly.

**6. UI correctness and accessibility**
- ✅ BUG-003 / BUG-004; error states now carry `role="alert"`.
- ⬜ RISK-004 — dead recipe setting.

**7. Performance and resource usage**
- No measured regressions; see *Performance findings*.

**8. Maintainability improvements**
- ⬜ Introduce CI (see below) — the highest-leverage remaining item.
- ⬜ Adopt a formatter so "formatting" becomes a real verification step.

---

## Performance findings

Profiling was deliberately limited: the brief asks for measurement rather than premature optimization, and no production-like database or Plex library was available in this environment. What was measured:

| Measurement | Result |
| --- | --- |
| Production build (`npm run build`) | Completes successfully; no route exceeded expectations. First Load JS shared by all: **87.8 kB** — reasonable for an application of this size. |
| Largest client route | `/smart-builder` at 16.5 kB route / 182 kB first load — the heaviest page, worth watching but not anomalous. |
| Full unit suite | 1322 tests in ≈17 s. |
| Docker image build | Completes successfully. |

Structural observations, **not** confirmed as problems:

- `src/lib/playlistService.ts` is 3,705 lines and `libraryHealth.ts` 1,621. Size alone is not a defect, and the repository ships a `benchmark-library-scan` script plus `playlistGenerationQueryMetrics.ts`, indicating query cost is already tracked deliberately.
- `prom-client` metrics are registered with bounded label sets as far as reviewed; no unbounded-cardinality metric was identified.
- Retention and cleanup are implemented as first-class features (`storage-cli.js report|cleanup`, `libraryBackup` retention, AI retention settings with per-category day limits), so the "rows accumulating without retention" class appears to be actively managed.

No optimization was performed, because no measurement justified one.

---

## Security and privacy findings

- **BUG-001 has a security dimension.** `MIXARR_ALLOW_PRIVATE_INTEGRATIONS=0` failed to block private-network destinations, leaving SSRF protection off for an operator who believed they had enabled it. Fixed. The two fail-*closed* flags (`MIXARR_ALLOW_PRIVATE_WEBHOOKS`, `METRICS_ALLOW_UNAUTHENTICATED`) failed in the safe direction and remain opt-in `false` after the fix.
- **BUG-003 is a credential-handling defect.** A scoped API token shown exactly once could be lost without any indication. Fixed, and the failure path now tells the user the token is still on screen.
- **No secrets are exposed by the changes.** Every new message was written to contain configuration values and variable *names* only. `describeEnvBooleanIssue` deliberately does not echo the offending value, and a test asserts this.
- **Existing redaction is strong.** `src/ai/security/redaction.ts`, `supportRedaction.ts`, and the `scanSensitiveData` detectors in `mixRecipes/transfer.ts` are thorough; `normalizeResponse.ts` filters credential-shaped keys out of diagnostics (`safeKeys`) before logging. The AI request path hashes prompts (`oneWayPromptHash`) rather than storing them, and `sanitizeUsagePayload` strips prompt/response/credential keys before persisting provider usage.
- **`streamToken.ts` reviewed** (untested but sound): HMAC-SHA256, constant-time comparison, length-checked before `timingSafeEqual`, bound to track *and* user, short TTL, and deliberately separate from the long-lived bearer token.
- **No new logging of user data** was introduced. The one console statement touched (`[CommunityRecipe] Portable export blocked`) already logged only category and path codes.

---

## Migration and deployment instructions

1. **No schema migration is required.** No Prisma model changed.
2. **One new idempotent SQL file runs automatically on container start:** `prisma/db-push-v2.4.13-request-limit-backfill.sql`, added to the Dockerfile CMD after `prisma db push`. It is safe to run repeatedly and on a fresh install (it matches no rows).
3. **Non-container installations** that manage the database with `prisma migrate` already received this backfill from `20260801010000_ai_daily_request_limit_configuration_v2413` and need no action.
4. **Two live behaviour changes must appear in the release notes:**
   - A global daily AI request limit that had been silently disabled by a container upgrade **will start being enforced again**. Administrators who intended no limit should confirm the setting reads *Unlimited* in AI Governance → Budgets.
   - Boolean environment flags set to `0`, `no`, or `off` now genuinely disable their feature. Anyone who set `AI_PLAYLIST_SUMMARIES_ENABLED=0`, `AI_METADATA_SUGGESTIONS_ENABLED=0`, `COMMUNITY_RECIPES_ENABLED=0`, `INTEGRATION_SCHEDULER_ENABLED=0`, or `MIXARR_ALLOW_PRIVATE_INTEGRATIONS=0` should verify that is what they meant.
5. **Rollback.** Reverting the code restores the previous behaviour. The SQL backfill is not automatically reversible, but it only writes values the interface itself would have written; no data is destroyed.

**Recommended next release version: 2.4.24** (patch). The changes are corrective, add no features, and change no schema.

---

## Deferred work

- **Native iPhone application — out of scope, not a defect.** No Apple development machine is available. No iOS or Xcode file was created, modified, or built. The shared API contracts a future client would consume (`src/lib/mobile/api.ts`, `directPlay.ts`, `streamToken.ts`) were read for consistency only; `streamToken.ts` was reviewed and found sound. This is **not** an unresolved defect in the web application.
- **Continuous integration.** There is no `.github/` directory. Every verification command in this report was run manually, and nothing prevents a future change from landing with failing tests. Adding a workflow that runs `npm test`, `tsc --noEmit`, `next lint`, `npm run build`, and `docker build` is the single highest-leverage maintainability improvement available and should precede further feature work.
- **End-to-end tests.** None exist. The source-contract convention used for UI regressions is effective at pinning specific wording and structure but cannot catch runtime rendering failures. The clipboard and beta-administration fixes in particular would be better served by a browser-level test that actually loads the page over a non-secure origin.
- **Formatter.** No Prettier or equivalent, so "formatting" cannot be verified as the brief's baseline expects.
- **RISK-001 through RISK-004** as described above.
- **Live-service integration testing.** No Plex, Tautulli, or AI provider was reachable. All integration behaviour was reviewed statically or through existing fixtures.

---

## Status table

| Bug ID | Severity | Component | Status | Root cause | Test added |
| --- | --- | --- | --- | --- | --- |
| BUG-001 | High | Configuration / env parsing | Fixed | Three divergent boolean parsers; the fail-open `!== "false"` group ignored the `0`/`no`/`off` convention `.env.example` itself documents | `src/lib/envBoolean.test.ts` (7) |
| BUG-002 | Medium | AI governance UI ↔ API | Fixed | UI offered `max="10"` retry attempts; server rejects `>1` and runtime caps at 1 | `src/lib/uiFailureReporting.test.ts` (2) |
| BUG-003 | High | Frontend clipboard | Fixed | v2.4.23's fallback-capable helper wired into 1 of 6 call sites; `navigator.clipboard` is undefined on non-secure LAN origins | `src/lib/uiFailureReporting.test.ts` (9) |
| BUG-004 | Medium | Beta administration UI | Fixed | No `try`/`catch`/`finally`; busy state cleared only on success and no channel could express failure | `src/lib/uiFailureReporting.test.ts` (4) |
| BUG-005 | High | Database upgrade path | Fixed | `prisma db push` applies schema shape only; the v2.4.13 data backfill had no Dockerfile companion, so `AiGovernanceSetting` rows kept the `'UNLIMITED'` column default | `src/lib/dbPushUpgradeBackfill.test.ts` (6) |
| RISK-001 | Unknown | Database upgrade path | Suspected—needs evidence | 13 further migrations backfill data with no `db push` companion | Count pinned by `dbPushUpgradeBackfill.test.ts` |
| RISK-002 | Unknown | Plex integration | Suspected—needs evidence | `new URL()` with a root-anchored path discards a configured base path; three inconsistent URL-joining styles in the repository | None |
| RISK-003 | Unknown | Community bundle import | Suspected—needs evidence | ZIP limits computed from attacker-supplied central-directory sizes; bytewise signature scan can misparse | None |
| RISK-004 | Low | Recipe schema | Suspected—needs evidence | `transitionPreference` validated and stored but never read by any engine path | None |

---

## Scope and honesty statement

**This audit does not claim to have found all bugs.** A repository of this size — 609 API route files, 256 database models, ~75k lines of application code — cannot be exhaustively verified in a single pass, and no such claim is made.

**What was examined systematically:** the complete repository structure and documentation; all package manifests, Docker and Compose configuration, and the Dockerfile CMD upgrade chain; the Prisma schema and all 84 migrations (mechanically, for the backfill class); the full warning-sign sweep across `src`; the entire `src/ai` governance, provider-normalization, and request-coordination layer; the configuration and boolean-parsing surface across every call site; every clipboard call site in the application; the job-locking and concurrency primitives; the authentication, admin-authorization, and mobile stream-token modules; and cross-layer enum consistency between the recipe schema, engine, and UI.

**What was reproduced:** BUG-001 by direct evaluation of the pre-fix predicates; BUG-005 end-to-end against a live Postgres 16 instance, including the runtime consequence through the real governance module and verification that the fix is idempotent and cannot override a deliberate setting; BUG-003's fallback and failure paths functionally through the helper. BUG-002 and BUG-004 were confirmed by inspection across every layer involved rather than by executing the UI, because the repository has no browser-level test harness — this is stated as a limitation, not glossed over.

**What remains uncertain:** the four recorded risks; the behaviour of all integrations against live Plex, Tautulli, and AI provider services, none of which were reachable; runtime behaviour of the React components, which have no executable test coverage in this repository; and the large majority of the 609 API routes, which were surveyed structurally rather than individually exercised.

**What was not touched:** the native iPhone application, per the brief.
