# Mixarr v2.3.1 — Recipe Import & Export

Mixarr recipes are reusable Smart Mix strategies. They are not generated playlists and never contain generated playlist membership, Plex credentials, server/library/media identifiers, listening history, feedback, or learned user profiles.

## Supported files and limits

| File | Purpose | Limit |
| --- | --- | --- |
| `name.mixarr-recipe.json` | One recipe | 5 MB |
| `mixarr-recipes-YYYY-MM-DD.mixarr-bundle.json` | Multiple recipes | 5 MB / 100 recipes |
| `name.mixarr-recipe.zip` | One recipe and optional artwork | 20 MB compressed |
| `mixarr-recipes-YYYY-MM-DD.mixarr-bundle.zip` | Multiple recipes and optional artwork | 20 MB compressed |

Archives are limited to 220 files and 50 MB expanded. Artwork is optional, limited to 3 MB and 4096×4096 pixels per image, and must be valid PNG, JPEG, or WebP content. A rejected or missing image never prevents an otherwise valid recipe from importing.

## Single recipe format

The envelope format version and the recipe schema version are intentionally separate. `formatVersion` controls file transport compatibility. `recipeVersion` tracks meaningful recipe behavior revisions.

```json
{
  "format": "mixarr-recipe",
  "formatVersion": 1,
  "exportedAt": "2026-07-19T18:30:00.000Z",
  "exportedBy": {
    "application": "Mixarr",
    "applicationVersion": "2.3.1"
  },
  "recipe": {
    "recipeVersion": 1,
    "name": "Late Night Highway",
    "description": "Atmospheric driving mix with a gradual energy rise.",
    "category": "Driving",
    "artwork": {
      "included": false,
      "reference": null
    },
    "settings": {
      "scoring": {},
      "targets": {},
      "bpmFlow": {},
      "discovery": {},
      "variety": {},
      "playlistIdentity": {},
      "refreshPolicy": {},
      "automationPolicy": {},
      "generation": {}
    }
  },
  "integrity": {
    "algorithm": "sha256",
    "checksum": "64 lowercase hexadecimal characters"
  }
}
```

The settings sections are the existing v2.3.0 recipe schema—not a second strategy model. The `generation` object uses an explicit allowlist of portable builder and Smart Mix settings. Local `serverId`, `libraryId`, preset IDs, selected track IDs, source playlist IDs, coordination playlist IDs, and automation destinations are never serialized.

## Bundle format

```json
{
  "format": "mixarr-recipe-bundle",
  "formatVersion": 1,
  "exportedAt": "2026-07-19T18:30:00.000Z",
  "exportedBy": {
    "application": "Mixarr",
    "applicationVersion": "2.3.1"
  },
  "manifest": {
    "recipeCount": 2,
    "artworkCount": 0,
    "summary": "2 Mixarr recipes"
  },
  "recipes": [
    {
      "recipeVersion": 1,
      "name": "Late Night Highway",
      "description": null,
      "category": "Driving",
      "artwork": { "included": false, "reference": null },
      "settings": {},
      "integrity": { "algorithm": "sha256", "checksum": "..." }
    }
  ],
  "integrity": { "algorithm": "sha256", "checksum": "..." }
}
```

Recipes are ordered by name and checksum. Each recipe checksum covers only its portable recipe payload. The bundle checksum covers the canonical ordered entries, including their individual integrity metadata.

## Canonical JSON and checksums

Canonical serialization sorts object keys recursively and preserves array order. SHA-256 is calculated over compact canonical JSON. Whitespace, property insertion order, export timestamp, exporting Mixarr version, filename, bundle input order, and artwork file order do not change a recipe checksum.

Imports recalculate every checksum. A valid checksum proceeds. A missing checksum is allowed only for an explicitly recognized legacy format and displays a warning. Malformed, unsupported, or mismatched checksums block persistence. Administrators can inspect the sanitized preview and diagnostic, but confirmation still cannot save corrupted content.

## What is always excluded

The exporter constructs a new payload from an allowlist and never serializes a Prisma row. It excludes:

- database, user, installation, server, library, Plex machine, rating-key, playlist, track, album, and artist IDs;
- Plex tokens, API keys, bearer tokens, cookies, passwords, client/webhook secrets, provider credentials, auth headers, and private URLs;
- hostnames, local IPs, database URLs, filesystem/Docker/volume paths, and temporary paths;
- generated playlist membership, execution/job IDs, notification destinations, and private automation configuration;
- playback/listening history, likes, dislikes, rejections, feedback, learned preferences, personalized score adjustments, and recommendation profiles.

