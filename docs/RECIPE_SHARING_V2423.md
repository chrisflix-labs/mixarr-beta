# Portable Recipe Sharing and Share-Code Security (v2.4.23)

Mixarr v2.4.23 fixes a false-positive export block without bypassing its sensitive-data policy. The previous community exporter rebuilt and scanned the complete canonical recipe document. A valid locally targeted recipe could therefore contain the source installation's library identifier at `recipe.generation.libraryId`, which matched `library_identifier_key` even though that identifier was not portable recipe behavior.

## Export pipeline

Copy share code, Community JSON, and Community bundle now use the same sequence:

1. Load the owned recipe record on the server.
2. Map it through `PortableRecipePayload`, an explicit allowlist of behavior fields.
3. Rebuild the backward-compatible canonical community recipe document only from that DTO.
4. Scan the final community payload that will be serialized.
5. Canonicalize keys, compress deterministically for MXR1 when requested, and add the checksum.
6. Return the complete code to the browser and copy it with the Clipboard API or a temporary-textarea fallback.

The client does not send or serialize `window.location`, `document.location`, the request origin, the current page URL, or the current user. Opening Mixarr through localhost, a private LAN IP, internal DNS, or a reverse proxy therefore cannot affect a safe share code.

## Portable recipe DTO

The DTO contains recipe version, name, description, category, portable artwork metadata, permissions, dependencies, compatibility and signature metadata, plus allowlisted scoring, mood/energy targets, BPM flow, discovery, artist/album variety, playlist identity, refresh, safe automation behavior, rules, presets, tuning, filters, and safety settings.

It deliberately excludes database recipe IDs and UUIDs, slugs, users, households, provider connections, Plex/media servers and libraries, playlists and tracks, job/audit/installation IDs, local automation destinations, browser/server origins, timestamps, paths, credentials, tokens, cookies, environment configuration, and complete database/API objects. Clone remains a local operation and keeps its existing relationship semantics; it does not use the community serializer.

## Security and diagnostics

The scanner still blocks credential-like keys and values, bearer tokens, known API-key formats, credentialed URLs, database connection strings, private IPv4 ranges, localhost/internal hosts, local filesystem and Docker paths, notification webhooks, environment references, email/private data, and known installation-specific identifier fields. UUID-looking strings are not rejected globally; only fields whose meaning is local are blocked or excluded.

Blocked exports return a concise category and safe field path. Server diagnostics include `action`, internal `recipeId`, `exportFormat`, `blockedCategory`, `blockedPath`, `detectorRule`, `findingCount`, and `result`. They never include the matched value, full recipe payload, share code, credential, or token.

## Clipboard and compatibility

The browser first uses `navigator.clipboard.writeText`. If it is unavailable or denied, Mixarr creates an off-screen read-only textarea for a single `document.execCommand("copy")` attempt and removes it immediately. If both methods fail, the UI reports a clipboard-specific error rather than a sensitive-data warning.

The wire format remains community format v1 with `MXR1:` codes because the serialized schema did not need to change; only the source mapping was corrected. Existing valid share codes remain importable. Codes for the same unchanged recipe and community metadata remain deterministic and do not depend on the database ID, browser/server URL, installation, or user.
