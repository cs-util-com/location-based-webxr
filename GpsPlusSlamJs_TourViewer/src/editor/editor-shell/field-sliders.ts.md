# field-sliders.ts

## Purpose

A block's number fields as sliders in the inspector, from the field's
`FieldSpec` `number.slider` (`kinds/edit-kinds.ts`): a narration circle's
radius, a zone's reach with its full-volume edge as a second thumb on the
same track, and a zone's volume in % with its loudness curve under it.

## Public API

- `fieldRange(field, numberBox)` -> `.range` or null: the slider
  (`data-act="field-slider:<name>"`, labelled with the field's label), or
  for a field with a `low` field a `.pair` of two sliders on one track
  (`data-pair="low"` / `"high"`, each naming the other in `data-other`),
  then `numberBox`. Null for a field without a track.
- `loudnessCurve(of, scale)` -> `.curve` holding `svg.loudness`: the zone's
  loudness over distance (`role="img"`, its words in `aria-label`).
- `loudnessPoints(of, width, height)` -> `{ points, words }`: the curve's
  corners (centre, edge, reach, a quarter past the reach) from `zoneGain`,
  y down, full volume at the top; and the words ("Loudness: 50 % within
  4 m, silent beyond 20 m").
- `wireFieldSliders({ root, selected, write })` -> `{ cancel() }`: a drag
  shows its value in the field's box and redraws the curves; its release
  calls `write(box, text)` once, which the shell answers by typing `text`
  into the box and committing it (`commitField`).

## Invariants & assumptions

- The drag rule is `range-slider.ts`'s: nothing written during a drag,
  one write at the release when it moved, none when cut off or with
  nothing selected.
- The write goes through the typed-number commit, so the bounds, the
  scale (a volume of 50 % is held as 0.5) and the calm-below-reach rule are
  checked once (`block-fields.ts`), and a write is one undo step.
- A pair's thumbs never cross (`pairValue`): the low one stays a step
  below the high one, so the written pair is one the file takes.
- A value outside the track (a reach of 150 m) rests its thumb at the
  track's end; the box keeps it, and nothing is written until the thumb
  moves. A blank optional field (no full-volume edge) rests at the
  track's start.
- The curve is drawn from the boxes beside it on every drag step and every
  typed character, and from the store on every draw.
- There is no 3D preview during a drag (the station radius has one through
  `radius-slider.ts`); the view follows at the release.

## Examples

```ts
const sliders = wireFieldSliders({
  root: inspector.root,
  selected: () => state().editorView.selected,
  write: (box, text) => {
    box.value = text;
    commitField(box, state().editorView.selected);
  },
});
```

## Tests

`field-sliders.test.ts` (jsdom, fast-check): the rows, a pair on one
track, a blank thumb's rest, one write at the release, a drag back to the
start, a keyboard step, the pair's order, the curve following a drag, a
cut-off drag, and a property that the curve stays in its box and falls to
silence at the reach. `playwright-tests/editor3d-sound-sliders.spec.js`:
mouse and keyboard in the editor, saved, and undone.
