# Recipe Copilot scoring-model schema alignment (v2.4.20)

Mixarr v2.4.20 removes the scoring-model schema drift between Recipe Copilot,
Recipe Studio, recipe persistence, imports, and Smart Mix execution.

## Canonical values

The authoritative catalog is `src/lib/scoringModelCatalog.ts`:

- `stable-v2` uses the recipe's explicit saved weights.
- `experimental-balanced` blends explicit weights toward balanced targets and
  increases artist and album variety. Availability remains governed by the
  existing beta feature.

The playlist engine contains an implementation for both values. The catalog
contains no `popularity_heavy` value because repository and engine inspection
found no implementation, legacy migration, product preset, or equivalent
semantics. It was an AI-invented value admitted by the former `z.string()`
draft schema.

## Validation flow

The Recipe Copilot response schema and JSON Schema derive the enum from the
catalog. The prompt lists the same values and their actual behavior. A schema
failure can use the existing single governed structured-repair attempt, whose
canonical JSON Schema also contains only those values.

Proposal construction and Apply selected validate a complete candidate with
the same `validatePlaylistRecipeDraft` pipeline used before persistence.
Application is atomic: an invalid field changes neither the form nor proposal
state, and the UI preserves the selected changes for correction or
regeneration.

Create and update routes return a structured `422` response with
`RECIPE_SCORING_MODEL_UNSUPPORTED`, `scoring.scoringModel`, the received value,
the supported values, and a sanitized correlation ID.

## Existing data and imports

At startup, Mixarr scans stored recipe scoring JSON. A documented alias would
be normalized to its catalog value and recorded in migration history. v2.4.20
defines no aliases. Unknown values remain unchanged, but the recipe is
disabled, quarantined with `RECIPE_LEGACY_SCORING_MODEL_REVIEW_REQUIRED`, and
shown in Recipe Studio as requiring an explicit supported selection.

Recipe imports, restores, templates, clones, exports, and execution all pass
through the same recipe schemas. Unknown values are rejected before they can
be persisted or executed.

## Upgrade note

No database schema migration is required because scoring configuration is
stored as JSON. The idempotent startup diagnostic performs the data audit and
review marking without logging recipe names, playlist content, instructions,
track metadata, or AI response bodies.
