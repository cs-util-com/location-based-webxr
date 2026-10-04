# sun-shadow-rig.ts

## Purpose

The pure half of the AR sun shadow prototype (plan
`GpsPlusSlamJs_Docs/docs/2026-09-23-2343-ar-sun-shadow-prototype-plan.md`,
M1). It decides where the shadow-casting sun light goes and its orthographic
shadow camera, when the shadow map must be re-rendered (the phone's cost
lives there), how dark the shadow is drawn over the camera image, and below
which sun it is off. No three.js; the three.js part and the OsmDemo AR wiring
are the plan's M2 and M3.

## Public API

- `SUN_SHADOW`: the defaults.
  - `halfWidthM` R: 25.
  - `marginM`: 30, so D = R + 30 m.
  - `sunUpdateDeg`: 0.05.
  - `innerFraction`: 0.25.
  - `casterMoveM`: 0.01.
  - `minSunElevationDeg`: 10.
  - `transmittance`: 0.3.
  - `mapSize`: 1024.
- `sunShadowPose({ sunDir, centre, halfWidthM?, distanceM? })` returns
  `{ position, target, bounds }`.
  - The light is at `centre + sunDir · D`, aimed at the centre.
  - The bounds are a ±R square, near 0 (the light itself), far D + R.
  - `RangeError` for a non-finite or non-unit direction, a sun at or below
    the horizon, a non-finite centre, R ≤ 0, or D ≤ R.
- `shadowNeedsUpdate(lastRendered, now, thresholds?)` returns `true` when:
  - nothing has been rendered yet;
  - the caster generation or R changed;
  - the sun moved more than `sunDeg`;
  - the caster offset moved more than `casterMoveM`;
  - the user moved more than `innerFraction · R` horizontally (Euclidean)
    from the rendered centre.
  - `RangeError` for a non-finite state or a negative or non-finite
    threshold. A NaN would otherwise make every comparison false and stop
    the updates silently.
- `shadowOpacity(t)` = `1 - t^(1/2.2)`: the display opacity for a linear
  transmittance. `RangeError` outside [0, 1].
- `sunShadowActive(elevationDeg, floorDeg?)`: on from the floor up. `false`
  for a non-finite elevation; `RangeError` for a non-finite floor.
- Types:
  - `Vec3`;
  - `SunShadowPose`;
  - `ShadowUpdateState` (`sunDir`, `centre`, `halfWidthM`,
    `casterGeneration`, `casterOffsetM`);
  - `ShadowUpdateThresholds`.

## Invariants & assumptions

- **Frame-agnostic, y up** (plan review finding 12). Each call site converts
  its own sun direction: NUE in AR (the framework's `sunDirectionNue` feeds
  in as is, tested), and x east / −z north on the look-dev page.
- **The camera is three.js's own.** The pose was checked by building a real
  `DirectionalLight` and projecting points through `shadow.matrix`.
  - Every point within R of the centre is inside the map: a sphere, not the
    whole square. The six extreme points are included.
  - So is the column toward the sun, up to the light, because near is 0.
    That makes the margin real coverage for tall casters on the sun side.
  - A point just past R laterally is outside.
- **Coverage chose `innerFraction`** (M1 review, finding 2). For the 1.5 m
  test pole within 6 m of the user, the shadow must stay in the map for
  every drift that does not trigger an update. The sweep over R {10, 25, 75},
  the inner fraction {0.25, 0.5} and the sun {10, 20, 40}° shows:
  - at R 25, 0.5 cuts at a 10° sun and 0.25 holds at every sun;
  - R 10 cuts at 10° and 20° even at 0.25.
  - 0.25 means the map re-centres every 6.25 m walked.
- **Call with the state of the LAST RENDER** (M1 review, finding 7), and
  store it only when the rule said yes. Sub-threshold steps then add up (a
  test does exactly that); a caller keeping the last FRAME would never
  update.
- **Casters in two parts** (M1 review, finding 6):
  - a generation compared exactly (a rebuild, the caster count);
  - an offset compared against `casterMoveM`. OsmDemo's content root eases
    every frame during the AR descent and the elevation ease; exact matching
    would re-render every frame for seconds.
  - A stale map moves a shadow by Δy·cot e, 5.7× Δy at 10°, so 1 cm is the
    default. Sweep it on the phone.
- **The receiver height is not a trigger** (review finding 4). A receiver
  only samples the map.
- **0.05°, not 0.25°** (review finding 5). A step Δe moves a shadow tip by
  h·Δe/sin²e: 14.5 cm for a 1 m pole at 10° at 0.25°.
- **The elevation floor** (10°; review finding 10). Ground texels stretch by
  1/sin e (5.8× at 10°), and long shadows leave the map.

## Example

```ts
if (sunShadowActive(elevationDeg)) {
  // check first: sunShadowPose throws for a sun at or below the horizon
  const now = {
    sunDir: sunNue,
    centre: userOnGround,
    halfWidthM: SUN_SHADOW.halfWidthM,
    casterGeneration: `${rebuilds}:${casters.length}`,
    casterOffsetM: contentRoot.position.y,
  };
  if (shadowNeedsUpdate(lastRendered, now)) {
    const pose = sunShadowPose(now);
    // light.position / target = pose.position / pose.target; camera bounds
    light.shadow.needsUpdate = true;
    lastRendered = now;
  }
}
```

## Tests

- `sun-shadow-rig.test.ts`:
  - the pole shadow's direction (away from the sun) and length (1/tan e),
    from an independent line-plane formula, over azimuths and elevations;
  - the south-sun known answers in both frames, and the framework's
    `sunDirectionNue` fed in as is;
  - the whole bounds object;
  - the `RangeError`s, including D ≤ R and a NaN half width;
  - the update rule: at and past each threshold, sub-threshold steps adding
    up, the Euclidean diagonal, caster generation vs offset, an R change,
    and the refusals;
  - the opacity curve at 0.2 / 0.3 / 0.5 (0.5188 / 0.4215 / 0.2703);
  - the elevation floor, swept.
- `sun-shadow-rig.property.test.ts` (fast-check and three.js):
  - the sphere, the extreme points and the sunward column inside the real
    shadow matrix, and the square's edge outside;
  - the coverage sweep (logged as a table), which pins the default.
