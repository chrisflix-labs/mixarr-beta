# Mixarr v2.4.6 — AI Playlist Summaries and Metadata Suggestions

Mixarr v2.4.6 adds factual playlist descriptions and a review-first metadata cleanup workspace. Both capabilities reuse the provider coordinator, privacy modes, request previews, structured-response validation, monetary and request-count budgets, provider-native context validation, retry protection, timeouts, usage history, and sanitized audits. Mixarr-configured token caps were retired in v2.4.17.

## Safety boundary

> Metadata suggestions are advisory only in Mixarr v2.4.6. Approving a suggestion records the decision but does not modify Plex, the source library, embedded tags, filenames, or folders.

The release contains no apply endpoint, provider tool, tag writer, file rename, source-library mutation, or Plex metadata update for suggestions. `AI_METADATA_WRITES_ENABLED` is hard-coded to `false`; the environment example documents the fixed value but cannot override the backend constant. “Approved suggestion — not applied” appears in list, detail, dashboard, API, and export data wherever approval could be misunderstood.

Generating “Plex-friendly” text only creates bounded plain text. “Copy for Plex” copies it to the clipboard; it does not contact Plex. Saving a summary as playlist notes writes only `GeneratedPlaylist.localPlaylistNotes` inside Mixarr.

## Playlist summaries

Open **AI → Playlist Summaries** or expand **AI playlist summaries** on a generated-playlist card. Any subset of these types can be requested:

- One sentence, detailed description, mood, genre, era, energy progression, BPM progression, discovery, familiarity, playlist change, refresh, why the playlist exists, Plex-friendly, and household-shareable.

Mixarr first creates a deterministic `PlaylistAnalysisSnapshot`. Available aggregates include count, duration, artist/album diversity and repetition, tag/year distributions, BPM and energy ranges/averages/thirds, explicit count, familiarity/discovery/recent percentages, and changes from the previous snapshot. Missing facts remain `null`. Response validation rejects unsupported BPM, energy, mood, genre, era, discovery, or familiarity claims.

Summary history retains provider/model, privacy mode, prompt version, snapshot, request ID, token usage, estimated/actual cost, status/error, preferred state, manual-edit provenance, and creator. Users can copy, export, edit, prefer, archive, restore, compare, delete, or save local notes. Edits preserve the original generated text.

Automatic refresh summaries default to off. When enabled, a successful manual regeneration queues only `REFRESH` using Local Only when required, otherwise Metadata Limited. It never replaces a preferred summary.

## Privacy behavior

- **Local Only:** the provider coordinator permits only a locally classified provider. Track context stays local.
- **Metadata Limited:** only aggregates and the minimum deterministic candidate values required for review are sent. Full track, artist, album, path, and listening-history records are withheld.
- **Anonymous Metadata:** ordered numeric/tag context may be sent without titles, artists, albums, or stable track IDs.
- **Full Metadata:** track titles, artists, and albums are included only when both Full Metadata and **Allow full track metadata** are enabled. Foreground remote summary requests require preview acknowledgment.

Playlist names, notes, titles, artists, albums, comments, tags, and imported metadata are serialized as untrusted data. System instructions say metadata cannot issue instructions. Strict Zod schemas reject unknown/executable fields, tool requests, non-submitted candidate IDs, duplicate response IDs, oversized output, and unsupported summary types.

## Metadata scans

Metadata Suggestions are disabled until explicitly enabled under **AI Advisory Settings**. A scan uses bounded indexed batches (1–100, default 50), checks cancellation between batches, and retains valid completed results if an AI batch fails. Job states are `QUEUED`, `PREPARING_CANDIDATES`, `ANALYZING`, `SAVING_SUGGESTIONS`, `COMPLETED`, `COMPLETED_WITH_WARNINGS`, `FAILED`, and `CANCELLED`.

Deterministic checks currently identify normalized artist variants, local genre spelling variants, conflicting album years, consistent neighbor moods that are missing, and live/remix/remaster/acoustic/edit/version title suffixes. The AI receives only candidate batches and may clarify them. It cannot add an affected track or candidate outside the submitted batch.

Each suggestion stores values, reason, confidence score/level, detection method, affected snapshots, source evidence and unavailable-source labels, impact indicators, provider/model provenance, a stable fingerprint, detection count/timestamps, review history, related audit history, and advisory status. Identical detections update the existing fingerprint and never reset an approved, rejected, or ignored decision.

