# code-spot-settle.ts

**Purpose.** The settle's measurement for the automatic code-spot rule
(code book plan, M6 v5.1). For each kept sighting of a stored code, it
measures how far the visit's GPS puts the code from each of the code's
KNOWN spots. `code-spots.ts` then decides.

It measures with the viewer's own rigid fit, so creator and visitor read
"moved" with one estimator:

- `estimateCodeDisplacement` with `CODE_MOVE_ESTIMATOR`;
- the shipped gate: `CODE_MOVE_RULE.minSpanS` and `minSpreadM`;
- the viewer's window: `MOVED_CODE_FIT_WINDOW_S` before the sighting,
  `MOVED_CODE_HORIZON_S` after it.

## Public API

- `interface SpotSighting { atMs, codeOdomNue, seenNue? }` - one kept
  sighting:
  - `atMs` is when it was seen, the centre of the window;
  - `codeOdomNue` is the stable pose in odometry-NUE;
  - `seenNue` (optional) is where the visit's alignment saw it, as north
    and east.
- `judgeCodeSpots({ spots, sightings, samples, candidate, reliable,
frameChanged, previousExpires, floorM? })` returns
  `{ decision, classes }`.
  - **Inputs:**
    - `spots` - the known spots as NUE poses in the visit's frame: the
      current one, `previous`, then the copies;
    - `samples` - the visit's device fixes as `DisplacementSample`s;
    - `candidate` - where a move would mint the code, or null.
  - **Outputs:**
    - `decision` - the `CodeSpotDecision`;
    - `classes` - per sighting, the known spot it belongs to: `"new"`
      for none, null without a fit and without `seenNue`.

## Invariants and defensive measures

- **One fit per (sighting, spot).** The pin is that spot's pose. If the
  gate is not met, the sighting has no distances at all, and so judges
  nothing.
- **A sighting without a fit is still classified** by where the visit's
  alignment saw it (`seenNue`, v5 review #3). It never decides an
  automatic change, but it lets the settle refuse a second print's
  correction.
- **No pose to mint (`candidate` null) moves nothing.** It counts as
  "near a known spot".
- **The caller gives only THIS visit's fixes.** The store's GPS list spans
  every visit of the page. An earlier visit's fixes carry another odometry
  origin, and a re-entry within the window would mix the two frames.
- Pure: no store, no geo. The caller converts each level's geo with
  `objectPoseNue`.

## Example

```ts
const { decision, classes } = judgeCodeSpots({
  spots: [{ spot: { kind: "current" }, pose: storedNue }],
  sightings: [{ atMs, codeOdomNue: odomNueFromWebXr(sighting.odomPose) }],
  samples: displacementSamples({ gpsPositions, odometryPositions, zero }),
  candidate: [north, east],
  reliable: true,
  frameChanged: false,
  previousExpires: false,
});
```

## Tests

`code-spot-settle.test.ts` uses an exact world: the odometry is the truth,
and the GPS is the truth plus an offset. It covers:

- seen at the saved spot;
- a move;
- an undo;
- a whole-visit GPS shift reading as moved (the measured false-trigger
  case);
- the window;
- the gate;
- the unfitted classification;
- the nearest spot;
- no move when the minted pose lies near a known spot, or when there is
  none.

Five hand mutations were each caught: the window, the gate, the fallback,
the candidate, and the pin's argument order.
