# Changelog

## v2.4.0 - AI Provider Foundation

- Added a provider-neutral AI contract, adapter registry, capability model, request coordinator, normalized errors, retries with jitter, timeouts, cancellation, response byte limits, normalized streams, and Zod-backed structured-response validation.
- Added native Ollama and Anthropic adapters plus shared OpenAI-compatible support for OpenAI, LiteLLM, LM Studio, DeepSeek, OpenRouter, and configurable compatible APIs. ChatGPT Subscription is registered as unavailable; Mixarr never uses browser cookies, profiles, session tokens, or web automation.
- Added additive provider, discovered-model, health, feature-setting, global-setting, and safe request-audit tables in migration `20260721050000_ai_provider_foundation_v240`. Global AI and every feature default to disabled; no provider is created and no external request runs during upgrade.
- Added administrator APIs and a responsive `/settings/ai` dashboard for provider CRUD, explicit secret replacement/removal, connection testing, model discovery, health, capabilities, budget/usage metadata, privacy classification, future-feature availability, and sanitized audits.
- AI credentials and secret headers use application-level AES-256-GCM authenticated encryption. Full prompts, full responses, raw provider errors, API keys, authorization headers, Plex tokens, and private library records are not persisted in AI audits.
- v2.4.0 adds foundation only: there is no AI playlist creation, regeneration, recipe execution, track add/remove/unlock, automation, web browsing, filesystem, shell, or tool-execution endpoint.

## v2.3.9 - Recipe Studio & Release Polish

- Added `/recipes/new` and `/recipes/:id/edit` as one responsive Recipe Studio with Guided, Beginner, and Advanced modes over the existing recipe schema.
- Added debounced and cancellable live candidate estimates, actionable compatibility analysis, scoring impact, discovery/variety previews, cached aggregate library profiles, and explicit estimate/stale/error states.
- Added accessible energy curve presets and control-point tables, expanded BPM flow controls, keyboard-native inputs, reduced-motion behavior, mobile collapse, and sticky mobile Validate/Save actions.
- Added unsaved-change detection, save progress, structured validation messaging, optimistic `expectedUpdatedAt` conflicts, recipe create/edit/archive audit events, and confirmed section copying from side-by-side comparison.
- Added recipe usage analytics, first-time onboarding, dedicated import routing, Recipe Library Studio links, and documentation covering safety, troubleshooting, migration, backup, keyboard, and mobile behavior.
- Added additive indexes for installed recipe lists, recipe playlist usage, and operational job aggregation in migration `20260721010000_recipe_studio_v239`.
- Reorganized Roadmap into Current, Next, Future, and collapsed Completed views while preserving historical data; added **Mixarr v2.4.x — AI-Assisted Mix Intelligence** as a roadmap-only next release line.
- Existing v2.3.x recipe documents, playlist associations, trust state, signatures, audit history, inheritance, snapshots, imports, and backups remain backward compatible and are not silently rewritten.

## v2.3.8 - Recipe Safety, Compatibility & Governance

- Added recipe schema v3 with explicit permission reasons, dependencies and safe fallbacks, semantic Mixarr-version compatibility, deprecation-aware migration output, deterministic canonical signing payloads, and Ed25519 public-key verification.
- Added server-derived local/trusted/official/untrusted/quarantined/signature-invalid/unknown/revoked trust, pending/approved/restricted/rejected/revoked approval, and signature result state persisted independently of enabled state.
- Added conservative configurable safety limits with absolute caps, explainable combined-risk analysis, impossible-candidate checks, forbidden delete/recreate and protected-target detection, and Suggest-Only defaults for external recipes.
- Extended staged import with a shared server-side governance plan, explicit high-risk consequences, stale-plan revalidation, transactional persistence, pre-import snapshots, immutable correlated audit events, and conflict-aware atomic restore.
- Added scoped governance, quarantine, signing-key, migration, audit, validation, approval, rejection, revalidation, safety-policy, snapshot-preview, and restore APIs plus recipe-list badges, visible import warnings, recipe governance details, and a quarantine workflow.
- Added execution-time approval, quarantine, permission, deletion, and protected-playlist enforcement; private signing keys and client-provided official/trust state are never accepted.
- Added additive migration `20260720180000_recipe_governance_v238`, governance/security tests, release documentation, and recipe-author guidance.

## v2.3.7 - Plex & Media Ecosystem Integrations

- Added prioritized multi-server Plex status, detailed authentication/identity/library/playlist/collection tests, user mapping, playlist ownership and permissions, collection import/export, external fingerprints, change classification, and manual reconciliation actions.
- Added scan-aware and mount-aware destructive synchronization gates, post-scan grace periods, recovery hysteresis, actionable Plex availability categories, and failover policy state with safe read-only defaults.
- Added privacy-minimized Tautulli playback signal ingestion, portable Discord recipe sharing, Notifiarr notifications, centralized versioned integration events, HMAC SHA-256 webhooks, retry tracking, delivery history, and retention cleanup.
- Added a fast expanded Homepage widget, flat Home Assistant status, authenticated low-cardinality Prometheus metrics, liveness/readiness/protected-details health endpoints, and a sanitized `/api/public/v1` dashboard API.
- Added hashed scoped API tokens shown once, expiry/revocation/use audit data, an administrator integration center, safe integration tests, ownership/reconciliation controls, responsive layouts, and an additive migration.
- Upgrade defaults are conservative: existing servers stay enabled; reconciliation requires manual review; failover and every new external integration remain disabled; webhook destinations and all new secrets require encryption and validation.

## v2.3.6 - Household Collaboration & Shared Playlists

- Added named, archivable households with stable Mixarr-user memberships, owner/member/child roles, reusable or expiring guests, configurable influence, eligibility, family restrictions, and temporary exclusions that retain preference history.
- Added opt-in household mode to Smart Builder with participant selection, six deterministic balance modes, configured-versus-effective influence preview, shared-favorite weighting, caps, anti-domination safeguards, party mode, family rules, voting, approval thresholds, and fairness controls.
- Extended Smart Mix generation with batched individual/shared preference loading, household compatibility scoring, consensus boosts, hard household dislikes, strict child content rules, conflict detection/resolution, artist/genre/member representation, contribution snapshots, and explanations.
- Added versioned playlist and track voting, approval-gated drafts that do not sync to Plex, administrator publication after approval, contribution breakdowns, preference conflicts, and a filterable privacy-safe activity log.
- Added household management and generated-playlist collaboration UI, authenticated APIs, an additive indexed migration, deterministic algorithm tests, and release documentation.
- Compatibility: all existing playlists remain Individual; no playlist, recipe, feedback, history, or Plex workflow is converted automatically.

## v2.3.5 - Community Recipe Sharing

- Added portable community recipe JSON, `.mixarr-recipe.zip` bundles, and checksum-protected `MXR1:` share codes.
- Added secure HTTPS URL, copy-and-paste, share-code, and upload import through one staged validation and approval pipeline.
- Added author, license, compatibility, changelog, tags, artwork, screenshots, source attribution, trust warnings, update conflicts, and local-modification detection.
- Added strict SSRF, redirect, archive, image, executable-content, credential, environment-variable, size, and path-traversal protections.
- Added decentralized sanitized reporting and optional read-only official GitHub repository browsing.
- Community recipes are data-only: Mixarr never executes recipe scripts, commands, plugins, hooks, or imported secrets.

## v2.3.4 - Curated Recipe Library

### Added

- A bundled, offline catalog of 28 versioned starter recipes covering Workout, Driving, Focus, Party, Relaxation, Sleep, Discovery, Deep Cuts, Recently Added, Forgotten Favorites, Decade Mixes, Seasonal Mixes, Genre Journeys, Artist Radio, Album Exploration, and Mood Progressions.
- A responsive `/recipes/library` browser with search, multi-category chips, difficulty, metadata, compatibility, favorites, hidden-recipe management, sorting, recently used recipes, loading and empty states, behavior previews, exact on-demand candidate counts, and accessible mobile details.
- One-click installation into the existing Mix Recipe model, safe duplicate prevention, source recipe/version tracking, customize-before-create handoff to the established editor, update status, explicit restore-original controls, and recipe-level version history.
- Deterministic compatibility estimates based on aggregate coverage of playback history, ratings, BPM, mood, energy, genres, artist/album metadata, date added, release year, popularity, and local analysis, with required/recommended distinctions and plain-language reasons.
- Normalized per-user favorite, hidden, last-used, source-version, and use-count persistence through the additive `20260720040000_curated_recipe_library_v234` migration.

### Compatibility, privacy, and performance