A second scanner checks prohibited keys and suspicious secret/path/URL patterns. It does not block ordinary prose merely because a description contains a word such as “token.” If private data is found, only finding categories and counts enter history; the value is never retained.

## Import flow

Selecting a file never imports it. Mixarr reads it, detects the format, validates top-level and recipe versions, verifies checksums, scans for private data, runs the shared recipe migration and validation services, compares settings with current capabilities, detects conflicts, and creates an owner-scoped staged import that expires after 30 minutes.

The preview shows the source versions, checksum and security status, human-readable strategy summary, compatible setting count, proposed adaptations, unsupported and safely ignored fields, validation messages, migration steps, conflicts, artwork state, and a recommended action. Confirmation uses the server-held stage and reruns checksum, security, and schema validation; client preview data is never trusted as persistence input.

Imported automation is always disabled and its local library is cleared. Importing a recipe does not create a generated playlist.

## Compatibility and adaptation

Every setting is classified as compatible, adaptable, unsupported, invalid, or safely ignored. Unsupported settings stay visible in the preview and diagnostic. Current automatic adaptations include older discovery level names, renamed BPM flow modes, removal of local-only references, and disabling imported automation until a destination library is explicitly configured.

Each adaptation includes the source value, proposed value, reason, behavioral impact, and whether it is required. Required security sanitization cannot be disabled.

## Conflicts

Mixarr checks exact and normalized names, full portable checksums, equivalent strategy checksums that ignore presentation metadata, earlier imported content, and duplicate names/content inside a bundle.

- **Rename** creates a new recipe and validates a suggested available name such as `High-Energy Workout (Imported)`.
- **Replace** updates portable recipe configuration while preserving the local database identity, generated-playlist relationships, audit data, and a recipe revision. It requires administrator permission.
- **Skip** leaves the existing recipe unchanged and records the choice.
- **Use Existing** avoids a duplicate when portable content is identical or equivalent.

Atomic mode (the default) rolls back all selected recipes if one fails. Independent mode commits valid recipes separately and reports individual failures. The mode is always visible before confirmation.

## Artwork archive security

Archives are parsed in memory without extracting uploaded paths to disk. Mixarr rejects absolute paths, `..` traversal, backslash traversal, symbolic links, unexpected locations, executables, nested archives, excessive compressed/expanded size, and excessive file counts. MIME type is derived from file signatures. Safe internal filenames are generated for imported artwork; upload paths and image source metadata are not preserved.

Archive layout:

```text
manifest.json
artwork/
  late-night-highway-a1b2c3d4e5.webp
```

## History and diagnostics

The Recipe Library’s Transfer History shows import/export timestamps, sanitized filenames, formats, result counts, adaptation/conflict outcomes, artwork status, warnings, and failures. Uploaded files and exported payloads are not retained indefinitely. Administrators can clear the current user’s history.

Completed imports can download a sanitized diagnostic containing application/format versions, checksum status, validation codes, compatibility results, adaptation explanations, unsupported setting names, conflict classifications, result status, safe summaries, and security finding categories. It excludes raw files, credentials, IDs, private values, paths, hosts, artwork bytes, and unsafe descriptions.

> This diagnostic file has been sanitized, but you should still review it before sharing.

## API

- `GET /api/playlist-recipes/:id/export` — single JSON; `?archive=1&artwork=1` creates an archive.
- `GET /api/playlist-recipes/export` — backward-compatible export of all recipes.
- `POST /api/playlist-recipes/export` — selected JSON bundle or archive.
- `POST /api/playlist-recipes/import/preview` — upload and stage JSON/base64 archive; returns preview and expiring stage ID.
- `GET|DELETE /api/playlist-recipes/import/:stageId` — retrieve or cancel an owned stage.
- `POST /api/playlist-recipes/import` — confirm an owned stage with decisions and transaction mode.
- `GET|DELETE /api/playlist-recipes/history` — list history or clear it with administrator permission.
- `GET /api/playlist-recipes/history/imports/:historyId/diagnostic` — download an owned sanitized diagnostic.

Every route requires the existing Mixarr session and is scoped to the initiating user. Replacement and history clearing require administrator permission.
