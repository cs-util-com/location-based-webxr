# `smoothstep.ts`

## Purpose

The landing page's **one** smoothstep curve, shared by the hero veil and both
scene gradients.

## Public API

- `smoothstep(t: number): number` — the classic cubic `t²(3−2t)`. Zero slope at
  both ends, `smoothstep(0) === 0`, `smoothstep(1) === 1`, symmetric about
  `0.5`.

## Invariants & assumptions

- **It does not clamp.** `t` must already be in `[0, 1]`; out-of-range input
  leaves the unit interval (`smoothstep(2) === -4`). This matches
  `GpsPlusSlamJs_OsmDemo/src/easing.ts`, and the reason is the same: clamping
  here would hide the day a caller's `t` silently leaves range, which is a live
  risk on a scroll-driven page where every `t` is a ratio of measured spans.
- **Callers clamp with [`clamp01`](./clamp01.ts.md)**, whose non-finite → `0`
  contract is what keeps a `NaN` out of a colour lerp. Passing a raw ratio
  straight in is a bug at the call site, not here.
- Pure and dependency-free.

## Why it exists as a module

The curve was written **three times in this package** as a bare, unnamed
expression — `hero-veil.ts`, `scene/sky-dome.ts`, `scene/portal.ts`. Worth
knowing that no guard could have caught it:

- `tests/repo-config/duplicate-helpers.test.js` holds `smoothstep` to one
  definition per package, but matches **declarations**. An expression nobody
  named is invisible to it. Its own header says so.
- `check:dup` runs jscpd per package at a 50-token floor; this expression is
  nine tokens.

All three sites also inlined `Math.min(1, Math.max(0, x))` beside a
`clamp01.ts` that had existed in this package all along — so the same three
lines carried two separate duplications, and the named half of one of them was
already guarded.

**Not shared with the framework**, deliberately: this package does not depend
on it (DEC-H3), and `AppFramework`'s `visualization/occlusion-mesh.ts` carries
the three-argument GLSL form `smoothstep(edge0, edge1, x)` that mirrors a
shader line for line — related, not interchangeable.

## Examples

```ts
import { clamp01 } from "./clamp01.js";
import { smoothstep } from "./smoothstep.js";

const eased = smoothstep(clamp01(scrolledPx / spanPx));
```

## Tests

`smoothstep.test.ts` — both endpoints, midpoint symmetry, the zero-slope
property that is the reason to use this curve rather than a linear ramp, and
the unclamped contract (pinned so a later session does not clamp inside and
make the callers' `clamp01` calls look redundant).

The three call sites keep their own coverage: `hero-veil.test.ts`,
`scene/sky-dome.test.ts` and `scene/portal.test.ts`.