- Existing recipes, playlists, automation, inheritance, imports, and settings remain unchanged; built-in definitions are version-controlled application data and never overwrite an installed customization automatically.
- Card compatibility uses cached aggregate/count queries and never loads full track records. Exact primary-filter counts are lazy-loaded only for the opened recipe details view and reuse the current Smart Mix query builder.
- The complete catalog works without internet access, GitHub, external metadata requests, a marketplace, or a remote recipe service. Compatibility is an estimate, not a playlist guarantee.

## v2.3.3 - Preset Inheritance & Overrides

### Added

- Deterministic centralized recipe resolution across built-in/global defaults, categories, multi-level base recipes, transition/discovery/variety/automation presets, recipe/group/playlist/user overrides, and authoritative locks.
- Per-field provenance, suppressed-value and conflict explanations, stable fingerprints, cycle/depth protection, field and section resets, dependency/impact previews, versioned presets, and four inheritance-aware clone modes.
- Additive normalized persistence for presets, categories, overrides, group policies, user preferences, locks, effective snapshots, conflicts, and audit events; generated playlists now capture exact resolver snapshots for reproducible retries.
- Responsive Presets & Inheritance management and recipe-editor foundation/effective-configuration views with accessible state labels, mobile inheritance chains, lock details, conflict guidance, and reset controls.

### Compatibility and safety

- Existing recipes remain legacy-explicit after the non-destructive migration and retain equivalent generation behavior. Inheritance is opt-in, false/zero/empty values remain explicit, and preset changes never trigger automatic regeneration.
- Server-side resolution and validation remain authoritative. Base/preset deletion is dependency-checked, group precedence is explicit, and administrator/user permissions reuse Mixarr authentication.

## v2.3.2 - Adaptive Recipe Mapping

### Added

- Receiving-library analysis for staged recipe imports, including genres, moods, artists, BPM, energy, popularity, audio-feature coverage, sync state, total tracks, and reusable saved mappings.
- Exact, normalized, saved, conservative alias/related, one-to-many, relaxed, unavailable, unsupported, and no-mapping-required decisions with confidence, reasons, local counts, candidate impact, and manual review.
- Deterministic weighted compatibility scoring and breakdowns, original/adapted count-only candidate estimates through the existing Smart Mix query builder, library coverage, candidate-pool health, warnings, and relaxation recommendations.
- Responsive Recipe Compatibility & Mapping UI with original/adapted comparison, searchable local vocabulary controls, debounced/cancellable recalculation, accept/reset actions, import-original choice, and explicit high-impact confirmation.
- Owner- and library-scoped analysis, mapping-decision, and saved-rule persistence; a mapping management page; later review from recipe details; and additive indexed migration `20260719230000_adaptive_recipe_mapping_v232`.

### Compatibility and safety

- The original imported recipe is preserved beside the adapted local definition. Existing v2.3.0/v2.3.1 recipes remain supported, imported automation remains disabled, and import never creates or modifies a Plex playlist.
- Candidate estimates use the same rule-to-Prisma query builder as playlist generation, grouped one-to-many OR rules remain grouped, manual/effective BPM sources retain existing precedence, and count queries do not load full track records.
- Major recipe-identity changes and low-compatibility original imports require explicit confirmation. Missing energy, BPM, or mood values are never fabricated.

## v2.3.1 - Recipe Import & Export

### Added

- Versioned `mixarr-recipe` and `mixarr-recipe-bundle` envelopes with explicit portable-field allowlists, deterministic canonical JSON, per-recipe SHA-256 checksums, and bundle-level integrity validation.
- Expiring, owner-scoped staged imports with checksum validation, sensitive-data scanning, schema migration, compatibility/adaptation analysis, duplicate-content and naming conflict detection, and server-side revalidation at confirmation.
- Rename, replace, skip, and use-existing conflict actions; administrator-only replacement; atomic and independent bundle transactions; recipe revision preservation; and no automatic playlist or automation creation.
- Optional `.mixarr-recipe.zip` and `.mixarr-bundle.zip` archives with controlled artwork files, path/symlink/executable/nested-archive defenses, compressed/expanded/file-count limits, content-based PNG/JPEG/WebP validation, and dimension/size limits.
- Persistent import/export audit history, sanitized support diagnostics, clear-history authorization, structured privacy-safe logs, and short-lived upload disposal.
- Responsive Recipe Library selection and bulk export, drag-and-drop six-step import wizard, human-readable recipe summaries, compatibility/security badges, per-recipe resolutions, progress/results state, and transfer history.
- Additive `20260719190000_recipe_import_export_v231` migration, security/unit/regression coverage, transfer format documentation, release notes, and Roadmap updates.

### Security and compatibility

- Valid exports cannot contain credentials, Plex server/library/media identifiers, database or installation IDs, local paths, hostnames, listening/playback history, learned preferences, likes/dislikes/rejections, generated playlist membership, or notification destinations.
- Existing v2.3.0 recipes remain valid. Older checksum-less canonical files use an explicit warning path; unsupported or corrupted integrity data is blocked.
- Exporting never changes recipe configuration. Importing never creates a generated playlist and never activates imported automation.

## v2.3.0 - Mix Recipe Foundation

### Added

- First-class Smart Mix recipes with metadata, artwork, independent ownership, enabled state, source traceability, and indexed generated-playlist relationships.
- Canonical `mixarr-recipe` schema v1 covering scoring, mood and energy, BPM flow, discovery, variety, playlist identity defaults, refresh, automation, and generation settings.
- Recipe revision tracking, centralized validation, schema migration infrastructure, create-from-playlist conversion, create-playlist-from-recipe generation, duplication, rename, soft deletion, and canonical export/import.
- Immutable resolved recipe snapshots and playlist-only override snapshots on generated playlists and regeneration records.
- Responsive Recipe Library, sectioned editor, validation UI, generated-playlist listing, and explicit automation confirmation.

### Compatibility

- Existing playlists and Smart Mix workflows do not require recipes.
- Recipes never contain track membership or personal feedback/history.
- Deleting a recipe retains every generated playlist and its historical snapshot.

## v2.2.9 - Orchestration Dashboard & Release Polish

- Added the unified Playlist Ecosystem dashboard with real health, group, overlap, coverage, Smart Action, experiment, job, activity, trend, and warning data.
- Added a bounded relationship graph, accessible relationship table, configurable overlap heatmap, group health overview, coverage segment drill-down, and mobile alternatives.
- Added independently loaded orchestration summary APIs, cached nightly ecosystem snapshots, persisted dashboard ranges, and bounded/paginated detailed payloads for large libraries.
- Added upcoming-job actions, retention-aware administrator queue cleanup, stale-job recovery, and audit filtering while preserving explanatory audit records.
- Added resumable onboarding/configuration review and explicit playlist enrollment that keeps automation disabled until separately enabled.
- Added versioned allowlisted JSON export, validated conflict preview, confirmed merge/replace import, missing-reference handling, transactions, and import auditing without importing secrets.
- Added backup-manifest validation, restore-readiness evidence, v2.2.x migration/index/link checks, and actionable non-blocking warnings.
- Added the additive `20260719010000_orchestration_dashboard_v229` migration, query indexes, tests, documentation, release notes, and final v2.2.x Roadmap updates.

## v2.2.8 - Playlist Health Monitoring & Alerts

- Added continuous playlist health scores across Plex linkage, missing and unavailable tracks, identity, repetition, artist and album variety, metadata confidence, BPM and mood transitions, staleness, and automation failures.
- Added severity-aware persistent alerts with acknowledgment, resolution, automatic recovery, reopening, occurrence counts, and audit history.
- Added in-app alerts plus encrypted Discord and generic webhook delivery with minimum-severity controls and delivery history.
- Added the Playlist Health workspace, dashboard health card, settings, navigation, nightly monitoring, authenticated APIs, additive persistence, tests, documentation, and v2.2.8 metadata.

## v2.2.7 - Smart Action Center

- Added a persistent, typed Smart Action framework and centralized review queue for playlist, library, and metadata recommendations.
- Added confidence, risk, explanations, previews, expected impact, approval, rejection, snooze, bulk safeguards, conflict detection, immediate execution, and maintenance scheduling.
- Added server-side revalidation, protected-track enforcement, playlist-version snapshots, restore links, audit history, structured failures, ownership checks, and automation policies disabled by default.
- Added Recently Added, metadata-conflict, and Smart Refresh providers with deduplication, superseding, expiry, progress-aware Job History, dashboard, navigation, settings, responsive UI, APIs, additive migration, and tests.

## v2.2.6 - Smart Experiments & Playlist A/B Testing

