# camera-heading.ts

## Purpose

The camera's heading for the visitor's walk: the bearing of the camera's forward, held
while the forward has too little of a horizontal part to carry a bearing
worth showing. The station guide (`station-guide.ts`) reads it each tick;
the radar turns by it and the direction words (`walk-direction.ts`) are
measured from it.

## Public API

- `WALK_HEADING_MIN_SHARE = 0.25` - the horizontal share below which the
  heading is held (the camera within about 14.5 degrees of straight down).
- `horizontalShare(forward) => number` - `hypot(north, east) / |forward|`
  of a forward in NUE (`[north, up, east]`): 1 level, 0 straight up or
  down; 0 for a zero or non-finite forward.
- `cameraHeadingDeg(forward, lastDeg, minShare?) => number | null` - the
  forward's bearing in `[0, 360)`, degrees from north; `lastDeg` (null
  before any) for a null forward, a share below `minShare`, or a forward
  with no bearing.

## Invariants & assumptions

- The forward is the camera's, through the alignment (world NUE); its
  length need not be 1.
- A held heading is the last one the caller kept: this module keeps no
  state. The guide resets its own at each AR entry's end.
- Never a guess: with no heading yet and the camera near vertical the
  result is null, not 0 (which would claim "facing north").
- The framework's map line (`user-heading.ts`, `VERTICAL_GUARD = 0.08`)
  answers another question (a line on a map, null near vertical, no
  hold); the walk needs a larger share because its radar is heading-up
  and its words flip past a 5 degree band.

## The share's sweep (2026-10-22)

- Model: the camera pitched 0-90 degrees down in 0.25 degree steps,
  rolled `j` degrees either way about its bearing's horizontal axis (a
  phone held flat tips its camera sideways when it rolls); the swing is
  the heading reported shaken against the one reported held still, the
  worst over all pitches.
- Table (share: held from; worst swing at 0.5 / 1 / 2 degrees of tremor):
  - 0.15: 81.5 deg down; 3.2 / 6.5 / 13.1
  - 0.20: 78.5; 2.4 / 4.9 / 9.7
  - 0.25: 75.75; 1.9 / 3.9 / 7.7 (shipped)
  - 0.30: 72.75; 1.6 / 3.2 / 6.3
  - 0.35: 69.75; 1.3 / 2.7 / 5.3
  - 0.40: 66.5; 1.1 / 2.3 / 4.6
  - 0.45: 63.5; 1.0 / 2.0 / 4.0
  - with no share at all (the old 1e-6 limit): 26.6 at 88 degrees down.
- Verdict across the range: every share from 0.20 keeps one degree of
  tremor under the words' 5 degree hysteresis; 0.15 does not. 0.25 ships
  as the smallest with a margin (0.20 reaches 4.9). A larger share trades
  a smaller swing for a heading held over a wider band.
- What would reverse it: phone data showing about 2 degrees of tremor at
  steep pitches (then 0.40), or visitors walking with the phone between
  65 and 75 degrees down (then a smaller share, accepting the swing).

## Examples

```ts
let last: number | null = null;
last = cameraHeadingDeg([1, 0, 0], last); // 0, facing north
last = cameraHeadingDeg([0.03, -1, 0.02], last); // 0, held
```

## Tests

- `camera-heading.test.ts` - the share; the bearing above it; the hold at
  88 degrees down rolled a degree either way; the edge; a property over
  random forwards; the sweep's table (to the file `WALK_HEADING_SWEEP_OUT`
  names) and its verdict.
- `station-guide.radar.test.ts` - the guide holds its heading at 88
  degrees down and follows again at 60.
