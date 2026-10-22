# walk-direction.ts

## Purpose

Which way a station is, in words (visitor walk W4 build plan
`GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md`,
M3, §1.5, §1.6, §5): the one direction rule for the peek's tail, the
list's rows and (M5) the edge pill. W4 had two rules ("behind" past 140°
in its words, past 137.5° in its pill); the build has this one.

## Public API

- `type WalkDirection = "ahead" | "left" | "right" | "behind"`.
- `WALK_AHEAD_DEG = 28`, `WALK_BEHIND_DEG = 140`,
  `WALK_DIRECTION_HYSTERESIS_DEG = 5` - the shipped defaults.
- `walkDirection(angleDeg, previous = null, options?) => WalkDirection | null`
  - `angleDeg`: the station's bearing relative to the camera's,
    `bearingDeltaDeg(stationBearing, cameraBearing)`, positive to the
    right; wrapped into (-180, 180] first;
  - `previous`: the word last shown for this station; it holds while the
    angle stays inside its zone grown by the band;
  - `options`: `aheadDeg`, `behindDeg`, `hysteresisDeg` (for the sweeps);
  - returns null for a non-finite angle; throws `RangeError` for
    thresholds that do not make three zones
    (`0 < ahead < behind < 180`, `0 <= h < ahead`, `h < 180 - behind`).
- `walkDirectionPhrase(word)` - the row's words: "ahead", "to your left",
  "to your right", "behind you" (W4).
- `walkDirectionTail(word)` - the peek's tail: "Ahead.", "To your left.",
  "To your right.", "Behind you." (W4).
- `createWalkDirections(options?) => WalkDirections` - one word per
  station with its own memory for the band: `of(id, angleDeg | null)`
  (null forgets the station: no heading), `reset()`.

## Invariants & assumptions

- Zones without a band: ahead `|a| < 28`, a side `28 <= |a| <= 140`,
  behind `|a| > 140`; the side by the sign.
- The band keeps only the PREVIOUS word, and only within `h` of its zone
  (ahead `|a| < 28 + h`, a side `28 - h < |a| <= 140 + h` on its own sign,
  behind `|a| > 140 - h`); a side never carries over to the other side.
- The memory is a view resource, a closure in the page's wiring
  (`visitor-stations.ts`), never the store: it changes with the camera's
  heading, many times a second (the store rule: events only).

## Examples

```ts
walkDirection(30); // "right"
walkDirection(30, "ahead"); // "ahead" (inside 28° + 5°)
walkDirectionTail(walkDirection(-90)!); // "To your left."
const dirs = createWalkDirections();
dirs.of("well", bearingDeltaDeg(stationBearing, cameraBearing));
```

## Tests

- `walk-direction.test.ts` - the thresholds, the band, the words, the
  per-station memory.
- `walk-direction.property.test.ts` - a heading jittering by less than the
  band around any threshold never changes the word; with no band the word
  is the zone alone; the band never invents a word the angle is not near.
- `walk-direction.sweep.test.ts` - word changes per slow full turn over
  ahead 20-35°, behind 120-150°, band 0-10° and jitter 0.5-3° (table to
  `WALK_DIRECTION_SWEEP_OUT`). Verdict (2026-10-21): every band at least as
  wide as the jitter gives the ideal four changes a turn at every
  threshold pair; with no band 10-62 changes. The shipped 5° holds up to
  3° of jitter; what would reverse it is a phone whose heading jitters by
  more than 5° (the field check, plan §3.2).