- Added protected Smart Mix v2 experiment drafts with pinned original playlist-version snapshots, controlled Version A and B settings, stable configuration history, and no Plex mutation during setup or generation.
- Added discovery, personalized-versus-base, scoring, BPM flow, mood blend, artist variety, and custom comparisons with controlled-variable validation, visible differences, constant settings, shared candidate/library/metadata references, random seeds, fallbacks, missing metadata, personalization influence, and overlap.
- Added optional separate Plex playlists and explicitly experimental alternating-active publication with independent stored Plex identifiers and idempotent retry behavior; the original is never replaced by publishing variants.
- Added independent variant feedback, acceptance/rejection metrics that exclude passive inactivity, bounded playback aggregation for unique tracks, generation-quality scores, metric definitions, and explainable confidence-limited suggested winners.
- Added explicit Version A or B application, continue/no-winner/inconclusive outcomes, merged-configuration generation previews and application, and snapshot-based original restoration with retained experiment history.
- Added the responsive `/experiments` dashboard, protected setup wizard, detail page, track comparison and feedback, timeline, decision controls, Smart Experiment settings, navigation, and Generated Playlists entry points.
- Added the additive `20260718190000_smart_experiments_v226` migration, ownership-checked APIs, Job History integration, bounded writes and playback reads, unit tests, documentation, roadmap completion, and v2.2.6 metadata.

## v2.2.5 - Library Coverage & Rotation Intelligence

- Added a responsive Library Coverage dashboard with all-time, active, 30-day, 90-day, and 12-month coverage; quality-weighted rotation fairness; used-versus-unused, trend, genre, mood, decade, and recently-added views.
- Added paginated intelligence for never-selected and overused tracks, high-confidence neglected opportunities, unused and partially used artists and albums, and nested library segments with filter-preserving drill-down and CSV/JSON export.
- Added explainable opportunity and overuse scoring that respects analysis, confidence, feedback, missing Plex items, duplicate suppression, live-track rules, playlist compatibility, recent rejection history, likes, locks, and intentionally preferred tracks.
- Added resumable, cancellable, duplicate-protected background calculation jobs with 400-track batches, progress stages, persistent cached track statistics, deduplicated snapshots, retention cleanup, structured summary logging, and no startup backfill.
- Added a guided neglected-mix workflow with conservative Safe Discovery, Balanced, Deep Library, Recently Added, and Underused High Quality presets; every draft remains preview-only until handed to Smart Builder.
- Added conservative Library Coverage settings, reset-calculated-statistics support that preserves playlist history and personalization, and optional quality-gated coverage-aware Smart Mix scoring that is disabled for existing installations.
- Extended Smart Mix explanations with bounded neglect bonuses and overuse penalties while preserving eligibility, feedback, identity, personalization, BPM/mood flow, transition, diversity, and existing repeat controls.
- Added authenticated summary, tracks, artists, albums, segments, genres, moods, decades, recently-added, overuse, opportunities, history, jobs, settings, export, recalculation, cancellation, and build-mix APIs.
- Added the additive `20260718150000_library_coverage_rotation_intelligence` migration, scoring and fairness tests, release metadata, roadmap updates, upgrade notes, and operator documentation.

## v2.2.4 - Smart Refresh Scheduling

- Added per-playlist Manual Only, Fixed Schedule, Smart Refresh, Smart Refresh with Fallback, and Disabled modes with conservative migration defaults.
- Added explainable evaluation of existing Smart Mix quality, weak tracks, compatible new tracks, playback repetition, identity drift, relevant metadata improvements, unavailable tracks, and major library changes.
- Added bounded candidate previews, predicted score improvement, confidence, identity-damage rejection, minimum-improvement gating, and least-disruptive action selection.
- Added Low, Balanced, High, and bounded Custom sensitivity; cooldowns; successful-refresh weekly limits; evaluation frequency; fallback age; and global/per-playlist time-zone quiet hours.
- Added manual Check for improvements, exact preview, explicit apply/dismiss, responsive settings, dashboard summaries, Job History audit, stale-safe execution, and automatic restorable version snapshots.
- Integrated bounded Smart Refresh evaluation as the final background pipeline stage after audio analysis, with major-sync targeting, batching, duplicate suppression, active-job safeguards, and no parallel generation engine.
- Added the additive `20260718030000_smart_refresh_scheduling` migration, authenticated APIs, documentation, and deterministic evaluation/scheduling tests.

## v2.2.3 - Playlist Roles & Progression Chains

- Added optional built-in and custom playlist roles with label-only, suggest, and apply-guidance behavior. Existing playlists receive no automatic role.
- Expanded existing progression chains in place with descriptions, lifecycle status, explicit member roles, handoff records, shared transitions, settings, analysis snapshots, master playlist links, and restoreable versions.
- Added real opening/ending boundary analysis for energy, BPM, half/double-time compatibility, mood tags and intensity, metadata confidence, warnings, and explainable category/overall scores.
- Added a responsive Playlist Chains workspace with drag, keyboard/touch ordering, charts, track previews, configurable handoffs, background analysis progress, optimization review, history, onboarding, and destructive confirmations.
- Added selected boundary optimization and shared bridge application with locked-track protection, stale-preview validation, pre-change snapshots, and incremental re-analysis.
- Added Mixarr-private and Plex-synced master journey playlists without replacing or modifying source playlists.
- Added authenticated, ownership-checked role, chain, member, handoff, analysis, optimization, master, settings, and version APIs with structured errors and paginated lists.
- Added an additive migration with idempotent role seeding, batched metadata reads, indexes, cancellable Job History integration, tests, API/migration documentation, and release metadata.
- Safety defaults: role behavior is Suggest, automatic repair and automatic Plex synchronization remain disabled, and ordinary playlist generation changes only when Apply role guidance is selected explicitly.

## v2.2.2 - Cross-Playlist Deduplication & Variety

- Added canonical track overlap, both-playlist percentages, smaller-playlist enforcement, Jaccard similarity, unique-track targets, artist concentration, album concentration, compilation handling, actionable severity warnings, and retained overlap trends.
- Added user defaults, per-playlist overrides, canonical pair policies, track/count allowances, allowed artists and albums, report-only playlists, core tracks, sharing designations, playlist/group/time-limited exclusivity, and clear inheritance labels.
- Integrated bounded current-use, recent-use, unused-track, artist, album, core, allowance, and exclusivity signals into Smart Mix v2 without bypassing identity, feedback, metadata, mood, energy, BPM, transition, or score-quality rules.
- Added an accessible paginated heatmap, mobile ranked comparisons, detailed shared/unique track views, policy details, stale-analysis indicators, background progress, cancellation, retry, and actionable repair entry points.
- Added deterministic selectable repair previews, protected-track priorities, explicit reasons and impacts, graceful insufficient-pool behavior, revision/content-hash stale checks, transactional apply, Plex rollback, repair history, and restorable pre-repair versions.
- Added bounded background pair processing, checkpoints, changed-result snapshots with retention, cached page reads, additive indexed data models, authenticated APIs, export/reset support, documentation, tests, and release metadata.
- Automatic repair remains disabled and preview remains enabled by default. Migration and startup do not analyze or rewrite Plex playlists.

## v2.2.1 - Playlist Groups & Collections

- Added user-owned collections with artwork, descriptions, multiple playlist memberships, group-local ordering, pause/resume, cloning, and safe deletion that never deletes playlists.
- Added versioned group defaults, explicit inheritance, playlist override precedence, a single primary settings group, source metadata, and conflict warnings while preserving every existing playlist setting.
- Integrated group discovery, deep-cut, artist and album limits, recency, live-track, recommendation, personalization, and exclusion controls into regeneration previews.
- Added bounded parent/child group regeneration jobs with progress, cancellation, failure isolation, existing playlist version snapshots, and activity history.
- Added explainable group health, responsive browser/detail management, search, filters, sorting, accessible ordering controls, navigation, per-playlist collection access, and a concise dashboard summary.
- Added authenticated user-isolated APIs, indexed additive schema, safe migration, tests, documentation, release metadata, and backwards-compatible empty defaults.

## v2.2.0 - Playlist Orchestration Foundation

