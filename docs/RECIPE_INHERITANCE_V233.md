# Recipe Inheritance and Overrides (v2.3.3)

Mixarr recipe inheritance lets a recipe reuse settings without copying them. Existing recipes remain legacy-explicit: their stored values continue producing the same result until inheritance is deliberately enabled.

## Understanding Effective Recipe Settings

The effective configuration is the validated configuration sent to Smart Mix Engine v2. Mixarr resolves it on the server, records the source of every field, reports suppressed values and locks, and creates a stable SHA-256 fingerprint. The UI labels fields as default, inherited, customized, legacy explicit, locked, conflicting, or invalid; status never relies on color alone.

Resolution order, from lowest to highest, is:

1. Built-in system defaults
2. Administrator global defaults
3. Category preset
4. Base recipe chain, oldest ancestor first
5. Transition, discovery, variety, and automation policy presets
6. Recipe-specific overrides
7. Explicitly prioritized group policies
8. Playlist-specific overrides
9. Eligible user preferences
10. Policy-lock enforcement

Locks are enforcement rules. The highest-authority lock wins, and a prohibited higher-layer value is retained in the explanation as suppressed rather than silently discarded. A conflicting locked override is blocking.

### Full example

```text
Built-in system defaults
        ↓
Administrator global defaults
        ↓
Workout category
        ↓
Workout Foundation
        ↓
Smooth Ramp transition preset
        ↓
Morning Workout
        ↓
Gym Playlist Override
```

`Morning Workout` can inherit high energy, a rising BPM curve, and a two-track artist limit from `Workout Foundation`, override discovery from 20% to 40%, and let one Gym playlist request 75 tracks. The playlist override does not modify either recipe. Resetting discovery deletes the local `discovery.deepCutPercentage` override; if the foundation later changes to 30%, the child receives 30% automatically.

## Base recipes and presets

A recipe has at most one direct base recipe, but a base may inherit another base. Mixarr detects direct and indirect cycles and limits chains to 10 base levels. A base recipe represents a complete reusable recipe foundation. A preset contributes only one reusable concern: category defaults, transition flow, discovery, variety, or automation behavior.

Base recipes with children cannot be deleted until children are reassigned, detached, or converted to explicit values. Presets with dependents require an archive or migration strategy. Category deletion uncategorizes recipes by default and never deletes them.

## Overrides and reset behavior

Recipe, playlist, group, and user values are stored separately. Stable paths such as `bpmFlow.maximumBpm` identify typed schema fields. `false`, `0`, an empty string, and an empty list are explicit values—not missing values. Reset removes the override record rather than copying its current inherited value. Section and all-override reset APIs accept multiple paths or an empty list for all recipe overrides.

Playlist overrides are captured independently and survive regeneration. User preferences only apply during user-specific generation and only for administrator-eligible field paths. Shared/system playlists do not implicitly adopt another user’s preferences.

## Clone modes

- Linked Clone retains the same base, preset references, and explicit overrides.
- Child Recipe uses the source as its base and starts without local overrides.
- Independent Copy resolves today’s effective configuration, stores every value explicitly, and removes inheritance references.
- Structure-Only Clone retains base and preset references but omits local, playlist, and user overrides.

## Conflicts, versions, and jobs

The resolver blocks invalid BPM/energy ranges, cycles, excessive depth, unavailable/archived presets, invalid schema values, and prohibited locked overrides. Deterministic group priority produces a warning that identifies the winner and suppressed group. Recipe revisions may store inheritance references, resolved output, resolver version, and fingerprint so comparisons distinguish changed overrides, inherited values, sources, locks, conflicts, and effective output.

Every recipe generation records the effective snapshot, provenance, chain, warnings/conflicts, resolver/schema version, and fingerprint. Exact retries use the original effective snapshot; “run with latest recipe” is a distinct action. Changing a shared preset does not regenerate playlists unless an automation policy explicitly requests it.

## API examples

Preview proposed changes without saving:

```http
POST /api/playlist-recipes/{id}/effective-configuration
Content-Type: application/json

{
  "proposedChanges": {
    "baseRecipeId": "…",
    "overrides": { "discovery": { "deepCutPercentage": 40 } }
  }
}
```

Reset one field:

```http
DELETE /api/playlist-recipes/{id}/overrides
Content-Type: application/json

{ "fieldPaths": ["discovery.deepCutPercentage"] }
```

Core endpoints include `/api/recipe-presets`, `/api/recipe-categories`, `/api/recipe-inheritance/global-defaults`, `/api/recipe-inheritance/locks`, `/api/recipe-inheritance/user-preferences`, recipe `base`, `dependents`, `impact-preview`, and `effective-configuration` endpoints, and playlist-group `recipe-policy` endpoints. Existing authentication and administrator checks apply.

## Migration behavior

Migration `20260720010000_recipe_inheritance_v233` is additive. It does not drop, reset, or rewrite user data. `inheritanceEnabled` defaults to false, so all current JSON sections remain legacy-explicit. New references are nullable. Existing API payloads, automations, history, and generation paths remain readable.

## Troubleshooting

**Circular inheritance:** Read the reported `A → B → C → A` chain, then remove or change one base assignment. Preview before saving.

**Unexpected effective value:** Open Effective Configuration, find the field, and inspect its source, inherited value, suppressed values, and lock. Reset a customization to reveal the next layer.

**Preset unavailable:** Archived and deleted presets do not silently disappear from resolution. Restore or replace the preset reference, convert the last effective values to explicit values, or remove the reference to fall back.

**Group conflict:** Select one primary recipe-policy group or set explicit priorities. Mixarr never uses database row order.

**Locked value:** Remove the suppressed local/playlist/user override or ask an administrator. User input is explained, not silently discarded.
