# Mixarr v2.4.15 — Storage Safety and Large-Library Scalability

## Investigation conclusion

The v2.4.14 report was reproducible in two distinct ways. A stock fresh application container wrote **240,541,696 bytes** into its writable layer before serving requests. Of that, approximately **230 MiB** was `/tmp/.npm`, created because the Docker startup command ran `npx --yes prisma@5.14.0` three times. The test database was only 23 MiB at that point. In addition, v2.4.14 used Docker's unlimited default `json-file` log configuration while metadata providers and enrichment engines could emit one error per track. A repeated provider failure across a 150,000-track library could therefore grow the host-side Docker JSON log without an application-visible file inside the container. This is the most credible path from the confirmed hundreds-of-megabytes layer defect to the reported hundreds of gigabytes over time, although the deleted original container made the exact 790 GB file impossible to prove.

The v2.4.14 scanner also exhibited storage amplification in PostgreSQL. A 1,000-track initial scan took 13.4 seconds; an unchanged scan still took 8.5 seconds and increased the database by 180,224 bytes and WAL by 1,705,552 bytes. PostgreSQL statistics showed cumulative Track updates rising from 659 to 1,932, plus 100 Album updates and one Artist update, despite zero metadata changes. The scanner loaded the complete Plex track response and complete database track set, then performed a linear filter for each track. At 150,000 tracks this implied roughly 22.5 billion comparisons and made a faithful pre-fix full-scale run impractical.

### Confirmed v2.4.14 code paths

- `Dockerfile:98`: three `npx --yes prisma@5.14.0` startup calls downloaded the CLI into `/tmp/.npm` on each newly created container.
- `src/lib/syncEngine.ts:483-490`: the complete Plex track snapshot and complete database track set were retained simultaneously.
- `src/lib/syncEngine.ts:542,564`: every Plex track scanned the full database array with `existingTracks.filter(...)` (O(n²)).
- `src/lib/syncEngine.ts:616`: matched tracks were updated even when unchanged; artist and album upserts at lines 417-474 did the same.
- `src/lib/localBpmEngine.ts:62` and `src/lib/localAudioFeatureEngine.ts:50`: analysis temporary data defaulted to the container-wide `/tmp` tree rather than a Mixarr-owned mounted directory.
- `src/lib/libraryBackup/backupStorage.ts:13,50`: backups defaulted to `/app/backups` and could fall back to `/app/tmp/mixarr-backups` or `/tmp/mixarr-backups`.
- `src/lib/communityRecipes/service.ts:84` and `src/lib/mixRecipes/transferService.ts:295`: imported artwork was written below `/app/public/uploads`.
- `docker-compose.yml:35,43,47`: only selected legacy paths were mounted; cache, general temporary data, artwork, scans, jobs, and exports had no approved mounted root.
- `server.js:39,52`: the unused legacy standalone entrypoint serialized its complete state into a source-relative `data/plexmix-db.json` file.
- `docker-compose.yml`: no logging limit was configured, so Docker used unbounded host-side JSON logs.

PostgreSQL is the only database engine supported by v2.4.14/v2.4.15. SQLite, SQLite WAL, and SQLite SHM are therefore reported as not applicable (zero) rather than receiving misleading SQLite maintenance controls. PostgreSQL WAL retention, checkpoints, vacuuming, and physical database storage remain owned by the PostgreSQL service and its persistent volume.

## Storage ownership

The application source directory is immutable at runtime. Persistent or potentially large Mixarr-owned files use these roots:

| Category | Docker default | Bare-metal default | Contents |
| --- | --- | --- | --- |
| Configuration | `/config` | `~/.mixarr/config` | settings, migration marker, database metadata directory |
| Data | `/data` | `~/.mixarr/data` | parent for all managed data categories |
| Cache | `/data/cache` | `~/.mixarr/data/cache` | bounded file cache, when enabled |
| Temporary | `/data/temp` | `~/.mixarr/data/temp` | BPM/audio samples and controlled temporary artifacts |
| Artwork | `/data/artwork` | `~/.mixarr/data/artwork` | recipe/community artwork |
| Backups | `/data/backups` | `~/.mixarr/data/backups` | library-intelligence backups and restore uploads |
| Exports | `/data/exports` | `~/.mixarr/data/exports` | managed export artifacts |
| Jobs | `/data/jobs` | `~/.mixarr/data/jobs` | future job artifacts; history rows remain in PostgreSQL |
| Scans | `/data/scans` | `~/.mixarr/data/scans` | future scan artifacts; scan history rows remain in PostgreSQL |
| Logs | `/data/logs` | `~/.mixarr/data/logs` | disabled unless file logging is explicitly added/enabled |

