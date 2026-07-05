# Mixarr

**Mixarr** is a self-hosted Plex music playlist and library enhancement app for people who want smarter ways to explore, repair, and playlist their Plex music libraries.

[![Discord](https://img.shields.io/badge/Discord-Mixarr%20Beta-5865F2?logo=discord&logoColor=white)](https://discord.gg/B7xMvAhaF)

Mixarr connects to your Plex music library, syncs artists/albums/tracks into a local database, and helps build smarter playlists using metadata, genres, moods, energy, BPM, popularity, and audio analysis. It is designed for self-hosted Plex music users who want more control than static playlists can provide.

## Roadmad to V2.0.0 & Beyond

![Dashboard Desktop](Screenshots/Roadmap.png)

## Beta / Experimental Notice

Mixarr is actively developed and several features are still beta or experimental. Bugs, edge cases, provider rate limits, failed audio samples, and incomplete metadata handling may happen, especially on large or unusual libraries.

Please report bugs, logs, feature requests, and test results in the Mixarr beta Discord:

[https://discord.gg/B7xMvAhaF](https://discord.gg/B7xMvAhaF)

Mixarr is not affiliated with Plex. Back up important playlists and settings before testing beta features or large repair/backfill jobs.

## Current Features

| Area | What Mixarr does today |
| --- | --- |
| Plex library connection | Connects to Plex, imports music libraries, and stores artists, albums, tracks, tags, and library state locally. |
| Smart playlist generation | Builds playlists from rules such as genre, artist, album, year, popularity, BPM, energy, mood, danceability, and more. |
| Push to Plex | Exports generated playlists back to Plex and supports saved playlist refresh flows. |
| Dashboard cards and stats | Shows library counts, metadata coverage, health summaries, background sync status, and app version context. |
| Library browsing | Provides searchable library and genre views for synced Plex music. |
| Track genre tools | Syncs, filters, inspects, and retries track-level genre metadata from supported providers. |
| Playlist-use tracking | Tracks playlist generation/export history and saved playlist refresh activity. |
| BPM detection and backfill | Uses API metadata where available, with local fallback support for missing or partial BPM data. |
| Audio feature analysis | Stores energy, mood/valence, danceability, acousticness, tempo, source, status, and confidence fields. |
| API metadata support | Uses providers such as Deezer, Last.fm, MusicBrainz, Discogs, Spotify, and AudioDB where configured and available. |
| Retry and repair tools | Provides targeted retry/backfill tools for missing or partial genre, popularity, BPM, and audio-feature data. |
| Library health views | Surfaces missing tracks, active/missing counts, metadata coverage, failure reasons, retry queues, and cleanup tools. |
| Background jobs | Runs sync, metadata, playlist refresh, and analysis jobs with progress logging and overlap protection. |
| Docker deployment | Ships with Docker and Docker Compose support for self-hosted installs. |

## Beta and Experimental Features

These features exist in the current beta, but are still being tested across different libraries, platforms, and file layouts:

| Feature | Status |
| --- | --- |
| Local Essentia BPM analysis | Experimental. Uses Essentia when available, with Aubio fallback on unsupported or unavailable setups. |
| Local Essentia audio-feature analysis | Experimental. Can analyze local audio for energy, mood/valence, danceability, acousticness, and related confidence data. |
| Multi-window and whole-track analysis modes | Beta. Useful for improving BPM/audio-feature coverage, but can be slower and CPU-heavy. |
| BPM and audio-feature confidence scoring | Beta. Confidence values are useful signals, not final truth. |
| Provider preference controls | Beta. API/local provider toggles and retry behavior are still being refined. |
| Library Health cleanup and repair tools | Beta. These tools are helpful, but review selections carefully before cleanup actions. |
| Automated saved playlist refresh | Beta. Background refresh jobs include locking/protection, but playlist automation should still be tested carefully. |
| Metrics and progress reporting | Beta. Useful for troubleshooting, but labels and coverage may continue to evolve. |

## Getting Started

1. Clone this repository.
2. Copy `.env.example` to `.env`.
3. Fill in the Plex settings and any optional provider keys you want to use.
4. Start the stack:

```bash
docker-compose up -d --build
```

If your Docker setup uses Compose v2, this command may also work:

```bash
docker compose up -d --build
```

Open Mixarr at:

```text
http://localhost:3000
```

From there, connect Plex, choose your music library, start a metadata sync, and use the dashboard/settings tools to run optional metadata, BPM, genre, popularity, and audio-feature jobs.

## Configuration Notes

Most users should start with `.env.example` and only change the values they need. Provider keys are optional, but more configured providers can improve metadata coverage.

### Plex

```env
PLEX_CLIENT_IDENTIFIER=your-random-uuid-here
PLEX_PRODUCT_NAME="Mixarr Playlist Curator"
PLEX_OAUTH_CALLBACK_URL=http://localhost:3000/auth/callback
```

### Providers

Mixarr can use external providers where available and configured:

| Provider | Used for |
| --- | --- |
| Deezer | BPM, popularity, genre metadata |
| Last.fm | Popularity and final-fallback genre tags |
| MusicBrainz | Genre/tag metadata |
| Discogs | Optional genre/style metadata |
| Spotify | Optional popularity/audio metadata and artist genres where enabled |
| AudioDB | Audio-feature metadata where available |

Provider APIs can be rate-limited, unavailable, incomplete, or inconsistent. Mixarr records source/status information so you can inspect and retry partial results.

### Local BPM and Audio Analysis

Local analysis defaults are intentionally conservative:

```env
ENABLE_API_BPM=true
ENABLE_LOCAL_BPM=true
PREFER_LOCAL_BPM=false
REPROCESS_API_BPM_WITH_LOCAL=false
LOCAL_BPM_ANALYZER=auto
LOCAL_BPM_ANALYSIS_SCOPE=windows
LOCAL_BPM_CONCURRENCY=1
LOCAL_BPM_REPROCESS_AUBIO_WITH_ESSENTIA=0
LOCAL_BPM_REPROCESS_NO_DATA_FAILED=0

ENABLE_API_AUDIO_FEATURES=true
ENABLE_LOCAL_AUDIO_FEATURES=true
PREFER_LOCAL_AUDIO_FEATURES=false
REPROCESS_API_AUDIO_FEATURES_WITH_LOCAL=false
LOCAL_AUDIO_FEATURES_SCOPE=windows
LOCAL_AUDIO_FEATURES_CONCURRENCY=1
LOCAL_AUDIO_FEATURES_AUTO_BACKFILL=0
```

`LOCAL_BPM_ANALYZER=auto` prefers Essentia when available and falls back to Aubio. The default `windows` scope samples multiple portions of a track. `whole_track` can be more thorough, but is slower.

Automatic initial sync does not launch the larger local Essentia audio-feature backfill unless `LOCAL_AUDIO_FEATURES_AUTO_BACKFILL=1`, except when API audio features are disabled and local analysis is enabled.

### Docker Media Path Mapping

For local BPM/audio analysis, the Mixarr container needs read access to the same media files Plex reports. These variables help rewrite Plex paths into container paths:

```env
PLEX_MEDIA_PATH_HOST=/mnt/Music
MIXARR_MEDIA_PATH_CONTAINER=/home/Mixarr/Music
MIXARR_PATH_MAPPINGS=/mnt/Music:/media
```

You also need the matching read-only Docker volume mount. For example, if Plex reports `/mnt/Music/...` but the Docker host stores files at `/mnt/plex/Music/...`, use:

```env
MIXARR_PATH_MAPPINGS=/mnt/Music:/media
```

And mount the real host folder into the container:

```yaml
volumes:
  - /mnt/plex/Music:/media:ro
```

## Database and Job Tuning

Mixarr keeps Prisma traffic conservative by default:

```env
MIXARR_DB_JOB_CONCURRENCY=4
MIXARR_STATUS_CACHE_SECONDS=5
MIXARR_STATUS_POLL_SECONDS=10
MIXARR_STATUS_IDLE_POLL_SECONDS=30
```

For larger installs, Prisma supports connection-string parameters such as `connection_limit` and `pool_timeout`:

```env
DATABASE_URL=postgresql://mixarr:mixarrpass@db:5432/mixarrdb?schema=public&connection_limit=20&pool_timeout=20
```

Prefer lowering job concurrency and avoiding overlapping syncs before raising the pool size.

## Discord Community

Join the Mixarr beta Discord to report bugs, share feedback, and help test upcoming features:

[https://discord.gg/B7xMvAhaF](https://discord.gg/B7xMvAhaF)

Good feedback is especially useful for large libraries, unusual Plex metadata, Docker path-mapping issues, local Essentia/Aubio analysis, provider rate limits, and playlist refresh behavior.

## Reporting Bugs

When reporting an issue, please include as much of the following as possible:

- Mixarr version.
- Docker image/tag, if applicable.
- Plex music library size.
- What page you were on and what action you clicked.
- Whether the issue involves API metadata, local Essentia analysis, BPM, audio features, playlists, dashboard, or library health.
- Relevant logs from the Mixarr container.
- Screenshots, if they help explain the problem.
- Any provider settings or local analysis settings that seem relevant.

Please avoid posting secrets such as Plex tokens, API keys, database passwords, or private file paths you do not want to share.

## Roadmap to v2.0.0 and Beyond

v2.0.0 is planned as a major step toward making Mixarr a more capable, more transparent, and more useful Plex music companion app. The items below are future-focused placeholders and may change as beta testing continues.

### Planned for v2.0.0

- Smarter playlist builder with more expressive controls.
- Improved genre intelligence and genre cleanup workflows.
- Better mood, energy, BPM, and audio-feature confidence scoring.
- Advanced local audio analysis options.
- More detailed library health diagnostics.
- Better retry, repair, and backfill tools.
- Playlist recommendations based on your library metadata.
- More dashboard insights and clearer status cards.
- User-configurable metadata/audio enrichment providers.
- Improved UI polish across desktop and mobile.
- Better duplicate and metadata cleanup tools.
- More automation around Plex playlist updates.

### Future Ideas Beyond v2.0.0

- Possible AI-assisted playlist ideas and playlist prompts.
- More advanced recommendation logic across genres, moods, eras, and listening contexts.
- Deeper duplicate detection and release/version grouping.
- More automation controls for scheduled playlist updates.
- Additional provider integrations where they make sense for self-hosted users.
- More export, reporting, and diagnostics tools for library maintenance.

## Previews

### Dashboard

| Desktop | Mobile |
| :---: | :---: |
| ![Dashboard Desktop](Screenshots/01.Dashboard-normal.png) | <img src="Screenshots/01.Dashboard-mobile.PNG" width="250"> |

### Playlist Builder

| Desktop | Mobile |
| :---: | :---: |
| ![Builder Desktop](Screenshots/02.Build%20Playlist-normal.png) | <img src="Screenshots/02.Build%20Playlist-mobile.PNG" width="250"> |

### Library View

| Desktop | Mobile |
| :---: | :---: |
| ![Library Desktop](Screenshots/03.Library-normal.png) | <img src="Screenshots/03.Library-mobile.PNG" width="250"> |

### Genres Page

| Desktop | Mobile |
| :---: | :---: |
| ![Genres Desktop](Screenshots/04-Genres-normal.png) | <img src="Screenshots/04-Genres-mobile.png" width="250"> |

### Settings and Integration

| Desktop | Mobile |
| :---: | :---: |
| ![Settings Desktop](Screenshots/04-Settings-norma.png) | <img src="Screenshots/04-Settings-mobile.PNG" width="250"> |

## Architecture

| Layer | Stack |
| --- | --- |
| Frontend | Next.js 14 App Router, React, CSS |
| Backend | Next.js route handlers, Node.js background workers |
| Database | PostgreSQL with Prisma ORM |
| Jobs | Sync, metadata, local analysis, playlist refresh, and scheduler jobs |
| Deployment | Docker and Docker Compose |

## Status

Mixarr is a serious self-hosted Plex music companion app, but it is still beta software. Expect active iteration, test carefully, and bring bugs or ideas to the Discord so the next version can get sharper.