- Added an opt-in managed playlist registry that distinguishes existing Plex playlists, generated playlists, managed playlists, automation configuration, runtime state, availability, and historical unregister state.
- Added validated `DEPENDS_ON`, `RUNS_AFTER`, and `RELATED` relationships with ownership/library checks, duplicate prevention, deterministic dependency ordering, full cycle reporting, and immutable job dependency snapshots.
- Added a shared persistent orchestration queue with strongly typed jobs, triggers, statuses, priority aging, scheduled eligibility, idempotency keys, duplicate audit decisions, cancellation, safe retry, and paginated history.
- Added database-backed playlist, Plex playlist, identity, library-write, global, user, and library locks with owners, heartbeats, leases, expiry, idempotent release, multi-process conflict handling, and conservative concurrency defaults.
- Added startup stale-job recovery that only requeues planning-only read/simulation work and sends possibly partial playlist writes to manual review.
- Added global and per-playlist automation controls, explicit state transitions and reasons, dry-run safeguards, structured audit events, startup schema health warnings, and a dedicated orchestration worker integrated with existing startup reliability.
- Added authenticated, user-isolated orchestration APIs, admin-only global settings, a responsive `/orchestration` workspace, dependency list, queue and audit controls, navigation, one compact dashboard card, and settings UI.
- Added the additive `20260717020000_playlist_orchestration_foundation` migration. Global orchestration, automatic registration, automatic automation enablement, and scheduled orchestration default to off; existing playlists are not silently registered.
- Added orchestration unit and safety coverage, v2.2.0 release/upgrade/rollback/API documentation, roadmap updates, and version metadata.

## v2.1.11 - Dashboard UI Cleanup

- Reorganized the dashboard around Library Readiness, Quick Actions, Activity & Automation, Playlist Management, Product & Preview, and Plex Servers.
- Removed the duplicate Recently Added Discovery registration and its duplicate summary request by using one canonical, stable widget definition.
- Combined Plex sync and enrichment coverage into one compact readiness panel with explicit states, progress indicators, preserved diagnostics, and on-demand detailed controls.
- Consolidated recent jobs and automation status, prioritized active work, and reduced repeated playlist-launch actions while retaining every existing destination.
- Moved version, roadmap, release, support, experimental, and preview information into one collapsed low-priority panel; the full Roadmap remains available on its dedicated page.
- Added resilient per-widget empty and error states, compact Plex server summaries, responsive single/two/four-column layouts, accessibility improvements, registry validation, and dashboard regression tests.

## v2.1.10 - Personalization Dashboard & Release Polish

- Added the dedicated `/personalization` control center with real user-scoped aggregates, learned-preference evidence, influential feedback, paginated suggestion decisions, playlist identities, behavioral trends, playback status, score influence, readiness checks, and accessible responsive states.
- Added a bounded dashboard service and authenticated APIs for summary, suggestions, identity browsing, health, cleanup, onboarding, versioned JSON export, validation, transactional import, and selective reset.
- Added merge, replace, identities-only, preferences-only, and feedback-only imports. Replace imports create a 30-day backup before changing data; missing tracks and playlists are reported without crossing user boundaries.
- Added reset previews, typed confirmation for full deletion, non-content audit entries, and low-value cleanup previews that preserve direct feedback, never-recommend rules, identities, manual preferences, Plex content, and unrelated settings.
- Added first-use onboarding, clear configured-environment privacy language, export secret exclusions, playback freshness checks, aggregate cache controls, database indexes, tests, documentation, and the additive `20260717010000_personalization_dashboard_v2110` migration.
- Marked v2.1.x Adaptive Personalization complete, introduced the proposed non-AI-dependent v2.2.x automation and playlist lifecycle direction, and documented later optional AI exploration with explicit consent and failure-isolation safeguards.

## v2.1.9 - Adaptive Automation Policies

- Added centralized, fail-safe policy evaluation for all Recently Added and scheduled-regeneration Plex writes.
- Added Disabled, Suggest Only, Require Approval, and Fully Automatic modes with Conservative, Balanced, Aggressive, and Custom presets.
- Added addition/removal limits, confidence thresholds, daily and weekly usage boundaries, timezone-aware quiet hours, playlist/track protection, and an emergency pause.
- Added stale-safe approvals, durable activity explanations, recoverable pre-write versions, and idempotent rollback through Playlist Version History.
- Added a responsive policy workspace, dashboard health summary, playlist protection tools, approval queue, and activity/rollback views.
- Added the additive `20260716130000_adaptive_automation_policies` migration with conservative legacy mapping and automatic removals disabled.

## v2.1.8 - Smart Mix Explanations & Insights

- Added immutable Smart Mix v2 decision traces sourced from actual scoring, filtering, fallback, transition, personalization, identity, and selection-margin values.
- Added selected and rejected explanations, deterministic recommendation confidence, score-layer separation, stable factor/reason codes, suggested fixes, and candidate comparisons.
- Added responsive explanation drawers, generation insights and filters, historical version explanations, detail preferences, privacy controls, and safe JSON debug export.
- Added authenticated paginated APIs, selected-track permanence, configurable rejected-trace caps and expiry, aggregate retention, indexed storage, cleanup controls, and trace-time instrumentation.
- Added the non-destructive `20260716120000_smart_mix_explanations` migration, tests, documentation, release notes, and completed Roadmap entry.

## v2.1.7 - Playlist Relationships & Coordination

- Added persisted playlist relationships, coordination settings, shared-core tracks, progression chains, and cached overlap summaries.
- Added canonical duplicate-aware track, artist, album, Jaccard, and enforced smaller-playlist overlap calculations.
- Added separate capped coordination scoring with hard/soft/warning modes, unused-track preference, selected-playlist exclusions, and group artist balancing.
- Added the Playlist Coordination dashboard, Smart Builder coordination controls, authenticated APIs, previewed track moves, and rebalance previews.
- Existing playlists remain unchanged and coordination-disabled until explicitly enabled.

## v2.1.6 - Contextual Mixes

- Added seven built-in contexts for focus, energy, driving, discovery, acoustic listening, summer parties, and winter relaxation.
- Added persistent user-isolated custom contexts with clone, edit, enable/disable, duplicate, and delete workflows.
- Added visible context application summaries, apply-only-unset behavior, manual override markers, individual restoration, and reset-to-context-default actions.
- Integrated a confidence-aware, capped contextual adjustment into Smart Mix Engine v2 while preserving identity, personalization, feedback, exclusions, and protected tracks.
- Added context-aware playlist previews and real per-track explanations with missing-metadata confidence.
- Stored versioned context snapshots, influence, overrides, and resolved settings in generated playlists and history.
- Added optional local-time/day suggestions without location tracking or inferred activities.
- Added the additive `20260716040000_contextual_mixes` PostgreSQL migration, APIs, responsive UI, tests, documentation, release notes, and Roadmap update.

## v2.1.5 - Listening History & Playback Awareness

- Added incremental, paginated Plex playback-history import with idempotent events, safe retry state, bounded matching, retention, and dedicated Job History records.
- Added explicit per-server Plex user mapping and user-isolated playback profiles.
- Added conservative completion, replay, recent-play, skip, forgotten-favorite, discovery, and confidence calculations.
- Integrated playback as a separately capped and explained layer after existing Smart Mix and adaptive scoring.
- Added soft and strict recent-play controls with locked, important, and selected-track protection.
- Added the responsive playback settings/dashboard, sync and rebuild actions, privacy controls, paginated profile categories, and unmatched-event administration.
- Added the non-destructive `20260716030000_playback_awareness` PostgreSQL migration, tests, upgrade documentation, and Roadmap update.

## v2.1.4 - Adaptive Smart Mix Scoring

- Added a dedicated adaptive scoring service layered on top of the unchanged Smart Mix Engine v2 base score.
- Added separate personal preference, playlist identity, historical acceptance, historical rejection, artist, mood, discovery, and repeat components with plain-language reasons and source/scope labels.
- Added evidence-based confidence bands and multipliers so one inferred interaction remains low influence while repeated consistent or explicit feedback receives greater trust.
- Added Off, Light, Balanced, Strong, and Maximum presets plus a 0–100% maximum-influence control, per-playlist override storage, component toggles, confidence thresholds, and directional limits.
- Added visible base-versus-personalized score comparisons and expandable scoring explanations in playlist previews and regeneration previews.
- Added aggregated user/playlist preference statistics, bounded 20,000-event recalculation, 500-row database batches, dirty-state tracking, Job History summaries, reset previews, and scoped reset APIs.
- Added adaptive scoring version and settings snapshots on managed playlists plus optional per-track explanation snapshots.
- Added authenticated settings, statistics, explanation, recalculation, and reset APIs with user isolation.
- Added the additive `20260716020000_adaptive_smart_mix_scoring` migration without changing existing personalization, feedback, playlist identity, history, or version records.

## v2.1.3 - Playlist Identity & Memory

- Added stable playlist identities independent of playlist names, with durable Mixarr and Plex linkage.
- Added normalized learned/manual/effective attributes, field locks, playlist track memory, idempotent membership history, artist and genre weights, training runs, and snapshots.
- Learned mood, energy, BPM, discovery, metadata coverage, artist, genre, and historical character from current and versioned playlist membership without requiring complete metadata.
- Added playlist-specific rejection strength, permanent never-use memory, important/anchor/locked tracks, and explicit feedback integration.
- Integrated playlist identity as a separate Smart Mix v2 scoring component and added identity reasons and impact summaries to advanced regeneration previews.
- Added the responsive Playlist Identity panel and editor with retrain, reset, clone, confidence, visual distributions, selectable moods, effective-value previews, and track-memory controls.
- Added lazy legacy initialization, batched historical processing, safe fallbacks, local privacy documentation, Job History summaries, and the additive `20260716010000_playlist_identity_memory` migration.

