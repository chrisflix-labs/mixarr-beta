# Household Collaboration (v2.3.6)

Household collaboration is optional. Existing generated playlists, recipes, feedback, regeneration, history, and Plex playlists remain in Individual mode until an administrator explicitly selects Household in Smart Builder.

## Architecture

`Household` is the durable administrative boundary. `HouseholdMember` links stable Mixarr user IDs and supports Owner, Member, Child, and Guest roles; `HouseholdGuest` stores lightweight profiles separately from permanent user preferences. A `HouseholdPlaylistConfiguration` opts one generated playlist into collaboration and stores only its selected subset through `PlaylistParticipant`.

The existing Smart Mix engine still builds and flow-scores the candidate set. The household compatibility layer batch-loads participant feedback, computes deterministic per-profile and shared scores, enforces hard dislikes/content rules, applies contribution and concentration limits, and then preserves the strongest fair ordering available. Individual mode never calls this layer.

Configured weights are preserved. Effective influence normalizes the active usable participants into the member pool after shared-favorite weight, applies the configured cap with deterministic water-fill redistribution, and reports normalization, excluded/no-history influence, cap reduction, and any unallocated remainder. Balanced mode starts active profiles equally; Weighted mode uses saved values; Individual First doubles the designated primary profile before normalization; Shared Favorites increases consensus; Discovery Consensus uses weighted numeric midpoint targets; Party Mode is a preset over the same pipeline.

Numeric discovery, energy, BPM, and popularity disagreements resolve by weighted average. Explicit-content conflicts use the strictest active profile. Artist/genre disagreement reduces score, hard household dislikes exclude, and disputed track feedback reduces score unless marked hard. Resolution is never random.

## Approval and publishing

Disabled approval publishes through the existing Plex workflow. Fixed, majority, unanimous, administrator-only, and conflict-severity approval modes create a local pending draft and do not write to Plex. Eligible participants may change one versioned approval or vote per target. When the threshold is reached the household administrator can publish the exact stored snapshot to Plex.

## API

- `GET|POST /api/households` lists or creates households.
- `GET|PATCH|DELETE /api/households/:id` reads, edits, or archives without deleting history.
- `GET|POST /api/households/:id/members` and `PATCH|DELETE /api/households/:id/members/:memberId` manage stable memberships.
- `GET|POST /api/households/:id/guests`, `PATCH|DELETE /api/households/:id/guests/:guestId`, and `POST .../reset` manage guest lifecycle and isolated feedback.
- `GET|POST /api/households/:id/preferences` manages scoped shared feedback.
- `GET /api/households/:id/activity` supports page, pageSize, eventType, userId, playlistId, from, and to filters.
- `POST /api/households/influence-preview` returns effective influence, conflicts, family rules, and approval requirements without generating tracks.
- `GET|PUT /api/generated-playlists/:id/household` reads or assigns collaboration.
- `PATCH /api/generated-playlists/:id/participants/:participantId` temporarily excludes or restores one playlist participant while retaining preferences.
- `GET|POST /api/generated-playlists/:id/votes` and `/approvals` expose versioned collaboration state.
- `POST /api/generated-playlists/:id/publish` publishes an approved draft after server-side revalidation.

All endpoints use the existing `mixarr_session` cookie. Mutations check ownership/administration on the server; regular members may only use enabled voting, approval, and feedback capabilities. Responses never expose Plex tokens or raw database payloads.

## Migration and operations

Apply `20260720100000_household_collaboration_v236`. It only creates new tables, indexes, and foreign keys; it does not rewrite existing data. Household and member deletion is restricted or represented as inactive/archive state so activity, conflicts, approvals, and contributions remain explainable. Generated-playlist deletion may cascade its playlist-specific collaboration records consistently with existing playlist-history behavior.

No new environment variables are required. Activity is paginated, candidate feedback is batch-loaded, and large track/user lists remain server-side.

## Manual workflow

1. Open **Households**, create a household, add users, configure influence/eligibility, and optionally add an expiring guest.
2. Open **Smart Builder**, choose **Household**, select the household and participating subset, then configure balance, caps, family rules, party/voting/approval options.
3. Run **Preview household influence** and review normalization, cap, conflict, family, and approval explanations.
4. Preview the playlist and inspect household generation warnings and track order.
5. Create it. Approval-disabled playlists sync normally; approval-gated playlists remain local drafts.
6. In **Generated Playlists**, review the Household Collaboration panel, submit eligible votes/approvals, and publish to Plex after the threshold is satisfied.
7. Return to **Households → Activity** to verify configuration, exclusion, vote, approval, publication, and guest events.