## Review, ignore rules, and exports

The `/ai/metadata-suggestions` workspace supports filters for confidence, type, field, status, artist, album, playlist, source, date, provider, detection method, three impact classes, and conflicts. It supports all specified sort orders, visible-only selection, notes, confirmation, approve/reject/archive/restore, and CSV/JSON exports. Detail track rows are paginated at 50.

Bulk requests compare the unique submitted IDs with the ownership-scoped database result before changing anything. Any mismatch rejects the entire request. Every review creates a `MetadataSuggestionReview` and audit entry. Approval requires the exact advisory confirmation.

Ignore-rule scopes include exact fingerprint, type, field, artist, album, existing value, suggested value, value pair, and source-conflict pattern. Rules can be enabled, disabled, or deleted at `/settings/ai/metadata-ignore-rules`. Deleting a rule never deletes historical suggestions.

Exports contain reviewable metadata, source availability/query state, track identifiers, impacts, review notes, dates, and the not-applied label. Filenames are generated from an ISO timestamp. Credentials, prompts, provider secrets, authorization data, paths, and access tokens are excluded.

## Permissions

Backend routes enforce these named, ownership-scoped permissions:

```text
ai.summary.view
ai.summary.generate
ai.summary.manage
ai.metadata_suggestions.view
ai.metadata_suggestions.generate
ai.metadata_suggestions.review
ai.metadata_suggestions.export
ai.metadata_suggestions.manage_ignore_rules
```

Existing Mixarr accounts map these boundaries to authenticated ownership plus the existing administrator override. Administrators still generate review and audit records.

## API

Summary routes:

```text
POST   /api/playlists/{playlistId}/ai-summaries/preview
POST   /api/playlists/{playlistId}/ai-summaries
GET    /api/playlists/{playlistId}/ai-summaries
GET    /api/playlists/{playlistId}/ai-summaries/{summaryId}
PATCH  /api/playlists/{playlistId}/ai-summaries/{summaryId}
DELETE /api/playlists/{playlistId}/ai-summaries/{summaryId}
```

Suggestion routes:

```text
POST /api/ai/metadata-suggestions/scan
GET  /api/ai/metadata-suggestions/jobs/{jobId}
POST /api/ai/metadata-suggestions/jobs/{jobId}/cancel
GET  /api/ai/metadata-suggestions
GET  /api/ai/metadata-suggestions/stats
GET  /api/ai/metadata-suggestions/{suggestionId}
POST /api/ai/metadata-suggestions/{suggestionId}/approve
POST /api/ai/metadata-suggestions/{suggestionId}/reject
POST /api/ai/metadata-suggestions/{suggestionId}/ignore
POST /api/ai/metadata-suggestions/bulk-review
POST /api/ai/metadata-suggestions/export
GET|POST /api/ai/metadata-ignore-rules
PATCH|DELETE /api/ai/metadata-ignore-rules/{ruleId}
GET|PUT /api/ai/advisory-settings
```

## Upgrade

Apply migration `20260724010000_ai_playlist_summaries_metadata_suggestions_v246` through the normal startup migration process. It is additive, creates no job or trigger, adds local notes, seeds both AI coordinator features disabled, and preserves playlists, recipes, providers, privacy/budget settings, permissions, and library data. No library scan or summary request starts during migration.

Docker upgrades use the normal image-and-migration process; containers and volumes do not need to be recreated.

## Troubleshooting

- **Missing provider / feature disabled:** configure AI, select a model, review privacy/budgets, then explicitly enable the coordinator feature and user advisory setting.
- **No scan results:** confirm Metadata Suggestions and deterministic checks are enabled; a clean or very small batch may produce no candidates.
- **Budget or native context limit:** use Metadata Limited, reduce batch size, choose fewer summary types, adjust a monetary/request-count budget, or select a model with a suitable native context window.
- **Privacy conflict:** Local Only requires a locally classified provider. Full track context additionally requires its dedicated setting.
- **Conflicting sources:** no value is chosen automatically; inspect queried and unavailable sources in detail.
- **Invalid AI response:** Mixarr retains safe deterministic results, marks the batch warning, and rejects out-of-schema or out-of-scope output.
- **Long scan:** watch durable progress and cancel safely; saved suggestions remain valid.
- **Duplicate suggestion:** the fingerprint updates detection count and time rather than recreating the pending item or resetting review decisions.
