import { validDiscordSupportUrl } from "./appInfo";

export const MIXARR_BETA_DISCORD_URL = validDiscordSupportUrl(process.env.DISCORD_SUPPORT_URL || process.env.NEXT_PUBLIC_DISCORD_SUPPORT_URL) || "";

export type ReleaseNoteBadge =
  | "Audio Features"
  | "Automation"
  | "Backup"
  | "Beta"
  | "Bug Fix"
  | "BPM"
  | "Accuracy"
  | "Cache"
  | "Dashboard"
  | "Data Enrichment"
  | "Database"
  | "Debugging"
  | "Diagnostics"
  | "Discord"
  | "External APIs"
  | "Feedback"
  | "Energy"
  | "Essentia"
  | "Hotfix"
  | "History"
  | "Identity"
  | "Import"
  | "Export"
  | "Genres"
  | "Job History"
  | "Jobs"
  | "Library"
  | "Library Health"
  | "Library Sync"
  | "Local Analysis"
  | "Matching Rules"
  | "Mood"
  | "Mobile"
  | "Navigation"
  | "Notifications"
  | "Performance"
  | "Personalization"
  | "Playlists"
  | "Popularity"
  | "Plex"
  | "Preview"
  | "Recipes"
  | "Regeneration"
  | "Release Notes"
  | "Refresh"
  | "Retry"
  | "Readiness"
  | "Roadmap"
  | "Safety Rules"
  | "Scheduler"
  | "Security"
  | "Settings"
  | "Sharing"
  | "Smart Builder"
  | "Support"
  | "Track Matching"
  | "UI"
  | "Reliability"
  | "Worker";

export type ReleaseNote = {
  version: string;
  title: string;
  releaseDate?: string;
  badges: ReleaseNoteBadge[];
  changes: string[];
};

