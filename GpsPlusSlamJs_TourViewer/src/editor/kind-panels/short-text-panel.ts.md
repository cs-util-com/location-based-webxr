# short-text-panel.ts

## Purpose

A short text's panel in the item inspector: chips for how it shows (pin, sign, edge hint, ground arrow), its role, and for a pin, a sign or a ground arrow how it turns; for a ground arrow also its style, a floor arrow's placement and caption switch, and its two colours with the sun check.

## Public API

- `ShortTextPanelDeps` - `view(id, view)` and `block(id, field, value)`, the shell's edits, and `changed?()`, a new draw after a write that came from no press (the caption switch, a colour well).
- `createShortTextPanel(deps): KindPanel` - draws for an item with `shortText` parts (from `inspector-model.ts`), null otherwise; acts `short-view:`, `short-role:`, `short-turn:`, `short-style:`, `short-floor:` and `short-colours:reset` (both colours back to the role's and the style's).

## Invariants

- The view chips come from `SHORT_TEXT_VIEWS`; every other chip group is one of the block's choices as the inspector model hands them over (`shortText.choices`, `block-fields.ts` `blockChoices`), so the values, their words and the fallback pressed for an absent field come from the kind's row in `kinds/edit-kinds.ts`; the panel holds no second list and no defaults of its own.
- Pressing the chip already in use writes nothing (no undo step, no changed file); an act for a choice the view does not read returns false and writes nothing.
- The turn chips show on a pin, a sign and a ground arrow (the views the row names), with the view's fallback pressed when none is written (a pin's is Upright); an edge hint has none, it sits at the screen's edge.
- A ground arrow: the style chips always; the placement chips (the row's `when`) and the caption switch only for a floor arrow. The colour wells show the written colour, else the role's accent and the style's dark default (`GROUND_DARK_DEFAULT`); the switch writes `"true"` or `""` and a well writes `#rrggbb`, both through `block` (`block-fields.ts` turns them into a boolean and a colour).
- The sun check rates the dark colour, the one that carries the shape on pale paving in direct sun (`sunContrast`); below 3 : 1 it turns into a warning (`.sunwarn`). An estimate for a flat part facing up, so it errs toward warning.
- Every chip writes at once; the panel has nothing to flush. The typed fields (description, reading distance, language) stay the dock's; where a pin, a sign or a ground arrow points is the panel's (below).

## Tests

`short-text-panel.test.ts` (jsdom): nothing for other kinds, the chips and defaults per view, what each act writes, the ground controls per style, what the switch and the wells write, the default colours and the sun warning. `kind-panels.test.ts` holds the row.

## Points to (signs and ground arrows)

- Three labelled boxes x, y and z (metres, the station's frame; aria-labels "Points to x/y/z"), always shown, the hint "none" while the file has no point. They are text boxes with a decimal keyboard rather than number inputs, so the format's strict reader, not the browser, judges what is typed.
- `composedPoint(boxes)` (exported): all blank gives `""` (remove the point), some blank gives `null` (nothing is sent yet), otherwise the trimmed values joined by spaces. The line goes through `deps.block(id, "pointsTo", line)`, so `blockFieldEdit` and the strict reader stay the only judges of validity.
- A box sends on change or Enter, once per typing: the same line is not sent twice until a box is typed in again, so a refusal is said once.
- "Pick in 3D" toggles `deps.pointPick` (the view's `pointPick` flag); while armed the button reads "Click the ground or an item...", is pressed, and the note "Esc cancels." shows. The 3D view answers the next click (`editor3d-editing.ts.md`).
- "Clear" sends a blank line; it is disabled while there is no point.
- Tests: `short-text-panel.test.ts` ("a short text's point"), with a property test of `composedPoint`.
