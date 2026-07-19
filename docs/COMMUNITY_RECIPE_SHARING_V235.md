# Community Recipe Sharing (v2.3.5)

Mixarr community recipes are portable, inspectable files. They can be shared through GitHub, Discord, documentation, downloads, direct links, or copy and paste. Mixarr does not host accounts, ratings, comments, a recipe database, or a moderation service.

> Mixarr community recipes are data-only. Recipes must never contain or execute scripts, commands, credentials, environment variables, plugins, or installation hooks.

## Sharing formats

- Plain JSON contains a version 1 manifest, the existing portable Mix Recipe document, optional changelog text, and a SHA-256 checksum.
- A `.mixarr-recipe.zip` bundle requires `manifest.json` and `recipe.json`. It may also contain `README.md`, `CHANGELOG.md`, `LICENSE`, one image under `artwork/`, and up to eight images under `screenshots/`.
- An `MXR1:` share code contains compressed JSON and a truncated SHA-256 checksum. The checksum detects accidental corruption; it does not prove the author's identity or make the recipe trusted.

The manifest format is `mixarr-community-recipe`, `formatVersion` is `1`, and `recipeId` is a portable reverse-domain-style identifier. It includes name, semantic recipe version, description, author, license, optional minimum Mixarr version, HTTPS homepage/documentation/source/support links, normalized descriptive tags, and relative bundle paths. Future readers must reject unsupported format versions rather than guessing how to interpret them.

## Import and approval

Open **Recipes → Community Recipes**. Import a direct HTTPS JSON or ZIP URL, paste JSON or an `MXR1:` code, or upload a JSON/ZIP file. GitHub file pages are converted only to their corresponding raw file; Mixarr never scrapes arbitrary HTML.

Every input follows the same pipeline: acquire, detect, parse, validate structure, validate recipe rules, scan prohibited content, normalize metadata, check compatibility, checksum, preview, approve, and install. Parsing never installs. Final installation revalidates the staged data. Imported recipes are disabled, with automation and scheduled refresh disabled, and never generate a playlist until the user intentionally does so.

The preview shows author, license, versions, source, docs, tags, artwork/screenshots, changelog, rule data, normalization, trust state, compatibility, warnings, and matching installed recipes. A matching `recipeId` can be imported as a copy or explicitly updated/replaced. Locally modified imports are identified by comparing the normalized recipe with its original imported checksum.

## Security model

URL imports allow HTTPS only, remove sensitive query data from retained display URLs, reject embedded credentials, resolve every host and redirect, reject loopback/private/link-local/multicast/metadata addresses, cap redirects and time, do not forward application credentials, and enforce response size plus content-signature checks.

ZIP readers reject absolute and parent paths, duplicate names, symbolic links, encrypted entries, unsupported compression, nested or executable content, unknown files, too many files, and excessive compressed or extracted bytes. Only PNG, JPEG, and WebP images with validated signatures and dimensions are accepted. SVG is not supported. Files are written only after approval under randomized Mixarr-managed names.

Recipe and manifest schemas reject unknown properties. Scans reject secret-like keys and values, private URLs, database connections, filesystem paths, environment assignments, scripts, hooks, commands, executable templates, and private installation identifiers without echoing suspected secret values. Markdown is displayed as untrusted text, not raw HTML.

These terms are distinct:

- **Structurally valid** means the document matches the allowlisted format.
- **Compatible** means this Mixarr version understands every required field and feature.
- **Official source** means the fetched URL was derived from the application-controlled repository configuration and allowed index path.
- **Trusted by the user** is a local judgment made after reviewing the recipe.
- **Guaranteed safe** is not a claim Mixarr makes. Validation reduces technical risk and does not guarantee playlist quality or author identity.

## Attribution, updates, and reports

Imported detail pages retain author, version, license, source, documentation, import date, tags, trust state, and local modification status. Updates always pass full validation, show conflicts, and require confirmation; locally edited recipes should normally receive upstream versions as a separate copy.

**Report Recipe** creates a sanitized report that can be copied or used to open a prefilled issue on a GitHub source repository. It contains only public recipe metadata, checksum, validation codes, Mixarr version, import method, category, and the user's short description. It excludes credentials, paths, Plex details, libraries, user identity, internal IDs, logs, cookies, and tokens. Mixarr does not moderate recipes hosted outside Mixarr-controlled repositories.

## Optional official repository

Set `COMMUNITY_RECIPES_REPOSITORY` to a public GitHub repository, with optional `COMMUNITY_RECIPES_BRANCH` and `COMMUNITY_RECIPES_INDEX`. The static `index.json` uses format `mixarr-community-index`, version 1, and points to explicit recipe files. Mixarr caches the index, supports name/tag filtering, and never recursively crawls a repository. Public GitHub authentication is not required. Every official import still goes through normal validation and approval; a manifest cannot declare itself official.

Core import/export/share-code features work when the repository integration is disabled or unavailable.