Environment overrides are `MIXARR_CONFIG_DIR`, `MIXARR_DATA_DIR`, `MIXARR_DATABASE_DIR`, `MIXARR_CACHE_DIR`, `MIXARR_TEMP_DIR`, `MIXARR_ARTWORK_DIR`, `MIXARR_BACKUP_DIR`, `MIXARR_EXPORT_DIR`, `MIXARR_JOB_DIR`, `MIXARR_SCAN_DIR`, and `MIXARR_LOG_DIR`. Existing `MIXARR_BACKUP_DIR`, `LOCAL_BPM_TEMP_DIR`, `LOCAL_AUDIO_FEATURE_TEMP_DIR`, legacy `DATA_DIR`, and `DB_FILE` values remain supported. Configured user paths are never silently replaced.

On startup Mixarr creates and verifies the resolved directories, logs them once, checks the filesystem that actually contains `MIXARR_DATA_DIR`, warns when Docker data roots appear unmounted, reports legacy writable paths, migrates recognized `/app/backups` files once with a verified marker, removes stale temporary files, prunes bounded histories, and schedules cleanup every six hours. Cross-filesystem legacy migration copies to a temporary destination, verifies size, atomically installs the destination, and only then removes the original. The music library is never a migration or cleanup target.

## Cache and retention audit

| Cache/history | Location/key | Deduplication and limits | Cleanup |
| --- | --- | --- | --- |
| Managed file cache | `MIXARR_CACHE_DIR`; writer-defined stable path | enabled by default; 10 GiB hard limit; no symlink traversal; active files excluded | 30 days, startup, every six hours, manual, and size enforcement cleanup |
| Provider metadata | normalized Track/Popularity/AudioFeature/Tag rows in PostgreSQL | stable track identifiers and upserts; unchanged scans create no entries | processing-state retry policy; orphan file cache cleanup where applicable |
| UI/profile/statistics caches | process memory; user/library keys | 30-second to 2-minute expiry plus 1,000-entry hard cap | expired entries pruned at insertion; restart clears all |
| Deezer genre-name cache | process memory; provider genre ID | deduplicated and capped at 1,000 entries | FIFO eviction; restart clears all |
| Legacy standalone provider cache | process memory; provider + normalized track | 10,000 entries, 30-day TTL | expiry/FIFO; restart clears all |
| Scan staging | PostgreSQL UNLOGGED `PlexScanSeenTrack`; scan ID + stable entity key | primary-key deduplication, 500-row batches, globally single active full scan | truncate after success/failure/cancellation; stale startup retention fallback |
| Scan history | PostgreSQL `SyncLog` | one compact row per scan; no per-track snapshot | 30 days, 1,000-row cleanup batches |
| Job history | PostgreSQL `JobHistory` | compact job summary; active states excluded | 14 days, 1,000-row cleanup batches |
| AI request/response/audit history | PostgreSQL AI, natural-language, playlist-analysis, recommendation, metadata-advisory, and troubleshooting tables | idempotency and status protections remain; active/review rows excluded; prompt, response, context, and diagnostic payload tables are included | 30 days by default, privacy applied before persistence, 1,000-row cleanup batches |
| Secure AI debug payload | PostgreSQL encrypted/sanitized debug record | explicit expiry | removed after `expiresAt` |
| Artwork | `MIXARR_ARTWORK_DIR`; content/recipe-derived name | validated, deterministic names, atomic writes; binary data is not stored on Track | manual orphan detection/removal; active writes protected |
| Library backups | `MIXARR_BACKUP_DIR`; unique backup ID | database reads are batched; archive size is validated; atomic write; explicit user operation | manual deletion; not silently expired |

