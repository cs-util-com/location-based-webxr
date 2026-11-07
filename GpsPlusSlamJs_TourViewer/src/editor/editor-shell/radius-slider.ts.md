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
- The dock is drawn again from the store, so the drag's state lives here,
  and the number and the slider are looked up at each step.
- A drag ends at `change` or at the pointer's release, whichever comes
  first: a browser fires no `change` for a drag back to where it began, and
  a draw can take the slider from under the pointer. A cancelled pointer
  writes nothing. The two listeners on the document exist only during a
  drag.
- A drag belongs to the finger that pressed the slider (its `pointerId`,
  taken at `pointerdown` while no drag runs): another finger's release or
  cancel, or a second press on the slider, does not end it. A drag begun
  without a press seen (the keyboard) ends at any release, as before.
- After a drag the thumb goes back to the station's radius, so a write that
  changed nothing leaves no thumb beside a number that disagrees.
- The format allows more than the track (2 to 300 m): the thumb rests at the
  nearer end of the track for such a radius, the number keeps the value, and
  nothing is written until the thumb moves. A radius under 5 m is reached
  by the number only.
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
order of write and preview, a refused edit, a cut-off drag, a drag ended by
the pointer alone, other inputs.
`editor-shell.test.ts`: the wiring to the view and the edits.
`playwright-tests/editor3d-station-ring.spec.js`: the ring in the 3D view.
