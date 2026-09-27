# ring-shadow.js

## Purpose

Shadows over the look-dev page's whole dense city (round-2 plan
`GpsPlusSlamJs_Docs/docs/2026-09-26-2055-owner-feedback-round-2-plan.md`,
M2b), without giving up the sun's sharp central map. The owner's words:
"shadows must work on all 42k buildings, not just the central ones".

- The sun keeps its central map: ±220 m at 2048, 0.21 m texels, driven by
  the framework's rig ([`sun-shadow.ts`](../../GpsPlusSlamJs_AppFramework/src/visualization/sun-shadow.ts.md)).
- A second `DirectionalLight` with **no intensity** carries a coarse map over
  the ring: ±2450 m at 2048, 2.4 m texels. The same rig re-renders it only
  when the sun moves or the city changes.
- The sun takes its shadow from the central map inside that map's frustum,
  and from the ring map outside it. It fades between them over the outer
  tenth of the central square.

## Public API

- `withRingShadow(chunk)` takes three's `ShaderChunk.lights_fragment_begin`
  and returns it with the ring shadow.
  - It is idempotent, detected by a marker comment.
  - It throws an `Error` when three's shadow line is not found. A three
    upgrade that rewords that line fails loudly instead of leaving the far
    city unshadowed.
- `RING_HALF_WIDTH_M` (2450): the dense city stops at 2350 m.
- `RING_MAP_SIZE` (2048).

The light, its rig and its lifetime live in `lookdev.js`
(`applyRingShadow`), as ordinary page code.

## Invariants & assumptions

- **Inert with one shadow.** The rewrite acts only when
  `NUM_DIR_LIGHT_SHADOWS >= 2`, so the page installs it once at load. With
  shadows off, or with the block alone, programs are three's own.
- **Shadow 0 is the sun, shadow 1 the ring.** three orders shadow-casting
  lights by scene traversal, so the page adds the ring light after the sun,
  under the same parent.
  - Were the order swapped, the sun would lose its shadow entirely. The
    smoke's near probe with the ring on catches that.
- **The central map is chosen by its whole frustum, depth included.** x and
  y are lateral to the sun's ray. At a 5° sun, ground 500 m out along the
  sun's azimuth lies only 44 m off the ray, inside the square. The first
  spike therefore read such ground "lit", from beyond the central map's
  depth: golden-hour coverage 0.64 against the correct 0.89.
- **The ring's own lookup is skipped** (index 1 carries no light). The sun's
  shadow intensity applies to both maps.
- **Cost.** One more map (16 MiB at 2048), rendered only when the sun or the
  city changes. One extra PCF lookup applies, only past the central square.
  In SwiftShader a frame took 10-15 % longer (relative only).
- **Why not the alternatives.** Measured 2026-09-27 (plan §10):
  - **One map fitted to the ring** shadows the far city just as well. But
    it coarsens the central texels elevenfold, the shadow's foot 0.3 m
    from a building loses a fifth of its darkening, and metre-sized casters
    fall below one texel.
  - **three's CSM** replaces the same chunks the page's haze chains onto
    (plan §3).

## Example

```js
import * as THREE from "three";
import { withRingShadow } from "./ring-shadow.js";

THREE.ShaderChunk.lights_fragment_begin = withRingShadow(
  THREE.ShaderChunk.lights_fragment_begin,
);
// Then add a DirectionalLight(0xffffff, 0) after the sun, under the same
// parent, drive it with createSunShadow, and update it when the sun moves.
```

## Tests

- `ring-shadow.test.mjs` (node:test) runs against the real chunk of the
  three the page serves. It covers:
  - the sun's two maps;
  - the depth test;
  - three's fallback line kept;
  - idempotence;
  - the refusal of an unknown chunk.
- `lookdev.smoke.spec.mjs`, "the dense city's far buildings cast shadows,
  past the sharp central map". At golden hour, ground around far lots at
  500, 1400 and 2300 m must darken. The share is logged at 10/20/40 levels
  and must be at least `RING_COVERAGE_MIN` at 20. The test also covers:
  - the near probe still darkening with the ring on;
  - the readout;
  - no ring for the block alone.
