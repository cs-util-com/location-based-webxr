# kind-panel.ts

## Purpose

The types of a kind's own part of the item inspector: what no field spec (`kinds/edit-kinds.ts` `fields`) can say. Types only.

## Public API

- `PanelItem`: the inspector model of an item.
- `KindPanelDraw`: one draw's pieces.
  - `key`: the panel's own state, part of what a draw is compared by.
  - `kept`: a node kept in the page across draws, under the head.
  - `ownsFields`: the dock draws none of the item's fields.
  - `title()`: the head's title in place of the dock's (null: the dock's).
  - `head()`: buttons before the fold.
  - `parts()`: sections after the fields.
- `KindPanel`:
  - `sync(item | null)` runs on every draw. It gets null when its kind is not selected and returns what to draw, or null.
  - `act(name, item, selected)` returns true when the press is its own.
  - `flush()` writes pending typing.

## Invariants & assumptions

- The dock places the pieces without knowing the kind. The shell hands a press (`data-act`) to the selected item's kind's panel before its own commands.
- `parts()` are made fresh on each draw, while `kept` is reused.

## Examples

See `model-panel.ts` (parts only) and `../long-text/long-text-panel.ts` (kept writer, title, head buttons, own fields).

## Tests

`kind-panels.test.ts`.
