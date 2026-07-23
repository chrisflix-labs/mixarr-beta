/**
 * Human-readable description of exactly what a Library Intelligence Backup
 * includes and excludes. Shared by the UI, the coverage summary, and the create
 * preview so the promise shown to the user matches what the code actually does.
 */

export const EXPORT_INCLUDED_CATEGORIES = [
  "Plex track identity (GUID, rating key, source id, title, artist, album, disc/track number, duration, year, file size, path hash, metadata fingerprint)",
  "Audio features (energy, danceability, valence, acousticness, loudness, key, tempo, and other existing analysis fields)",
  "BPM / tempo values and their source and analysis state",
  "Popularity scores, provider, and lookup state",
  "Track genres (raw and normalized) and genre lookup state",
  "Processing, completion, and known no-data states for the above",
  "Provenance: analysis source, engine version, and original timestamps",
] as const;

export const EXPORT_EXCLUDED_CATEGORIES = [
  "AI provider configuration, requests, prompts, responses, and history",
  "API keys, Plex tokens, passwords, and authentication secrets",
  "Session data and environment variables",
  "Application logs and audit logs",
  "User accounts, user passwords, and household controls",
  "Notification credentials, webhook secrets, and provider credentials",
  "Recipes, playlists, and saved natural-language requests",
  "Unrelated application settings and unrelated queue history",
  "Raw audio files, album artwork, and full database dumps",
  "Raw absolute media paths (a SHA-256 path hash is stored instead)",
] as const;

export const BACKUP_SCOPE_SUMMARY =
  "Library Intelligence backups preserve calculated audio metadata so it can be restored " +
  "without repeating a full analysis. They do not contain application settings, accounts, " +
  "Plex tokens, API keys, AI data, logs, playlists, or audio files.";
