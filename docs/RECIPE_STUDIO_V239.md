# Mixarr v2.3.9 — Recipe Studio & Release Polish

Recipe Studio unifies creation, editing, live analysis, comparison, governance, and maintenance around the existing Mix Recipe document. Guided, Beginner, and Advanced modes do not create different recipe formats: they edit the same fields used by the v2.3.x schema and generation services.

## Routes

- `/recipes` — installed recipes, transfer center, trust state, and management actions.
- `/recipes/new` — guided creation and review.
- `/recipes/:id/edit` — section-based Recipe Studio.
- `/recipes/:id/compare` — side-by-side strategy comparison with confirmed section copying.
- `/recipes/import` — opens the existing staged import and export center.
- `/recipes/community` — official-provider and community-source browser.
- `/recipes/analytics` — cached privacy-minimized operational analytics.
- `/recipes/onboarding` — reopenable first-use readiness and safety guide.

## Editing modes

Guided mode asks about purpose, library, size, discovery, energy, BPM smoothness, repetition, refresh, household use, approval, and fallback behavior. It maps answers into the normal recipe sections and then requires review.

Beginner mode uses plain-language controls and recommended ranges. If inheritance, nested rules, BPM sections, custom scoring models, or local overrides are present, it warns that those advanced values remain preserved.

Advanced mode exposes the complete section controls plus structured JSON for the strategy sections. Identity, trust, approval, signatures, snapshots, and audit records cannot be overwritten through raw editing.

## Live estimates and compatibility

The live analysis endpoint uses aggregate count queries rather than loading the library into frontend memory. Requests are debounced by 500 ms, stale requests are aborted, aggregate library profiles are cached for 30 seconds, and responses are explicitly labeled as estimates.

Candidate analysis reports evaluated tracks, estimated rule rejection, candidate count, unique artist/album bounds, requested capacity, headroom, and fallback likelihood. Compatibility reports metadata coverage and actionable remediation for BPM, energy, mood, empty libraries, missing dependencies, and insufficient candidates.

Scoring and discovery previews explain relative influence, possible conflicts, familiarity, rediscovery, new/rare estimates, artist/album estimates, and variety. They do not claim to predict the final ordered playlist.

## Mood, energy, and BPM

Energy progression has presets and a normalized visual curve. Every control point is also represented in an editable table; users can add, change, or remove points without dragging. Duplicate/out-of-order positions and invalid ranges block save. Existing schema-compatible energy minimum, target, maximum, and progression values remain authoritative.

BPM editing covers target range, flow, transition size, smoothness, half/double-time matching, missing metadata, and existing section targets. Coverage warnings link back to the relevant editor section.

## Safety, save behavior, and accessibility

All save and activation behavior continues through the existing server validation, governance, permission, protected-playlist, quarantine, and approval systems. Recipe Studio adds an `expectedUpdatedAt` optimistic-concurrency check; a stale editor receives HTTP 409 and cannot silently overwrite another change.

The editor includes unsaved-change warnings, live status announcements, labeled inputs, keyboard-native controls, a non-visual curve table, color-independent text, focus-visible browser controls, reduced-motion support, responsive single-column layouts, mobile-safe dialogs, and a sticky mobile Validate/Save bar.

## Imports, backups, and migrations

The v2.3.8 staged governance pipeline remains authoritative for file, paste, URL, community, batch, quarantine, signature, approval, rollback, and snapshot restore. Exports continue to use the secret-free allowlist; integration credentials and private listening data are not included.

v2.3.9 does not replace or renumber the existing recipe schema. Earlier v2.3.x documents are normalized by the existing sequential migrations. The new database migration adds only query indexes for installed recipes, recipe usage, and operational analytics; it does not rewrite recipe JSON or playlist associations.

## Troubleshooting

- **Live analysis unavailable:** keep editing; the last result is marked stale. Confirm Plex library sync and retry by changing a field.
- **Low BPM or mood coverage:** run Data Enrichment or choose an allow/neutral missing-metadata fallback.
- **Save conflict:** reload the current recipe or use Compare before applying selected sections.
- **Import quarantined:** open Recipe Quarantine and review signature, dependency, permission, and risk findings.
- **Requested size unlikely:** reduce size, relax one required filter, or enable safe fallback behavior.

## v2.4.x boundary

The roadmap now includes **Mixarr v2.4.x — AI-Assisted Mix Intelligence**. v2.3.9 includes only the roadmap entry; it does not implement or simulate AI functionality.
