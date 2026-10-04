# smoothstep.ts

## Purpose

The framework package's one three-argument `smoothstep`: GLSL's built-in
(clamped Hermite), mirrored exactly for the TS twins of shaders (the occluder
fade in `visualization/occlusion-mesh.ts`, the atmosphere haze boundary and
cloud density).

## Public API

- `smoothstep(edge0, edge1, x)` → 0 at/below `edge0`, 1 at/above `edge1`,
  Hermite in between.

## Invariants & assumptions

- Clamps, like GLSL.
- Not the one-argument easing curve `smoothstep(t)` of OsmDemo's `easing.ts`
  or the Landing page; the duplicate-helper guard's exemption for the name
  is keyed to this file and carries that reason.
- Promoted from a private copy in `occlusion-mesh.ts` on 2026-09-23 (DEC-H3:
  a one-liner once per package), when the atmosphere needed it twice.

## Examples

```ts
smoothstep(fogNear, fogFar, depth); // three's linear-fog ramp
```

## Tests

`smoothstep.test.ts` — edges, midpoint, clamping, monotone within [0, 1].
