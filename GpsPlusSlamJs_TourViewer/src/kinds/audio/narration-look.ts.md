# `kinds/audio/narration-look.ts` - how a narration circle looks

## Purpose

The narration circle's look, behind one function so that `spot.ts` does not
change when the look does. It is minimal on purpose: the final look waits
for a look prototype. Today: a thin ring on the ground at the radius, and a
column of particles rising at the centre ("go there"), brighter while the
visitor is inside. An invisible column takes the taps.

## Public API

- `narrationLook(radiusM)` -> `NarrationLook`:
  - `object` - the group to place;
  - `tapTarget` - the invisible column a tap is cast against;
  - `inside(inside)` - brighter inside;
  - `tick(seconds)` - moves the particles; allocates nothing (the spread is
    one array made at load);
  - `dispose()` - frees every geometry and material.

## Invariants & assumptions

- The particles' spread is fixed (golden angle), so two circles look alike
  and a test is repeatable.
- The ring lies just above the ground (2 cm) and writes no depth.

## Examples

```ts
const look = narrationLook(6);
look.tick(1.5);
look.inside(true);
```

## Tests

`narration-look.test.ts` (the rise stays on the column and repeats each
`RISE_S`, the tick writes in place) and `spot.test.ts` (a tap target,
dispose). The look itself is checked
by eye until its prototype is chosen.
