# extent-slider.ts

## Purpose

An item's extent slider in the inspector: a video's width beside its typed
number, on the track its placement row names (`ExtentSpec.slider` in
`placement/placement-rows.ts`). Kinds without a track (a picture, a model)
keep the typed number alone.

## Public API

- `extentRange(numberBox, label, track, value)` - the row: an
  `<input type="range" data-act="extent-slider">` on `track`, labelled
  `label`, resting at `value` on the track, then `numberBox`.
- `wireExtentSlider({ root, item, write })` -> `{ cancel() }`:
  - `item()` - the selected item with an extent and its value now, or
    null (no drag starts);
  - `write(id, value)` - the one edit of a release that moved the value
    (the shell writes it as the 3D view's dot drag does: an `extent` scene
    edit, so the format's bounds are kept in one place);
  - `cancel()` - a drag cut off (the selection changed, the view closed):
    nothing written.

## Invariants & assumptions

- The drag rule is `range-slider.ts`'s: nothing is written during a drag,
  a release where it began writes nothing, one drag is at most one undo
  step.
- A drag shows its value in the typed number (two decimals); at its end the
  number and the thumb show the tour's value again, and the draw a write
  causes brings the new one.
- The track (0.3-6 m, step 0.05 m for a video) covers what is set by feel;
  the number takes the rest of the format's bounds, and the thumb rests at
  the nearer end of the track for those, unwritten until moved.
- No 3D preview during the drag: the view resizes at the release. The
  white dots in the view stay the live way to resize.

## Examples

```ts
const drag = wireExtentSlider({
  root: inspector.root,
  item: () => ({ id: "clip", value: 2 }),
  write: (id, value) => edits.scene({ kind: "extent", ref: { kind: "block", id }, value }),
});
```

## Tests

`extent-slider.test.ts` (jsdom): the row's track and label, the resting
thumb for a width outside the track, one write at the release, none for a
drag back, a cut-off drag or no selection. `inspector-model.test.ts`: a
video's extent carries the track, a picture's none.
