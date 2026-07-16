# Track Feedback (v2.1.2)

Mixarr stores explicit recommendation feedback in user-scoped effective-state tables and an append-only `FeedbackEvent` history. The PostgreSQL migration `20260715090000_track_feedback_v212` is additive and does not rewrite existing tracks, playlists, versions, interaction events, or learned profiles.

When personalization is enabled, `NEVER_RECOMMEND` is a hard candidate exclusion. Likes, dislikes, artist preferences, and playlist-fit feedback are conservative explainable score components. Poor-transition feedback is matched to track pairs within the playlist or playlist-profile context and never becomes a global dislike. Disabling personalization retains all stored feedback while restoring global-only generation behavior.

Large bulk operations are accepted as one request and processed in bounded server chunks. The feedback-management view is paginated. Resetting all personalization deletes only the current user's explicit and learned feedback and never deletes Plex metadata, playlists, or playlist-version snapshots.
