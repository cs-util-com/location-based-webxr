# `terrain-slope.ts`

**Purpose:** slope, aspect and isocline arithmetic for §2's ground treatment —
the JS twin of what the fragment shader computes, so CI can check it.

## Public API

- `slopeSteepness(normal): number` — `length(N.xz)`, i.e. `sin(slope angle)`.
  0 flat, 1 vertical.
- `slopeAspect(normal): number` — which way the lean faces, `[-π, π]`.
- `isoclinePhase(normal): number` — steepness × `ISOCLINE_FREQUENCY`. A line is
  drawn wherever this crosses a half-period.
- `slopeTreatmentStrength(normal): number` — the flat-ground fade, `0..1`.
- Constants: `ISOCLINE_FREQUENCY` (45), `FLAT_FADE_STEEPNESS` (0.15).

Normals come from `terrainNormal` in `terrain-texture.ts` as `[x, up, z]`.

## Invariants & assumptions

- **Isoclines are lines of constant STEEPNESS, not of constant height.** A
  uniformly tilted plane has no lines on it. This is the whole idea and the easy
  thing to get wrong — height contours look plausible and would satisfy any test
  that only asked "are there lines".
- **The phase depends on steepness and nothing else.** Folding in aspect or
  height makes a tilted plane band, which looks convincing and is the wrong
  picture. Pinned by test, and a deliberate mutation was confirmed to fail it.
- **Steepness is a magnitude, not a direction.** It must not change as a
  hillside of constant lean turns, or a contour appears where the ground merely
  faces a different way.
- **Steepness is bounded by 1**, which is what lets `ISOCLINE_FREQUENCY` be a
  fixed number rather than something retuned per landscape.
- **Flat ground is faded out, and that is not decoration.** At exactly flat the
  aspect is undefined and the phase is zero everywhere at once, so a large flat
  area would be uniformly inside or outside a line and would flip between the
  two on numerical noise — a whole car park strobing.

## What cannot be tested here

`fwidth`. The shader uses it to keep a drawn line one pixel wide at any
distance, and there is no CPU equivalent — it is a screen-space derivative. That
is also the reason DEC-R6-7 rejected implementing the treatment as CPU vertex
colours.

## Examples

```ts
import { terrainNormal } from "./terrain-texture.js";
import { isoclinePhase, slopeSteepness } from "./terrain-slope.js";

const n = terrainNormal(texture, x, y);
slopeSteepness(n); // 0 on flat ground
isoclinePhase(n); // crosses a half-period wherever a line belongs
```

## Tests

- `terrain-slope.test.ts` — steepness is `sin(angle)`, monotonic, and
  aspect-independent; aspect has no branch-cut jump; the phase depends only on
  steepness; the flat fade is smooth and reaches both ends.
- `ground-slope-shader.test.ts` covers the GLSL that mirrors this.
