# `sun-position.ts`

**Purpose:** the one direction vector both the `DirectionalLight` and the sky
read, from a sun's angles, plus the camera-vs-sun rule for the default view.
Import-free on purpose: the look-dev page
(`GpsPlusSlamJs_DesignSystem/3d/lookdev.js`) loads `sunDirection` from it
without a build.

Replaces `sun.ts`'s camera-following sun (§1, DEC-R6-3, reversing DEC-R4-6).
**Where** the sun is lives in [`sun-clock.ts`](sun-clock.ts.md) since plan
2026-09-23-2149: the real sun for the map's place and a date. The "plausible
day" that lived here (`sunAt`, a fixed 55° noon with no date or place,
`DEFAULT_TIME_OF_DAY`, `MAX_SUN_ELEVATION_RAD`) is retired.

## Public API

- `sunDirection(angles: SunAngles): Vector3Like` — a **unit** vector towards the
  sun in the render frame.
- `SunAngles` (`elevationRad`, `azimuthRad`) and `Vector3Like`.
- `MIN_SUN_EYE_ANGLE_RAD` (π/8) — how far the BOOT sun must stay off the
  default camera's eye vector.
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
    other angle in the file, and its test could not have caught that. #264's
    review found the convention error and it was fixed; #264's other option —
    delete it — was taken on the owner's call.

## Invariants & assumptions

- **Azimuth is clockwise from north, and north is `−z`.** The same convention
  `mesh-data.ts`, `cell-mesh.ts` and the framework's `geo/solar-position`
  use, so the real sun needs no conversion. Pinned by four tests, and a
  deliberate sign flip was confirmed to fail two of them.
- **The returned direction is unit length at every input.** The same vector
  positions the light and drives the sky; a non-unit one makes the sky's sun
  and the lit highlights disagree.
- **`MIN_SUN_EYE_ANGLE_RAD` is asserted at the BOOT sun**, not over all camera
  positions (the user may put the sun behind the camera on purpose). Since the
  sun is real, the boot sun moves with the date and the place, so the guard
  is swept over every place the picker offers and every month.

## Examples

```ts
import { sunDirection } from "./sun-position.js";

const towardsSun = sunDirection({ elevationRad, azimuthRad }); // +x east, +y up, −z north
light.position.copy(towardsSun).multiplyScalar(1000);
```

## Tests

- `sun-position.test.ts` — the compass convention (north/east/south/west/zenith),
  unit length over a grid of angles, and the not-a-headlight guard at the
  boot sun of every picker place in every month.
