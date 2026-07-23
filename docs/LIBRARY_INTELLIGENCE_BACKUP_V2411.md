# Library Intelligence Backup & Restore (v2.4.11)

Mixarr can spend a very long time building **library intelligence**: local Essentia
audio-feature analysis, BPM/tempo detection, external popularity lookups, and genre
collection across tens or hundreds of thousands of tracks. If the Mixarr database
volume is deleted or recreated, all of that work is normally lost.

The **Library Intelligence Backup** preserves that calculated and collected
intelligence in a small, portable file so it can be restored into a fresh database
without rerunning the analysis and lookup jobs.

> This is **not** a complete application or disaster-recovery backup. It contains
> only library intelligence. It is not a database dump.

Manage it at **Settings → System → Library Intelligence Backup**
(`/settings/system/library-backup`). Only administrators can create, download,
delete, upload, preview, or restore backups.

## What a backup contains

- **Plex track identity** needed only to re-match tracks: internal record id, Plex
  media GUID(s), rating key, non-secret source id and library identifiers, title,
  artist, album, album artist, disc/track number, duration, release year, file size,
  a SHA-256 hash of the normalized media path, and a metadata fingerprint.
- **Audio features** (energy, danceability, valence, acousticness, loudness, key,
  scale, tempo, and the other existing analysis fields), including local, API, and
  effective values and their sources.
- **BPM / tempo** values, source, confidence, and analysis state.
- **Popularity** score, provider, confidence, and lookup state.
- **Track genres** (raw and normalized) and genre lookup state.
- **Processing, completion, and known no-data states** for the above.
- **Provenance**: analysis source, engine version, and original timestamps.

## What a backup never contains

AI provider configuration, AI requests/prompts/responses/history, API keys, Plex
tokens, passwords, authentication and session secrets, environment variables,
application and audit logs, user accounts and passwords, notification/webhook/
provider credentials, recipes, playlists, saved natural-language requests, household
controls, unrelated settings, raw audio files, album artwork, and full database
dumps. Raw absolute media paths are **not** stored — only a hash of the normalized
path. An explicit field allowlist enforces this on both export and restore, so even
a maliciously crafted archive cannot inject secret-named fields.

## Creating a backup

1. Open **Settings → System → Library Intelligence Backup**.
2. Review the coverage cards and the included/excluded lists.
3. Optionally add a note (for example, "Before rebuilding the database volume").
4. Choose **Create Backup**. The job runs in the background (Preparing → Reading
   tracks → Exporting → Writing archive → Verifying checksums → Complete) and keeps
   running even if you close the browser.
5. **Download the finished `.mixarr-library-backup` file** and keep a copy somewhere
   safe.

## Storing backups outside the database volume

By default, server-side backups are written to `MIXARR_BACKUP_DIR` (default
`/app/backups`). **A backup stored on the same volume as the database is lost when
that volume is deleted — which defeats the purpose.** Mount a dedicated volume:

```yaml
services:
  mixarr:
    volumes:
      - ./mixarr-data:/app/data
      - ./mixarr-backups:/app/backups   # separate from the database volume
```

Mixarr cannot verify that the backup directory is on separate persistent storage, so
it never claims a backup is safe from volume deletion. Always keep a downloaded copy
as well. **Deleting both the database volume and the backup volume deletes the
backup too.**

## Restoring after recreating the database

The primary use case is restoring after a new Mixarr database volume has been
created. Plex credentials are intentionally excluded from the backup, so:

1. Start Mixarr with the new database.
2. **Configure the Plex connection again** (Settings).
3. Run a **lightweight Plex library sync** — this only rebuilds the track index; it
   does not re-run audio, BPM, popularity, or genre processing.
4. Open **Settings → System → Library Intelligence Backup → Restore**, upload the
   `.mixarr-library-backup` file, and let it validate.
5. Choose a conflict policy and **Preview changes** (no database writes happen during
   preview).
6. **Apply restore.** Successfully matched features, BPM, popularity, and genres are
   marked complete, so normal processing only targets records that are still missing.

### Uploading before a Plex sync (deferred restore)

You can upload a backup before the library has been synchronized. Mixarr validates
it, stages the records, and marks the restore as *waiting for library sync*. It does
**not** create fake Plex tracks. After you sync the library, apply/resume the restore
to match the staged records to the newly synchronized tracks. Unmatched staged
records remain visible so you can retry matching later.

