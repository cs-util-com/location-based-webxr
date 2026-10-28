# pin-sheet.ts

## Purpose

The visitor's pin sheet (station blocks plan B2b step 5; the design's tap
floor, §2.5): a short text stands in the world as its caption (a `pin`);
a tap on it in AR opens a sheet on the screen with its whole text, the
caption and the description. Only a pin with a description opens one; a
tap on nothing closes the sheet.

## Public API

- `createPinSheet({ dom, scene, blocks, pick })` -> `PinSheet`:
  - `tapped(tap)` - picks among `tappablePins` with `pick`
    (`seams.pickObjectInView`); a hit opens its sheet (title = caption,
    text = description, `hidden = false`), no hit (or no scene, outside
    AR) closes it.
  - `close()` - hides and empties it (the Close button, `stopStations`).
  - `openId()` - the pin whose sheet is open, or null.
  - `sync()` - closes the sheet when its pin is no longer one a tap could
    open (its station's content hidden, the block gone from the tour, or no
    scene); `main.ts` calls it on every station tick. Free while closed.
- `tappablePins(scene, blocks)` - every shown object (itself and every
  ancestor `visible`) under a `station-content:<id>` group whose
  `userData.objectId` names a pin with a non-empty description, by id.
- `tourBlocksById(manifest)` - every station's blocks by id (ids are
  unique tour-wide); empty without a tour.
- `cancelsXrSelect(target)` - whether a tap on `target` (a
  `beforexrselect`'s) belongs to the overlay: a control (`button`, `a`,
  `input`, `select`, `textarea`, `summary`), a `.sheet` or the story
  card (`#scene-panel`), a model's card (`.model-card`) or a toy's
  gesture layer (`.model-gestures`). `main.ts` cancels those in visitor mode, so a
  tap on Continue or on the sheet's Close never also hits a pin behind it.

## Invariants & assumptions

- Text is set with `textContent` (no markup); `#pin-sheet-text` keeps its
  line breaks (`white-space: pre-line`).
- The tap comes from `seams.startXrSelect` (the framework's
  `startXrSelectListener`), started for a visitor's AR session in
  `ar-entry.ts` and disposed at its end; `hooks.visitorTap` is
  `pinSheet.tapped`, and `hooks.stopStations` also closes the sheet.
- The sheet is the design system's `.sheet` docked to the bottom edge,
  above the walk's sheet (z-index 30), styled as the walk's sheet.

## Examples

```ts
const sheet = createPinSheet({
  dom,
  scene: () => seams.getScene(),
  blocks: () => tourBlocksById(manifest),
  pick: seams.pickObjectInView,
});
sheet.tapped(tap);
```

## Tests

- `pin-sheet.test.ts` - the overlay's taps, the blocks map, opening and
  closing, which pins are offered (hidden, bare, outside the content, a
  card), no scene; a property over any mix of described and shown pins.
- `playwright-tests/story-blocks.spec.js` - a tap on the story's pin opens
  its description, only described pins are offered, and the Close is no
  world tap.
