# Recipe Safety, Compatibility & Governance (v2.3.8)

Mixarr treats every imported recipe as untrusted data. The staged import pipeline parses with size and duplicate-key limits, validates schema v3, verifies integrity and Ed25519 origin, evaluates compatibility and dependencies, infers legacy permissions, enforces limits, explains combined risk, produces an immutable import plan, and revalidates that plan immediately before an atomic write.

## Trust and approval

Trust and enabled state are separate. Trust may be `LOCAL`, `TRUSTED`, `OFFICIAL`, `UNTRUSTED`, `QUARANTINED`, `SIGNATURE_INVALID`, `SIGNATURE_UNKNOWN`, or `REVOKED`. Local approval may be pending, approved, approved with restrictions, rejected, quarantined, or revoked locally.

An external recipe is stored in quarantine by default, with schedules and automation disabled and no granted destructive permissions. A valid signature proves integrity and signer identity; it never overrides local policy. `OFFICIAL` is derived only when the signature is valid under a configured official public key and schema, compatibility, dependency, and safety checks all pass. JSON fields such as `official`, `trustState`, or `approvalState` are ignored as authority.

Administrators add only Ed25519 public keys through `POST /api/recipes/signing-keys`. Private PEM material is rejected. Keys can expire or be revoked. Revoking a key disables affected recipes and records an immutable audit event.

## Permissions and risk

Schema v3 supports `playlist.create`, `playlist.update`, `playlist.delete`, `playlist.protected_update`, automation create/update/enable/fully-automatic/add/remove, schedule create/frequent-refresh, approval disable, library and Plex collection read/write, webhook, notification, and external-integration permissions. Each declaration includes a reason and whether it is required.

`playlist.delete` and `playlist.protected_update` are always denied. Delete, recreate, replacement-by-deletion, and protection-override aliases are rejected before normalization. The execution and regeneration services re-check enabled, approval, quarantine, granted permissions, and playlist protection. A user may still delete a playlist through Mixarr's separate direct confirmation flow; recipe execution cannot invoke it.

Risk scoring is explainable. Scheduled or daily operation, full regeneration, large removals, loss of manual/liked-track preservation, high-risk permissions, and combinations such as unattended large removal all contribute findings. Policy rules, not the score alone, decide what is forbidden. External and high-risk recipes recommend Suggest-Only.

## Safety limits

Administrators configure limits at `/api/settings/recipe-safety`. Defaults cover additions/removals, replacement percentage, playlists per run, recipes per import, schedule frequency, candidate and playlist size, external requests, retries, and consecutive automatic failures. Absolute caps cannot be exceeded. A requested value above a configurable limit is clamped only in the displayed server plan and audit trail; a value above an absolute cap is invalid.

## Compatibility, dependencies, and migration

Compatibility uses semantic version parsing, including prereleases and `2.x`-style maximums. Invalid expressions are errors. Required unavailable dependencies prevent activation. Optional dependencies may use only explicit non-escalating fallbacks such as disabling a rule, Suggest-Only, skipping a notification, disabling a schedule, or requiring approval.

Legacy schemas migrate sequentially from saved filters to v1, governance declarations in v2, and signature metadata in v3. Inferred permissions are visible and require review. The original and normalized payloads are retained; migration preview returns a diff hash, and migration execution rejects stale previews and never enables the result automatically.

## Audit, snapshots, and restore

Governance audit events are append-only through normal APIs and correlate validation, signature, quarantine, approval, restriction, migration, import, execution blocks, key revocation, and restore. Secret fields are sanitized. Import snapshots contain only affected recipe configuration—never credentials—and are written before configuration changes. Restore preview identifies post-import edits; restore is atomic and requires explicit conflict confirmation.

## API scopes and routes

Read-only tokens cannot mutate governance. Available scopes are `recipes.view`, `recipes.import`, `recipes.approve`, `recipes.manage_trust`, `recipes.migrate`, `recipes.restore`, `recipes.audit.view`, `recipes.signing_keys.view`, and `recipes.signing_keys.manage`.

- `POST /api/recipes/governance/validate`
- `GET /api/recipes/quarantine`
- `POST|DELETE /api/recipes/:id/approval`
- `POST /api/recipes/:id/reject`
- `POST /api/recipes/:id/revalidate`
- `GET /api/recipes/:id/signature`
- `GET /api/recipes/audit`
- `POST /api/recipes/migration/preview` and `/run`
- `GET|POST /api/recipes/:id/migration`
- `GET /api/recipes/:id/snapshots`
- `GET|POST /api/recipes/signing-keys`; `POST /api/recipes/signing-keys/:keyId/revoke`
- `GET|PATCH /api/settings/recipe-safety`
- `GET /api/recipes/snapshots/:snapshotId/preview`; `POST /api/recipes/snapshots/:snapshotId/restore`

Errors use stable codes such as `DUPLICATE_JSON_KEY`, `STALE_IMPORT_PREVIEW`, `RECIPE_QUARANTINED`, `RECIPE_APPROVAL_REQUIRED`, `RECIPE_PERMISSION_REQUIRED`, `RECIPE_PLAYLIST_DELETE_FORBIDDEN`, `RECIPE_PROTECTED_PLAYLIST`, `EXPLICIT_CONFIRMATION_REQUIRED`, `STALE_MIGRATION_PREVIEW`, and `RESTORE_CONFLICT`.

## Events and operations

Governance events include validation/signature results, quarantine and approval states, migration/import failures, restore results, blocked execution, protected-playlist blocks, destructive-action blocks, and signing-key revocation. Webhook data is sanitized and excludes complete recipe payloads, tokens, credentials, paths, and private keys.

After upgrade, apply migration `20260720180000_recipe_governance_v238`. Existing recipes remain local and are validated when used or explicitly revalidated. If verification fails, inspect the stored key ID, key expiry/revocation, whether the payload changed after signing, and whether the signature was calculated over Mixarr's canonical payload. If migration fails, export the preserved original, correct the reported path, and preview again.
