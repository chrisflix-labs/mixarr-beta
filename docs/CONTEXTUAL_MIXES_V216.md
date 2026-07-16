# Mixarr v2.1.6 — Contextual Mixes

Contextual Mixes translate a listening situation into visible Smart Mix Engine v2 settings. Selecting a card never generates a playlist. Review the change summary, edit any control, preview the result, and then use the existing create flow.

## Built-in contexts

Mixarr includes Monday Morning Focus, Friday Night Energy, Late Night Drive, Weekend Discovery, Sunday Acoustic, Summer Party, and Winter Chill. Built-ins are versioned application definitions. Clone one before editing it; cloned profiles are stored independently and are never silently changed when a built-in evolves.

## Custom contexts

Use **Create custom context** in Playlist Builder to define a name, description, availability, energy, discovery, familiarity, BPM range and flow, moods, variety, deep-cut preference, and recency preference. Availability describes the context for suggestions and future scheduling; v2.1.6 does not schedule playlist generation.

Custom profiles are private to the signed-in Mixarr user. They can be edited, duplicated, disabled, or deleted. Built-ins are read-only but clonable.

## Influence and scoring

Low, Balanced, and Strong influence levels cap context adjustment at 4, 8, and 12 points per track. Context uses energy, BPM, mood, and popularity only when those signals are available. Missing fields lower confidence and remain visible in track explanations; they do not reject the track.

The ordering is: Smart Mix v2 base/tuning, contextual adjustment, playlist identity and adaptive personalization, then playback awareness. Existing hard exclusions, never-recommend feedback, protected tracks, and safety rules stay authoritative. Selecting a context does not train personalization; only real interactions do.

## Overrides

Every setting remains editable. A changed context-derived field is marked Customized and can be restored individually. **Reset all settings to context defaults** restores only context-related Smart Mix settings. It does not change the playlist name, selected library, exclusions, pinned or locked tracks, or unrelated controls.

## Suggestions and privacy

Suggestions are optional and dismissible. They use the configured timezone plus time/day/season labels. Mixarr does not use precise location, device sensors, weather services, or hidden driving detection. Activity contexts are suggested only after explicit configuration or selection.

## History and versioning

Generated playlists store the context profile ID/name, built-in version, influence, complete context snapshot, manual overrides, final resolved Smart Mix settings, engine version, and timestamp. Historical generations remain explainable after a custom profile is edited or deleted.

## Missing metadata and troubleshooting

- Missing BPM, mood, energy, or popularity lowers context confidence instead of excluding the track.
- Sunday Acoustic prefers relaxed/low-energy evidence; it does not require an acoustic tag.
- If the preview has too few good matches, reduce influence, widen BPM/energy settings, or continue without a context.
- If a custom context fails validation, check the energy/BPM range order, slider values, mood names, and profile name.
- If a context was deleted while the builder was open, reload profiles or continue without context.
