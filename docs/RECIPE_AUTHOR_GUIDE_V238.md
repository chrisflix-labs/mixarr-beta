# Mixarr Recipe Author Guide (schema v3)

A recipe is declarative data. It cannot contain scripts, commands, templates, plugins, credentials, installation hooks, or private server identifiers.

## Governance metadata

Declare every capability with a specific reason:

```json
{
  "permissions": [
    { "permission": "library.read", "reason": "Evaluate candidates in the selected music library", "required": true },
    { "permission": "playlist.create", "reason": "Create a new generated playlist after user confirmation", "required": true }
  ],
  "dependencies": [
    { "type": "feature", "name": "smart_actions", "required": false, "fallback": { "action": "suggest_only" } }
  ],
  "compatibility": {
    "minMixarrVersion": "2.3.8",
    "maxMixarrVersion": "2.x",
    "recipeSchemaVersion": 3
  }
}
```

Do not request `playlist.delete` or `playlist.protected_update`; Mixarr denies both. Prefer manual refresh or approval-required automation, preserve locked/liked/manual tracks, keep replacement limits small, avoid daily unattended full regeneration, and ensure the candidate pool is comfortably larger than the requested playlist size.

Fallbacks must reduce capability: disable the affected rule, use Suggest-Only, skip an optional notification, store a schedule disabled, require approval, use a compatible candidate source, or ignore a UI-only field. A fallback must never add permissions, disable approval, delete data, or target protected playlists.

## Signing

Mixarr supports Ed25519. The signature object contains `algorithm`, `keyId`, Base64 `value`, `signedAt`, and optional `expiresAt`. Sign the UTF-8 bytes of Mixarr's deterministic canonical payload with the signature value omitted. Local-only slug, artwork/source playlist identifiers, library/server IDs, pinned/excluded local track IDs, and automation library IDs are normalized out of the signing payload.

Never distribute a private signing key with a recipe and never upload it to Mixarr. Administrators configure the corresponding public key. Official status additionally requires that key to be marked official and every local validation to pass.

## Testing checklist

- Validate required fields, enum values, numeric ranges, schedules, URLs, permissions, dependencies, and unknown fields.
- Test a missing signature, modified payload, unknown/revoked/expired key, invalid Base64, and duplicate JSON keys.
- Test below-minimum, above-maximum, prerelease, invalid, and compatible Mixarr versions.
- Test missing required and optional dependencies plus every fallback.
- Test direct and aliased deletion, protected targets, high-removal scheduled automation, and Suggest-Only behavior.
- Test legacy multi-step migration, original-payload preservation, stale plan rejection, atomic rollback, snapshot restore, and restore conflicts.

Deprecated fields are reported with a code, path, replacement, deprecation/removal version when known, and migration availability. Migrate sequentially and review behavior changes; never replace an ambiguous automatic setting with a more permissive default.
