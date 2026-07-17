# Mixarr v2.1.9 — Adaptive Automation Policies

Mixarr routes every automatic Recently Added and scheduled-regeneration playlist write through one server-side policy evaluator. Recommendation scoring remains independent: scoring proposes changes, while the policy decides whether Mixarr may suggest, queue, delay, or apply them.

## Safe upgrade behavior

Migration `20260716130000_adaptive_automation_policies` is additive. It preserves existing schedules, Recently Added settings, playlists, track locks, identity memory, and version history. Existing users receive a conservative Suggest Only global policy. Existing playlist modes become explicit conservative overrides: Off becomes Disabled, Suggestions becomes Suggest Only, and Automatic becomes Require Approval. Automatic removals are never enabled by migration.

Docker installations continue to use the existing migration/db-push workflow. No new environment variables are required. Never use `prisma db push --force-reset` for an upgrade.

## Modes and presets

- **Disabled** does not run unattended analysis, create proposals, or write Plex. Manual analysis remains available.
- **Suggest Only** stores explained changes for review and never writes Plex automatically.
- **Require Approval** creates proposals and revalidates them at approval time.
- **Fully Automatic** writes only candidates that pass all current rules.

Conservative, Balanced, and Aggressive presets populate visible settings. Editing an individual field changes the label to Custom. Presets are copied into the policy and are not hidden behavior.

## Enforcement and accounting

The evaluator checks global and playlist policy, emergency and playlist pause, playlist protection, membership-level track protection, existing locks/likes/importance, addition/removal confidence, missing metadata, per-update limits, daily/weekly limits, quiet hours, regeneration approval, and source. Invalid or absent policy data returns `policy_invalid` and performs no Plex write.

One addition or removal is one change. A replacement is one addition plus one removal. A reorder-only update counts once. Applied activity is the durable usage source; suggestions and failed writes do not consume allowance. Rollback creates a compensating negative usage activity without deleting the original audit record. Day and Monday-based week boundaries use the policy's IANA timezone.

## Quiet hours and concurrency

Quiet hours are evaluated on the server and may cross midnight. Analysis remains available by default, while Plex writes wait. Delayed work is represented by an idempotent proposal and must be revalidated before execution. Automation takes a user/playlist or proposal lock before approval and rechecks the playlist timestamp inside the database transaction so concurrent work cannot silently apply a stale proposal.

## Approval and rollback

Approval verifies ownership, expiry, playlist freshness, current protection, confidence, policy, and remaining limits. It creates a pre-write Playlist Version History entry before changing local membership or Plex. Partial Plex synchronization remains visible as Partial and is not destructively retried.

Automation activity links to the recoverable pre-update revision. Rollback first previews differences and warns when later changes exist, creates another safety revision, restores through the existing version service, reconciles Plex, records a new activity, and retains the original automation event.

## API

All endpoints require the `mixarr_session` cookie, validate input, enforce user ownership, and return JSON errors with appropriate `400`, `401`, `404`, or `409` status codes.

- `GET|PUT /api/automation/policy` — read overview or update the global policy.
- `PUT /api/automation/pause` — persist pause/resume state and optional reason.
- `GET|PUT|DELETE /api/automation/playlists/{playlistId}/policy` — read, set, or reset an override.
- `PUT /api/automation/playlists/{playlistId}/protection` — protect or unprotect a playlist.
- `PUT /api/automation/playlists/{playlistId}/tracks/{trackId}/protection` — protect membership from automatic removal.
- `GET /api/automation/proposals` and `GET /api/automation/proposals/{proposalId}` — list or inspect proposals.
- `POST /api/automation/proposals/{proposalId}/approve|reject` — apply or reject all or selected proposal items idempotently.
- `GET /api/automation/activity` and `GET /api/automation/activity/{activityId}` — list or inspect durable activity.
- `POST /api/automation/activity/{activityId}/rollback` — preview and then confirm a rollback.

The Automation Policies page at `/automation` provides the primary interface. Raw policy snapshots remain audit/debug data rather than the main user experience.