export const releaseNotes: ReleaseNote[] = [
  {
    version: "2.1.6",
    title: "Contextual Mixes",
    releaseDate: "July 16, 2026",
    badges: ["Smart Builder", "Playlists", "Personalization", "Identity", "Mood", "Energy", "BPM", "Database", "History", "Settings", "Mobile", "UI"],
    changes: [
      "Added seven built-in context cards: Monday Morning Focus, Friday Night Energy, Late Night Drive, Weekend Discovery, Sunday Acoustic, Summer Party, and Winter Chill.",
      "Added reusable custom context profiles with identity, availability, energy, discovery, familiarity, popularity, BPM flow, mood, variety, deep-cut, and recency controls.",
      "Added a visible Low, Balanced, or Strong context influence layer with strict caps, confidence-aware missing-metadata fallback, and real per-track context explanations.",
      "Added context application summaries, apply-only-unset behavior, manual override indicators, individual restoration, and reset-to-context-default actions.",
      "Integrated context scoring with the existing Smart Mix Engine v2 before separate playlist identity, adaptive personalization, explicit feedback, and playback layers; hard exclusions and protected tracks remain authoritative.",
      "Added authenticated user-isolated context CRUD, clone, apply/preview, and settings APIs plus optional local-time/day suggestions without location or activity inference.",
      "Stored the selected context, versioned snapshot, influence, overrides, and final resolved settings with generated playlists and generation history.",
      "Added an additive PostgreSQL migration, responsive accessible UI, tests, documentation, release notes, and Roadmap completion.",
    ],
  },
  {
    version: "2.1.5",
    title: "Listening History & Playback Awareness",
    releaseDate: "July 16, 2026",
    badges: ["Personalization", "Plex", "History", "Playlists", "Jobs", "Database", "Performance", "Security", "Settings", "Mobile", "UI"],
    changes: [
      "Added paginated incremental Plex playback-history synchronization with timestamp overlap, idempotent event keys, bounded rating-key lookups, retention controls, retry-safe state, and summarized Job History records.",
      "Added discovered Plex accounts and explicit per-server Mixarr-to-Plex user mappings so listening histories and recommendation profiles remain user-separated.",
      "Added conservative event normalization for completion, partial playback, accidental starts, missing duration or offsets, and confidence-limited skip inference.",
      "Added aggregated per-user track playback profiles with completion and skip rates, replay counts, recent windows, affinity, forgotten-favorite scores, and evidence confidence.",
      "Integrated playback awareness after existing Smart Mix and adaptive scoring as a separate capped layer with soft or strict recent-play behavior, completion and replay bonuses, cautious skip penalties, forgotten favorites, and deeper-cut support.",
      "Protected locked, important, and explicitly selected tracks from strict recent-play removal while keeping explicit dislikes and never-recommend feedback authoritative.",
      "Added a responsive Playback Awareness settings and dashboard page with mapping, influence, recency, forgotten-favorite, signal toggles, sync status, profile categories, rebuild, reset, privacy, and error states.",
      "Added authenticated, validated APIs for settings, mappings, sync, status, summary, paginated track details, rebuild, reset, and admin-only unmatched-event review.",
      "Added additive database migration, scheduled daily integration, score snapshots and explanations, automated coverage, privacy documentation, upgrade notes, and Roadmap completion.",
    ],
  },
  {
    version: "2.1.4",
    title: "Adaptive Smart Mix Scoring",
    releaseDate: "July 16, 2026",
    badges: ["Personalization", "Playlists", "Feedback", "Identity", "History", "Database", "Performance", "Settings", "Mobile", "UI"],
    changes: [
      "Added a dedicated adaptive scoring service on top of the unchanged Smart Mix Engine v2 base score, preserving both scores for comparison.",
      "Added separate personal preference, playlist identity, historical acceptance, historical rejection, artist, mood, discovery, and repeat components with source, scope, confidence, and plain-language reasons.",
      "Added evidence-based confidence multipliers, minimum-confidence controls, explicit-feedback priority, old-evidence decay, directional limits, and a 0–100% maximum personalization influence cap.",
      "Added Off, Light, Balanced, Strong, and Maximum presets, advanced component controls, per-playlist override storage, and recommended-default restoration.",
      "Added expandable base-versus-personalized scoring explanations to Smart Mix previews and regeneration previews, including visible cap messages and low-data states.",
      "Added aggregated user and playlist statistics, bounded batched recalculation with Job History, dirty-state tracking after feedback, reset previews, and scoped reset/retraining APIs.",
      "Stored adaptive scoring version and settings snapshots on managed playlists, with optional per-track explanation snapshots for historical explanations.",
      "Added the non-destructive PostgreSQL migration, user-isolated APIs, performance limits, tests, privacy documentation, release notes, and Roadmap updates.",
    ],
  },
  {
    version: "2.1.3",
    title: "Playlist Identity & Memory",
    releaseDate: "July 16, 2026",
    badges: ["Identity", "Playlists", "Personalization", "Regeneration", "History", "Database", "BPM", "Mood", "Energy", "Mobile", "UI"],
    changes: [
      "Added stable playlist identities keyed by the internal GeneratedPlaylist ID, with preserved Plex linkage independent of playlist names.",
      "Added normalized identity attributes, playlist track memory, idempotent membership events, artist and genre preferences, training runs, and compact snapshots.",
      "Added weighted current/history learning for mood distribution, energy and BPM character, discovery, artists, genres, metadata coverage, and explainable confidence states.",
      "Separated learned, user-defined, locked, inherited, and effective identity values; manual values and explicit playlist feedback take precedence over inferred behavior.",
      "Added playlist-specific temporary, weak, strong, and permanent rejection memory plus preferred, important, anchor, and locked track importance.",
      "Integrated playlist identity as a distinct Smart Mix v2 score component and added identity-aware regeneration reasons, hard playlist rejections, and impact warnings.",
      "Added a responsive Playlist Identity panel with selectable moods, range controls, preservation modes, characteristic locks, retraining, scoped reset, cloning, and important-track management.",
      "Added lazy initialization for legacy playlists, batched historical track loading, summarized Job History, local-data privacy documentation, and an additive PostgreSQL migration.",
    ],
  },
  {
    version: "2.1.2",
    title: "Likes, Dislikes & Track Feedback",
    releaseDate: "July 15, 2026",
    badges: ["Personalization", "Feedback", "Playlists", "Preview", "Regeneration", "Database", "Performance", "Mobile", "UI"],
    changes: [
      "Added reversible likes, dislikes, never-recommend exclusions, preferred artists, and recommend-less artist preferences with user-scoped effective state and append-only event history.",
      "Added playlist/profile-scoped good-fit and poor-fit signals plus transition-aware reports with stable optional reasons, notes, BPM, mood, energy, score, generation, and engine context.",
      "Integrated conservative explicit-feedback components and hard exclusions into Smart Mix Engine v2 without overwriting global scores or bypassing playlist safety and variety rules.",
      "Added compact accessible feedback controls to playlist previews, regeneration previews, and library track actions, with confirmation for strong exclusions and immediate local state updates.",
      "Added optional post-removal reasons and undo in Smart Builder previews; removals without a reason create no lasting personalization signal.",
      "Added server-side bulk feedback, artist deduplication, bounded chunks, partial-failure results, feedback search/management, and reset/privacy integration.",
      "Excluded never-recommend tracks from Smart Mix, regeneration candidates, and Recently Added recommendations while personalization is enabled.",
    ],
  },
  {
    version: "2.1.1-hotfix",
    title: "Nightly Audio Features & Logging Cleanup",
    releaseDate: "July 15, 2026",
    badges: ["Hotfix", "Audio Features", "BPM", "Essentia", "Scheduler", "Job History", "Reliability", "Performance"],
    changes: [
      "Fixed Audio Features not running for pending tracks during nightly synchronization and moved the awaited analysis to the final processing stage.",
      "Unified manual, recovered, and scheduled Audio Features execution around fresh saved settings and one provider-resolution path.",
      "Added proper local Essentia fallback when the preferred API is unavailable; API preference no longer disables eligible local analysis.",
      "Prevented enabled-but-unusable provider configurations from reporting a successful zero-work result while preserving valid disabled and no-eligible-track outcomes.",
      "Added clearer nightly stage summaries, Job History details, guarded batch draining, and bounded progress logs for long-running local analysis.",
      "Reduced repetitive sync and enrichment logging while retaining detailed per-item diagnostics at debug level.",
    ],
  },
  {
    version: "2.1.1",
    title: "Duplicate Preservation & Plex Conflict Inspector",
    releaseDate: "July 14, 2026",
    badges: ["Plex", "Library Sync", "Library Health", "Track Matching", "Database", "Data Enrichment", "Playlists", "Diagnostics", "Performance", "Reliability", "UI"],
    changes: [
      "Changed Plex synchronization identity to server, library, and rating key so GUID, path, or metadata overlap can never suppress a physical Plex track instance.",
      "Added canonical recording groups with confidence, evidence, review state, preferred sources, and non-destructive split/merge controls while preserving every existing Track ID and relationship.",
      "Added duplicate enrichment sharing for BPM, mood, and energy with manual/local/API precedence, field provenance, track-level overrides, and a default-enabled setting.",
      "Added a searchable, filterable, paginated Plex Conflict Inspector with row and bulk resolution actions plus a calculated, idempotent Repair Unresolved Plex Tracks preview.",
      "Made non-zero Library Health counts actionable and added missing album, artist, and track detail views, duplicate-group inspection, and duplicate-copy details on track pages.",
      "Updated Plex summaries and structured logs to distinguish active instances, grouped duplicates, inherited data, review relationships, and genuine persistence failures; duplicate relationships no longer count as skipped tracks.",
      "Added duplicate-aware playlist controls that avoid canonical recording repeats by default while allowing alternate copies and deterministic quality or existing-copy preferences.",
      "Added safe schema backfill, indexed duplicate lookups, server-side pagination, bounded bulk operations, and regression coverage for preservation, grouping, inheritance, manual overrides, ambiguous matches, repeat syncs, and repair totals.",
    ],
  },
  {
    version: "2.1.0",
    title: "Personalization Foundation",
    releaseDate: "July 13, 2026",
    badges: ["Personalization", "Smart Builder", "Playlists", "Settings", "Database", "Security", "History", "Roadmap", "UI"],
    changes: [
      "Added user recommendation profiles, optional playlist preference profiles, local interaction history, and typed selection/rejection service boundaries.",
      "Added conservative, explainable personal score adjustments with an internal eight-point cap and explicit separation from global and playlist-context scoring.",
      "Added independent personalization and behavior-learning toggles, readable profile summaries, confidence states, recent learning signals, and mobile-friendly controls.",
      "Added confirmed reset modes for learned behavior or all personalization while preserving Plex metadata, playlists, versions, manual metadata corrections, and global Smart Mix settings.",
      "Personalization behavior remains in the local Mixarr database; no external behavioral analytics, cloud profile synchronization, or third-party profile storage was added.",
      "Updated the product roadmap to mark v2.0.x complete and present v2.1.x Personalization & Adaptive Recommendations as the current cycle.",
      "Fixed repeated missing-track restoration during Plex sync. Restored tracks now persist as active, dashboard totals are recalculated after commit, and sync reconciliation includes stronger verification and diagnostics.",
    ],
  },
  {
    version: "2.0.10",
    title: "Beta Feature Polish & Advanced Flags",
    releaseDate: "July 13, 2026",
    badges: ["Beta", "Smart Builder", "Security", "Settings", "Diagnostics", "Feedback", "Discord", "Automation", "History", "Database"],
    changes: [
      "Added centralized server-authoritative feature resolution with Stable, Public Beta, Private Beta, and Developer access levels.",
      "Added disabled-by-default per-user opt-in, individual feature preferences, administrator overrides, access grants, and immediate global/per-feature emergency switches.",
      "Added Stable v2 and Experimental Balanced model registration, safe fallback before mutation, model comparison previews, and beta/scoring metadata in playlist versions.",
      "Added Beta Administration, consistent risk warnings, acknowledgement and reset flows, Sponsors messaging, sanitized diagnostics, local usage summaries, and configured feedback/Discord actions.",
      "Experimental Recently Added auto-add and scheduled regeneration now recheck access and flags at execution time and stop before playlist changes when unavailable.",
      "The v1.5.x beta JSON remains compatible, stable defaults are unchanged, and revoked access preserves preferences, playlists, and history in a disabled state.",
    ],
  },
  {
    version: "2.0.9",
    title: "Recently Added Automation",
    releaseDate: "July 13, 2026",
    badges: ["Automation", "Playlists", "Plex", "Preview", "Scheduler", "History", "Safety Rules", "Notifications", "UI"],
    changes: [
      "Added disabled-by-default Recently Added Automation with independent saved toggles; enabling the master switch never enables playlist-changing actions.",
      "Added idempotent new-track detection, explainable New Music Scores, confidence bands, configurable analysis quarantine, manual override, and persistent ignore controls.",
      "Added Smart Mix v2 playlist matching with reasons, suggested sections, expected score impact, previewable change sets, and per-playlist Off, Suggestions Only, or Automatic modes.",
      "Added explicit automatic-add thresholds and limits, duplicate and variety protection, overlapping-run locks, chunked large-library processing, and restorable versions around playlist changes.",
      "Added optional recently added mixes, user schedules, deduplicated notifications, detailed run history, progress phases, dashboard discovery status, and a responsive review/configuration workspace.",
      "Manual scanning, analysis, matching, mix creation, suggestion review, and selected application remain available while all automation is disabled.",
    ],
  },
  {
    version: "2.0.8",
    title: "Manual BPM & Metadata Corrections",
    badges: ["BPM", "Mood", "Energy", "Library", "History", "Accuracy", "Smart Builder", "Regeneration", "Database", "UI"],
    changes: [
      "Added persistent manual BPM, mood, and energy corrections while preserving provider and local-analysis values for comparison and audit.",
      "Added field-level verification, field-specific source ignoring and restoration, conflict indicators, correction reasons, and append-only history.",
      "Added mobile-friendly metadata comparison controls with BPM half-time/double-time suggestions and Mixarr mood choices.",
      "Added transactional bulk corrections with impact previews, validation warnings, replacement counts, and shared batch identifiers.",
      "Smart Mix Engine v2, playlist scoring, BPM flow, mood blending, energy curves, regeneration, and version snapshots now use centrally resolved effective metadata.",
      "Metadata enrichment remains free to refresh raw observations without replacing trusted manual corrections or restoring ignored sources.",
    ],
  },
  {
    version: "2.0.7",
    title: "Playlist Version History & Restore",
    badges: ["Playlists", "History", "Backup", "Regeneration", "Plex", "Security", "UI"],
    changes: [
      "Added complete ordered playlist snapshots for initial generation, full regeneration, advanced regeneration, restore, undo, and named manual restore points.",
      "Added a responsive version timeline with version details, engine and application metadata, stored scores, historical tracks, labels, and pin protection.",
      "Added current-to-history and arbitrary two-version comparisons for added, removed, moved, possibly replaced, state-changed tracks, generation settings, and scores.",
      "Added preview-first restoration with stale-playlist protection, an automatic safety version, explicit unavailable-track handling, current score recalculation, and Plex sync status.",
      "Added schema-versioned snapshot migration for v2.0.6 revisions, corrupt snapshot safeguards, recursive credential redaction, stable atomic revision counters, pagination, storage estimates, and protected retention cleanup.",
      "Added Playlist Version History settings with conservative defaults: enabled, 25-version retention, manual edit and score snapshots enabled, and automatic cleanup disabled.",
    ],
  },
  {
    version: "2.0.6",
    title: "Advanced Playlist Regeneration",
    badges: ["Beta", "Regeneration", "Playlists", "Preview", "History", "BPM", "Energy", "Mood", "UI"],
    changes: [
      "Added targeted replacement for weak, low-scoring, selected, and section-based playlist tracks.",
      "Added track locking, liked-track preservation, and lock-aware transition warnings.",
      "Added position-aware replacement scoring against both neighboring tracks and the saved mood, BPM, energy, discovery, and variety intent.",
      "Added interactive previews with individual acceptance, before/after metrics, meaningful-improvement thresholds, and original-track fallback.",
      "Added transaction-backed playlist revisions, stale-preview protection, regeneration history, and server-side undo.",
      "Added responsive, keyboard-accessible regeneration controls and large-library candidate-pool limits.",
    ],
  },
  {
    version: "2.0.5",
    title: "Deep Cut & Discovery Controls",
    badges: ["Playlists", "Popularity", "Plex", "History", "Preview", "Diagnostics", "UI"],
    changes: [
      "Added Mostly Familiar, Balanced Discovery, and Deep Discovery levels with editable advanced values and Custom state.",
      "Added deep-cut targets, relative overplay penalties, hidden-gem boosts, popular-track soft limits, and underplayed Plex track weighting.",
      "Added efficient generated-playlist-history lookbacks that penalize recent use without hard-excluding tracks or creating large bind-variable lists.",
      "Added pool-relative discovery classification, missing-metadata fallbacks, track-level selection reasons, result labels, warnings, and diagnostics.",
      "Added a separate Discovery Target Match metric so intentionally less-popular playlists do not reduce the overall quality score.",
      "Existing v2.0.2 Familiar vs Discovery values migrate into detailed discovery settings; Smart Mix v1 remains unchanged.",
    ],
  },
  {
    version: "2.0.4",
    title: "BPM Ramp & Transition Tools",
    badges: ["Playlists", "BPM", "Preview", "Diagnostics", "UI"],
    changes: [
      "Added beta BPM flow modes for Ramp Up, Ramp Down, Keep Steady, Natural Flow, and No BPM Ordering.",
      "Added BPM transition controls for maximum gap, rule strength, jump handling, half-time/double-time matching, and starting BPM strategy.",
      "Added reusable BPM transition analysis with difficulty labels, effective gap scoring, direction conflict detection, and missing-BPM handling.",
      "Integrated BPM flow ordering into Smart Mix Engine v2 while preserving mood, energy, recommendation tuning, and variety scoring.",
      "Added BPM Flow scoring metadata, transition warnings, preview sorting, and generated playlist BPM Flow details.",
    ],
  },
  {
    version: "2.0.3",
    title: "Mood Blending",
    badges: ["Playlists", "Smart Builder", "Mood", "Preview", "UI"],
    changes: [
      "Added Smooth Transition, Strict Matching, and Mixed Mood blend modes for Smart Mix v2 playlists.",
      "Added mood path and allowed-mood controls in Builder and Smart Builder.",
      "Improved mood-aware ordering so smooth mood paths can move through visible playlist zones.",
      "Added scoring support for multi-mood bridge tracks, compatible mixed moods, conflicting mood penalties, and missing mood-tag fallbacks.",
      "Added mood warnings and mood curve preview data to playlist previews and regeneration previews.",
      "Extended Smart Mix v2 diagnostics with mood coverage, fallback counts, conflict counts, bridge tracks, and missing mood counts.",
    ],
  },
  {
    version: "2.0.2",
    title: "Recommendation Tuning",
    badges: ["Playlists", "Smart Builder", "BPM", "Popularity", "UI"],
    changes: [
      "Added Smart Mix v2 recommendation tuning controls for recommendation strength, familiarity vs discovery, popularity, mood, energy, BPM, artist variety, and album variety.",
      "Added built-in tuning presets: Balanced, More Familiar, More Discovery, High-Energy, Chill, DJ-Friendly, and Deep Cuts.",
      "Added saved custom tuning presets with basic create, select, and delete support.",
      "Applied tuning to v2 candidate scoring, transition ordering, soft variety controls, recent-use avoidance, and fallback warnings.",
      "Generated playlists now store the tuning preset and tuning config snapshot used at creation time.",
      "Generated playlist cards now show the tuning preset and key tuning values without cluttering the page.",
    ],
  },
  {
    version: "2.0.1",
    title: "Playlist Scoring",
    badges: ["Playlists", "BPM", "Energy", "Mood", "Preview"],
    changes: [
      "Added playlist quality scoring for Smart Mix v2 generated playlists.",
      "Added BPM flow, energy curve, mood consistency, discovery balance, and weak-spot scoring.",
      "Added quality score storage and display for generated playlists and regeneration previews.",
      "Added warnings for missing metadata and transition weak spots.",
    ],
  },
  {
    version: "2.0.0",
    title: "Smart Mix Engine v2 Foundation",
    badges: ["Beta", "Smart Builder", "Playlists", "BPM", "History"],
    changes: [
      "Added the Smart Mix Engine v2 foundation with a separate ordered generation pipeline.",
      "Added engine version tracking for generated playlists and playlist history.",
      "Added v2 metadata fallback handling for missing BPM, mood, energy, and popularity.",
      "Added internal v2 scoring fields with score breakdowns for future tuning.",
      "Added Smart Mix Engine v1 Legacy and v2 Foundation labels in playlist preview, generated playlists, and history.",
      "Preserved the existing v1 playlist generation path for the standard builder.",
    ],
  },
  {
    version: "1.5.0",
    title: "Beta Feature Flags & Experimental Access",
    badges: ["Beta", "Settings", "Dashboard", "Preview", "Support"],
    changes: [
      "Added new Beta & Experimental Features settings section.",
      "Added master experimental feature toggle.",
      "Added groundwork for individual beta feature flags.",
      "Added clear beta, preview, and unstable UI labels.",
      "Added private beta warning text.",
      "Added GitHub Sponsors beta access messaging.",
      "Added optional beta-only preview cards for future v2.0.0 features.",
      "Added safe defaults so experimental features are disabled by default.",
      "Added backend support for reading and saving beta feature settings.",
      "Added guardrails so stable users are not affected by beta features.",
    ],
  },
  {
    version: "1.3.9.2",
    title: "External API Settings UI",
    badges: ["Hotfix", "Settings", "External APIs", "Security", "Data Enrichment"],
    changes: [
      "Rebuilt the External APIs settings section into configurable provider cards.",
      "Added web UI configuration for API provider toggles and supported enrichment types.",
      "Added encrypted storage for API keys and secrets saved through the UI.",
      "Kept .env fallback support while allowing UI-saved credentials to take effect without container restarts.",
      "Added safer provider testing, masked credentials, and support diagnostics redaction.",
      "Improved local-first behavior when API providers are disabled.",
    ],
  },
  {
    version: "1.3.9.1",
    title: "App Readiness Database Check Fix",
    badges: ["Hotfix", "Settings", "Readiness", "Database", "Diagnostics"],
    changes: [
      "Fixed a false App Readiness database error on the Settings page.",
      "Improved database readiness checks so optional or stale table checks do not show as critical errors.",
      "Added clearer database readiness statuses for OK, warning, and error states.",
      "Improved readiness diagnostics without exposing database credentials or secrets.",
    ],
  },
  {
    version: "1.3.9",
    title: "v2.0.0 Readiness & Beta Hardening",
    badges: ["Beta", "Readiness", "Diagnostics", "Settings", "Release Notes", "Roadmap"],
    changes: [
      "Added app readiness checks for database, Plex, worker, scheduler, support links, and local analysis status.",
      "Added readiness information to support/settings diagnostics.",
      "Cleaned up release notes and roadmap for the end of the v1.3.x cycle.",
      "Added a v2.0.0 roadmap preview focused on Smart Mix Engine v2 and smarter playlist generation.",
      "Improved configuration validation and safer empty/error states.",
      "Improved support diagnostics consistency while preserving secret redaction.",
      "Hardened beta defaults before the v2.0.0 feature cycle.",
    ],
  },
  {
    version: "1.3.8",
    title: "Beta Feedback & Discord Support Polish",
    badges: ["Beta", "Support", "Discord", "Diagnostics", "Feedback"],
    changes: [
      "Added a Beta Support page with Discord, GitHub, feedback, and diagnostics actions.",
      "Added copyable bug report and feedback templates.",
      "Added safe support diagnostics export with secret redaction.",
      "Added support actions for failed jobs and Library Health diagnostics.",
      "Added configurable Discord support URL handling.",
      "Improved beta version/about details and links to release notes and roadmap.",
    ],
  },
  {
    version: "1.3.7.2",
    title: "Dashboard Card Refresh Fix",
    badges: ["Hotfix", "Dashboard", "Library Health", "Data Enrichment", "Refresh"],
    changes: [
      "Fixed the Dashboard Library Health card staying stuck in a Refreshing state after health data was available.",
      "Fixed Dashboard Data Enrichment showing zero counts when enrichment data existed.",
      "Aligned Dashboard Library Health and Data Enrichment cards with their shared summary sources.",
      "Improved dashboard loading, error, and stale refresh states.",
      "Improved dashboard refresh behavior after sync, enrichment, and worker jobs complete.",
    ],
  },
  {
    version: "1.3.7.1",
    title: "Remove Healthy Tracks Card",
    badges: ["Hotfix", "Library Health", "Performance", "UI"],
    changes: [
      "Removed the expensive Healthy Tracks card from the Library Health summary page.",
      "Improved Library Health page load performance by avoiding unnecessary healthy-track calculations.",
      "Kept issue-focused Library Health cards for missing, partial, failed, and pending metadata categories.",
    ],
  },
  {
    version: "1.3.7",
    title: "Plex Matching & Track Sync Polish",
    badges: ["Plex", "Library Sync", "Track Matching", "Library Health", "Job History"],
    changes: [
      "Improved Plex track matching using stable identifiers before metadata fallbacks.",
      "Improved handling for moved files, renamed tracks, restored tracks, and missing-from-Plex records.",
      "Added clearer Plex sync summaries with scanned, matched, added, updated, moved, missing, duplicate, and conflict counts.",
      "Added Plex Sync diagnostics and Library Health visibility for sync-related issues.",
      "Improved duplicate candidate and match conflict handling without unsafe automatic merging.",
      "Preserved enrichment metadata more reliably during track sync updates.",
    ],
  },
  {
    version: "1.3.6",
    title: "Background Worker Reliability",
    badges: ["Worker", "Scheduler", "Job History", "Reliability", "Diagnostics"],
    changes: [
      "Added clearer background worker health, heartbeat, and queue visibility.",
      "Added stale worker and stale job detection.",
      "Improved recovery for interrupted enrichment and analysis jobs after restart.",
      "Added duplicate job protection for long-running sync and enrichment actions.",
      "Improved Job History status, progress, and result summaries.",
      "Improved scheduled job reliability and skip reporting when another job is already running.",
      "Added worker and scheduler diagnostics for troubleshooting.",
    ],
  },
  {
    version: "1.3.5",
    title: "Mood & Energy Sync Improvements",
    badges: ["Mood", "Energy", "Audio Features", "Library Health", "Data Enrichment", "Smart Builder"],
    changes: [
      "Added clearer mood and energy health classification in Library Health.",
      "Added mood/energy source and confidence display where available.",
      "Added missing mood, missing energy, and partial mood/energy visibility.",
      "Improved retry/reprocess targeting for tracks missing mood or energy values.",
      "Improved Data Enrichment summaries for mood and energy completeness.",
      "Improved Smart Builder and Playlist Preview messaging when mood/energy data is incomplete.",
    ],
  },
  {
    version: "1.3.4",
    title: "BPM Confidence & Source Improvements",
    badges: ["BPM", "Library Health", "Data Enrichment", "Diagnostics", "Playlists"],
    changes: [
      "Added clearer BPM source labels for local, API, imported, estimated, and manual values.",
      "Added BPM confidence levels to make tempo data easier to trust.",
      "Added BPM source conflict detection for significantly different provider values.",
      "Improved Library Health BPM detail views with source, confidence, and reason information.",
      "Added BPM source/confidence filters and source breakdowns where available.",
      "Improved Dashboard and Data Enrichment BPM summaries.",
    ],
  },
  {
    version: "1.3.3",
    title: "Data Enrichment Cleanup",
    badges: ["Data Enrichment", "Library Health", "BPM", "Audio Features", "Genres", "Popularity", "Job History"],
    changes: [
      "Cleaned up Data Enrichment into clearer BPM, Audio Features, Genres, Popularity, and Local Audio Analysis sections.",
      "Added clearer provider/mode visibility for enrichment actions.",
      "Added preflight summaries before enrichment jobs run.",
      "Improved no-op handling so enrichment actions explain when no tracks are eligible.",
      "Connected enrichment actions to Library Health detail filters.",
      "Improved Job History summaries for enrichment jobs.",
      "Improved dashboard and Library Health refresh after enrichment jobs complete.",
    ],
  },
  {
    version: "1.3.2",
    title: "Local Audio Analysis Polish",
    badges: ["Audio Features", "Local Analysis", "Essentia", "Library Health", "Job History"],
    changes: [
      "Added clearer Local Audio Analysis status and provider-mode visibility.",
      "Added local analysis preflight summaries with matched, eligible, skipped, and skip-reason counts.",
      "Improved Local Essentia progress and completion summaries.",
      "Improved skip reason reporting for local audio analysis and force reprocess actions.",
      "Added local analysis diagnostics to Library Health.",
      "Improved Library Health and dashboard refresh after local analysis jobs complete.",
    ],
  },
  {
    version: "1.3.1",
    title: "Audio Feature Retry Improvements",
    badges: ["Library Health", "Audio Features", "Retry", "Local Analysis", "Job History"],
    changes: [
      "Improved audio-feature retry actions to use the same resolved track sets as Library Health cards and detail views.",
      "Added retry preflight checks with matched, eligible, queued, skipped, and skip-reason counts.",
      "Improved local Essentia retry handling for partial and pending audio-feature tracks.",
      "Added clearer disabled states for API-only and local-only retry modes.",
      "Improved Job History summaries for audio-feature retry and reprocess jobs.",
      "Library Health and dashboard counts now refresh after audio-feature retry jobs complete.",
    ],
  },
  {
    version: "1.3.0.1",
    title: "Audio Features Health Card Sync Fix",
    badges: ["Hotfix", "Dashboard", "Library Health", "Audio Features", "Cache"],
    changes: [
      "Fixed Audio Features health cards showing stale incomplete counts after audio feature data was saved.",
      "Improved Library Health cache invalidation after audio feature sync, retry, and local Essentia reprocess jobs.",
      "Aligned Dashboard and Library Health audio feature counts around the same source-of-truth resolver.",
      "Added stale summary diagnostics for audio feature health counts.",
      "Preserved v1.3.0 Library Health Accuracy count/detail/retry consistency rules.",
    ],
  },
  {
    version: "1.3.0",
    title: "Library Health Accuracy",
    badges: ["Library Health", "Accuracy", "Diagnostics", "Audio Features", "BPM", "Genres", "Popularity", "Retry"],
    changes: [
      "Rebuilt Library Health around shared category resolvers so card counts, detail rows, and retry actions use the same track sets.",
      "Added health accuracy invariants for audio features, BPM, genres, popularity, and local file status.",
      "Added Health Accuracy Diagnostics to detect count/detail mismatches.",
      "Improved provider-mode-aware classification for BPM and audio feature health.",
      "Preserved the v1.2.8 fix for BPM-present tracks being classified as partial audio features.",
      "Improved retry targeting and skip explanations for Library Health categories.",
      "Added health diagnostics export for easier bug reports.",
    ],
  },
  {
    version: "1.2.9.1",
    title: "Matching Rules Layout Fix",
    badges: ["Hotfix", "UI", "Playlists", "Matching Rules"],
    changes: [
      "Fixed Matching Rules row overflow on the Playlist Builder page.",
      "Improved responsive layout for rule fields, operators, values, and delete actions.",
      "Prevented Matching Rules controls from overlapping the preview panel.",
      "Improved narrow-width and mobile behavior for the Matching Rules card.",
    ],
  },
  {
    version: "1.2.9",
    title: "Playlist Builder UI Fix",
    badges: ["UI", "Playlists", "Preview", "Safety Rules", "Bug Fix"],
    changes: [
      "Fixed Playlist Builder layout overlap after generating a playlist preview.",
      "Improved Previewed Tracks table sizing and overflow behavior.",
      "Improved responsive layout for builder and preview panels.",
      "Tuned repeated-artist warnings so allowed repeats do not show as warnings when max tracks per artist is enabled.",
      "Added clearer safety-rule messaging for successful variety rules versus actual problems.",
      "Prepared the UI for the upcoming v1.3.0 feature branch.",
    ],
  },
  {
    version: "1.2.8-hotfix.7",
    title: "Audio Feature Incomplete Count Classification Fix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Retry", "Dashboard"],
    changes: [
      "Fixed Audio Feature Health showing zero incomplete categories while the dashboard reported incomplete tracks.",
      "Tracks with BPM data but missing full audio feature fields now count as Partial Audio Features.",
      "Partial and Pending Audio Feature detail views now use the same incomplete track set as the dashboard.",
      "Improved local Essentia retry targeting for partial audio-feature tracks.",
      "Removed misleading missing-audio-feature gap wording when tracks are actually partial.",
    ],
  },
  {
    version: "1.2.8-hotfix.6",
    title: "BPM Partial Audio Feature Classification Fix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Retry", "Local Analysis"],
    changes: [
      "Fixed tracks with BPM data being incorrectly classified as missing audio features.",
      "Tracks with BPM but missing energy, mood, danceability, or local Essentia values now count as partial audio features.",
      "Partial Audio Features and Pending Audio Features now load the correct track sets.",
      "Improved retry and local Essentia candidate selection for partial audio-feature tracks.",
      "Aligned /settings/library-health and /library-health around the same classification rules.",
    ],
  },
  {
    version: "1.2.8-hotfix.5",
    title: "Partial Audio Feature Classification Fix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Retry", "Local Analysis"],
    changes: [
      "Fixed tracks with BPM data but missing audio feature fields being classified as missing instead of partial.",
      "Partial Audio Features now correctly shows tracks with incomplete energy, mood, danceability, or local Essentia fields.",
      "Pending Audio Features now loads the same retry-eligible track set shown in the summary.",
      "Improved local Essentia retry candidate selection for partial audio-feature tracks.",
      "Aligned /settings/library-health and /library-health classification behavior.",
    ],
  },
  {
    version: "1.2.8-hotfix.4",
    title: "Library Health Card Detail Match Fix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Retry"],
    changes: [
      "Fixed Missing Audio Features cards showing 70 while the detail view returned 0 tracks.",
      "Fixed Pending Audio Features cards showing 70 while the detail view returned 0 tracks.",
      "Unified Library Health card counts and detail rows around shared track ID resolution.",
      "Included audio feature gap tracks in detail views and retry candidate selection.",
      "Added mismatch detection so health cards cannot silently disagree with detail tables.",
    ],
  },
  {
    version: "1.2.8-hotfix.3",
    title: "Audio Gap Detail Query Fix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Retry"],
    changes: [
      "Fixed Missing Audio Features detail view returning zero rows when summary showed gap-classified tracks.",
      "Fixed Pending Audio Features detail view to include gap-classified tracks.",
      "Added shared audio feature gap track ID logic for summary, details, and retry actions.",
      "Improved retry candidate selection for active tracks without audio feature records.",
      "Improved debug logging for audio feature summary/detail count matching.",
    ],
  },
  {
    version: "1.2.8-hotfix.2",
    title: "Audio Gap Summary Merge Fix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Dashboard", "Retry"],
    changes: [
      "Fixed audio feature gap detection not being merged into Library Health summary counts.",
      "Missing audio feature cards now include active tracks without audio feature records.",
      "Fixed detail filters so gap tracks appear when clicking View tracks.",
      "Improved audio feature retry targeting for gap-classified tracks.",
      "Aligned audio feature provider mode logging with actual settings.",
    ],
  },
  {
    version: "1.2.8-hotfix",
    title: "Audio Feature Gap Hotfix",
    badges: ["Hotfix", "Library Health", "Audio Features", "Dashboard", "Retry"],
    changes: [
      "Fixed active tracks with no audio feature records being excluded from Library Health detail filters.",
      "Added audio feature gap detection between dashboard complete counts and Library Health categories.",
      "Classified unaccounted incomplete tracks as missing audio features instead of hiding them.",
      "Improved dashboard wording to show exact incomplete audio feature counts.",
      "Improved retry targeting for missing audio feature tracks.",
    ],
  },
  {
    version: "1.2.8",
    title: "Audio Feature Health Consistency Fix",
    badges: ["Library Health", "Audio Features", "Bug Fix", "Retry", "Dashboard"],
    changes: [
      "Fixed mismatch where audio feature health summaries showed incomplete tracks but detail views returned none.",
      "Aligned missing, partial, and pending audio feature filters with summary counts.",
      "Improved audio feature completeness checks for current provider settings.",
      "Added clearer incomplete-track reasons in Library Health details.",
      "Improved retry targeting so audio feature retries use the same filters shown in the UI.",
      "Improved dashboard wording when rounded percentages hide incomplete tracks.",
    ],
  },
  {
    version: "1.2.7",
    title: "Navigation Cleanup",
    badges: ["UI", "Mobile", "Navigation", "Dashboard"],
    changes: [
      "Cleaned up desktop sidebar navigation with grouped sections.",
      "Grouped playlist tools, library tools, and activity pages.",
      "Reduced mobile bottom navigation to the most-used items.",
      "Added a mobile More menu for secondary pages.",
      "Improved mobile spacing so navigation labels no longer overlap.",
      "Moved mobile version/GitHub/Beta controls out of the crowded bottom area.",
    ],
  },
  {
    version: "1.2.6",
    title: "Export/Import Mixarr Recipes",
    badges: ["Recipes", "Import", "Export", "Backup", "Sharing"],
    changes: [
      "Added recipe export for individual recipes and all saved recipes.",
      "Added recipe import with validation and preview before saving.",
      "Added duplicate-name handling with automatic rename or skip options.",
      "Preserved recipe filters, Smart presets, Mood presets, BPM presets, and safety rules during export/import.",
      "Added a stable Mixarr recipe JSON format for backups and sharing.",
    ],
  },
  {
    version: "1.2.5",
    title: "Playlist History",
    badges: ["Playlists", "History", "Regeneration", "Preview", "Job History"],
    changes: [
      "Added Playlist History for created and regenerated Mixarr playlists.",
      "Added historical track snapshots showing the exact order written to Plex.",
      "Added playlist creation and regeneration summaries with filters, recipes, presets, exclusions, and safety rules.",
      "Added history details views with track lists and regeneration comparison stats.",
      "Added links from Generated Playlists to related playlist history.",
    ],
  },
  {
    version: "1.2.4",
    title: "Advanced Playlist Regeneration",
    badges: ["Playlists", "Regeneration", "Plex", "Preview", "Job History"],
    changes: [
      "Enabled Keep Some Existing Tracks regeneration mode.",
      "Added 25% and 50% keep options for playlist regeneration.",
      "Enabled Prefer Different Tracks Than Last Time using generated playlist snapshots.",
      "Added regeneration comparison stats for kept, replaced, reused, and new tracks.",
      "Added Remove from Generated Playlists action without deleting Plex playlists.",
      "Improved regeneration preview safety before replacing Plex playlist contents.",
    ],
  },
  {
    version: "1.2.3",
    title: "Playlist Regeneration",
    badges: ["Playlists", "Regeneration", "Smart Builder", "Recipes", "Preview", "Plex"],
    changes: [
      "Added playlist regeneration for Mixarr-created playlists.",
      "Added saved generation metadata for playlists created from the builder, Smart Builder, and recipes.",
      "Added regeneration preview before replacing tracks in Plex.",
      "Added support for regenerating playlists using saved filters, presets, manual exclusions, and safety rules.",
      "Added Generated Playlists visibility and Job History entries for regeneration runs.",
    ],
  },
  {
    version: "1.2.2-hotfix",
    title: "Smart Builder Preset Hotfix",
    badges: ["Hotfix", "Smart Builder", "Mood", "BPM", "Beta"],
    changes: [
      "Fixed Smart Builder so Mood Presets can be selected without first choosing a Smart Preset.",
      "Fixed Smart Builder so BPM Presets can be selected without first choosing a Smart Preset.",
      "Allowed Smart, Mood, and BPM presets to be combined independently.",
      "Improved Smart Builder preview metadata for partial preset selections.",
      "Changed the app status badge from Official to Beta.",
    ],
  },
  {
    version: "1.2.2",
    title: "BPM Range Presets",
    badges: ["Smart Builder", "Playlists", "BPM", "Recipes", "Preview"],
    changes: [
      "Added BPM Range Presets to Smart Builder.",
      "Added Slow, Medium, Upbeat, Dance, High Energy, and Wide Open tempo presets.",
      "BPM Presets now tune playlist tempo without manually entering ranges.",
      "Playlist Preview now shows selected BPM preset metadata and helpful low-match warnings.",
      "Saved recipes now preserve BPM preset metadata while keeping filter values as the source of truth.",
    ],
  },
  {
    version: "1.2.1",
    title: "Mood Presets",
    badges: ["Smart Builder", "Playlists", "Mood", "Recipes", "Preview"],
    changes: [
      "Added Mood Presets for quickly applying mood, energy, and BPM ranges.",
      "Added presets such as Happy, Chill, Hype, Dark, Emotional, Sad / Mellow, Relaxed, Focus, Upbeat, and Balanced.",
      "Moved Mood Presets into the Smart Builder flow where guided playlist features belong.",
      "Fixed Mood Presets placement so they now appear directly in the Smart Builder flow.",
      "Playlist Preview now shows the selected mood preset and related warnings.",
      "Saved recipes now preserve mood preset metadata while keeping filter values as the source of truth.",
    ],
  },
  {
    version: "1.2.0",
    title: "Smart Playlist Builder v1",
    badges: ["Smart Builder", "Playlists", "Recipes", "Preview", "Safety Rules"],
    changes: [
      "Added Smart Playlist Builder v1 with guided playlist presets.",
      "Added presets for Workout, Chill, Party, Focus, Driving, Discovery, Deep Cuts, Popular Favorites, and Balanced Mix.",
      "Smart Builder now suggests filters, BPM ranges, energy/mood ranges, popularity preferences, and safety rules.",
      "Smart Builder uses the existing playlist preview flow before creating playlists.",
      "Smart Builder setups can be saved as reusable playlist recipes.",
      "Playlist creation history now records the Smart Builder preset used.",
    ],
  },
  {
    version: "1.1.10",
    title: "Playlist Safety Rules",
    badges: ["Playlists", "Recipes", "Preview", "Safety Rules"],
    changes: [
      "Added optional playlist safety rules to reduce repetitive results.",
      "Added artist spacing to avoid same-artist back-to-back tracks.",
      "Added max tracks per artist and max tracks per album controls.",
      "Added low-track-count warnings in playlist preview.",
      "Saved safety rule settings with playlist recipes.",
      "Added safety rule summaries and warnings to playlist preview and Job History.",
    ],
  },
  {
    version: "1.1.9.1",
    title: "Manual Track Exclusion",
    badges: ["Playlists", "Recipes", "Preview", "Library"],
    changes: [
      "Added manual track exclusions for Mixarr-generated playlists.",
      "Added exclude actions from playlist previews.",
      "Added excluded track management with remove-exclusion support.",
      "Applied manual exclusions to playlist previews, recipe previews, and playlist creation.",
      "Added exclusion counts to playlist preview stats where applicable.",
    ],
  },
  {
    version: "1.1.9",
    title: "Edit and Duplicate Playlist Recipes",
    badges: ["Playlists", "Recipes", "UI", "Preview"],
    changes: [
      "Added editing for saved playlist recipes.",
      "Added recipe duplication for quickly creating variations.",
      "Added update-existing-recipe support from the playlist builder.",
      "Added improved recipe actions and updated recipe metadata.",
      "Kept recipe previews connected to the playlist preview flow.",
    ],
  },
  {
    version: "1.1.8",
    title: "Save Playlist Recipes",
    badges: ["Playlists", "Recipes", "Preview", "UI"],
    changes: [
      "Added saved playlist recipes for reusable playlist filter setups.",
      "Added Save Recipe action to the playlist builder.",
      "Added a Saved Recipes page with recipe summaries and usage actions.",
      "Added recipe preview support using the playlist preview flow.",
      "Added dashboard visibility for saved playlist recipes.",
    ],
  },
  {
    version: "1.1.7",
    title: "Playlist Preview Before Create",
    badges: ["Playlists", "Preview", "UI", "Plex"],
    changes: [
      "Added a playlist preview step before creating playlists.",
      "Added track previews, filter summaries, and playlist stats before writing to Plex.",
      "Added warnings for low-match and zero-match playlist filters.",
      "Added create-from-preview flow so users can review playlists first.",
      "Improved playlist creation confidence and reduced accidental bad playlists.",
    ],
  },
  {
    version: "1.1.6-hotfix",
    title: "Homepage Library Health Performance Hotfix",
    badges: ["Bug Fix", "Dashboard", "Library Health"],
    changes: [
      "Fixed large-library homepage performance issue where Library Health counts could block SSR for several minutes.",
      "Reduced expensive repeated health-count queries.",
      "Homepage now renders without waiting for a full Library Health recalculation.",
    ],
  },
  {
    version: "1.1.6",
    title: "Library Health Details",
    badges: ["Library Health", "Debugging", "BPM", "Audio Features", "Jobs"],
    changes: [
      "Added a dedicated Library Health Details page.",
      "Added clickable health categories for missing BPM, API-only BPM, partial audio features, failed analysis, and missing local files.",
      "Added track-level explanations for why items appear in each health category.",
      "Added filtered track views with sorting and basic actions.",
      "Connected Library Health retry actions with Job History and retry explanations.",
    ],
  },
  {
    version: "1.1.5",
    title: "Background Scheduler Settings",
    badges: ["Settings", "Scheduler", "Automation", "Jobs"],
    changes: [
      "Added web UI controls for the Background Scheduler.",
      "Added daily, weekly, interval, and custom cron schedule options.",
      "Kept 3:00 AM daily as the default schedule.",
      "Added validation for custom cron expressions.",
      "Added scheduler status visibility and better scheduled-job history labeling.",
      "Kept SYNC_CRON_SCHEDULE as a fallback/default environment variable.",
    ],
  },
  {
    version: "1.1.4",
    title: "Retry Explanation Improvements",
    badges: ["Library Health", "Retry", "Debugging", "Jobs"],
    changes: [
      "Improved retry result messages when no tracks are queued.",
      "Added clearer explanations for zero-result BPM and audio-feature retry actions.",
      "Added retry filter, matched, queued, skipped, and reason details where available.",
      "Improved Job History summaries for retry and zero-attempt jobs.",
      "Reduced confusion around local-only retry and force reprocess actions.",
    ],
  },
  {
    version: "1.1.3",
    title: "Better Job History",
    badges: ["Jobs", "Dashboard", "Debugging", "Library Health"],
    changes: [
      "Added Job History page for recent background jobs.",
      "Added status, timing, duration, and summary details for sync and retry jobs.",
      "Added dashboard visibility for recent job activity.",
      "Added basic filters for job status and job type.",
      "Improved debugging visibility for failed or zero-result jobs.",
    ],
  },
  {
    version: "1.1.2",
    title: "Version & Update Visibility",
    badges: ["UI", "Settings", "Release Notes", "Roadmap"],
    changes: [
      "Added clearer current-version visibility across Mixarr.",
      "Added an About / Updates area for release notes, roadmap access, and update guidance.",
      "Added dashboard version visibility.",
      "Centralized app version display to reduce stale version mismatches.",
    ],
  },
  {
    version: "1.1.1",
    title: "Roadmap & Coming Soon",
    badges: ["Beta", "Dashboard", "Roadmap", "UI"],
    changes: [
      "Added a Roadmap / Coming Soon page for Mixarr's path toward v2.0.0.",
      "Added a dashboard card linking to the v2.0.0 roadmap.",
      "Added roadmap sections for current release, upcoming features, v2.0.0 ideas, and beta community access.",
      "Updated app version display to v1.1.1.",
    ],
  },
  {
    version: "1.1.0",
    title: "Dashboard Cleanup & v2.0.0 Preview",
    badges: ["Beta", "Dashboard", "Roadmap", "UI"],
    changes: [
      "Cleaned up dashboard enrichment card layouts.",
      "Fixed Track Genres card text overflow.",
      "Removed redundant Data Enrichment dashboard section.",
      "Added v2.0.0 Coming Soon preview section.",
      "Added guidance that enrichment tools are available from each dashboard card.",
      "Improved dashboard polish and mobile layout.",
    ],
  },
  {
    version: "1.0.5",
    title: "Metadata Reliability & Library Health Polish",
    badges: ["Beta", "Bug Fix", "Dashboard", "Library Health", "Local Analysis"],
    changes: [
      "Fixed partial audio feature retry not clearing after successful local Essentia analysis.",
      "Fixed retry queues replaying already-completed tracks.",
      "Improved BPM and audio feature candidate selection consistency.",
      "Added post-save verification logging for local metadata analysis.",
      "Improved Library Health count/filter accuracy.",
      "Improved whole-track Essentia temp cleanup and worker safety.",
      "Added separate too-short status handling.",
      "Added GitHub repository link.",
      "Improved provider/status breakdowns in Dashboard and Library Health.",
    ],
  },
  {
    version: "1.0.4",
    title: "Local/API Metadata Controls",
    badges: ["Beta", "Local Analysis", "Settings"],
    changes: [
      "Added settings to enable or disable API BPM lookup.",
      "Added settings to enable or disable API Audio Feature lookup.",
      "Added local Essentia-only mode for BPM.",
      "Added local Essentia-only mode for Audio Features.",
      "Added API-preferred vs local-preferred effective value logic.",
      "Added provider breakdowns to Dashboard and Library Health.",
      "Added retry behavior that respects configured providers.",
    ],
  },
  {
    version: "1.0.3",
    title: "Library Health, Cleanup & Pool Stability",
    badges: ["Beta", "Bug Fix", "Dashboard", "Library Health", "Plex"],
    changes: [
      "Added Library Health page.",
      "Added Plex/Mixarr sync integrity stats.",
      "Added missing track viewer.",
      "Added safe cleanup tools for stale Plex records.",
      "Added missing track export.",
      "Added BPM health summary.",
      "Added validated atomic BPM samples, ffmpeg seek fallback, and separate extraction/analyzer failure reporting.",
      "Improved dashboard counts to use active tracks only.",
      "Fixed Prisma connection pool exhaustion during long-running sync/status polling.",
      "Improved Sync Center status polling with slower idle polling, active polling hints, and pool-busy backoff.",
      "Added shared job overlap protection for manual syncs, enrichment jobs, and nightly scheduler runs.",
      "Improved Prisma P2024 logging with concise pool-timeout diagnostics instead of repeated status stack traces.",
    ],
  },
];

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "");
}