## v2.1.2 - Likes, Dislikes & Track Feedback

- Added user-specific liked, disliked, and never-recommend track states plus preferred and recommend-less artist states.
- Added playlist/profile-scoped fit feedback and pairwise poor-transition reports with optional stable reason enums and contextual metadata.
- Added append-only feedback events, indexed effective-state tables, authenticated mutation/read/bulk APIs, chunked large selections, and partial-failure reporting.
- Integrated explicit feedback as explainable Smart Mix v2 scoring components while preserving global scoring, hard rules, variety limits, and the personalization toggle.
- Applied never-recommend as a hard exclusion in generation, regeneration, and Recently Added recommendation paths without modifying existing playlists.
- Added compact feedback menus to playlist previews, regeneration previews, and the library, plus optional removal reasons, undo, bulk actions, and feedback management.
- Expanded user-specific reset and privacy controls to cover all explicit feedback data.
- Added the non-destructive `20260715090000_track_feedback_v212` PostgreSQL migration with indexed user/track, user/artist, playlist/profile, pairwise transition, and event-history lookups.

## v2.1.1-hotfix - Nightly Audio Features & Logging Cleanup

- Fixed newly discovered tracks not receiving Audio Features during the same nightly synchronization run.
- Moved Audio Features and BPM processing to the final nightly stage and kept the parent job active until analysis finishes.
- Unified manual, recovered, and scheduled Audio Features execution around fresh settings and shared provider resolution.
- Added local Essentia fallback when a preferred API is unavailable, without treating API preference as disabling local analysis.
- Distinguished disabled, no-eligible-track, provider-misconfiguration, processing-failure, and successful processing outcomes.
- Added guarded batch draining, stage-level Job History metadata, and concise progress reporting for long local analysis runs.
- Reduced repetitive sanitizer, Plex duplicate/conflict, popularity, track-tag, Library Health, and routine worker-lock logging while retaining per-item debug diagnostics.

## v2.1.1 - Duplicate Preservation & Plex Conflict Inspector

- Made Plex server, library, and rating key the authoritative physical track-instance identity; Plex GUIDs, file paths, and metadata now provide duplicate evidence without claiming or suppressing another item.
- Preserved every valid Plex item as a separate active `Track` row and replaced conflict skip paths with separate-instance creation, confidence grouping, or durable review state.
- Added canonical recording groups, match evidence, preferred enrichment sources, split/merge controls, review status, and indexed non-destructive membership.
- Added BPM, mood, and energy inheritance with manual correction, verified local, high-confidence API, inherited, and fallback precedence plus source-track/provider/confidence provenance.
- Added the default-enabled “Automatically share enrichment across confirmed duplicates” setting while retaining track-level overrides and instance-specific Plex, file, play, playlist, and interaction fields.
- Added a calculated, idempotent Repair Unresolved Plex Tracks preview and repair action that uses the existing per-library sync lock and persists missing rating-key instances without resetting or deleting data.
- Added a searchable, filterable, paginated Plex Conflict Inspector with candidate records, evidence, status, row actions, and bounded bulk actions.
- Made non-zero Library Health values interactive and added missing album, artist, track, duplicate-group, and track-copy detail views.
- Updated playlist duplicate handling to avoid canonical recording repeats by default, allow alternates, prefer quality, or prefer an existing playlist copy without hiding tracks from the library.
- Replaced ambiguous conflict/skip summaries with active-instance, new-instance, grouped-duplicate, inherited-data, needs-review, and persistence-failure counts and credential-safe structured logs.
- Added safe v2.1.1 migrations and high-confidence backfill while preserving all existing IDs, corrections, analysis, history, personalization, and playlists.

## v2.1.0 - Personalization Foundation

- Added opt-in user recommendation profiles, optional playlist profiles, append-oriented interaction history, compact derived adjustments, and safe user-owned reset behavior.
- Added a dedicated personalization scoring layer with structured explanations, confidence gating, playlist/user de-duplication, and a conservative eight-point maximum adjustment.
- Added independent personalization and learning toggles, profile summaries, preference/avoidance cards, recent signals, playlist profiles, privacy copy, and mobile-safe controls.
- Connected reliable lock, accepted regeneration replacement, and playlist restore actions to non-blocking local event collection.
- Added user-scoped profile, history, rebuild, reset, and playlist-preference APIs with typed validation and pagination.
- Marked v2.0.x complete and v2.1.x current in a typed, centralized product roadmap source.
- Personalization data remains local; no external behavioral analytics or profile synchronization was added.
- Fixed repeated missing-track restoration during Plex sync with conditional persisted-state transitions, post-commit active totals, verified cache invalidation, and non-destructive conflict handling.

## v2.0.10 - Beta Feature Polish & Advanced Flags

- Replaced scattered beta checks with a shared feature registry and authoritative server resolver covering server ceilings, access tiers, administrator restrictions, user opt-in, per-feature preferences, runtime overrides, and emergency kill switches.
- Added Stable, Public Beta, Private Beta, and Developer access levels with persistent administrator-managed grants, expiration support, preserved configuration after revocation, and first-user admin bootstrapping for existing self-hosted installations.
- Added Stable v2 and a real Experimental Balanced scoring model, safe model resolution/fallback, comparison previews that never auto-save, and scoring/beta metadata in generated playlists and version history.
- Added beta administration, consistent risk labels and warnings, acknowledgement-based opt-in, stable reset controls, configurable Sponsors messaging, safe feedback/Discord links, sanitized feedback reports, and local beta usage summaries.
- Protected experimental Recently Added auto-add and scheduled regeneration at execution time, storing required flags/access/model with runs and skipping permanently unavailable work before playlist mutation.
- Added database models for feature overrides, per-user preferences/access, usage, and feedback reports while preserving the v1.5.x `betaFeatureSettings` JSON and disabled-by-default behavior.

## v2.0.9 - Recently Added Automation

- Added disabled-by-default Recently Added Automation with independent, persistent feature toggles and preview-first automatic changes.
- Added idempotent Plex new-track detection, first-seen and batch state, explainable New Music Scores, confidence bands, quarantine rules, manual override, ignore controls, and chunked processing.
- Added Smart Mix v2 playlist compatibility matching with reasons, suggested sections, expected score impact, global thresholds, and playlist-level Off, Suggestions Only, and Automatic Strong Matches overrides.
- Added pending change sets, manual approval, conservative per-playlist/run limits, duplicate and variety protection, and mandatory restorable playlist versions around automatic additions.
- Added optional recently added mixes, per-user schedules, deduplicated in-app notifications, structured automation history, progress phases, and overlapping-run locks.
- Added a responsive dashboard discovery card and full review/configuration workspace while keeping every manual tool available when automation is disabled.

## v2.0.8 - Manual BPM & Metadata Corrections

- Added durable, separately stored BPM, mood, and energy corrections with optional reasons, verified state, actor attribution, and append-only history.
- Added one centralized, query-free effective metadata resolver with manual, verified source, provider/local, embedded/imported, fallback, and missing precedence.
- Added field-specific verification and source ignore/restore controls without deleting raw enrichment or local-analysis data.
- Integrated effective metadata into Smart Mix v2 scoring, BPM transitions, mood blending, energy curves, regeneration, explanations, and immutable playlist-version snapshots.
- Added library metadata badges and server-side filters plus transactional bulk correction previews with shared batch IDs.
- Added responsive track correction controls, source comparisons, BPM half/double-time suggestions, correction removal, and history browsing.

## v2.0.7 - Playlist Version History & Restore

- Added complete, schema-versioned playlist state snapshots with ordered tracks, track state, display metadata, generation settings, engine/app versions, scores, duration, and secret redaction.
- Added a playlist version timeline, detailed historical track view, pinning, labels, named manual restore points, lightweight pagination, storage estimates, and protected retention cleanup.
- Added deterministic comparison between current or arbitrary versions, including added, removed, moved, state-changed, and possible replacement tracks plus settings and score changes.
- Added preview-first restoration with ownership checks, stale-preview protection, unavailable-track warnings, automatic safety versions, current score recalculation, new restore revisions, and Plex synchronization status.
- Integrated initial generation, full regeneration, advanced regeneration, and undo with the existing `PlaylistRevision` model while preserving and migrating v2.0.6 revisions in memory.
- Added conservative user settings. History defaults on, the retention target is 25, manual and score snapshots default on, and destructive automatic cleanup defaults off.

