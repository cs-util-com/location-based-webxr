# travelling-box-sign.ts

## Purpose

The reading sign's words as a travelling surface (`travel-surface.ts`):
the narration box in travel mode is the ghost and the painter's model
(`narration-words-paint.ts`), and the words plate under the sign
(`reading-sign.ts`) is the plate. It is the first surface the travelling
box's controller (`travelling-box.ts`) moves.

## Public API

- `signHideWhy({ voice, inStation, sheetOpen })` gives why the words hide,
  in this order: `"no voice"`, `"outside the station"`, `"sheet open"`;
  else null.
- `signWordsGrowth(grow)` gives the growth to hand the sign for the
  `grow` knob: undefined (the sign's own, `signGrowth` of the distance)
  when on, 1 when off.
- `signWordsSurface(deps)` gives the `TravelSurface`. `deps`:
  - `id`: the text's block id; the surface's id is `words:<id>` and it
    answers to `<id>`;
  - `sign`: the sign's `wordsPlate`, `attachWords`, `detachWords`;
  - `box`: the narration box's `paintModel`, `restingRect`, `setGhost`,
    `setPointer`, `beginPress`, `movePress`, `endPress`, `state`;
  - `scale`: the paint scale (`wordsPaintScale` of the device pixel
    ratio);
  - `travelling`, `voice`, `inStation`, `sheetOpen`: the live inputs.
  - It throws a `TypeError` when the sign's words plate is not a mesh.

## Invariants and assumptions

- Kind `words`, slot `bottom`, voiced, never folds (`canFold` false).
- Its gate is the letter (`letterGate`): the em as drawn against the
  knob's threshold.
- `layout()` reads the box's paint model once per frame and keeps the same
  `TravelLayout` object until the box lays out anew; the canvas size is
  `wordsCanvasSize` of the box's layout at `scale`. Null while the box
  paints nothing; then `paintKey()` is empty.
- `hang` attaches the texture at `plateSizeM` of the box's size and font
  (one em = 0.136 m), so the plate is the box's shape.
- `pressing()` is the box's own `state().pressing`, so a finger on the
  ghost and one forwarded from the plate count alike.

## Examples

```ts
const surface = signWordsSurface({
  id: block.id,
  sign,
  box,
  scale: wordsPaintScale(devicePixelRatio),
  travelling: () => view === "world",
  voice: () => voiceLoaded,
  inStation: () => inside,
  sheetOpen: () => sheet.isOpen(),
});
const travel = createTravellingBox({ surface, scene, camera, ... });
```

## Tests

- `travelling-box-sign.test.ts`: the hide order, the growth knob, one
  layout per box layout at the scaled canvas size, no layout while
  nothing paints, the plate at the box's shape, the letter gate, the
  forwarded press state, and the refusal of a plate that is not a mesh.
- The check page and its e2e (`travelling-box-check.spec.js`) drive it in
  a browser.
