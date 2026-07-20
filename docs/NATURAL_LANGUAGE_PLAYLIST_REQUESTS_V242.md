# Mixarr v2.4.2 — Natural-Language Playlist Requests

## Safety architecture

AI interprets intent. Mixarr’s deterministic engine selects and orders tracks.

Ask Mixarr is an interpretation and review workflow. AI output is accepted only through `naturalLanguageInterpretationSchema`, converted server-side into the existing `mixarr-recipe` schema, validated by recipe safety/governance, analyzed against the user’s accessible library, and previewed by the deterministic playlist engine. The provider never returns final track IDs and has no mutation tool or Plex endpoint.

The only mutation path is:

1. The current request revision has valid recipe, candidate, compatibility, and preview results.
2. Every blocking ambiguity and unresolved entity is resolved.
3. A permitted user explicitly approves that exact revision.
4. A separate create action rechecks the revision and permissions.
5. The canonical recipe is saved and passed to `createPlaylistFromRecipe`.

Editing, revising, accepting/removing assumptions, or resolving ambiguities creates a new revision and invalidates approval. Repeated execution submissions use a unique idempotency key. Scheduled refresh and recipe automation are forced off in the AI draft; they require the existing separate Mixarr confirmation flows.

## Provider, privacy, and cost behavior

The administrator must enable global AI, configure an eligible structured-JSON provider/model, and enable `natural_language_playlist_requests`. The request form performs a governance preflight before provider submission and displays provider location, effective privacy mode, token estimate, maximum output, and cost range.

- **Local Only:** the AI coordinator rejects every provider not administrator-confirmed as local.
- **Metadata Limited:** request text is sent because it is the user-authored task. Only allowlisted safe metadata may be included; v2.4.2 does not send track inventories.
- **Anonymous Metadata:** identifying music metadata is transformed or removed by v2.4.1 governance.
- **Full Metadata:** requires the existing versioned acknowledgment for external providers.

Plex credentials, access tokens, server addresses, rating keys, file/network paths, database IDs, full library inventories, complete track lists, and unrelated user data are never sent. Provider prompts/responses are not stored by the request tables. When prompt retention is disabled, Mixarr stores only a SHA-256 digest plus the structured interpretation and recipe revision.

All v2.4.1 global/provider/user budgets, pricing, request limits, token limits, prompt/response limits, timeouts, paid fallback policy, retry-cost protection, background controls, hard shutdown, and AI audits remain authoritative.

## Permissions

The service declares these capabilities and currently maps personal actions to ownership and household/administrative actions to the existing administrator role:

- `SUBMIT_NATURAL_LANGUAGE_REQUESTS`
- `VIEW_PERSONAL_REQUESTS`
- `VIEW_HOUSEHOLD_REQUESTS`
- `EDIT_REQUEST_INTERPRETATIONS`
- `APPROVE_PERSONAL_REQUESTS`
- `APPROVE_OTHER_USERS_REQUESTS`
- `EXECUTE_APPROVED_RECIPES`
- `VIEW_AI_COST_INFORMATION`
- `VIEW_PROVIDER_DETAILS`
- `VIEW_AI_AUDIT_HISTORY`
- `MANAGE_NATURAL_LANGUAGE_DEFAULTS`

Submission never grants execution. Recipe and Plex execution permissions are rechecked by the existing deterministic workflow.

## Request lifecycle and audit

Statuses are `DRAFT`, `ANALYZING`, `NEEDS_REVIEW`, `NEEDS_CLARIFICATION`, `READY_FOR_APPROVAL`, `APPROVED`, `EXECUTING`, `COMPLETED`, `FAILED`, `CANCELLED`, and `EXPIRED`. Server-side transition validation prevents clients from setting approval or analysis state.

The request record holds current state, governance/provider summary, canonical draft, validation, candidate estimate, compatibility, preview, approval revision, recipe/execution links, usage, and safe error information. Every revision stores immutable interpretation/recipe/analysis snapshots and a before/after field diff. Audit events record the actor, revision, action, result, and concise safe details—never secrets or hidden model reasoning.

## API

- `GET|POST /api/natural-language-requests`
- `POST /api/natural-language-requests/preflight`
- `GET|PATCH|DELETE /api/natural-language-requests/:id`
- `POST /api/natural-language-requests/:id/interpret`
- `GET|POST /api/natural-language-requests/:id/revisions`
- `POST /api/natural-language-requests/:id/assumptions/:assumptionId`
- `POST /api/natural-language-requests/:id/ambiguities/:ambiguityId`
- `POST /api/natural-language-requests/:id/analyze`
- `POST /api/natural-language-requests/:id/preview`
- `POST /api/natural-language-requests/:id/approve`
- `POST /api/natural-language-requests/:id/save`
- `POST /api/natural-language-requests/:id/execute`
- `POST /api/natural-language-requests/:id/cancel`

Errors use `{ error: { code, message, fields? } }`. Approval and execution ignore client claims about validation or approval and re-read authoritative database state.

## Similar-playlist behavior

Named libraries, generated playlists, recipes, artists, albums, and genres are resolved locally within the user’s accessible data. Multiple matches become blocking review items. A single source playlist may contribute its deterministic filter/scoring characteristics, but pinned/excluded track IDs are removed. A related-playlist coordination rule enables a 20% hard overlap maximum and a preference for unused tracks. The source is never copied track-for-track.

## Migration and upgrade

Apply `20260721180000_natural_language_playlist_requests`. It adds `NaturalLanguageRequest`, `NaturalLanguageRequestRevision`, and `NaturalLanguageRequestAudit` plus indexes and foreign keys. Existing recipes, generated playlists, AI providers, credentials, governance settings, and automation are unchanged. The new feature remains disabled until an administrator enables it in AI settings.

Back up PostgreSQL and the AI credential encryption key before upgrading. Rollback requires dropping the three new request tables only; they do not own recipe or playlist rows.

## Troubleshooting

- **AI/feature disabled:** enable global AI and this feature in Settings → AI.
- **Local provider unavailable:** verify the local endpoint and administrator local classification. Local Only never falls back externally.
- **Budget/token/prompt error:** review the governance dashboard. Retrying is offered only when retry-cost policy permits it.
- **Needs clarification:** resolve every marked ambiguity, entity, and blocking assumption.
- **No candidates/preview failure:** edit filters in Recipe Studio, sync the intended music library, or improve required metadata coverage, then refresh analysis.
- **Approval disappeared:** a draft field or interpretation changed; review and approve the new revision.
- **Protected playlist:** v2.4.2 creates a new playlist and does not replace a source playlist. Existing protected-playlist enforcement remains authoritative for all other recipe workflows.

## Accessibility and responsive design

The request, review, cards, native controls, confirmation actions, and Recipe Studio path are keyboard accessible; focus is visible; low confidence includes text labels; errors use live/alert semantics; preview rows remain readable on mobile; primary workflows do not require horizontal scrolling.

## v2.4.3 recommendation

Focus on administrator-configurable natural-language defaults, richer permission roles beyond owner/admin mapping, deterministic similarity profiles for more source attributes, retention automation, localized UI copy, and browser-level end-to-end coverage against representative local-provider responses—while preserving the same review and deterministic execution boundary.
