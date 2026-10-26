# bar-actions.ts

## Purpose

The bottom bar's power actions for the selection, as data, pure: what
the inspector does not offer (the Studio 3 prototype's rule) -
Duplicate, Align to station and Copy position. The buttons are
`editor-shell.ts`'s.

## Public API

- `barActions(model)` -> the buttons for the selection's inspector model
  (`InspectorModel | null`), each `{ action, label, title }`:
  - a station: Duplicate, Copy position;
  - an item: Duplicate, Align to station, Copy position;
  - a code (read-only in the 3D view): Copy position only;
  - Copy position only where `positionText` has a text; none without a
    selection.
- `positionText(model)` -> the place and heading as text, or null:
  - a station or a code: `E <m> m, N <m> m, height <m> m, heading <deg>
deg` - metres east and north of the tour's centre and the height over
    the ellipsoid, as the inspector's Position shows them;
  - an item: `<m> m north, <m> m east, <m> m up of its station, heading
<deg> deg`, in its station's frame;
  - two decimals for metres (never "-0.00"), whole degrees in 0-359,
    "no heading" when the file gives none.
- `ALIGNED_DEG` (0.5) - an item this near its station's way counts as
  aligned: the shell says so and writes nothing.

## Invariants & assumptions

- Pure; the words are the prototype's ("Duplicate the selection
  (Ctrl+D)", "Turn it to face the way its station faces", "Copy the
  position and heading as text").

## Examples

```ts
barActions(buildInspector({ selected: "pin-1" /* ... */ })); // dup, align, copy
positionText(model); // "2.00 m north, -1.25 m east, 0.50 m up of its station, heading 15 deg"
```

## Tests

`bar-actions.test.ts`: the actions per kind and without a selection or a
position; the words; the texts, "no heading", the "-0" and 360 cases.
End to end: `playwright-tests/editor3d-edit.spec.js` (align, copy) and
`editor3d-tree.spec.js` (duplicate, the bar's layout).
