# Recipe Copilot (v2.4.4)

Recipe Copilot adds AI-assisted creation, refinement, explanation, diagnosis, optimization, intent comparison, naming, description, onboarding, and playlist-example conversion directly to Recipe Studio. It is advisory: AI-generated recipes are never activated automatically, never approved automatically, and never sent directly to the deterministic playlist engine.

## Workflow and actions

Open **AI Copilot** from the Recipe Studio toolbar. The drawer identifies whether it is analyzing a new draft, the current unsaved recipe, or the last saved recipe. The primary actions are:

- **Create** — turn a written description into a structured, editable recipe draft.
- **Refine** — compare current and proposed rules with reasons, expected behavior, side effects, and confidence. Accept all, reject all, edit values, or select changes individually.
- **Explain** — provide a short summary and a detailed section-by-section explanation of the current saved or unsaved state.
- **Diagnose** — identify likely causes, affected rules, evidence, confidence, corrections, purpose impact, and whether local validation is available. Diagnosis never edits the recipe.
- **Optimize** — confirm or correct the presumed purpose before requesting improvements that preserve it.
- **Compare intent** — compare written intent with configured behavior and local candidate analysis.
- **Names, descriptions, and onboarding** — generate non-executable supporting content.
- **Playlist example conversion** — use aggregate local characteristics to create a reusable concept, not a static copy of track IDs.

Example prompts:

- Create: “Create a relaxing work playlist with mostly familiar music and a few discoveries.”
- Refine: “Reduce artist repetition while keeping the same purpose.”
- Explain: “Explain the pacing and discovery behavior for a non-technical listener.”
- Diagnose: “Why does this produce too few candidates and repeat albums?”
- Optimize: “Keep the workout progression, but improve candidate availability and automation safety.”

## Structured validation and safety

Provider output must match the strict Recipe Copilot schema (`1.0`). Unknown keys, unknown rule fields, executable content, credentials, track IDs, database queries, commands, URLs, and arbitrary settings are rejected. A safe patch is normalized into the existing Mixarr recipe schema, forced inactive, and passed through:

1. AI response schema validation.
2. Recipe schema normalization.
3. Unsupported-rule detection.
4. Permission and provider validation.
5. Compatibility and local metadata checks.
6. Recipe and automation safety checks.
7. Intent conflict detection.
8. Local candidate estimation.
9. Governance validation.
10. Conservative status assignment.

Candidate estimates include matching tracks, requested size, artist and album capacity, restrictive rules, confidence, and achievability. Track-level library metadata is not required and is not sent for candidate estimation.

Parent and inheritance recommendations explain the built-in parent, inherited versus child rules, conflicts, compatibility requirements, and maintenance benefit. A parent is never attached automatically. Safety recommendations are likewise advisory.

## Status and approval workflow

AI proposals use these statuses:

- **Draft** — generated but not reviewed or validated.
- **Needs Review** — assumptions, warnings, conflicts, unsupported requests, or low-confidence choices need confirmation.
- **Validated** — schema, compatibility, candidates, and safety passed. This does not mean approved or active.
- **Approved** — an authorized user separately confirmed review. Approval leaves the recipe inactive.
- **Rejected** — explicitly rejected and retained according to audit policy.
- **Superseded** — replaced by a newer AI or manual revision.
- **Quarantined** — invalid, unsafe, unsupported, suspicious, or governance-blocked. It cannot be approved or activated until corrected and revalidated.

The backend rejects Draft → Approved, Needs Review → Approved, and Quarantined → Approved. Applying an existing-recipe proposal creates a normal recipe revision, stores the logical structured diff and AI request/proposal IDs, clears approval, and leaves the recipe disabled. Restore creates another restorable, inactive revision. Activation remains a separate explicit action after normal approval.

## Privacy, provider governance, and costs

Recipe Copilot uses the central v2.4.x AI provider coordinator and respects provider enablement, model availability, per-user access, request-count and monetary limits, provider-native context validation, context trimming, timeouts, retry policy, hard shutdown, fallback policy, usage history, and audit logging. Mixarr-configured token caps were retired in v2.4.17; token estimates remain informational.

- **Local Only** permits only administrator-confirmed local providers. Remote fallback is disabled.
- **Metadata Limited** sends recipe structure, safe rule values, aggregate analysis, and the user’s request. Recipe identity, server/library IDs, selected track IDs, secrets, paths, and unrelated data are excluded.
- **Anonymous Metadata** applies the central anonymous transformation policy.
- **Full Metadata** requires the existing acknowledgment and still excludes credentials, tokens, cookies, paths, and unrelated user data.

The preflight displays the resolved provider and model, privacy mode, whether remote operation is allowed, estimated input/output tokens, the one-attempt estimated cost, and the exact blocking reason. It refreshes when the drawer opens, when its request inputs change, when the window regains focus after settings work, or when Refresh is selected. No request is sent when AI or the feature is disabled, a provider/model is unavailable, privacy policy blocks it, access is denied, a limit is reached, or context cannot be safely admitted. Provider, model, pricing, initial-cost, daily, monthly, privacy, authentication, rate-limit, temporary-provider, and real retry-cost failures have separate codes.

## Permissions and audit

Named checks cover `recipe.ai.use`, `recipe.ai.create`, `recipe.ai.refine`, `recipe.ai.explain`, `recipe.ai.diagnose`, `recipe.ai.optimize`, `recipe.ai.view_history`, `recipe.ai.review`, `recipe.ai.approve`, `recipe.ai.quarantine`, and `recipe.ai.configure`. The current role model grants ordinary owner actions to authenticated users and reserves approval, quarantine, and configuration for administrators.

Durable request/proposal records preserve the original request and proposal, provider/model, privacy mode, tokens/cost, prompt version, response identifier, confidence, assumptions, warnings, unsupported requests, candidate/compatibility results, intent conflicts, parent/inheritance recommendations, status, prior configuration, apply/approval actors, and manual-edit markers. Recipe and central AI audit histories record requests, failures, proposal creation, application, validation, status changes, approval, rejection, quarantine, superseding, and restoration without prompts, raw credentials, or authorization headers.

## Troubleshooting

- **Request blocked** — read the exact preflight reason; enable Recipe Copilot, configure an eligible provider/model, or resolve the stated privacy/budget/limit policy.
- **Invalid provider response** — retry only when safe; malformed or hallucinated fields never enter the recipe.
- **Stale proposal** — the recipe changed while the request ran. Compare the current state and generate a new proposal.
- **Too few candidates** — review local reduction evidence, missing metadata, playlist size, repetition limits, and strict filters.
- **Quarantined** — correct blocking findings, then revalidate. It cannot be approved directly.
- **Provider failure or cancellation** — unsaved Recipe Studio changes remain intact. Retry still passes normal cost and request protections.

Limitations: estimates are not guarantees; provider explanations can be imperfect; local metadata coverage constrains diagnosis; no provider receives credentials or gains access to Plex mutation, files, plugins, or arbitrary execution.
