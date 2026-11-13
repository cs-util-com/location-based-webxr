# short-text-panel.ts

## Purpose

A short text's panel in the item inspector: chips for how it shows (pin, sign, edge hint, ground arrow), its role, and for a sign or a ground arrow how it turns; for a ground arrow also its style, a floor arrow's placement and caption switch, and its two colours with the sun check.

## Public API

- `ShortTextPanelDeps` - `view(id, view)` and `block(id, field, value)`, the shell's edits, and `changed?()`, a new draw after a write that came from no press (the caption switch, a colour well).
- `createShortTextPanel(deps): KindPanel` - draws for an item with `shortText` parts (from `inspector-model.ts`), null otherwise; acts `short-view:`, `short-role:`, `short-turn:`, `short-style:`, `short-floor:` and `short-colours:reset` (both colours back to the role's and the style's).

## Invariants

- The view, role and turn choices and their words come from the kind's row in `kinds/edit-kinds.ts`; the panel holds no second list.
- A block without a role presses `label`; a sign without an orientation presses `Fixed` (`world`), the reader's defaults.
- The turn chips show only on a sign and a ground arrow (where they turn its plate): a pin and an edge hint face the visitor anyway.
- A ground arrow: the style chips always; the placement chips and the caption switch only for a floor arrow. The colour wells show the written colour, else the role's accent and the style's dark default (`GROUND_DARK_DEFAULT`); the switch writes `"true"` or `""` and a well writes `#rrggbb`, both through `block` (`block-fields.ts` turns them into a boolean and a colour).
- The sun check rates the dark colour, the one that carries the shape on pale paving in direct sun (`sunContrast`); below 3 : 1 it turns into a warning (`.sunwarn`). An estimate for a flat part facing up, so it errs toward warning.
- Every chip writes at once; the panel has nothing to flush. The typed fields (description, reading distance) stay the dock's.

## Tests

`short-text-panel.test.ts` (jsdom): nothing for other kinds, the chips and defaults per view, what each act writes, the ground controls per style, what the switch and the wells write, the default colours and the sun warning. `kind-panels.test.ts` holds the row.