## v2.0.6 - Advanced Playlist Regeneration

- Added targeted replacement for weak, low-scoring, selected, intro, middle, ending, and custom-range tracks.
- Added per-track locks, bulk lock actions, liked-track preservation, and lock-aware warnings.
- Added position-aware candidate scoring against both neighbors while preserving saved mood, BPM, energy, discovery, duration, order, and variety intent.
- Added a required preview with individual accept/reject controls, before/after scoring details, and meaningful-improvement thresholds.
- Added transactional regeneration records, playlist revisions, stale-preview protection, detailed history, and server-side undo.
- Added responsive and keyboard-accessible advanced regeneration controls for Smart Mix Engine v2 beta playlists.
- Kept the original track when no candidate is a meaningful improvement and limited candidate pools for large Plex libraries.

## v2.0.5 - Deep Cut & Discovery Controls

- Added Mostly Familiar, Balanced Discovery, and Deep Discovery profiles plus editable advanced controls.
- Added soft deep-cut targets, relative overplay penalties, hidden-gem boosts, popular-track limits, and underplayed Plex track weighting.
- Added efficient Mixarr playlist-history lookbacks and recent-use penalties without large database `IN` queries.
- Added discovery previews, result labels, track-level reasons, target-match scoring, warnings, and generation diagnostics.
- Added backward-compatible migration from Familiar vs Discovery and persisted effective configuration/results on generated playlists.
- Preserved hard rules, missing-metadata fallbacks, and Smart Mix v1 behavior.

## v2.0.3 - Mood Blending

- Added Smart Mix v2 mood blend modes for Smooth Transition, Strict Matching, and Mixed Mood playlists.
- Added mood path and allowed-mood controls in Builder and Smart Builder.
- Improved mood-aware ordering so smooth paths can move through zones like Happy -> Energetic -> Party.
- Added scoring support for multi-mood bridge tracks, compatible mixed moods, conflicting mood penalties, and missing mood-tag fallbacks.
- Added mood warnings and mood curve preview data to playlist previews and regeneration previews.
- Extended Smart Mix v2 diagnostics with mood blend mode, selected mood path, allowed moods, coverage, fallback counts, conflict counts, bridge tracks, and missing mood counts.

## v2.0.2 - Recommendation Tuning

- Added Smart Mix v2 recommendation tuning with built-in Balanced, More Familiar, More Discovery, High-Energy, Chill, DJ-Friendly, and Deep Cuts presets.
- Added user-facing tuning controls for recommendation strength, familiar/discovery balance, popularity, mood, energy, BPM, artist variety, album variety, and recently used tracks.
- Added saved custom tuning presets with basic create, select, and delete support.
- Applied tuning to v2 candidate scoring, transition ordering, artist/album variety, recent-use fallback, and preview warnings.
- Stored the tuning preset and config snapshot used for generated playlists.
- Added generated playlist display for the tuning preset and key tuning values.

## v2.0.1 - Playlist Scoring

- Added playlist quality scoring for Smart Mix v2 generated playlists.
- Added BPM flow, energy curve, mood consistency, discovery balance, and weak-spot scoring.
- Added quality score storage and display for generated playlists and regeneration previews.
- Added warnings for missing metadata and transition weak spots.

## v2.0.0 - Smart Mix Engine v2 Foundation

- Added a separate Smart Mix Engine v2 foundation with an ordered generation pipeline.
- Added v1/v2 engine version tracking for generated playlists and playlist history.
- Added v2 metadata fallback handling for missing BPM, mood, energy, and popularity.
- Added internal v2 score and score breakdown fields for generated preview tracks.
- Added Smart Mix Engine v1 Legacy and v2 Foundation labels in preview, generated playlists, and history UI.
- Preserved the existing v1 playlist builder path as the standard legacy generation behavior.

## v1.5.1 - Job History Cleanup

- Added a Clear History action to the Job History page.
- Added confirmation before clearing old job records.
- Finished jobs can now be removed from history.
- Active, running, queued, or pending jobs are preserved.
- Added backend support for safely clearing terminal job records.
- Added success and error feedback for cleanup actions.

## v1.5.0 - Beta Feature Flags & Experimental Access

- Added new Beta & Experimental Features settings section.
- Added master experimental feature toggle.
- Added groundwork for individual beta feature flags.
- Added clear beta, preview, and unstable UI labels.
- Added private beta warning text.
- Added GitHub Sponsors beta access messaging.
- Added optional beta-only preview cards for future v2.0.0 features.
- Added safe defaults so experimental features are disabled by default.
- Added backend support for reading and saving beta feature settings.
- Added guardrails so stable users are not affected by beta features.

## v1.3.9.2 - External API Settings UI

- Rebuilt the External APIs settings section into configurable provider cards.
- Added web UI configuration for API provider toggles and supported enrichment types.
- Added encrypted storage for API keys and secrets saved through the UI.
- Kept .env fallback support while allowing UI-saved credentials to take effect without container restarts.
- Added safer provider testing, masked credentials, and support diagnostics redaction.
- Improved local-first behavior when API providers are disabled.

## v1.3.9.1 - App Readiness Database Check Fix

- Fixed a false App Readiness database error on the Settings page.
- Improved database readiness checks so optional or stale table checks do not show as critical errors.
- Added clearer database readiness statuses for OK, warning, and error states.
- Improved readiness diagnostics without exposing database credentials or secrets.

## v1.3.9 - v2.0.0 Readiness & Beta Hardening

- Added app readiness checks for database, Plex, worker, scheduler, support links, and local analysis status.
- Added readiness information to support/settings diagnostics.
- Cleaned up release notes and roadmap for the end of the v1.3.x cycle.
- Added a v2.0.0 roadmap preview focused on Smart Mix Engine v2 and smarter playlist generation.
- Improved configuration validation and safer empty/error states.
- Improved support diagnostics consistency while preserving secret redaction.
- Hardened beta defaults before the v2.0.0 feature cycle.

## v1.3.8 - Beta Feedback & Discord Support Polish

- Added a Beta Support page with Discord, GitHub, feedback, and diagnostics actions.
- Added copyable bug report and feedback templates.
- Added safe support diagnostics export with secret redaction.
- Added support actions for failed jobs and Library Health diagnostics.
- Added configurable Discord support URL handling.
- Improved beta version/about details and links to release notes and roadmap.

## v1.3.7.2 - Dashboard Card Refresh Fix

- Fixed the Dashboard Library Health card staying stuck in a Refreshing state after health data was available.
- Fixed Dashboard Data Enrichment showing zero counts when enrichment data existed.
- Aligned Dashboard Library Health and Data Enrichment cards with their shared summary sources.
- Improved dashboard loading, error, and stale refresh states.
- Improved dashboard refresh behavior after sync, enrichment, and worker jobs complete.

## v1.3.7.1 - Remove Healthy Tracks Card

- Removed the expensive Healthy Tracks card from the Library Health summary page.
- Improved Library Health page load performance by avoiding unnecessary healthy-track calculations.
- Kept issue-focused Library Health cards for missing, partial, failed, and pending metadata categories.

## v1.3.7 - Plex Matching & Track Sync Polish

- Improved Plex track matching using stable identifiers before metadata fallbacks.
- Improved handling for moved files, renamed tracks, restored tracks, and missing-from-Plex records.
- Added clearer Plex sync summaries with scanned, matched, added, updated, moved, missing, duplicate, and conflict counts.
- Added Plex Sync diagnostics and Library Health visibility for sync-related issues.
- Improved duplicate candidate and match conflict handling without unsafe automatic merging.
- Preserved enrichment metadata more reliably during track sync updates.

## v1.3.6 - Background Worker Reliability

- Added clearer background worker health, heartbeat, and queue visibility.
- Added stale worker and stale job detection.
- Improved recovery for interrupted enrichment and analysis jobs after restart.
- Added duplicate job protection for long-running sync and enrichment actions.
- Improved Job History status, progress, and result summaries.
- Improved scheduled job reliability and skip reporting when another job is already running.
- Added worker and scheduler diagnostics for troubleshooting.

## v1.3.5 - Mood & Energy Sync Improvements

- Added clearer mood and energy health classification in Library Health.
- Added mood/energy source and confidence display where available.
- Added missing mood, missing energy, and partial mood/energy visibility.
- Improved retry/reprocess targeting for tracks missing mood or energy values.
- Improved Data Enrichment summaries for mood and energy completeness.
- Improved Smart Builder and Playlist Preview messaging when mood/energy data is incomplete.

## v1.3.4 - BPM Confidence & Source Improvements

