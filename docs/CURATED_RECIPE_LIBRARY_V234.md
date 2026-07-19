# Curated Recipe Library (v2.3.4)

Mixarr v2.3.4 adds a built-in collection of 28 playlist recipes at `/recipes/library`. The catalog is bundled in the application source, so browsing, previewing, and installing recipes works offline and does not require GitHub, a marketplace, a remote catalog, or a successful metadata-provider request.

## Browse and understand recipes

Use search, multi-select category chips, difficulty, metadata, compatibility, favorites, and sorting controls to narrow the catalog. Each card emphasizes the outcome, discovery level, target length, metadata expectations, and estimated fit for the current default music library. Open **Details** for the complete behavior summary, exclusions, expected playlist shape, customizable fields, metadata coverage, built-in version history, and an optional advanced engine configuration.

Difficulty describes setup and metadata needs, not the music. Beginner recipes work with common library data, intermediate recipes benefit from playback or analyzed metadata, and advanced recipes use progression behavior or need a genre/artist choice.

Metadata is declared as required, recommended, or optional. Missing recommended metadata never blocks a recipe; Mixarr keeps the recipe usable and explains which fallback signals will apply. A required source with no coverage makes compatibility unavailable until that data exists or the recipe is customized to relax the requirement.

## Compatibility estimates

Card compatibility is deterministic and based on the selected user's actual default-library aggregates: active track count and coverage for playback profiles, ratings, BPM, mood, energy, genre, artist, album, date added, release year, popularity, and local analysis. Required coverage, recommended coverage, estimated filter selectivity, and the candidate-to-target ratio produce the Excellent, Good, Limited, Poor, or Unavailable label.

Opening a recipe requests one exact primary-filter count through the same rule-to-database query builder used by Smart Mix generation. This does not generate a playlist or load track rows. Aggregate statistics are cached for two minutes and keyed to the library update timestamp; detail counts are lazy so the initial grid does not issue one query per card. Compatibility is an estimate, not a guarantee: duplicate handling, scoring, exclusions, safety limits, and subsequent library changes can affect final output.

## Install, customize, and create

**Install** creates a user-owned `PlaylistRecipe` through the existing validator and revision system. The copy records `sourceRecipeId` and `sourceRecipeVersion`; a serializable installation transaction with bounded retry prevents accidental concurrent duplicates without adding a data-loss-warning constraint during upgrades. It then appears everywhere existing Mix Recipes are supported.

**Customize** installs the recipe if necessary and opens the established Mix Recipe editor. A source banner identifies the built-in starting point. Save a personal configuration or create a playlist using the existing generation workflow; no separate playlist engine is involved.

Installing or creating a playlist counts as meaningful use and updates Recently Used. Merely opening a detail view does not.

## Favorites and hidden recipes

Favoriting stores only preference state against the stable built-in ID; it does not duplicate or install the recipe. Favorites survive catalog updates and can be filtered immediately.

Hiding removes a recipe from the default view without deleting its definition or an installed copy. Open **Hidden Recipes** to restore one item or restore all. Search does not include hidden recipes unless the hidden view is active.

## Updates and restore original

Every definition contains a stable ID, integer version, the Mixarr version that introduced or changed it, and a short change summary. Installed copies retain the source version they used. A later catalog version can therefore show **Update available** without overwriting user changes.

Customized installed recipes are never overwritten automatically during an application upgrade.

Use **Restore original** from an installed recipe's editor to replace its engine configuration with the current bundled defaults. Mixarr asks for confirmation, preserves the personal display name and description, increments the personal recipe revision when behavior changes, updates the source version, and records audit/job history. Existing generated playlists are not modified or regenerated.

## Persistence and backward compatibility

Migration `20260720040000_curated_recipe_library_v234` adds nullable source fields to `PlaylistRecipe` and a single normalized `BuiltInRecipePreference` table for favorite, hidden, last-used, version-used, and use-count state. Defaults are non-destructive. Existing personal recipes, imports, inheritance, automation, generated playlists, and settings require no conversion and retain their previous behavior.
