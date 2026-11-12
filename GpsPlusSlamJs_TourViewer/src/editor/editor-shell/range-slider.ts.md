# range-slider.ts

## Purpose

The inspector's one drag rule for every slider (a station's radius, a
sound's radius, reach and volume), and the pure rules a track keeps.

## Public API

- `SliderTrack` - `{ min, max, step }`, in the units the slider shows.
- `trackValue(value, track)` - `value` clamped to the track and rounded to
  its step counted from `min`, without float noise; not a finite number:
  `min`.
- `pairValue(value, other, thumb, track)` - a thumb of a pair moved to
  `value`: on the track, and at least one step below (`low`) or above
  (`high`) the other thumb.
- `rangeInput(act, label, track, value)` - an `<input type="range">` on the
  track, `data-act` = `act`, `aria-label` = `label`, its value and its
  default value at `trackValue(value)`.
- `wireRangeDrag({ root, owns, begin, move, end })` -> `{ cancel() }`:
  - `owns(act)` - which sliders (by `data-act`) the rule answers;
  - `begin(slider)` - the drag's subject `{ id, before }`, or null: none;
  - `move(slider, id, value)` - one step shown; returns the value taken;
  - `end(act, slider, id, before, at)` - the drag over: `at` to write when
    it moved, null otherwise (or cut off); `slider` is the one drawn now;
  - `cancel()` - a drag cut off, nothing written.

## Invariants & assumptions

- Nothing is written during a drag, and a release where it began writes
  nothing: one drag is at most one write, one undo step.
- The dock is drawn again from the store, so the drag's state lives here
  and the slider is looked up by its `data-act` at its end.
- A drag ends at `change` or at its pointer's release, whichever comes
  first (a browser fires no `change` for a drag back to where it began);
  a cancelled pointer writes nothing. A drag belongs to the finger that
  pressed the slider (`pointerId`); a drag begun without a press (the
  keyboard) ends at any release or at its `change`. The document listeners
  exist only during a drag.
- An input on another slider of the rule ends the running drag first.
- `trackValue` is idempotent and always on the track; `pairValue` never
  lets the thumbs meet.

## Examples

```ts
const drag = wireRangeDrag({
  root,
  owns: (act) => act === "radius-slider",
  begin: () => ({ id: "gate", before: 25 }),
  move: (_s, _id, v) => v,
  end: (_act, _s, id, _before, at) => at !== null && write(id, at),
});
```

## Tests

`range-slider.test.ts` (jsdom, fast-check): `trackValue` on the track and
on a step for any number, `pairValue` never crossing, `rangeInput`'s
attributes and resting value. The drag rule through its users:
`radius-slider.test.ts` and `field-sliders.test.ts`.