- Added clearer BPM source labels for local, API, imported, estimated, and manual values.
- Added BPM confidence levels to make tempo data easier to trust.
- Added BPM source conflict detection for significantly different provider values, including possible half-time/double-time matches.
- Improved Library Health BPM detail views with source, confidence, source values, and reason information.
- Added BPM source/confidence filters and source breakdowns where available.
- Improved Dashboard, Data Enrichment, diagnostics, Job History, and playlist preview BPM summaries.

## v1.3.3 - Data Enrichment Cleanup

- Cleaned up Data Enrichment into clearer BPM, Audio Features, Genres, Popularity, and Local Audio Analysis sections.
- Added clearer provider/mode visibility for enrichment actions.
- Added preflight summaries before enrichment jobs run.
- Improved no-op handling so enrichment actions explain when no tracks are eligible.
- Connected enrichment actions to Library Health detail filters.
- Improved Job History summaries for enrichment jobs.
- Improved dashboard and Library Health refresh after enrichment jobs complete.

## v1.3.2 - Local Audio Analysis Polish

- Added clearer Local Audio Analysis status and provider-mode visibility.
- Added local analysis preflight summaries with matched, eligible, skipped, and skip-reason counts.
- Improved Local Essentia progress and completion summaries.
- Improved skip reason reporting for local audio analysis and force reprocess actions.
- Added local analysis diagnostics to Library Health.
- Improved Library Health and dashboard refresh after local analysis jobs complete.

## v1.3.1 - Audio Feature Retry Improvements

- Improved audio-feature retry actions to use the same resolved track sets as Library Health cards and detail views.
- Added retry preflight checks with matched, eligible, queued, skipped, and skip-reason counts.
- Improved local Essentia retry handling for partial and pending audio-feature tracks.
- Added clearer disabled states for API-only and local-only retry modes.
- Improved Job History summaries for audio-feature retry and reprocess jobs.
- Library Health and dashboard counts now refresh after audio-feature retry jobs complete.

## v1.3.0.1 - Audio Features Health Card Sync Fix

- Fixed Audio Features health cards showing stale incomplete counts after audio feature data was saved.
- Improved Library Health cache invalidation after audio feature sync, retry, and local Essentia reprocess jobs.
- Aligned Dashboard and Library Health audio feature counts around the same source-of-truth resolver.
- Added stale summary diagnostics for audio feature health counts.
- Preserved v1.3.0 Library Health Accuracy count/detail/retry consistency rules.

## v1.3.0 - Library Health Accuracy

- Rebuilt Library Health around shared category resolvers so card counts, detail rows, and retry actions use the same track sets.
- Added health accuracy invariants for audio features, BPM, genres, popularity, and local file status.
- Added Health Accuracy Diagnostics to detect count/detail mismatches.
- Improved provider-mode-aware classification for BPM and audio feature health.
- Preserved the v1.2.8 fix for BPM-present tracks being classified as partial audio features.
- Improved retry targeting and skip explanations for Library Health categories.
- Added health diagnostics export for easier bug reports.

## v1.2.9.1 - Matching Rules Layout Fix

- Fixed Matching Rules row overflow on the Playlist Builder page.
- Improved responsive layout for rule fields, operators, values, and delete actions.
- Prevented Matching Rules controls from overlapping the preview panel.
- Improved narrow-width and mobile behavior for the Matching Rules card.

## v1.2.9 - Playlist Builder UI Fix

- Fixed Playlist Builder layout overlap after generating a playlist preview.
- Improved Previewed Tracks table sizing and overflow behavior.
- Improved responsive layout for builder and preview panels.
- Tuned repeated-artist warnings so allowed repeats do not show as warnings when max tracks per artist is enabled.
- Added clearer safety-rule messaging for successful variety rules versus actual problems.
- Prepared the UI for the upcoming v1.3.0 feature branch.

## v1.2.8-hotfix.7 - Audio Feature Incomplete Count Classification Fix

- Fixed Audio Feature Health showing zero incomplete categories while the dashboard reported incomplete tracks.
- Tracks with BPM data but missing full audio feature fields now count as Partial Audio Features.
- Partial and Pending Audio Feature detail views now use the same incomplete track set as the dashboard.
- Improved local Essentia retry targeting for partial audio-feature tracks.
- Removed misleading missing-audio-feature gap wording when tracks are actually partial.

## v1.2.8-hotfix.6 - BPM Partial Audio Feature Classification Fix

- Fixed tracks with BPM data being incorrectly classified as missing audio features.
- Tracks with BPM but missing energy, mood, danceability, or local Essentia values now count as partial audio features.
- Partial Audio Features and Pending Audio Features now load the correct track sets.
- Improved retry and local Essentia candidate selection for partial audio-feature tracks.
- Aligned /settings/library-health and /library-health around the same classification rules.

## v1.2.8-hotfix.5 - Partial Audio Feature Classification Fix

- Fixed tracks with BPM data but missing audio feature fields being classified as missing instead of partial.
- Partial Audio Features now correctly shows tracks with incomplete energy, mood, danceability, or local Essentia fields.
- Pending Audio Features now loads the same retry-eligible track set shown in the summary.
- Improved local Essentia retry candidate selection for partial audio-feature tracks.
- Aligned /settings/library-health and /library-health classification behavior.

## v1.2.8-hotfix.4 - Library Health Card Detail Match Fix

- Fixed Missing Audio Features cards showing 70 while the detail view returned 0 tracks.
- Fixed Pending Audio Features cards showing 70 while the detail view returned 0 tracks.
- Unified Library Health card counts and detail rows around shared track ID resolution.
- Included audio feature gap tracks in detail views and retry candidate selection.
- Added mismatch detection so health cards cannot silently disagree with detail tables.

## v1.2.8-hotfix.3 - Audio Gap Detail Query Fix

- Fixed Missing Audio Features detail view returning zero rows when summary showed gap-classified tracks.
- Fixed Pending Audio Features detail view to include gap-classified tracks.
- Added shared audio feature gap track ID logic for summary, details, and retry actions.
- Improved retry candidate selection for active tracks without audio feature records.
- Improved debug logging for audio feature summary/detail count matching.

## v1.2.8-hotfix.2 - Audio Gap Summary Merge Fix

- Fixed audio feature gap detection not being merged into Library Health summary counts.
- Missing audio feature cards now include active tracks without audio feature records.
- Fixed detail filters so gap tracks appear when clicking View tracks.
- Improved audio feature retry targeting for gap-classified tracks.
- Aligned audio feature provider mode logging with actual settings.

## v1.2.8-hotfix - Audio Feature Gap Hotfix

- Fixed active tracks with no audio feature records being excluded from Library Health detail filters.
- Added audio feature gap detection between dashboard complete counts and Library Health categories.
- Classified unaccounted incomplete tracks as missing audio features instead of hiding them.
- Improved dashboard wording to show exact incomplete audio feature counts.
- Improved retry targeting for missing audio feature tracks.

## v1.2.8 - Audio Feature Health Consistency Fix

- Fixed mismatch where audio feature health summaries showed incomplete tracks but detail views returned none.
- Aligned missing, partial, and pending audio feature filters with summary counts.
- Improved audio feature completeness checks for current provider settings.
- Added clearer incomplete-track reasons in Library Health details.
- Improved retry targeting so audio feature retries use the same filters shown in the UI.
- Improved dashboard wording when rounded percentages hide incomplete tracks.

## v1.2.7 - Navigation Cleanup

- Cleaned up desktop sidebar navigation with grouped sections.
- Grouped playlist tools, library tools, and activity pages.
- Reduced mobile bottom navigation to the most-used items.
- Added a mobile More menu for secondary pages.
- Improved mobile spacing so navigation labels no longer overlap.
- Moved mobile version/GitHub/Beta controls out of the crowded bottom area.

## v1.2.6 - Export/Import Mixarr Recipes

- Added recipe export for individual recipes and all saved recipes.
- Added recipe import with validation and preview before saving.
- Added duplicate-name handling with automatic rename or skip options.
- Preserved recipe filters, Smart presets, Mood presets, BPM presets, and safety rules during export/import.
- Added a stable Mixarr recipe JSON format for backups and sharing.

## v1.2.5 - Playlist History

- Added Playlist History for created and regenerated Mixarr playlists.
- Added historical track snapshots showing the exact order written to Plex.
- Added playlist creation and regeneration summaries with filters, recipes, presets, exclusions, and safety rules.
- Added history details views with track lists and regeneration comparison stats.
- Added links from Generated Playlists to related playlist history.

## v1.2.4 - Advanced Playlist Regeneration

