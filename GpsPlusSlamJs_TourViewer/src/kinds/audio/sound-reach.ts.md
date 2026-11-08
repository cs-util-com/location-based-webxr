# `kinds/audio/sound-reach.ts` - the free sounds' distance rules

## Purpose

The pure numbers and functions that decide how a free sound reaches the
visitor: an ambient zone's loudness by distance, a narration circle's inside
with its leave margin, and the background's glide.

## Public API

- `NARRATION_DEFAULT_RADIUS_M` (6), `NARRATION_MARGIN_M` (1.5) - the circle's
  default radius and the extra distance beyond it before a leave counts.
- `AMBIENT_DEFAULT_MAX_M` (20) - a zone's earshot when the item names none.
- `BACKGROUND_UNDER_VOICE` (0.3), `LOWER_GLIDE_S` (0.35).
- `ZoneReach` - `{ maxM, minM?, volume }`.
- `zoneGain(distanceM, zone)` - `volume` up to `minM` (or 0 m), falling
  linearly to 0 at `maxM`; 0 beyond, and 0 for a negative or non-finite
  distance.
- `circleInside(distanceM, radiusM, marginM, wasInside)` - inside at or below
  the radius; once inside, until beyond the radius plus the margin; false for
  a non-finite distance.
- `glide(current, target, dtS)` - one exponential step toward `target` with
  time constant `LOWER_GLIDE_S`; no step for `dtS <= 0`.

## Invariants & assumptions

- **The defaults rest on the AR view's tracking, not on GPS alone.**
  `sound-reach.sweep.test.ts` puts a visitor within half the radius under
  three noise models (open-sky GPS, street-canyon GPS, tracking fused) and
  counts the runs in which the narration is cut off, and the runs in which a
  neighbour standing just outside hears the circle open:
  - fused tracking: no cut-off from 3 m with a margin of 1 m or more;
  - open-sky GPS alone: no cell of 3-8 m by 0.5-1.5 m holds (40 % of runs
    cut off at 6 m / 1.5 m); it holds from 10 m with 1.5 m;
  - street-canyon GPS alone: nothing up to 16 m holds.
    So 6 m / 1.5 m holds only while the view tracks the phone; a tour walked
    on GPS alone needs a larger circle. The defaults are provisional.
- Distances are horizontal (the parts drop the height).

## Examples

```ts
zoneGain(10, { maxM: 20, volume: 1 }); // 0.5
circleInside(7, 6, 1.5, true); // true: still inside the margin
```

## Tests

`sound-reach.test.ts` (the curves and the hysteresis) and
`sound-reach.sweep.test.ts` (the radius and margin sweep above; its table is
printed with `console.info`).
