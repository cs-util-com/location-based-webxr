# `easing.ts`

## Purpose

The demo's easing curves. Today: one, `smoothstep`.

## Public API

- `smoothstep(t: number): number` — the classic `t²(3 − 2t)` on `[0, 1]`.
  - **Precondition: `t` is already in `[0, 1]`.** Not clamped, deliberately —
    every caller derives `t` from an elapsed-time ratio it has already bounded,
    and a silent clamp here would hide the case where one of them stopped doing
    so.
  - Total for in-range input; never throws.

## Invariants & assumptions

- `smoothstep(0) === 0` and `smoothstep(1) === 1` exactly. A fade that begins at
  0.02 opacity is a visible pop, so the endpoints are asserted rather than
  assumed from the algebra.
- Monotonically increasing across the interval — a fade that goes backwards
  reads as a flicker.
- Zero slope at both ends. That is the whole reason to prefer it to a linear
  ramp, and it is what all three AR-entry fades were independently reaching for.

## Why the module exists

`smoothstep` was defined three times in this package — `ar-descent.ts`,
`ar-entry-dom-veil.ts`, `ar-entry-veil.ts` — character for character, the third
added on 2026-08-23 while its own plan quoted the "search before adding" rule.
The three call sites are the AR entry's three fades, which are meant to match;
sharing the curve makes that a fact rather than a coincidence.

**Not shared with the framework.** `AppFramework`'s
`visualization/occlusion-mesh.ts` defines `smoothstep(edge0, edge1, x)` — the
three-argument GLSL form, mirroring the shader beside it. The two shapes are
related but not interchangeable, and a cross-package import edge for a one-liner
is not worth its cost (owner decision DEC-H3, 2026-08-24: pure one-liners live
once per package).

## Example

```ts
import { smoothstep } from "./easing.js";

const alpha = 1 - smoothstep(elapsedS / FADE_S); // FADE_S-second fade-out
```

## Tests

`easing.test.ts` — both endpoints exactly, symmetry about the midpoint, dense
monotonicity sampling, the near-zero slope at both ends, and a differential
check against the literal expression the three copies used, so the move is
provably not a redesign.

## Related

- `ar-descent.ts` — the fly-in's height curve.
- `ar-entry-dom-veil.ts` — the DOM veil's fade.
- `ar-entry-veil.ts` — the mesh sphere's fade after landing.