- Enabled Keep Some Existing Tracks regeneration mode.
- Added 25% and 50% keep options for playlist regeneration.
- Enabled Prefer Different Tracks Than Last Time using generated playlist snapshots.
- Added regeneration comparison stats for kept, replaced, reused, and new tracks.
- Added Remove from Generated Playlists action without deleting Plex playlists.
- Improved regeneration preview safety before replacing Plex playlist contents.

## v1.2.3 - Playlist Regeneration

- Added playlist regeneration for Mixarr-created playlists.
- Added saved generation metadata for playlists created from the builder, Smart Builder, and recipes.
- Added regeneration preview before replacing tracks in Plex.
- Added support for regenerating playlists using saved filters, presets, manual exclusions, and safety rules.
- Added Generated Playlists visibility and Job History entries for regeneration runs.

## v1.2.2-hotfix - Smart Builder Preset Hotfix

- Fixed Smart Builder so Mood Presets can be selected without first choosing a Smart Preset.
- Fixed Smart Builder so BPM Presets can be selected without first choosing a Smart Preset.
- Allowed Smart, Mood, and BPM presets to be combined independently.
- Improved Smart Builder preview metadata for partial preset selections.
- Changed the app status badge from Official to Beta.

## v1.2.2 - BPM Range Presets

- Added BPM Range Presets to Smart Builder.
- Added Slow, Medium, Upbeat, Dance, High Energy, and Wide Open tempo presets.
- BPM Presets now tune playlist tempo without manually entering ranges.
- Playlist Preview now shows selected BPM preset metadata and helpful low-match warnings.
- Saved recipes now preserve BPM preset metadata while keeping filter values as the source of truth.

## v1.2.1 - Mood Presets

- Added Mood Presets for quickly applying mood, energy, and BPM ranges.
- Added presets such as Happy, Chill, Hype, Dark, Emotional, Sad / Mellow, Relaxed, Focus, Upbeat, and Balanced.
- Moved Mood Presets into the Smart Builder flow where guided playlist features belong.
- Fixed Mood Presets placement so they now appear directly in the Smart Builder flow.
- Playlist Preview now shows the selected mood preset and related warnings.
- Saved recipes now preserve mood preset metadata while keeping filter values as the source of truth.

## v1.2.0 - Smart Playlist Builder v1

- Added Smart Playlist Builder v1 with guided playlist presets.
- Added presets for Workout, Chill, Party, Focus, Driving, Discovery, Deep Cuts, Popular Favorites, and Balanced Mix.
- Smart Builder now suggests filters, BPM ranges, energy/mood ranges, popularity preferences, and safety rules.
- Smart Builder uses the existing playlist preview flow before creating playlists.
- Smart Builder setups can be saved as reusable playlist recipes.
- Playlist creation history now records the Smart Builder preset used.

## v1.1.10 - Playlist Safety Rules

- Added optional playlist safety rules to reduce repetitive results.
- Added artist spacing to avoid same-artist back-to-back tracks.
- Added max tracks per artist and max tracks per album controls.
- Added low-track-count warnings in playlist preview.
- Saved safety rule settings with playlist recipes.
- Added safety rule summaries and warnings to playlist preview and Job History.

## v1.1.9.1 - Manual Track Exclusion

- Added manual track exclusions for Mixarr-generated playlists.
- Added exclude actions from playlist previews.
- Added excluded track management with remove-exclusion support.
- Applied manual exclusions to playlist previews, recipe previews, and playlist creation.
- Added exclusion counts to playlist preview stats where applicable.

## v1.1.9 - Edit and Duplicate Playlist Recipes

- Added editing for saved playlist recipes.
- Added recipe duplication for quickly creating variations.
- Added update-existing-recipe support from the playlist builder.
- Added improved recipe actions and updated recipe metadata.
- Kept recipe previews connected to the playlist preview flow.

## v1.1.8 - Save Playlist Recipes

- Added saved playlist recipes for reusable playlist filter setups.
- Added Save Recipe action to the playlist builder.
- Added a Saved Recipes page with recipe summaries and usage actions.
- Added recipe preview support using the playlist preview flow.
- Added dashboard visibility for saved playlist recipes.

## v1.1.7 - Playlist Preview Before Create

- Added a playlist preview step before creating playlists.
- Added track previews, filter summaries, and playlist stats before writing to Plex.
- Added warnings for low-match and zero-match playlist filters.
- Added create-from-preview flow so users can review playlists first.
- Improved playlist creation confidence and reduced accidental bad playlists.

## v1.1.6-hotfix - Homepage Library Health Performance Hotfix

- Fixed large-library homepage performance issue where Library Health counts could block SSR for several minutes.
- Reduced expensive repeated health-count queries.
- Homepage now renders without waiting for a full Library Health recalculation.

## v1.1.6 - Library Health Details

- Added a dedicated Library Health Details page.
- Added clickable health categories for missing BPM, API-only BPM, partial audio features, failed analysis, and missing local files.
- Added track-level explanations for why items appear in each health category.
- Added filtered track views with sorting and basic actions.
- Connected Library Health retry actions with Job History and retry explanations.

## v1.1.5 - Background Scheduler Settings

- Added web UI controls for the Background Scheduler.
- Added daily, weekly, interval, and custom cron schedule options.
- Kept 3:00 AM daily as the default schedule.
- Added validation for custom cron expressions.
- Added scheduler status visibility and better scheduled-job history labeling.
- Kept SYNC_CRON_SCHEDULE as a fallback/default environment variable.

## v1.1.4 - Retry Explanation Improvements

- Improved retry result messages when no tracks are queued.
- Added clearer explanations for zero-result BPM and audio-feature retry actions.
- Added retry filter, matched, queued, skipped, and reason details where available.
- Improved Job History summaries for retry and zero-attempt jobs.
- Reduced confusion around local-only retry and force reprocess actions.

## v1.1.3 - Better Job History

- Added Job History page for recent background jobs.
- Added status, timing, duration, and summary details for sync and retry jobs.
- Added dashboard visibility for recent job activity.
- Added basic filters for job status and job type.
- Improved debugging visibility for failed or zero-result jobs.

## v1.1.2 - Version & Update Visibility

- Added clearer current-version visibility across Mixarr.
- Added an About / Updates area for release notes, roadmap access, and update guidance.
- Added dashboard version visibility.
- Centralized app version display to reduce stale version mismatches.

## v1.1.1 - Roadmap & Coming Soon

- Added a Roadmap / Coming Soon page for Mixarr's path toward v2.0.0.
- Added a dashboard card linking to the v2.0.0 roadmap.
- Added roadmap sections for current release, upcoming features, v2.0.0 ideas, Discord beta feedback, and GitHub supporter beta access.
- Updated app version display to v1.1.1.

## v1.1.0 - Dashboard Cleanup & v2.0.0 Preview

- Cleaned up dashboard enrichment card layouts.
- Fixed Track Genres card text overflow.
- Removed redundant Data Enrichment dashboard section.
- Added v2.0.0 Coming Soon preview section.
- Added guidance that enrichment tools are available from each dashboard card.
- Improved dashboard polish and mobile layout.

## v1.0.5 - Metadata Reliability & Library Health Polish

- Fixed partial audio feature retry not clearing after successful local Essentia analysis.
- Fixed retry queues replaying already-completed tracks.
- Improved BPM and audio feature candidate selection consistency.
- Added post-save verification logging for local metadata analysis.
- Improved Library Health count/filter accuracy.
- Improved whole-track Essentia temp cleanup and worker safety.
- Added separate too-short status handling.
- Added GitHub repository link.
- Improved provider/status breakdowns in Dashboard and Library Health.

## v1.0.4 - Local/API Metadata Controls

- Added settings to enable or disable API BPM lookup.
- Added settings to enable or disable API Audio Feature lookup.
- Added local Essentia-only mode for BPM.
- Added local Essentia-only mode for Audio Features.
- Added API-preferred vs local-preferred effective value logic.
- Added provider breakdowns to Dashboard and Library Health.
- Added retry behavior that respects configured providers.


## v1.0.3 - Library Health, Cleanup & Pool Stability

- Added Library Health page.
- Added Plex/Mixarr sync integrity stats.
- Added missing track viewer.
- Added safe cleanup tools for stale Plex records.
- Added missing track export.
- Added BPM health summary.
- Added validated atomic BPM samples, ffmpeg seek fallback, and separate extraction/analyzer failure reporting.
- Improved dashboard counts to use active tracks only.
- Fixed Prisma connection pool exhaustion during long-running sync/status polling.
- Improved Sync Center status polling with slower idle polling, active polling hints, and pool-busy backoff.
- Added shared job overlap protection for manual syncs, enrichment jobs, and nightly scheduler runs.
- Improved Prisma P2024 logging with concise pool-timeout diagnostics instead of repeated status stack traces.
