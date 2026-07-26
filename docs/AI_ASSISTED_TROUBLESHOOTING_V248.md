# Mixarr v2.4.8 — AI-Assisted Troubleshooting

Mixarr runs deterministic diagnostics before requesting an AI explanation. The AI provides explanations and suggestions only. No settings are changed without explicit user approval.

## What it does

The Troubleshooting Center at `/troubleshooting` creates persistent sessions for playlist and candidate problems, provider and Plex failures, library metadata gaps, scheduling and job failures, performance concerns, and import or integration problems. Contextual Troubleshoot links on recipes, generated playlists, and jobs preselect the relevant resource without collecting unrelated data.

Each session follows one ordered workflow:

1. The user selects the problem and explicitly approves diagnostic categories.
2. Mixarr collects bounded local data for the selected resource and time window.
3. The centralized sanitizer removes credentials and pseudonymizes identifying values.
4. The user may preview the sanitized bundle before it is persisted.
5. Deterministic checks produce versioned findings and evidence strength.
6. An optional governed AI request receives only the relevant sanitized subset.
7. AI output is schema-validated and may reference only real deterministic finding IDs.
8. Suggestions are stored separately and require individual review.
9. Supported recipe changes require acceptance, an exact-diff confirmation, current-version revalidation, normal recipe schema validation, and a new recipe revision.

Deterministic-only mode is the safe default and remains fully useful when AI is disabled, unavailable, rate-limited, over budget, or returns malformed output.

## Diagnostic privacy

Safe defaults include aggregate provider status, Plex status, library statistics, and recent job history. Sanitized logs, recipe configuration, track-level metadata, and integration configuration are not enabled by default. Administrators must explicitly enable the high-sensitivity categories in policy.

The recursive sanitizer handles objects, arrays, JSON-derived configuration, URLs, headers, log text, stack-trace text, and nested fields. It removes credential-like keys and inline values including passwords, API keys, access and refresh tokens, Plex tokens, authorization headers, cookies, private keys, database URLs, webhook secrets, OAuth secrets, and encryption keys. Email addresses, filesystem paths, hostnames, and IP addresses receive stable placeholders inside one session; placeholders do not correlate users across sessions.

Sanitization happens before preview, diagnostic persistence, AI submission, export, or audit metadata. A final credential scan fails closed. Mixarr records redaction counts—not the removed values.

## Deterministic checks and candidate funnels

The initial engine checks candidate exhaustion, recent failed jobs, unhealthy AI providers, unavailable Plex servers, and large BPM, genre, or energy metadata gaps. Findings contain a stable check ID and version, severity, deterministically derived evidence strength, observed and expected values, evidence, affected resources, possible next steps, freshness, and limitations.

When a retained playlist evaluation includes an ordered rejection trace, Mixarr renders a candidate funnel using the first rejection reason, so the primary total never double-counts a track. Optional overlap counts remain separate. Historical generations that did not retain a funnel are labeled unavailable rather than reconstructed or invented.

The acceptance fixture scans 2,840 tracks, rejects 2,102 by genre, 491 by release year, 183 by recent-play rules, and 53 by artist spacing, leaving 11 eligible candidates for a requested 50. The engine reports 39 unfilled positions and does not claim a rule will recover an exact number without a simulation.

## What-if simulations

Supported recipe suggestions run through the existing `previewPlaylistTracks` deterministic engine twice: once for the current recipe and once for an in-memory changed copy. The recipe version and current value must still match the reviewed suggestion. Results report candidate and playlist-fill counts before and after, runtime, new warnings, and the exact diff.

Simulations do not save recipes, update timestamps, write playlists, modify history, send notifications, or trigger integrations. Results are cached against the recipe version and proposed diff and are invalidated by version changes.

## AI privacy and cost controls

Troubleshooting uses the existing AI provider registry, feature settings, privacy modes, request coordinator, prompt and response-size limits, provider-native context validation, provider and user cost budgets, request-count limits, timeouts, bounded retries, context trimming, audit history, and fallback policy. Token estimates remain informational. External AI troubleshooting is off after migration.

Before submission, the UI shows provider, model, privacy mode, estimated input tokens, estimated cost, approved categories, and whether track-level data is present. Only the problem statement, deterministic findings, supporting metrics, limitations, and relevant approved summaries are submitted; Mixarr does not send the entire bundle.

The response contract rejects unknown action types, missing finding references, malformed structure, excessive content, and arbitrary operations. Suggested action types are allowlisted; destructive actions and unsupported configuration paths are manual-only.

## Suggestion review and audit history

Suggestions have independent Proposed/Awaiting Review, Accepted, Rejected, Dismissed, Applying, Applied, Apply Failed, Completed Manually, No Longer Applicable, and Superseded states. No suggestion is preselected and unrelated changes cannot be bulk-approved.

Every suggestion displays its source, supporting findings, before and after values, explanation, expected effect, possible side effects, risk, reversibility, permission, simulation, and application mode. Before a supported recipe change is applied, Mixarr reloads the recipe, compares the target version and current value, validates the proposed configuration with the normal schema, creates a recipe revision, and records a sanitized audit event. Applying a suggestion never regenerates a playlist.

Session creation, privacy approval, preview, collection, sanitization summary, deterministic completion, AI request and result, simulation, every review decision, application, export, cancellation, failure, and deletion are auditable without storing raw secret-bearing context.

## Retention, export, and deletion

Sessions default to 30-day retention. JSON exports contain only the sanitized session summary, selections, redaction counts, findings, optional explanation, suggestion decisions, simulations, versions, and timestamps. The export is sanitized and scanned again. Deleting a session removes findings and suggestions and redacts retained session content; deleted content is no longer accessible through the API.

## Administration and permissions

Sessions are owner-scoped. Related recipes, playlists, jobs, and libraries must belong to the current user. Household sessions require active membership; administrative provider and integration targets require administrator access. Expanding log, track-level, export, or external AI policies requires administrator access. Household ownership and the existing administrator model are reused rather than introducing a second permission system.

## Limitations

- Detailed candidate funnels are available only for generation records that retained the evaluation trace.
- Initial automatic configuration application is deliberately limited to allowlisted recipe filter paths; all other suggestions link to or remain in existing manual workflows.
- Long-running collection currently uses restart-safe session stages and idempotent replacement of findings. Existing playlist previews perform simulation work; they are bounded but not placed on a second worker system.
- Notification delivery remains in existing Mixarr workflows; diagnostic payloads are never included in notifications.
