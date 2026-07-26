# Recipe Copilot canonical conflict detection (v2.4.19)

Mixarr v2.4.19 fixes false stale-proposal conflicts during **Apply selected**.

## Authoritative snapshot

Recipe Studio disables Recipe Copilot until its active draft has completed
initialization. Immediately before generation, the drawer calls the studio’s
authoritative draft accessor, deep-clones that value, and sends it as
`baseDraft`. The server parses it through the canonical recipe draft schema,
hydrates schema defaults, stores it in the proposal snapshot, and computes a
stable revision hash with sorted object keys and volatile UI fields excluded.

The provider generates proposed changes only. It never supplies the
authoritative current value. Review displays resolve current values from
`baseDraft`.

## Three-way equality

For every selected editable path:

```text
conflict = current != base && current != proposed
```

All three operands use the same path-aware canonicalizer. Strings follow schema
trimming. A compatibility path may decode exactly one accidental JSON-string
layer only when the destination expects a string. Objects use stable key order.
Recipe rule and curve arrays remain ordered; schema-defined mood, artist, genre,
trait, and locked-trait sets compare in sorted order. Missing, `undefined`,
`null`, and default values follow the Recipe Studio schema.

If current already equals proposed, application skips the field idempotently
and increments `alreadyAppliedCount`.

## Genuine conflicts

Genuine conflicts return `AI_RECIPE_PROPOSAL_CONFLICT` as an expected workflow
result. The drawer shows the value captured at generation, the active form
value, the Copilot value, and a safe default to keep the manual value. Users may
apply non-conflicting fields, explicitly use selected Copilot values, or cancel
and continue editing.

Missing or invalid snapshots use dedicated snapshot codes. Unexpected
application exceptions alone use `AI_RECIPE_PROPOSAL_APPLY_FAILED`.

Applying remains a local draft operation. It marks changed fields dirty,
reruns validation and analysis, and never saves, activates, executes, publishes,
or generates a playlist.
