# globe-approach-meteor.ts

## Purpose

The editor's approach flight on opening a tour in the globe view: the
globe package's own meteor (the pin flight of the globe lab), from high
above down to close to the tour, on the editor's camera. It is the
`ApproachDriver` that `globe-approach-run.ts` drives. One set of rules
with the lab: the trajectory, its pacing on loaded data, its safety cap
and its landing all come from `gps-plus-slam-globe/view`
(`createGlobeApproach`, `createGlobeLandingFlight`, `createApproachDrive`,
`PIN_FLIGHT`, `METEOR_PACE`, `pinEnd`); this file only wires them to the
editor.

## Public API

- `MeteorKnobs` - `meteorDeg` (entry angle below the tour's horizon, deg),
  `meteorLandDeg` (landing angle, held over the final stretch, deg),
  `landAglM` (landing height over the tour's ground, m), `startKm` (start
  height over the ellipsoid, km). Read from the link by `globe-switch.ts`.
- `createMeteorApproach(deps): ApproachDriver` with
  - `ellipsoid` - the globe's ellipsoid;
  - `view` - the globe view's `camera`, `ecefCamera`, `placeCameraEcef` and
    `fitDistance` only (never its frame);
  - `controls` - `{ release() }`, released when the landing takes over;
  - `tour` (`{lat, lng}`, deg) and `groundM` (its ground, m over the
    ellipsoid; non-finite or negative reads as 0, as the flight needs: a
    tour below the ellipsoid, at the Dead Sea, lands over the ellipsoid);
  - `knobs` - `MeteorKnobs`;
  - `progress()` - the tour's loading, 0 to 1 (clamped; NaN reads 0);
  - `reliefGroundM(place)` - the relief's finest ground there, or null;
  - `reducedMotion` - a cut to the end view, no flight;
  - `durationMs` (optional, the page's checks) - the flight runs on a
    clock scaled so it lasts that long at a full pace;
  - `now` (optional) - the page clock, default `performance.now`.
- The returned driver: `durationMs` (0 under reduced motion, else the
  asked length or the path's own), `start`, `drive` (true only while the
  flight approaches or descends), `retarget`, `takeOver`, `bar` (see
  `globe-approach-run.ts.md`).
- `TourArrival` and `tourArrivalProgress(arrival)` - the tour's loading
  as the flight's progress: 0 until the ground at the tour is known and
  the relief has settled, then the share of stations admitted (1 for a
  tour without stations), clamped to 0..1.
- `isFlyingPhase(phase)` - true for `approaching` and `descending` only.

## Invariants & assumptions

- **One continuous trajectory.** The camera is placed out on the meteor's
  line (30 degrees south of the tour, at `startKm`) before the first
  frame; the flight enters at `meteorDeg` and steepens monotonically to
  `meteorLandDeg`, which it holds over the final stretch, and lands
  `landAglM` over the ground (so about `landAglM / sin(meteorLandDeg)` from
  the tour). No settle and no tilt of the editor's own.
- **Paced as in the globe.** The flight flies the lab's meteor pace
  (`METEOR_PACE`: a 5 s lag in two stages, an S-curve with no jerk at its
  start), its gate reads `progress`, and it lands without it after the
  lab's safety cap (`PIN_FLIGHT.safetyCapMs`). In the editor "loaded" is
  what loads at the tour whatever the camera does
  (`tourArrivalProgress`): the relief's ground at the tour known, the
  relief settled, then the share of stations admitted. The street map
  near the tour cannot gate it: it loads only within a few kilometres of
  the camera, so a gate holding high above would wait for it forever.
- **The frame is never set here.** Only `placeCameraEcef` is called; the
  view's frame follows through its own recentring: the frame is no
  longer moved per frame.
- **Reduced motion** places the flight's end camera (as it would land with
  the tour loaded) on the first frame and lands.
- **Retarget** starts a new leg from the camera as it is: position,
  direction and speed stay continuous. A retarget during the flight lands
  at the meteor's landing (its angle and `landAglM`), whatever the
  selection's size; once landed, the same action frames the selection by
  its radius. The meteor's landing is one rule.
- **Takeover** stops the flight for good: `drive` returns false and places
  nothing (the approach's "user" phase is never driven).
- **The bar** reads the height over the ground on a log scale, from the
  start height to `landAglM`: 0 at the start, 1 at the landing, only
  rising as the camera falls.
- The defaults (`globe-switch.ts`): 20 degrees in (the lab's default is
  30), 50 out (inside 45-60), 150 m over the ground (about 200 m from the
  tour: its pins and rings fill the view), from 8000 km (the hemisphere
  in view).

## Examples

```ts
const driver = createMeteorApproach({
  ellipsoid,
  view,
  controls,
  tour: { lat: 48.137, lng: 11.575 },
  groundM: 519,
  knobs: { meteorDeg: 20, meteorLandDeg: 50, landAglM: 150, startKm: 8000 },
  progress: () => admitted / stations,
  reliefGroundM: () => null,
  reducedMotion: false,
});
const run = createApproachRun({ box, driver, reducedMotion: false });
// each frame: run.drive(now); run.step(now, altitudeKm);
```

## Tests

`globe-approach-meteor.test.ts` (a stand-in view whose `placeView` and
`setFrameTarget` must never be called), swept over Marienplatz, a
high-latitude goal and a goal across the date line, times three knob
settings (the defaults; 20 to 60; 30 to 45 from 65,000 km): the landing
within the chosen distance, the angles at the entry and the landing, a
bounded turn rate, the speed from one frame to the next bounded over the
whole flight (below 1.08), the first placement on the line, the pacing by
loading and its cap, the arrival's parts, the flying phases, a tour below
the ellipsoid, the checks' clock, the reduced-motion
cut, the takeover, retargets kept continuous (one below the bend), and the bar.
`editor3d-globe.test.ts` wires the arrival with a stand-in that admits:
the flight lands soon after the tour is in, well before the safety cap,
and only by the cap without each part.
`playwright-tests/editor3d-globe-approach.spec.js` covers it in the page,
including the frame moved only by its recentring.
