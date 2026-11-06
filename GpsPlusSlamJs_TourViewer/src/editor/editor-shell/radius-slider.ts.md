# radius-slider.ts

## Purpose

A station's radius slider beside its number in the inspector: a drag shows
the radius in the number and on the 3D view's ring, and the release writes
one edit.

## Public API

- `RADIUS_SLIDER` - the track: 5 to 100 m in steps of 1.
- `radiusRange(numberBox, radiusM)` -> `.range`: the slider
  (`data-act="radius-slider"`, `aria-label="Radius"`), then `numberBox`.
- `wireRadiusSlider({ root, station, preview, write })` -> `{ cancel() }`:
  - `station()` - the selected station's id and radius, or null;
  - `preview(id, radiusM | null)` - the ring at that radius, or as the tour
    has it;
  - `write(id, radiusM)` - one edit;
  - `cancel()` - a drag cut off: the number and the view put back, nothing
    written.

## Invariants & assumptions

- Nothing is written during a drag, and a release where it began writes
  nothing: one drag is at most one undo step.
- The preview is dropped after the write, so the ring never shows the old
  radius for a frame.
- The dock is drawn again from the store, so the drag's state lives here.
- The format allows more than the track (2 to 300 m): the thumb rests at the
  track's end for such a radius, the number keeps the value, and nothing is
  written until the thumb moves.
- Events of any other input in `root` are ignored, as is a drag with nothing
  selected.

## Examples

```ts
const radius = wireRadiusSlider({
  root: inspector.root,
  station: selectedStation,
  preview: (id, m) => view.previewRadius(id, m),
  write: (id, m) => edits.station(id, { foundRadiusM: m }),
});
```

## Tests

`radius-slider.test.ts` (jsdom): the row's order and range, a radius past
the track, the preview and the one write, a drag back to the start, the
order of write and preview, a refused edit, a cut-off drag, other inputs.
`editor-shell.test.ts`: the wiring to the view and the edits.
`playwright-tests/editor3d-station-ring.spec.js`: the ring in the 3D view.
