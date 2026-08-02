# `sun-position.ts`

**Purpose:** the sun's position as a physical function of a time of day, and the
one direction vector both the `DirectionalLight` and the sky shader read.

Replaces `sun.ts`'s camera-following sun (§1, DEC-R6-3, reversing DEC-R4-6).

## Public API

- `sunAt(timeOfDay: number): SunAngles` — `0` sunrise east, `0.5` noon south,
  `1` sunset west. Clamps out-of-range input; a non-finite value falls back to
  `DEFAULT_TIME_OF_DAY`.
- `sunDirection(angles: SunAngles): Vector3Like` — a **unit** vector towards the
  sun in the render frame.
- `cameraAzimuth(camera, target): number` — unchanged from `sun.ts`; returns `0`
  for a camera directly above its target.
- Constants: `MAX_SUN_ELEVATION_RAD` (55°), `DEFAULT_TIME_OF_DAY` (0.98),
  `MIN_SUN_EYE_ANGLE_RAD` (π/8).

## Invariants & assumptions

- **Azimuth is clockwise from north, and north is `−z`.** The same convention
  `mesh-data.ts` and `cell-mesh.ts` use. `sun.ts` measured from `+z`, which was
  internally consistent but is not what a user means by "azimuth" — and this is
  now a user-facing control. Pinned by four tests, and a deliberate sign flip
  was confirmed to fail two of them.
- **The returned direction is unit length at every input.** The same vector
  positions the light and drives the sky's `sunPosition`; a non-unit one makes
  the painted sun and the lit highlights disagree.
- **The azimuth sweep stays inside one turn** (90° → 270°), so it needs no wrap.
  A wrap would snap the sky round mid-drag.
- **`MIN_SUN_EYE_ANGLE_RAD` is now asserted at the DEFAULT time only**, not as a
  property over all camera positions. The user may deliberately put the sun
  behind the camera; the guard protects what a first-time viewer sees.

## Known limits

- **This is a plausible day, not a correct one.** No date, no latitude, no
  equation of time — `MAX_SUN_ELEVATION_RAD` is a single constant standing in
  for the whole seasonal range (Cologne runs ~16° in December to ~62° in June).
  Nothing in the demo yet needs the sun to be in the _correct_ place, only in a
  _consistent and controllable_ one. A real solar-position model is a
  well-defined follow-up with its own tests.

## Examples

```ts
import { sunAt, sunDirection, DEFAULT_TIME_OF_DAY } from "./sun-position.js";

const angles = sunAt(DEFAULT_TIME_OF_DAY); // ~3.4° elevation, ~266° azimuth
const towardsSun = sunDirection(angles); // unit vector, +x east, +y up, −z north
light.position.copy(towardsSun).multiplyScalar(1000);
```

## Tests

- `sun-position.test.ts` — the compass convention (north/east/south/west/zenith),
  unit length over a grid of angles, noon-is-highest and day symmetry,
  monotonic azimuth with no discontinuity, clamping and the non-finite
  fallback, the low default, and the not-a-headlight guard at the default time.
