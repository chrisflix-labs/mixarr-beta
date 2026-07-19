# Mixarr v2.3.2 — Adaptive Recipe Mapping

Adaptive Recipe Mapping extends the v2.3.1 secure staged import workflow. It does not introduce a second recipe format or playlist-generation engine. Imported files still normalize into the canonical Mix Recipe schema, and candidate estimates use the existing Smart Mix rule-to-Prisma query builder.

## Import behavior

After format, checksum, privacy, schema, version, and conflict validation, Mixarr analyzes the selected owned Plex music library. The analysis reads bounded vocabulary rows and database aggregates for library size, genres, moods, artists, BPM, energy, popularity, audio features, and active sync state. Profiles are cached briefly and invalidated when the library or saved mappings change.

Mappings use this precedence:

1. Manually confirmed mapping for the selected library.
2. Manually confirmed global mapping.
3. Exact local value.
4. Case, punctuation, ampersand, and plural-normalized value.
5. Conservative known alias, related vocabulary, or high-confidence fuzzy suggestion.
6. Manual review.

Genre and mood mappings may target multiple local values. Those alternatives remain an OR group inside the existing recipe rule tree. Exclusions missing from the local library are marked as requiring no mapping and do not lower compatibility.

## Compatibility and estimates

Compatibility is a deterministic weighted harmonic calculation rather than a simple average. Required genres and artists, rule support, and candidate-pool health have more influence than optional preferences. Required unavailable constraints apply an additional penalty. The preview shows genre, mood, BPM, energy metadata, artist availability, general metadata, candidate coverage, and rule-support components.

Original and adapted candidate estimates call `buildTrackWhereClause` and `prisma.track.count`; they do not load candidate track records or reproduce filtering in a second engine. Estimates remain labeled as estimates because final Smart Mix v2 scoring, diversity, personalization, coordination, transition sequencing, and safety selection occur during generation.

BPM range filtering uses Mixarr's existing effective BPM predicate, including the current manual/local/API/imported precedence and half/double-time controls. Missing BPM, energy, or mood values are never fabricated. Existing missing-metadata fallbacks remain part of the recipe.

## Identity and persistence

The preview classifies accepted adaptations as identity-preserving, minor, moderate, or major. Major changes require an explicit confirmation. Importing the original definition with poor compatibility also requires confirmation.

`RecipeImportAnalysis` stores original/adapted definitions, compatibility, estimates, warnings, engine/schema versions, identity impact, library scope, and a mapping-state hash. `RecipeValueMapping` stores each decision. `SavedRecipeMappingRule` stores reusable indexed source mappings with scope, confidence, origin, confirmation state, enablement, usage, and timestamps. The saved `PlaylistRecipe` retains the original imported JSON and its linked analysis for later review.

The migration is additive. Deleting or disabling a saved mapping never changes an imported recipe, and a temporarily missing local value does not erase mapping history.

## APIs

- `POST /api/playlist-recipes/import/:stageId/analysis` selects a library, applies bounded mapping edits, recalculates counts/scores/warnings, persists an immutable analysis state, and refreshes the staged preview.
- `GET|POST /api/recipe-mappings` lists/searches or creates/updates owned mapping rules.
- `PATCH|DELETE /api/recipe-mappings/:id` enables/disables or deletes an owned mapping rule.
- `POST /api/playlist-recipes/import` confirms adapted or original import, validates the analysis ID and required acknowledgements, preserves the original definition, and never generates a playlist.

Every route requires the Mixarr session cookie and scopes libraries, recipes, stages, analyses, and mapping rules to the signed-in user.