## How tracks are matched

Matching is conservative and deterministic, attempted in this order:

1. Exact Plex GUID (within the expected library)
2. Exact stable source identifier (Plex `plexId`)
3. Exact Plex rating key (same Plex server)
4. Normalized path-hash match plus a compatible duration
5. Metadata fingerprint (artist, album, title, disc, track number, bucketed duration)
6. High-confidence metadata fallback (normalized artist/title/album + strict duration)

Matching accounts for case, Unicode, whitespace, and punctuation differences, missing
album artists, and multi-disc albums. Duration is used at every metadata tier so live
versions, remasters, and re-releases of the same title are not matched to the wrong
recording. **Ambiguous matches are never applied automatically** — they are left for
manual resolution, and every track's match type is persisted so you can inspect how it
matched (`exact_guid`, `exact_source_id`, `exact_rating_key`, `path_hash`,
`metadata_fingerprint`, `high_confidence_metadata`, `manual`, `ambiguous`,
`unmatched`).

## Conflict policies

- **Fill Missing Only** (default, recommended): restore a value only where the current
  database has none; existing valid values are preserved.
- **Prefer Backup**: replace current library-intelligence values with the backup's
  values (requires explicit confirmation).
- **Keep Current**: only fill categories that have no current data at all.

Policies can be set globally or per category (audio features, BPM, popularity, genres,
no-data states). Data outside the Library Intelligence scope is never touched.

## Known no-data results

If Mixarr previously attempted a popularity or genre lookup and the provider had no
data, that "no data" result is restored so the new database does not immediately repeat
the same lookup for every track. Transient states (queued, running, retrying, locked,
etc.) are never restored as active work — they are converted to a safe pending or
incomplete state.

## Older analysis versions

Restored data is classified as compatible, compatible-but-older, requires-migration,
unsupported, or unknown. Older but usable results are restored (with a non-blocking
warning) and keep their original source and version; they are not automatically
requeued for reprocessing unless they are structurally incompatible or you explicitly
request reanalysis.

## Preventing unnecessary reprocessing

After a successful restore, valid audio features, BPM, popularity, and genres are
marked complete and are not automatically requeued. Restored no-data attempts remain
known no-data results. Use **Process Remaining Missing Data** to queue only the records
that are still genuinely incomplete.

## Interrupted or repeated restores

Restores are idempotent and resumable. If a restore is interrupted, it is marked
*interrupted* and can be resumed from the last committed batch; already-applied records
are skipped. Running the same restore twice does not create duplicate intelligence
records. A cancel request stops the restore safely before the next batch commit.

## Security notes and limitations

- Uploaded archives are treated as untrusted input and are fully validated before any
  database write.
- Mixarr never executes anything from a backup and never restores SQL or configuration.
- A raw database file is never accepted as a Library Intelligence backup.
- Backups and restores operate entirely locally; no external service receives the data.
- Mixarr cannot guarantee the backup directory is on separate storage — keep a
  downloaded copy.

## Troubleshooting a failed backup

- *`EACCES: permission denied, open '/app/backups/...'`* — the backup directory is
  not writable by the container user (uid 1001). This happens with a **bind-mounted**
  host directory that is owned by another user. Fix it one of these ways:
  - Use a **named volume** (the compose default `mixarr_backups:/app/backups`), which
    is writable out of the box, or
  - Make the host directory writable: `chown -R 1001:1001 ./mixarr-backups` (or
    `chmod -R 777` if you cannot change ownership), then recreate the container.

  If the directory is not writable, Mixarr falls back to a temporary directory and
  logs a warning; the backup still completes and can be downloaded, but that
  server-side copy may not persist — download it to keep it.

## Troubleshooting failed imports

- *"This is not a Mixarr Library Intelligence backup"* — the file is a different archive
  or a database dump; only `.mixarr-library-backup` files created by Mixarr are accepted.
- *Checksum verification failed* — the file is corrupt or was modified; re-download or
  re-create it.
- *Requires a newer Mixarr* — the backup was created by a newer version; upgrade Mixarr.
- *Waiting for library sync* — configure Plex and run a library sync, then resume.
- *Many unmatched records* — ensure the same Plex library was synced; retry matching
  after the sync completes.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MIXARR_BACKUP_DIR` | `/app/backups` | Directory where server-side backup archives are stored. Mount this on a volume separate from the database. |
