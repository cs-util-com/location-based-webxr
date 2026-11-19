# ring-shadow.js

## Purpose

The sizes of the look-dev page's ring shadow: shadows over the whole dense
city without giving up the sun's sharp central map.

- The sun keeps its central map: ±220 m at 2048, 0.21 m texels, driven by
  the framework's rig ([`sun-shadow.ts`](../../GpsPlusSlamJs_AppFramework/src/visualization/sun-shadow.ts.md)).
- A second `DirectionalLight` with **no intensity** carries a coarse map over
  the ring: ±2450 m at 2048, 2.4 m texels. The same rig re-renders it only
  when the sun moves or the city changes.
- The sun takes its shadow from the central map inside that map's frustum,
  and from the ring map outside it. The shader rewrite that does this is the
  framework's [`two-map-shadow.ts`](../../GpsPlusSlamJs_AppFramework/src/visualization/two-map-shadow.ts.md)
  (`withTwoMapShadow`): its sidecar holds the fade, the depth test, the
  light order and why it is a chunk rewrite rather than three's CSM. The
  page installs it once at load.

## Public API

- `RING_HALF_WIDTH_M` (2450): the dense city stops at 2350 m.
- `RING_MAP_SIZE` (2048).

The light, its rig and its lifetime live in `lookdev.js`
(`applyRingShadow`), as ordinary page code.

## Invariants & assumptions

- **The central map must hold the whole city's casters.** Receivers inside
  its frustum read only it, so the page stands its camera beyond the ring
  (`distanceM` = 2480 m, not the rig's R + 30 m). At 250 m the dense
  buildings, which start at 420 m, were behind that camera. At a low sun
  their long shadows then had a hole across the centre: measured at golden
  hour, 0 of the central ground 120-210 m toward the sun darkened, against
  0.5 now. Depth over 2.7 km still resolves to well under a millimetre per
  step. With that range the central map's depth fade (0.98-0.995 of its
  depth) spans about 165-205 m past the centre.
- **Shadow 0 is the sun, shadow 1 the ring.** The page adds the ring light
  after the sun, under the same parent. Were the order swapped, the sun
  would lose its shadow entirely.
- **The ring's normal bias shortens far shadows.** The rig sets one texel,
  2.4 m, which on the ground shortens every ring shadow by bias /
  tan(elevation): about 27 m at a 5° sun, about 1.5 m at noon.
- **`ShadowMaterial` receivers are not handled.** Its shadow mask
  multiplies every directional shadow, so it would apply the ring map on
  top of the central one. Nothing on the page receives through it today;
  the catalog's entries only cast.
- **Cost.** One more map (16 MiB at 2048), rendered only when the sun or the
  city changes. One extra PCF lookup applies, only past the central square.
  In SwiftShader a frame took 10-15 % longer (relative only). Switching the
  ring on or off recompiles every lit program, since the shadow count is
  part of three's program key.
- **The ring size.** At 1024 (4.8 m texels) a coverage metric (darkened
  pixels around lots) read the same as at 2048. It does not measure shadow
  length, which the doubled normal bias shortens by about 55 m at a 5° sun.
- **Why not one map fitted to the ring.** Measured: it shadows the far city
  just as well, but it coarsens the central texels elevenfold, the shadow's
  foot 0.3 m from a building loses a fifth of its darkening, and metre-sized
  casters fall below one texel.

## Example

```js
import * as THREE from "three";
import { withTwoMapShadow } from "/fw/visualization/two-map-shadow.js";
import { RING_HALF_WIDTH_M, RING_MAP_SIZE } from "./ring-shadow.js";

THREE.ShaderChunk.lights_fragment_begin = withTwoMapShadow(
  THREE.ShaderChunk.lights_fragment_begin,
);
// Then add a DirectionalLight(0xffffff, 0) after the sun, under the same
// parent, drive it with createSunShadow over RING_HALF_WIDTH_M at
// RING_MAP_SIZE, and update it when the sun moves.
```

## Tests

- The rewrite's tests are the framework's `two-map-shadow.test.ts`, against
  the real chunk of the three the page serves.
- `3d/pages.fast.spec.mjs` loads the look-dev page, so a chunk the page
  cannot compile or an import the `/fw/` route cannot serve fails there.