`MIXARR_CACHE_MAX_SIZE_GB=unlimited` is the only unlimited file-cache setting. Zero and negative values are rejected, so zero cannot ambiguously mean disabled or unlimited. Disable the cache explicitly with `MIXARR_CACHE_ENABLED=false`.

Default policy:

```env
MIXARR_CACHE_ENABLED=true
MIXARR_CACHE_MAX_SIZE_GB=10
MIXARR_CACHE_RETENTION_DAYS=30
MIXARR_TEMP_RETENTION_HOURS=24
MIXARR_JOB_RETENTION_DAYS=14
MIXARR_SCAN_HISTORY_RETENTION_DAYS=30
MIXARR_AI_HISTORY_RETENTION_DAYS=30
MIXARR_SCAN_BATCH_SIZE=500
MIXARR_SCAN_MAX_CONCURRENCY=4
MIXARR_SCAN_PROGRESS_INTERVAL=1000
```

## Scanner and database design

Tracks are fetched from Plex in validated pages and processed in 500-row transactions. Page-local stable identifiers query indexed subsets of PostgreSQL instead of loading the entire Track table. New rows use bulk insertion; existing rows are updated only when normalized metadata, file identity, sync state, or fingerprint changed. A stable recording fingerprint helps duplicate matching without binary data or full metadata snapshots.

The UNLOGGED scan-seen table holds only compact stable keys during a scan. It avoids WAL amplification for ephemeral reconciliation state, is globally protected so only one full-library scan can run, and is truncated before releasing the lock on success, failure, or cancellation. A failed partial Plex response never reaches missing-file reconciliation. Missing tracks are marked in one indexed `NOT EXISTS` query; no unlimited `IN (...)` list or tombstone table is created. Track rows remain for safe restoration and existing library-health semantics, rather than being destructively deleted.

The migration `20260803010000_storage_safety_v2415` adds `Track.recordingFingerprint`, lookup/reconciliation/history indexes, and `PlexScanSeenTrack`. It is additive and idempotent. The Docker compatibility startup sequence still uses `prisma db push`, then explicitly reapplies the migration SQL so the staging table is UNLOGGED even when `db push` initially created it as logged.

## Disk safeguards and diagnostics

```env
MIXARR_STORAGE_WARNING_PERCENT=80
MIXARR_STORAGE_CRITICAL_PERCENT=90
MIXARR_MIN_FREE_SPACE_GB=10
```

Before a full scan, backup, or artwork import, Mixarr checks the filesystem containing the configured data root. Optional storage-intensive work is refused at the critical percentage or below the minimum free-space floor; essential consistency cleanup can continue. Storage state also contributes to readiness/health.

Administrators can open `/settings/system/storage` or call the authenticated `/api/admin/storage` endpoint to see PostgreSQL database and WAL sizes, all managed file categories, history relation sizes and row counts, total/free filesystem space, configured policies, last cleanup outcome, reclaimed bytes, and unexpected legacy paths. Available operations are report, expired cleanup, all-cache cleanup, stale-temp cleanup, job/scan/AI pruning, and orphaned-artwork removal. Every operation previews by default. Deletion requires the exact confirmation `DELETE MIXARR MANAGED DATA`; music paths, active jobs, and active files are never included. The database-checkpoint action explicitly reports PostgreSQL ownership rather than pretending to run a SQLite checkpoint.

Developer/administrator commands:

```bash
npm run storage-report
npm run cleanup:dry-run
npm run cleanup
npm run benchmark-library-scan -- --tracks 150000 --suite
```

## Final 150,000-track benchmark

The benchmark generates Plex metadata over a local HTTP server and exercises the compiled production sync engine and PostgreSQL code paths without creating audio files. Final suite runtime was 366 seconds.

