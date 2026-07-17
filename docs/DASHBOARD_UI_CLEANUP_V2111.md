# Mixarr v2.1.11 — Dashboard UI Cleanup

Mixarr v2.1.11 reorganizes the main dashboard without removing any existing feature, route, or action. The primary workflow now follows a deliberate hierarchy: Library Readiness, Quick Actions, Activity & Automation, Playlist Management, a collapsed Product & Preview panel, and compact Plex server summaries.

## Duplicate root cause

`RecentlyAddedDiscoveryCard` was manually included twice in the authenticated dashboard grid. Because each instance was a client component with its own mount effect, the duplicate also issued a second request to `/api/recently-added/summary`. The release replaces the manual card wall with a canonical widget registry. `recently-added-discovery` is registered exactly once with a stable ID, and its summary is fetched once on the server with the other independent dashboard data.

The registry validates duplicate IDs during development, filters unavailable entries before rendering, sorts by section and order, uses widget IDs as React keys, and never appends feature-flagged copies.

## Operational hierarchy

- Library Readiness combines Plex sync state, active tracks, last sync, and BPM, audio-feature, genre, and popularity coverage. Detailed sync and enrichment controls remain available on demand.
- Quick Actions keeps Smart Builder, Recently Added Discovery, recipes, and regeneration prominent.
- Activity & Automation shows the latest job, active-job emphasis, recent failures, automation mode, completed automation today, approvals, and the next Recently Added schedule when available.
- Playlist Management summarizes history, generated playlists, versions, and saved recipes without duplicating the primary build action.
- Product & Preview is collapsed by default and contains version, release notes, Roadmap, beta support, experimental announcements, and the next-cycle summary. The full Roadmap remains at `/roadmap`.
- Plex Servers keeps server, connection, library, active-track, last-sync, and sync-action information near the bottom.

## Loading, errors, and live status

Dashboard data sources fail independently. Library readiness, Recently Added, jobs, automation, playlist counts, and Plex servers have local fallback states, so one unavailable API or database query does not block the full dashboard. Disabled Recently Added keeps manual review and enable/configuration actions available.

The dashboard summary is rendered from the server response and does not immediately request the same data again. It polls only while readiness or enrichment work is active. Existing worker and sync progress behavior remains available; no full-page timer or automatic page reload was added.

## Responsive and accessibility behavior

Quick Actions uses four logical columns on large screens, two columns on tablet, and one column on mobile. Metrics and product links collapse similarly without horizontal scrolling. Buttons remain semantic, focus rings are visible, status badges include text, collapsible sections expose native expanded state, and mobile actions use full-width touch targets where appropriate.

The regression suite verifies unique widget IDs, a single Recently Added registration, feature-flag stability, section order, collapsed product content, error and empty-state source contracts, action routes, and responsive rules at 390, 768, 1440, and 1920 pixels.
