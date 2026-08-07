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
- **`cameraAzimuth` was removed on 2026-08-07**, and the reason is worth keeping
  because the function looked load-bearing for two rounds after it stopped being
  so. It measured which compass direction the view came from, and existed for
  DEC-R4-6: the sun tracked the camera at a fixed 45° offset so the reflective
  ground's facet highlight was always visible, instead of only over the band of
  azimuths a fixed sun happened to light. DEC-R6-3 reversed that — a sun that
  follows the camera makes the whole scattering sky spin as you pan — so the sun
  became physical and this lost its only caller.
  - It then survived on a **false** docstring ("other code reads it") and on its
    own test import, which is the only thing that kept it past the dead-code
    check. It had also silently kept `sun.ts`'s old convention, measuring from
    `+z` while the module header states north is `−z`: **180° out** from every
    other angle in the file, and its test could not have caught that (one
    north/south case that returns 0 under both readings, one east case where the
    symmetry makes them agree). #264's review found the convention error and it
    was fixed; #264's other option — delete it — was taken on the owner's call
    once it was clear nothing had read it since round 6.
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