| Scenario | Duration | Peak RSS | DB growth | WAL | Track result |
| --- | ---: | ---: | ---: | ---: | --- |
| Initial 150,000 | 109.4 s | 422 MB | existing test DB reused free pages; see note | 669.9 MB | 150,000 inserted |
| Unchanged | 21.7 s | 409 MB | 0 B | 51.5 KB | 0 inserted/metadata changed/missing |
| 1% modified | 26.9 s | 431 MB | 2.0 MB | 32.9 MB | exactly 1,500 renamed |
| 1% removed | 20.6 s | 441 MB | 1.6 MB | 4.8 MB | exactly 1,500 marked missing |
| Five steady rescans | 19.9–21.1 s | 433–439 MB | net 0 B apart from one 162 KB relation-page fluctuation | 19.5–25.7 KB steady | 0 changed rows after statistics caught up |
| Interrupted scan | 1.0 s | 436 MB | 0 B | 6.4 KB | failed safely; staging 0 |
| Restart recovery | 21.3 s | 430 MB | 0 B | 19.7 KB | 0 duplicates; staging 0 |

The final database retained exactly 150,000 Track records (148,500 active and 1,500 missing). Every scenario reported 0 bytes of cache, artwork, temporary, backup, export, and file-log growth. A separate fresh-database run measured approximately 377 MB of normal persistent PostgreSQL growth for the initial 150,000 normalized tracks. The large 669.9 MB initial WAL volume is transient PostgreSQL work in the database volume, not Docker application-layer growth; unchanged scans stabilize at tens of kilobytes rather than hundreds of megabytes.

## Before-and-after Docker writable-layer measurements

The isolated v2.4.14 reproduction created a **240,541,696-byte application writable layer before any library scan**. `docker diff` and `du` identified about 230 MiB under `/tmp/.npm`, downloaded by the three `npx --yes prisma@5.14.0` startup commands. Its Docker JSON logger had no `max-size` or `max-file` options.

The final v2.4.15 validation used fresh PostgreSQL, config, and data volumes, a read-only root filesystem, and a 64 MiB `/tmp` tmpfs. After first startup and a restart, the application writable layer was **4,096 bytes**, `docker diff` was empty, `/tmp/.npm` did not exist, `/data` contained no payload data, and `/config` contained only the 94-byte one-time migration marker. Track, sync-log, job, and scan-staging counts were unchanged across restart. The 4 KiB reported by Docker is overlay metadata rather than an application-created file. Docker logging was confirmed as `json-file` with `max-size=10m` and `max-file=5`.

Docker reports a 2.19 GB immutable image display size (including the bundled FFmpeg, Aubio, Essentia, Next.js, and local Prisma runtime). The production stage retains the migration CLI but prunes build-only dependencies. Immutable image layers are distinct from the 4 KiB application writable layer and are content-addressed/shared by Docker. A final application build completed successfully, and the complete automated suite reported 1,139 tests: 1,138 passed, 0 failed, and 1 intentionally skipped.

## Docker deployment and upgrade from v2.4.14

The v2.4.15 image bundles Prisma and never downloads a CLI at startup. `/app` is read-only, `/tmp` is a 64 MiB tmpfs, and `/config` plus `/data` are declared volumes. Recommended Compose protection:

```yaml
services:
  mixarr:
    image: ghcr.io/chrisflix-labs/mixarr-beta:v2.4.15
    volumes:
      - ./mixarr/config:/config
      - ./mixarr/data:/data
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=64m
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
```

1. Stop Mixarr without deleting its PostgreSQL or existing backup volumes.
2. Back up the PostgreSQL volume and any `/app/backups` content.
3. Add persistent `/config` and `/data` mounts and Docker logging limits.
4. Pull/build v2.4.15 and start it normally. Never use `prisma db push --force-reset`.
5. Watch startup logs for resolved paths, legacy data, mount warnings, cleanup, capacity, and migration status.
6. Open Storage Diagnostics and run a cleanup preview before any deletion.
7. Run one library scan, then an unchanged rescan; unchanged Track/Album/Artist update counts should remain zero.

Recognized legacy backups are migrated only once. Other explicitly configured paths remain in place and are reported; Mixarr does not silently move arbitrary directories or the music library.

## Files changed for v2.4.15