function prereleaseRank(value?: string) {
  if (!value) return 3;
  if (value.startsWith("hotfix")) return 4;
  if (value.startsWith("rc")) return 2;
  if (value.startsWith("beta")) return 1;
  return 0;
}

function comparePrereleaseIdentifiers(left: string, right: string) {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) {
      const difference = leftNumber - rightNumber;
      if (difference !== 0) return difference;
      continue;
    }

    const difference = leftPart.localeCompare(rightPart);
    if (difference !== 0) return difference;
  }

  return 0;
}

export function compareSemanticVersions(left: string, right: string) {
  const [leftMain, leftPrerelease] = normalizeVersion(left).split("-", 2);
  const [rightMain, rightPrerelease] = normalizeVersion(right).split("-", 2);
  const leftParts = leftMain.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = rightMain.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }

  const rankDifference = prereleaseRank(leftPrerelease) - prereleaseRank(rightPrerelease);
  if (rankDifference !== 0) return rankDifference;
  return comparePrereleaseIdentifiers(leftPrerelease || "", rightPrerelease || "");
}

export function getReleaseNotesOldestFirst(notes: ReleaseNote[] = releaseNotes) {
  return [...notes].sort((left, right) => compareSemanticVersions(left.version, right.version));
}

export function getReleaseNotesNewestFirst(notes: ReleaseNote[] = releaseNotes) {
  return [...notes].sort((left, right) => compareSemanticVersions(right.version, left.version));
}
