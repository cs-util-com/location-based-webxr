# short-text-panel.ts

## Purpose

A short text's panel in the item inspector: chips for how it shows (pin, sign, edge hint), its role, and for a sign how it turns.

## Public API

- (internal) `SHORT_TEXT_VIEW_CHOICES` - the view chips, in order.
- `ShortTextPanelDeps` - `view(id, view)` and `block(id, field, value)`, the shell's edits.
- `createShortTextPanel(deps): KindPanel` - draws for an item with `shortText` parts (from `inspector-model.ts`), null otherwise; acts `short-view:`, `short-role:`, `short-turn:`.

## Invariants

- The role and turn choices and their words come from the kind's row in `kinds/edit-kinds.ts`; the panel holds no second list.
- A block without a role presses `label`; a sign without an orientation presses `Fixed` (`world`), the reader's defaults.
- The turn chips show only on a sign: a pin and an edge hint face the visitor anyway.
- Every chip writes at once; the panel has nothing to flush. The typed fields (description, reading distance) stay the dock's.

## Tests

`short-text-panel.test.ts` (jsdom): nothing for other kinds, the chips and defaults per view, what each act writes. `kind-panels.test.ts` holds the row.