```text
.env.example
CHANGELOG.md
Dockerfile
README.md
docker-compose.yml
docs/STORAGE_SAFETY_V2415.md
package-lock.json
package.json
prisma/schema.prisma
prisma/migrations/20260803010000_storage_safety_v2415/migration.sql
scripts/benchmark-library-scan.js
scripts/storage-cli.js
server.js
src/app/api/admin/storage/route.ts
src/app/api/storage/artwork/[...path]/route.ts
src/app/settings/page.tsx
src/app/settings/system/storage/page.tsx
src/components/StorageDiagnostics.tsx
src/instrumentation.ts
src/lib/adaptiveRecipeMappingContracts.test.ts
src/lib/adaptiveRecipeMappingService.ts
src/lib/aiDailyRequestLimits.test.ts
src/lib/aiFoundation.test.ts
src/lib/aiIntelligenceV2410.test.ts
src/lib/aiPerRequestCostLimit.test.ts
src/lib/aiProviderFeatureAuthorizationV2412.test.ts
src/lib/audioFeatureEngine.ts
src/lib/boundedCache.ts
src/lib/builtInRecipeContracts.test.ts
src/lib/builtInRecipes/compatibility.ts
src/lib/communityRecipeContracts.test.ts
src/lib/communityRecipes/service.ts
src/lib/duplicateRecordings.ts
src/lib/intentIntelligence.test.ts
src/lib/libraryBackup/backupStorage.ts
src/lib/localAudioFeatureEngine.ts
src/lib/localBpmEngine.ts
src/lib/logging.ts
src/lib/mixRecipes/transferService.ts
src/lib/naturalLanguageRequests.test.ts
src/lib/personalization/dashboard.ts
src/lib/popularityEngine.ts
src/lib/providers/audiodb.ts
src/lib/providers/deezer.ts
src/lib/providers/discogs.ts
src/lib/providers/lastfm.ts
src/lib/providers/musicbrainz.ts
src/lib/providers/spotify.ts
src/lib/readiness.test.ts
src/lib/readiness.ts
src/lib/recentlyAdded/detection.ts
src/lib/recentlyAdded/matching.ts
src/lib/recipeCopilot.test.ts
src/lib/recipeStudioService.ts
src/lib/releaseNotes.test.ts
src/lib/releaseNotes.ts
src/lib/storage.ts
src/lib/storageMaintenance.ts
src/lib/storageSafety.test.ts
src/lib/storageStartup.ts
src/lib/syncEngine.ts
src/lib/syncSettings.ts
src/lib/trackSync.ts
src/lib/trackTagEngine.ts
```

## Recovery from a nearly full host

Do not delete the affected container first: doing so can erase the writable-layer evidence needed to identify the growth path. Stop Mixarr to halt new work, then capture:

```bash
docker system df -v
docker inspect mixarr
docker diff mixarr
docker exec mixarr du -xhd1 /
docker exec mixarr du -xhd2 /app /config /data /tmp /var/tmp
docker logs --tail 500 mixarr
```

Also inspect Docker's `LogPath` from `docker inspect`; JSON logs live on the host and do not necessarily appear in `docker diff`. Back up PostgreSQL and `/config`/`data`, reclaim unrelated host space if necessary, upgrade to v2.4.15 with mounted roots and log rotation, start the app, and use Storage Diagnostics → cleanup preview. Clear only confirmed expired cache/temp/history through the authenticated controls. Never delete the music library or PostgreSQL files by hand. If the database volume is large, use PostgreSQL-native inspection and maintenance; do not delete WAL files manually.

## Remaining limits and evidence gaps

The original 790 GB container had already been removed, so its exact offending pathname cannot be recovered. The v2.4.14 Prisma download and unbounded Docker-log configuration were reproduced; the historical 790 GB split between writable layer, Docker JSON log, and other host storage remains unknown. The benchmark measures PostgreSQL, managed directories, WAL generation, and process RSS; host-specific Docker storage drivers may report allocated bytes differently. File logging is not enabled by Mixarr, and PostgreSQL's own logging/WAL retention must still be configured appropriately in the database service. User-created exports and intentionally retained library backups remain user-controlled and are not silently deleted.
