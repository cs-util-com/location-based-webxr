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

- **The defaults rest on the tracking's noise, not on GPS.** `spot.ts`
  measures, in the scene's x/z, the distance between the tracked camera
  and the circle's centre; both share the scene frame, so a constant
  alignment offset moves them together and cancels out by construction.
  Changes of the alignment during a walk (a re-alignment shifting the
  scene) are not modelled; they are assumed to sit inside the drift
  models. `sound-reach.sweep.test.ts` puts a still visitor within half the
  radius under three tracking models (steady, drifting, poor: stated, not
  measured) and counts the runs in which the narration is cut off and in
  which a still neighbour 2 m beyond the radius (the edge at which the
  circle opens) hears it open (at most 1 in 20 holds):
  - steady and drifting tracking: every circle of 3-8 m with a margin of
    0.5-2 m holds, for the listener and the neighbour (at most 0.5 %);
  - poor tracking (1 m slow error): the listener holds from 5 m at any
    margin, 4 m with 1 m or more, 3 m with 1.5 m or more; the neighbour
    hears the circle open in 22-28 % of the runs at every radius and
    margin. The margin cannot help it: the circle opens at the radius.
  - Neighbour distance: under drifting tracking 1 m beyond the radius opens
    (15-18 %) and 2 m holds; under poor tracking 2 m opens (22-27 %), 3 m
    holds narrowly (3-5 %), 4 m holds (at most 0.3 %).
  - The default 6 m / 1.5 m keeps its listener up to 1.5 m of slow error
    (1 %) and breaks at 2 m (13 %); its neighbour 2 m outside breaks first,
    between 0.5 m (1 %) and 0.75 m (9 %). A field walk found it stable.
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
