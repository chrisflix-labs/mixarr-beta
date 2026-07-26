# Recipe Copilot draft application (v2.4.18)

## Root cause

The review drawer kept selection and edited proposal values in its own local
state, then sent paths and a copied recipe to a server-side `apply` operation.
That operation had two different meanings: new recipes received a returned
local draft, while existing recipes were persisted immediately as a disabled
revision. The drawer had no apply-specific pending state, did not close after
success, did not require a returned draft before showing its notice, used field
paths as checkbox identity, and surfaced failures above the scrolled review
area. The result could look like a silent no-op and did not provide a reliable
form-state handoff.

## v2.4.18 behavior

Recipe Studio owns the only editable draft. The drawer sends a typed collection
of stable, selected proposal changes to Recipe Studio. The server checks those
changes against the stored proposal, rejects protected or unknown paths,
detects selected fields that were manually changed after proposal generation,
applies every selected change immutably, and validates the complete result
against the canonical Recipe Studio schema. Only then does Recipe Studio replace
its active draft state.

The patch is atomic. Arrays such as `filters.rules` are replaced as complete
values. Unknown fields, approval and activation state, ownership, audit data,
signatures, execution history, generated playlist identifiers, and
prototype-pollution path segments cannot be changed.

`Apply selected` does not save, create, activate, execute, publish, or generate
a playlist. It marks the proposal as applied for audit purposes and updates the
local form draft. The existing Save/Create button remains the persistence
boundary.

The button shows `Applying…`, prevents duplicate operations, and closes the
drawer only after the active draft is updated. Success reports the applied count
and reminds the user to review and save. Failure keeps the drawer, proposal, and
selection open and reports that no recipe fields changed.
