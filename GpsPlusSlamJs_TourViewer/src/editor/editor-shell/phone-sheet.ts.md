# phone-sheet.ts

## Purpose

The editor's panels on a phone: the tree and the details as sheets over the
map, each with a drag grip, and the map's canvas ending at a sheet's top.

## Public API

- `PHONE_SHEET_PX` - 700; at this width and under the panels are sheets. The
  same number stands in the `width <= 700px` rules of `editor-shell.css`.
- `phoneSheets(widthPx)` - whether that is so.
- `SheetKind` - `"tree"` or `"details"`.
- `SHEET_SHARE` - the part a sheet first takes: 0.62 and 0.66.
- `SHEET_LIMITS` - what a drag leaves: 0.3 to 0.8; under 0.2 the sheet goes.
- `SHELL_DOCK_LAYOUT` - the dock rule's numbers: both panels stay side by
  side above the sheets, and the list opens first on a phone.
- `sheetRelease(share)` - where a released sheet rests, null when it goes.
- `wirePhoneSheets({ tree, details, spacePx, dismiss })` -> `{ sync(which) }`:
  adds a `.sheet-grip` as each panel's first child and answers its drag;
  `sync` says which sheet shows (null: none, or no phone).

## Invariants & assumptions

- One number drives both the sheet's height and the canvas: `--s-sheet-share`
  on the body, a share of the height over the bottom panel. No measuring,
  so a bottom panel dragged taller moves the sheet and the canvas with it.
- A drag sets the sheet's own `height` and writes the number on release: the
  canvas resizes once, not per step.
- A sheet remembers its height until the page goes, each its own. A dismissed
  sheet keeps the height it had before the drag.
- A cancelled drag changes nothing.
- The grip is for a finger and hidden from readers: `#tree-fold`, the back
  button and the close button do the same work from a keyboard.

## Examples

```ts
const sheets = wirePhoneSheets({
  tree: treeRoot,
  details: inspectorRoot,
  spacePx: () => view.clientHeight - panelPx,
  dismiss: (which) => goAway(which),
});
sheets.sync("tree");
```

## Tests

`phone-sheet.test.ts` (jsdom): the layout's numbers, `sheetRelease`, the
share per sheet, nothing written during a drag, the limit, a dismissal, a
sheet's remembered height, a cancelled drag.
`editor-shell.test.ts` ("on a phone"): which sheet shows when.
`playwright-tests/editor3d-phone.spec.js`: positions and gaps at 390x844 and
844x390, the tap to details and back, the drag, the bottom panel.
