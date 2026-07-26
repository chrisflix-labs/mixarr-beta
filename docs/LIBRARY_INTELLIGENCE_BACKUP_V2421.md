# Lossless Library Intelligence Backup & Restore (v2.4.21)

Mixarr v2.4.21 makes Library Intelligence backups lossless, versioned, verifiable,
and explicit about partial outcomes. A backup and restore against the same unchanged
Plex library must reproduce its audio-feature, BPM, popularity, genre, no-data,
failure, incomplete, and pending state counts exactly. Restore does not queue
reanalyzing or provider lookups.

## Root cause fixed

Schema-v1 restore code used the first non-null identity as a de-duplication key:
`plex_guid`, then rating key, Plex id, fingerprint, or record id. A Plex GUID
identifies a recording and is not unique to a library track. In the reported 36,816
track library, 1,243 duplicated GUID groups contained 2,772 tracks.

- Parsing kept one record per duplicated GUID and silently discarded 1,529.
- Matching saw the remaining representative's GUID resolve to multiple current tracks
  and stopped as ambiguous, rejecting another 1,243.
- `1,529 + 1,243 = 2,772`, exactly the shared deficit in audio features, BPM,
  popularity, and genres.

Schema v2 de-duplicates only literally repeated scoped archive record ids. A
non-unique GUID is retained as evidence while scoped source id, scoped rating key,
media-part identity, path hashes, and metadata fingerprints continue disambiguation.

## Artifact manifest

Every schema-v2 archive contains:

- source Mixarr version, schema/data versions, creation time, safe Plex
  server/library identifiers, and a non-secret library fingerprint;
- eligible, read, serialized, written, skipped, invalid, and reason-category counts;
- expected/exported category counts plus completed, incomplete, attempted, value,
  pending, failed, and known-no-data states;
- SHA-256 and byte/record counts for serialized track data;
- identity-strategy and path-normalization versions; and
- an explicit `complete` flag.

The archive excludes raw media paths, tokens, API keys, passwords, credentials, AI
prompts/responses, sessions, playlists, and user data outside the scoped track
intelligence. The database history row stores the whole-archive SHA-256 after the
written file is read back and validated.

The UI distinguishes **Current library coverage**, **Selected backup contents**, and
**Written backup contents**. Only the artifact manifest is used to describe a
completed backup. A count mismatch produces a partial/failed artifact, never a normal
success banner.

## Identity strategy v2

Matching is deterministic, scoped to the Plex server and library, and stops rather
than choosing arbitrarily:

1. stable Plex GUID evidence;
2. scoped Plex source id;
3. scoped rating key;
4. scoped media-part id (including multiple parts);
5. versioned SHA-256 path identities;
6. artist/album/title/disc/track/duration fingerprint; and
7. unique metadata plus strict duration fallback.

Paths use NFKC Unicode normalization, slash normalization, duplicate-slash collapse,
case folding, and trimming. Schema v2 stores full v2, compatible v1, and portable
two/three/four-segment suffix hashes so slash, case, Unicode-form, and mount-prefix
changes can match without exposing the path. Duplicate hashes and identities remain
ambiguous.

## Restore safety and statuses

Upload validates ZIP structure, entry allowlists, checksums, schema compatibility,
manifest consistency, record limits, and every record before Library Intelligence
changes. Schema-v1 backups from v2.4.11 through v2.4.20, including v2.4.15, use an
explicit migration adapter. Legacy expected counts are derived from parsed content
and unavailable fields are reported.

The dry run persists the complete identity plan and reports exact, fallback,
unmatched, ambiguous, invalid, and incompatible records plus expected/projected
category counts. An incomplete same-library plan is blocked unless the administrator
explicitly confirms a partial restore.

Writes use deterministic atomic batches. Every batch is awaited; a failing batch is
rolled back and can be resumed without clearing existing intelligence. Unmatched and
ambiguous tracks are never cleared. Applied staging state makes a retry idempotent.

After writes, Mixarr recalculates counts from the matched database tracks and compares
them with the parsed backup contents. The final statuses are:

- `fully_restored`
- `restored_with_warnings`
- `partial_restore`
- `failed`
- `incompatible_backup`

Only `fully_restored` receives a green success banner. It requires 100% matching, no
invalid or ambiguous records, no write failures, and exact category reconciliation.
